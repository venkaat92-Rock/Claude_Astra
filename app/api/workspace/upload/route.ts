import { requireUser, UnauthorizedError } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/stream";
import { Workspace, guessContentType } from "@/lib/server/workspace";
import { extractText } from "@/lib/server/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * POST /api/workspace/upload (multipart/form-data, field "file", optional "dir")
 * Saves an attachment into the user's workspace (default: uploads/<name>) so the
 * agent's file tools can read it. Word, PowerPoint, Excel and PDF files are also
 * converted to text: the text is saved next to the original as <name>.txt and,
 * when small enough, returned inline so the model sees it immediately.
 */
const MAX_INLINE_TEXT = 200 * 1024;
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("file field is required");
    if (file.size > MAX_BYTES) return jsonError(`File is larger than ${MAX_BYTES / 1024 / 1024} MB`, 413);
    const dir = (typeof form.get("dir") === "string" ? (form.get("dir") as string) : "uploads").replace(/^\/+|\/+$/g, "") || "uploads";
    const safeName = file.name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "file";
    const path = `${dir}/${safeName}`;
    const ws = new Workspace(user.identityId);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await ws.write(path, bytes, file.type || guessContentType(path));
    let textPath: string | undefined;
    let text: string | undefined;
    let extractError: string | undefined;
    try {
      const extracted = await extractText(bytes, safeName);
      if (extracted !== null) {
        textPath = `${path}.txt`;
        await ws.write(textPath, extracted, "text/plain; charset=utf-8");
        if (Buffer.byteLength(extracted) <= MAX_INLINE_TEXT) text = extracted;
      }
    } catch (err) {
      extractError = err instanceof Error ? err.message : String(err);
    }
    return Response.json({ path, size: file.size, contentType: file.type || guessContentType(path), textPath, text, extractError });
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
