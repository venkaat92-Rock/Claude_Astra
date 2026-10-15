import { z } from "zod";
import { requireUser, UnauthorizedError } from "@/lib/server/auth";
import { modelCatalog } from "@/lib/server/config";
import { getVideoStatus, startVideo } from "@/lib/server/providers/bedrock-video";
import { jsonError } from "@/lib/server/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  prompt: z.string().min(1).max(2048),
  modelId: z.enum(["nova-reel", "luma-ray-2"]).optional(),
  durationSeconds: z.number().int().optional(),
});

/** POST /api/generate/video — start an async Bedrock video job. */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const body = Body.parse(await request.json());
    const spec = modelCatalog().find((m) => m.id === (body.modelId ?? "nova-reel"));
    const job = await startVideo({ prompt: body.prompt, modelId: spec?.apiModelId, durationSeconds: body.durationSeconds, userId: user.identityId });
    return Response.json(job);
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
    if (err instanceof z.ZodError) return jsonError(err.issues.map((i) => i.message).join("; "));
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

/** GET /api/generate/video?arn=... — poll a job; returns a presigned URL when done. */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireUser();
    const arn = new URL(request.url).searchParams.get("arn");
    if (!arn) return jsonError("arn query parameter is required");
    return Response.json(await getVideoStatus(arn));
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
