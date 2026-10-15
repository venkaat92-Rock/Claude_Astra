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
  preview?: string; // data URL for images
  error?: string;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const DOC_TYPES = new Set(["application/pdf"]);
const TEXT_EXT = /\.(md|txt|json|ya?ml|toml|csv|tsv|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|sh|sql|env|ini|cfg|xml|svg|tf|log|dockerfile)$/i;
const MAX_INLINE_IMAGE = 4 * 1024 * 1024; // after resize
const MAX_INLINE_DOC = 8 * 1024 * 1024;
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

/** Downscale large images in the browser so they fit model limits and keep history small. */
async function normalizeImage(file: File): Promise<{ data: string; mediaType: string; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const needsResize = scale < 1 || file.size > MAX_INLINE_IMAGE;
  if (!needsResize) {
    const data = toBase64(await file.arrayBuffer());
    return { data, mediaType: file.type, preview: `data:${file.type};base64,${data}` };
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const mediaType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const url = canvas.toDataURL(mediaType, 0.88);
  return { data: url.split(",")[1], mediaType, preview: url };
}

/** Turn a File into an Attachment: inline where the model can consume it, otherwise upload to the workspace. */
export async function prepareAttachment(file: File): Promise<Attachment> {
  const base: Attachment = { id: uid(), name: file.name, size: file.size, kind: "file", status: "processing", parts: [] };
  try {
    if (IMAGE_TYPES.has(file.type)) {
      const { data, mediaType, preview } = await normalizeImage(file);
      return { ...base, kind: "image", status: "ready", preview, parts: [{ type: "image", mediaType, data, name: file.name }] };
    }
    if (DOC_TYPES.has(file.type) && file.size <= MAX_INLINE_DOC) {
      const data = toBase64(await file.arrayBuffer());
      return { ...base, kind: "document", status: "ready", parts: [{ type: "document", mediaType: file.type, data, name: file.name }] };
    }
    if ((file.type.startsWith("text/") || TEXT_EXT.test(file.name)) && file.size <= MAX_INLINE_TEXT) {
      const text = await file.text();
      return { ...base, kind: "text", status: "ready", parts: [{ type: "text", text: `<attached_file name="${file.name}">\n${text}\n</attached_file>` }] };
    }
    // Everything else: store in the workspace so the agent's tools can get at it.
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/workspace/upload", { method: "POST", body: form });
    const j = (await res.json()) as { path?: string; error?: string };
    if (!res.ok || !j.path) throw new Error(j.error ?? `upload failed (${res.status})`);
    return { ...base, kind: "file", status: "ready", path: j.path, parts: [] };
  } catch (err) {
    return { ...base, status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Build the message parts for a send: attachments first, then the typed text. */
export function partsForSend(text: string, attachments: Attachment[]): AstraPart[] {
  const ready = attachments.filter((a) => a.status === "ready");
  const parts: AstraPart[] = ready.flatMap((a) => a.parts);
  const uploaded = ready.filter((a) => a.path).map((a) => a.path!);
  if (uploaded.length) parts.push({ type: "text", text: `Attached files saved to the workspace: ${uploaded.join(", ")}. Use the file tools to inspect them.` });
  parts.push({ type: "text", text });
  return parts;
}
