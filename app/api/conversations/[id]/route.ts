import { requireUser, UnauthorizedError } from "@/lib/server/auth";
import { ConversationStore } from "@/lib/server/conversations";
import { jsonError } from "@/lib/server/stream";
import { Workspace } from "@/lib/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function handle(err: unknown): Response {
  if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
  return jsonError(err instanceof Error ? err.message : String(err), 500);
}

/** GET /api/conversations/:id -> full record. */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const rec = await new ConversationStore(new Workspace(user.identityId)).get(id);
    return rec ? Response.json(rec) : jsonError("Not found", 404);
  } catch (err) {
    return handle(err);
  }
}

/** PATCH /api/conversations/:id { title } -> rename. */
export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const { title } = (await request.json()) as { title?: string };
    if (!title) return jsonError("title is required");
    await new ConversationStore(new Workspace(user.identityId)).rename(id, title);
    return Response.json({ ok: true });
  } catch (err) {
    return handle(err);
  }
}

/** DELETE /api/conversations/:id */
export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    await new ConversationStore(new Workspace(user.identityId)).delete(id);
    return Response.json({ ok: true });
  } catch (err) {
    return handle(err);
  }
}
