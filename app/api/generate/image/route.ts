import { z } from "zod";
import { requireUser, UnauthorizedError } from "@/lib/server/auth";
import { modelCatalog } from "@/lib/server/config";
import { generateImage } from "@/lib/server/providers/bedrock-image";
import { jsonError } from "@/lib/server/stream";
import { Workspace, guessContentType } from "@/lib/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  prompt: z.string().min(1).max(1024),
  negativePrompt: z.string().max(1024).optional(),
  width: z.number().int().min(320).max(2048).optional(),
  height: z.number().int().min(320).max(2048).optional(),
  modelId: z.string().optional(),
});

/** POST /api/generate/image — Nova Canvas; saves PNG to the workspace and returns a preview URL. */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const body = Body.parse(await request.json());
    const spec = modelCatalog().find((m) => m.id === (body.modelId ?? "nova-canvas"));
    const { png, seed } = await generateImage({ ...body, modelId: spec?.apiModelId });
    const ws = new Workspace(user.identityId);
    const path = `generated/${Date.now()}.png`;
    await ws.write(path, png, guessContentType(path));
    return Response.json({ path, seed, url: await ws.presign(path) });
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
    if (err instanceof z.ZodError) return jsonError(err.issues.map((i) => i.message).join("; "));
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
