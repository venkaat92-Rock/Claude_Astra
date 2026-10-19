import { requireUser, UnauthorizedError } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/stream";
import { Workspace, guessContentType } from "@/lib/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;

/**
 * POST /api/workspace/upload-url { name, contentType?, size? } -> { path, url, contentType }
 * Picks a free path under uploads/ and returns a presigned PUT URL, so the browser
 * sends the file straight to S3 instead of through the app server (which caps
 * request bodies at a few MB).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const { name, contentType, size } = (await request.json()) as { name?: string; contentType?: string; size?: number };
    if (!name) return jsonError("name is required");
    if (size && size > MAX_BYTES) return jsonError(`File is larger than ${MAX_BYTES / 1024 / 1024} MB`, 413);
    const ws = new Workspace(user.identityId);
    const path = await ws.uniquePath("uploads", name);
    const type = contentType || guessContentType(path);
    return Response.json({ path, url: await ws.presignPut(path, type), contentType: type });
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
    console.error("[api/workspace/upload-url]", err);
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
