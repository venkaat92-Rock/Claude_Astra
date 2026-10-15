import { requireUser, UnauthorizedError } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/stream";
import { Workspace, guessContentType } from "@/lib/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * POST /api/workspace/upload (multipart/form-data, field "file", optional "dir")
 * Saves an attachment into the user's workspace (default: uploads/<name>) so the
 * agent's file tools can read it. Used for attachments the model can't take inline.
 */
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
    await ws.write(path, new Uint8Array(await file.arrayBuffer()), file.type || guessContentType(path));
    return Response.json({ path, size: file.size, contentType: file.type || guessContentType(path) });
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
