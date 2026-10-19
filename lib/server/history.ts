import type { AstraMessage, AstraPart } from "@/lib/types";
import type { Workspace } from "./workspace";
import { extractText } from "./extract";

/** Bedrock document blocks are limited to 4.5 MB; larger PDFs are sent as extracted text. */
const MAX_DOC_BYTES = 4_500_000;
/** Bedrock image blocks are limited to 3.75 MB. */
const MAX_IMAGE_BYTES = 3_750_000;

/**
 * Make a client-supplied history safe to send to a model:
 * - merge back-to-back messages from the same role (a dropped connection can leave
 *   the user's next prompt right after a tool-result message);
 * - answer any tool call that never got a result (the run was cut off mid-way),
 *   since every provider rejects a tool_use without a matching tool_result.
 */
export function repairHistory(messages: AstraMessage[]): AstraMessage[] {
  const out: AstraMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const prev = out[out.length - 1];
    if (prev && prev.role === "assistant") {
      const pending = prev.parts.filter((p): p is Extract<AstraPart, { type: "tool_use" }> => p.type === "tool_use");
      if (pending.length) {
        const answered = new Set(m.role === "user" ? m.parts.filter((p) => p.type === "tool_result").map((p) => (p as Extract<AstraPart, { type: "tool_result" }>).toolUseId) : []);
        const missing = pending.filter((t) => !answered.has(t.id));
        if (missing.length) {
          const filler: AstraPart[] = missing.map((t) => ({ type: "tool_result", toolUseId: t.id, name: t.name, content: "Interrupted: this tool call did not finish (the connection was lost). Run it again if it is still needed.", isError: true }));
          if (m.role === "user") {
            out.push({ ...m, parts: [...filler, ...m.parts] });
            continue;
          }
          out.push({ id: `${prev.id}-results`, role: "user", parts: filler });
        }
      }
    }
    const last = out[out.length - 1];
    if (last && last.role === m.role && m.role === "user") {
      // Tool results must come first in a user message; keep them ahead of new text.
      const parts = [...last.parts, ...m.parts];
      parts.sort((a, b) => Number(b.type === "tool_result") - Number(a.type === "tool_result"));
      out[out.length - 1] = { ...last, parts };
      continue;
    }
    out.push(m);
  }
  // A trailing assistant turn with unanswered tool calls (shouldn't happen: the route requires a user message last).
  return out;
}

/**
 * Attachments are uploaded to the workspace and referenced by path so chat requests
 * stay small. Load their bytes here, just before the model call.
 */
export async function hydrateAttachments(messages: AstraMessage[], ws: Workspace | undefined): Promise<AstraMessage[]> {
  const cache = new Map<string, AstraPart>();
  const load = async (p: Extract<AstraPart, { type: "image" | "document" }>): Promise<AstraPart> => {
    if (p.data || !p.path) return p;
    const key = `${p.type}:${p.path}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let result: AstraPart;
    const label = p.name ?? p.path;
    if (!ws) {
      result = { type: "text", text: `[attachment ${label} is unavailable: no workspace bucket configured]` };
    } else {
      try {
        const { bytes } = await ws.readBytes(p.path);
        if (p.type === "image" && bytes.byteLength > MAX_IMAGE_BYTES) {
          result = { type: "text", text: `[image ${label} is too large to show the model (${bytes.byteLength} bytes); it is saved at ${p.path}]` };
        } else if (p.type === "document" && bytes.byteLength > MAX_DOC_BYTES) {
          const text = await extractText(bytes, p.name || p.path).catch(() => null);
          result = text
            ? { type: "text", text: `<attached_file name="${label}" source="${p.path}">\n${text.slice(0, 150_000)}${text.length > 150_000 ? "\n[truncated; use read_file with an offset for the rest]" : ""}\n</attached_file>` }
            : { type: "text", text: `[document ${label} is too large to attach directly; it is saved at ${p.path}, use read_file]` };
        } else {
          result = { ...p, data: Buffer.from(bytes).toString("base64") };
        }
      } catch (err) {
        result = { type: "text", text: `[attachment ${label} could not be loaded from ${p.path}: ${err instanceof Error ? err.message : String(err)}]` };
      }
    }
    cache.set(key, result);
    return result;
  };

  return Promise.all(
    messages.map(async (m) => {
      if (m.role !== "user" || !m.parts.some((p) => (p.type === "image" || p.type === "document") && !p.data && p.path)) return m;
      const parts = await Promise.all(m.parts.map((p) => (p.type === "image" || p.type === "document" ? load(p) : Promise.resolve(p))));
      return { ...m, parts };
    }),
  );
}

/** Drop inline bytes for attachments that live in the workspace (used before saving). */
export function stripStoredAttachmentData(messages: AstraMessage[]): AstraMessage[] {
  return messages.map((m) =>
    m.parts.some((p) => (p.type === "image" || p.type === "document") && p.path && p.data)
      ? { ...m, parts: m.parts.map((p) => ((p.type === "image" || p.type === "document") && p.path ? { ...p, data: "" } : p)) }
      : m,
  );
}
