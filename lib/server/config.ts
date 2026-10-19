import { readFileSync } from "node:fs";
import { amplifyOutputs } from "@/lib/amplify-config";
import { DEFAULT_MODELS, DEFAULT_MODEL_ID, type ModelSpec } from "@/lib/models";

export interface ServerConfig {
  region: string;
  mediaBucket?: string;
  mediaPrefix: string;
  workspaceBucket?: string;
  googleApiKey?: string;
  bedrockAgentId?: string;
  bedrockAgentAliasId?: string;
  claudeFallbackModel?: string;
  /** Routing prefix for Claude and OpenAI ids on Bedrock: "us." (default), "eu.", "jp.", "au.", "global." or "" (ASTRA_CLAUDE_ROUTING=none) for in-region only. */
  claudeRoutingPrefix: string;
  /** How Claude is called: "converse" (Bedrock Converse API, default) or "messages" (Claude Messages-API endpoint, bedrock-mantle). */
  claudeApi: "converse" | "messages";
  authMode: "cognito" | "none";
  defaultModelId: string;
  /** Seconds after which a chat request pauses between tool rounds so the client can resume (0 = never). */
  requestBudgetSeconds: number;
}

let cached: ServerConfig | undefined;

export function serverConfig(): ServerConfig {
  if (cached) return cached;
  // ASTRA_BEDROCK_REGION lets Bedrock calls target a different region from the one
  // the app is hosted in (e.g. app in us-west-2, Nova Canvas only in us-east-1).
  const region =
    process.env.ASTRA_BEDROCK_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    amplifyOutputs.custom?.region ||
    amplifyOutputs.storage?.aws_region ||
    "us-east-1";
  const authMode = process.env.ASTRA_AUTH_MODE === "none" ? "none" : "cognito";
  if (authMode === "none" && process.env.NODE_ENV === "production" && process.env.AWS_APP_ID) {
    // Refuse to run unauthenticated on Amplify Hosting.
    throw new Error("ASTRA_AUTH_MODE=none is not allowed on a deployed environment");
  }
  cached = {
    region,
    mediaBucket: process.env.ASTRA_MEDIA_BUCKET || amplifyOutputs.custom?.mediaBucketName,
    mediaPrefix: (process.env.ASTRA_MEDIA_PREFIX || "videos/").replace(/^\/+/, ""),
    workspaceBucket:
      process.env.ASTRA_WORKSPACE_BUCKET ||
      amplifyOutputs.custom?.workspaceBucketName ||
      amplifyOutputs.storage?.bucket_name,
    googleApiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
    bedrockAgentId: process.env.BEDROCK_AGENT_ID,
    bedrockAgentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID,
    claudeFallbackModel: process.env.ASTRA_CLAUDE_FALLBACK_MODEL,
    claudeRoutingPrefix: normalizePrefix(process.env.ASTRA_CLAUDE_ROUTING ?? "us"),
    claudeApi: process.env.ASTRA_CLAUDE_API === "messages" ? "messages" : "converse",
    authMode,
    defaultModelId: process.env.ASTRA_DEFAULT_MODEL || DEFAULT_MODEL_ID,
    requestBudgetSeconds: budgetSeconds(process.env.ASTRA_REQUEST_BUDGET_SECONDS),
  };
  return cached;
}

/** "us" | "us." -> "us."; "" | "none" | "bare" -> "" (in-region id, no prefix). */
function normalizePrefix(v: string): string {
  const t = v.trim().replace(/\.$/, "").toLowerCase();
  if (!t || t === "none" || t === "bare") return "";
  return `${t}.`;
}

/**
 * Bedrock addresses Claude and OpenAI models through inference-profile prefixes:
 * `us.…` routes within the US geography (default here), `global.…` across every
 * region (often blocked by region-restricting organization policies, and not
 * accepted by the Claude endpoint), and a bare id is in-region only.
 * Ids that already carry a prefix are left alone.
 */
export function bedrockClaudeModelId(apiModelId: string): string {
  if (!/^(anthropic|openai)\./.test(apiModelId)) return apiModelId;
  return serverConfig().claudeRoutingPrefix + apiModelId;
}

let modelCache: ModelSpec[] | undefined;

/** Model catalog: defaults merged with ASTRA_MODELS_JSON overrides (by id). */
export function modelCatalog(): ModelSpec[] {
  if (modelCache) return modelCache;
  const merged = new Map(DEFAULT_MODELS.map((m) => [m.id, m]));
  const overridePath = process.env.ASTRA_MODELS_JSON;
  if (overridePath) {
    try {
      const extra = JSON.parse(readFileSync(overridePath, "utf8")) as Partial<ModelSpec>[];
      for (const m of extra) {
        if (!m.id) continue;
        merged.set(m.id, { ...(merged.get(m.id) ?? ({} as ModelSpec)), ...m } as ModelSpec);
      }
    } catch (err) {
      console.warn(`[claude-astra] could not read ASTRA_MODELS_JSON (${overridePath}):`, err);
    }
  }
  modelCache = [...merged.values()];
  return modelCache;
}

/** Attach runtime availability (missing keys, missing agent ids) to each model. */
export function modelAvailability(m: ModelSpec): { available: boolean; reason?: string } {
  const cfg = serverConfig();
  if (m.status === "retired") return { available: false, reason: "retired by the provider" };
  if (!m.enabled) return { available: false, reason: m.notes ?? "disabled" };
  if (m.provider === "gemini" && !cfg.googleApiKey) return { available: false, reason: "GOOGLE_API_KEY not set" };
  if (m.provider === "bedrock-agent" && !(cfg.bedrockAgentId && cfg.bedrockAgentAliasId)) {
    return { available: false, reason: "BEDROCK_AGENT_ID / BEDROCK_AGENT_ALIAS_ID not set" };
  }
  if (m.provider === "bedrock-video" && !cfg.mediaBucket) return { available: false, reason: "ASTRA_MEDIA_BUCKET not set" };
  return { available: true };
}

function budgetSeconds(v: string | undefined): number {
  const n = Number(v);
  // Default 20s: Amplify Hosting cuts requests at roughly 30s, so pause well before that.
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : 20;
}
