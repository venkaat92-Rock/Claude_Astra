import { modelAvailability, modelCatalog, serverConfig } from "@/lib/server/config";

export const dynamic = "force-dynamic";

/** GET /api/models — the catalog with runtime availability. */
export async function GET(): Promise<Response> {
  const cfg = serverConfig();
  const models = modelCatalog().map((m) => ({ ...m, ...modelAvailability(m) }));
  return Response.json({ models, defaultModelId: cfg.defaultModelId, region: cfg.region, authMode: cfg.authMode });
}
