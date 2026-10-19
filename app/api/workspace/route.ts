import { requireUser, UnauthorizedError } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/stream";
import { Workspace } from "@/lib/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ws(): Promise<Workspace> {
  const user = await requireUser();
  return new Workspace(user.identityId);
}

function handle(err: unknown): Response {
  if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
  return jsonError(err instanceof Error ? err.message : String(err), 500);
}

/** GET /api/workspace            -> list files
 *  GET /api/workspace?path=a/b   -> read a text file
 *  GET /api/workspace?path=a/b&url=1 -> presigned URL (add &download=1 to save as a file) */
export async function GET(request: Request): Promise<Response> {
  try {
    const w = await ws();
    const u = new URL(request.url);
    const path = u.searchParams.get("path");
    if (!path) return Response.json({ files: await w.list() });
    if (u.searchParams.get("url")) return Response.json({ url: await w.presign(path, 3600, !!u.searchParams.get("download")) });
    return Response.json({ path, content: await w.read(path) });
  } catch (err) {
    return handle(err);
  }
}

/** PUT /api/workspace { path, content } -> write a text file */
export async function PUT(request: Request): Promise<Response> {
  try {
    const w = await ws();
    const { path, content } = (await request.json()) as { path?: string; content?: string };
    if (!path || typeof content !== "string") return jsonError("path and content are required");
    await w.write(path, content);
    return Response.json({ ok: true, path });
  } catch (err) {
    return handle(err);
  }
}

/** DELETE /api/workspace?path=a/b */
export async function DELETE(request: Request): Promise<Response> {
  try {
    const w = await ws();
    const path = new URL(request.url).searchParams.get("path");
    if (!path) return jsonError("path is required");
    await w.delete(path);
    return Response.json({ ok: true });
  } catch (err) {
    return handle(err);
  }
}
