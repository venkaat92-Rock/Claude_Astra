"use client";

import type { AstraPart } from "@/lib/types";

export interface Attachment {
  id: string;
  name: string;
  size: number;
  kind: "image" | "document" | "text" | "file";
  status: "processing" | "ready" | "error";
  /** Parts to include in the user message (image/document/text). */
  parts: AstraPart[];
  /** Workspace path when the file was uploaded instead of inlined. */
  path?: string;
  /** Workspace path of the extracted text for Office/PDF uploads. */
  textPath?: string;
  preview?: string; // data URL for images
  error?: string;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const DOC_TYPES = new Set(["application/pdf"]);
const TEXT_EXT = /\.(md|txt|json|ya?ml|toml|csv|tsv|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|sh|sql|env|ini|cfg|xml|svg|tf|log|dockerfile)$/i;
const MAX_INLINE_IMAGE = 4 * 1024 * 1024; // after resize
/** Inline fallback for PDFs when the workspace upload fails (base64 grows it by a third). */
const MAX_INLINE_DOC = 3 * 1024 * 1024;
const MAX_INLINE_TEXT = 200 * 1024;
const MAX_IMAGE_EDGE = 1568;

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function toBase64(buf: ArrayBuffer): string {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Downscale large images in the browser so they fit model limits and keep uploads small. */
async function normalizeImage(file: File): Promise<{ blob: Blob; data: string; mediaType: string; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const needsResize = scale < 1 || file.size > MAX_INLINE_IMAGE;
  if (!needsResize) {
    const data = toBase64(await file.arrayBuffer());
    return { blob: file, data, mediaType: file.type, preview: `data:${file.type};base64,${data}` };
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const mediaType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const url = canvas.toDataURL(mediaType, 0.88);
  const data = url.split(",")[1];
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mediaType }), data, mediaType, preview: url };
}

/** Largest file that may go through the app server when direct-to-S3 upload is unavailable. */
const MAX_SERVER_UPLOAD = 4 * 1024 * 1024;

/**
 * Save a file in the user's workspace under uploads/. Uploads go straight to S3 with a
 * presigned URL (no size limit from the app server); if that fails, small files fall
 * back to the server upload route.
 */
async function uploadToWorkspace(blob: Blob, name: string): Promise<{ path: string; text?: string; textPath?: string; extractError?: string; viaServer: boolean }> {
  let directError = "";
  try {
    const r = await fetch("/api/workspace/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, contentType: blob.type || undefined, size: blob.size }),
    });
    const j = (await r.json().catch(() => ({}))) as { path?: string; url?: string; contentType?: string; error?: string };
    if (!r.ok || !j.path || !j.url) throw new Error(j.error ?? `HTTP ${r.status}`);
    const put = await fetch(j.url, { method: "PUT", headers: { "Content-Type": j.contentType ?? "application/octet-stream" }, body: blob });
    if (!put.ok) throw new Error(`S3 upload failed (HTTP ${put.status})`);
    return { path: j.path, viaServer: false };
  } catch (err) {
    directError = err instanceof Error ? err.message : String(err);
  }
  if (blob.size > MAX_SERVER_UPLOAD) throw new Error(`upload failed: ${directError}`);
  const form = new FormData();
  form.append("file", new File([blob], name, { type: blob.type }));
  const res = await fetch("/api/workspace/upload", { method: "POST", body: form });
  const j = (await res.json().catch(() => ({}))) as { path?: string; textPath?: string; text?: string; extractError?: string; error?: string };
  if (!res.ok || !j.path) throw new Error(j.error ?? `upload failed (HTTP ${res.status}; direct upload: ${directError})`);
  return { path: j.path, text: j.text, textPath: j.textPath, extractError: j.extractError, viaServer: true };
}

async function extractOnServer(path: string): Promise<{ text?: string; textPath?: string; extractError?: string }> {
  const r = await fetch("/api/workspace/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
  const j = (await r.json().catch(() => ({}))) as { text?: string; textPath?: string; extractError?: string; error?: string };
  if (!r.ok) return { extractError: j.error ?? `HTTP ${r.status}` };
  return j;
}

/**
 * Turn a File into an Attachment. Images and PDFs are stored in the workspace and
 * referenced by path (the server loads the bytes for the model), which keeps every
 * chat request small. Small text files are inlined. Everything else is stored and,
 * for Word/PowerPoint/Excel/PDF, converted to text the model can read right away.
 */
export async function prepareAttachment(file: File): Promise<Attachment> {
  const base: Attachment = { id: uid(), name: file.name, size: file.size, kind: "file", status: "processing", parts: [] };
  try {
    if (IMAGE_TYPES.has(file.type)) {
      const { blob, data, mediaType, preview } = await normalizeImage(file);
      try {
        const up = await uploadToWorkspace(blob, file.name);
        return { ...base, kind: "image", status: "ready", preview, path: up.path, parts: [{ type: "image", mediaType, data: "", name: file.name, path: up.path }] };
      } catch {
        // Could not store it: send the (resized) image inline instead.
        return { ...base, kind: "image", status: "ready", preview, parts: [{ type: "image", mediaType, data, name: file.name }] };
      }
    }
    if (DOC_TYPES.has(file.type)) {
      try {
        const up = await uploadToWorkspace(file, file.name);
        return { ...base, kind: "document", status: "ready", path: up.path, parts: [{ type: "document", mediaType: file.type, data: "", name: file.name, path: up.path }] };
      } catch (err) {
        if (file.size > MAX_INLINE_DOC) throw err;
        const data = toBase64(await file.arrayBuffer());
        return { ...base, kind: "document", status: "ready", parts: [{ type: "document", mediaType: file.type, data, name: file.name }] };
      }
    }
    if ((file.type.startsWith("text/") || TEXT_EXT.test(file.name)) && file.size <= MAX_INLINE_TEXT) {
      const text = await file.text();
      return { ...base, kind: "text", status: "ready", parts: [{ type: "text", text: `<attached_file name="${file.name}">\n${text}\n</attached_file>` }] };
    }
    // Word, PowerPoint, Excel, large text, archives...: store it, then extract text when possible.
    const up = await uploadToWorkspace(file, file.name);
    const ex = up.viaServer ? up : await extractOnServer(up.path);
    const parts: AstraPart[] = ex.text
      ? [{ type: "text", text: `<attached_file name="${file.name}" source="${up.path}">\n${ex.text}\n</attached_file>` }]
      : [];
    return { ...base, kind: ex.text ? "text" : "file", status: "ready", path: up.path, textPath: ex.textPath, parts, error: ex.extractError };
  } catch (err) {
    return { ...base, status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Build the message parts for a send: attachments first, then the typed text. */
export function partsForSend(text: string, attachments: Attachment[]): AstraPart[] {
  const ready = attachments.filter((a) => a.status === "ready");
  const parts: AstraPart[] = ready.flatMap((a) => a.parts);
  const uploaded = ready.filter((a) => a.path && a.parts.length === 0);
  if (uploaded.length) {
    const lines = uploaded.map((a) => (a.textPath ? `${a.path} (text extracted to ${a.textPath}; read that with read_file)` : a.path));
    parts.push({ type: "text", text: `Attached files saved to the workspace: ${lines.join("; ")}. Use the file tools to inspect them.` });
  }
  const stored = ready.filter((a) => a.path && a.parts.some((p) => p.type === "image" || p.type === "document"));
  if (stored.length) {
    parts.push({ type: "text", text: `(Attachments are also saved in the workspace: ${stored.map((a) => a.path).join("; ")}.)` });
  }
  parts.push({ type: "text", text });
  return parts;
}
