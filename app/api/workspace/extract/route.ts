import { requireUser, UnauthorizedError } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/stream";
import { Workspace } from "@/lib/server/workspace";
import { extractText } from "@/lib/server/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INLINE_TEXT = 200 * 1024;

/**
 * POST /api/workspace/extract { path } -> { path, textPath?, text?, extractError? }
 * Converts an uploaded Word, PowerPoint, Excel or PDF file to text, saves it next
 * to the original as <name>.txt and returns it inline when it is small enough.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const { path } = (await request.json()) as { path?: string };
    if (!path) return jsonError("path is required");
    const ws = new Workspace(user.identityId);
    const { bytes } = await ws.readBytes(path);
    try {
      const text = await extractText(bytes, path);
      if (text === null) return Response.json({ path });
      const textPath = `${path}.txt`;
      await ws.write(textPath, text, "text/plain; charset=utf-8");
      return Response.json({ path, textPath, text: Buffer.byteLength(text) <= MAX_INLINE_TEXT ? text : undefined });
    } catch (err) {
      return Response.json({ path, extractError: err instanceof Error ? err.message : String(err) });
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
    console.error("[api/workspace/extract]", err);
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
