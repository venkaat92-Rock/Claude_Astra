import { requireUser, UnauthorizedError } from "@/lib/server/auth";
import { ConversationStore } from "@/lib/server/conversations";
import { jsonError } from "@/lib/server/stream";
import { Workspace } from "@/lib/server/workspace";
import type { AstraMessage, Effort } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handle(err: unknown): Response {
  if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
  return jsonError(err instanceof Error ? err.message : String(err), 500);
}

/** GET /api/conversations -> list of summaries, newest first. */
export async function GET(): Promise<Response> {
  try {
    const user = await requireUser();
    const store = new ConversationStore(new Workspace(user.identityId));
    return Response.json({ conversations: await store.list() });
  } catch (err) {
    return handle(err);
  }
}

/** POST /api/conversations { id?, title?, modelId, messages, effort? } -> create or update. */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { id?: string; title?: string; modelId?: string; messages?: AstraMessage[]; effort?: Effort };
    if (!body.modelId || !Array.isArray(body.messages)) return jsonError("modelId and messages[] are required");
    const store = new ConversationStore(new Workspace(user.identityId));
    return Response.json(await store.save({ id: body.id, title: body.title, modelId: body.modelId, messages: body.messages, effort: body.effort }));
  } catch (err) {
    return handle(err);
  }
}
