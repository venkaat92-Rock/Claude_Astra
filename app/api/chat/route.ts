import { randomUUID } from "node:crypto";
import { findModel } from "@/lib/models";
import type { AstraEvent, ChatRequestBody } from "@/lib/types";
import { runAgent } from "@/lib/server/agent/loop";
import { requireUser, UnauthorizedError, type AstraUser } from "@/lib/server/auth";
import { modelAvailability, modelCatalog, serverConfig } from "@/lib/server/config";
import { jsonError, ndjsonResponse } from "@/lib/server/stream";
import { Workspace } from "@/lib/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/chat — run one agentic exchange and stream NDJSON events.
 * Body: ChatRequestBody. The client keeps the full history and replays it.
 */
export async function POST(request: Request): Promise<Response> {
  let user: AstraUser;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonError(err.message, 401, "unauthorized");
    throw err;
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return jsonError("Invalid JSON body");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) return jsonError("messages[] is required");
  if (body.messages[body.messages.length - 1]?.role !== "user") return jsonError("last message must be from the user");

  const found = findModel(modelCatalog(), body.modelId || serverConfig().defaultModelId);
  if (!found) return jsonError(`Unknown model: ${body.modelId}`, 404, "unknown_model");
  const model = found;
  const avail = modelAvailability(model);
  if (!avail.available) return jsonError(`${model.label} is unavailable: ${avail.reason}`, 409, "model_unavailable");
  if (!(model.capabilities.includes("chat") || model.capabilities.includes("agent"))) {
    return jsonError(`${model.label} is a ${model.capabilities.join("/")} model; use /image or /video`, 400);
  }

  const sessionId = body.conversationId || randomUUID();
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  const { userId, identityId } = user;
  const { messages, effort } = body;

  async function* run(): AsyncGenerator<AstraEvent, void, unknown> {
    let workspace: Workspace | undefined;
    try {
      workspace = new Workspace(identityId);
    } catch (err) {
      yield { type: "status", text: `Workspace disabled (${err instanceof Error ? err.message : String(err)}); running without file tools.` };
    }
    yield* runAgent({
      model,
      messages,
      effort,
      sessionId,
      // Without a bucket the file tools cannot work; run the model with no tools.
      tools: workspace ? undefined : [],
      ctx: { userId, identityId, workspace: workspace as Workspace, signal: controller.signal },
    });
  }

  return ndjsonResponse(run(), controller.signal);
}
