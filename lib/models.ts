import type { Effort, ProviderKind } from "./types";

export type Capability = "chat" | "tools" | "vision" | "thinking" | "image" | "video" | "agent";

export interface ModelSpec {
  /** Stable id used by the UI and API (never changes when Bedrock ids rotate). */
  id: string;
  label: string;
  vendor: "Anthropic" | "Amazon" | "Google" | "Luma" | "OpenAI";
  provider: ProviderKind;
  /**
   * Identifier passed to the underlying API:
   * - anthropic-bedrock: `anthropic.claude-*`; the server prepends the routing prefix (ASTRA_CLAUDE_ROUTING, default `global.`)
   * - bedrock-converse / bedrock-image / bedrock-video: Bedrock model id or inference profile id
   * - gemini: Gemini model name
   */
  apiModelId: string;
  capabilities: Capability[];
  description: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  defaults?: {
    effort?: Effort;
    maxTokens?: number;
    /** adaptive = `thinking: {type: "adaptive"}`; budget = legacy `budget_tokens`; none = omit. */
    thinking?: "adaptive" | "budget" | "none";
    /** Set `eager_input_streaming` on tools (newer Bedrock serving stack only). */
    eagerToolStreaming?: boolean;
  };
  /** Shown in the UI; e.g. "requires GOOGLE_API_KEY". */
  notes?: string;
  enabled: boolean;
}

/**
 * Default catalog. Override or extend by pointing ASTRA_MODELS_JSON at a JSON
 * file containing an array of ModelSpec (merged by `id`).
 *
 * Bedrock ids verified against Anthropic's "Claude in Amazon Bedrock" docs and
 * AWS model cards as of 2026-10. Re-check ids marked "verify" in the AWS
 * console (Bedrock -> Model catalog) before relying on them.
 */
export const DEFAULT_MODELS: ModelSpec[] = [
  // ---------------- Anthropic Claude (Bedrock Messages-API endpoint) ----------------
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    vendor: "Anthropic",
    provider: "anthropic-bedrock",
    apiModelId: "anthropic.claude-opus-5-5",
    capabilities: ["chat", "tools", "vision", "thinking"],
    description: "Default. Best balance of capability and cost for agentic coding.",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    defaults: { effort: "high", maxTokens: 64_000, thinking: "adaptive", eagerToolStreaming: true },
    notes: "Bedrock access criteria apply; check Model access in the console.",
    enabled: true,
  },
  {
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    vendor: "Anthropic",
    provider: "anthropic-bedrock",
    apiModelId: "anthropic.claude-fable-5-1",
    capabilities: ["chat", "tools", "vision", "thinking"],
    description: "Most capable. Long-horizon agentic work; thinking always on.",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    defaults: { effort: "high", maxTokens: 64_000, thinking: "adaptive", eagerToolStreaming: true },
    notes: "Open to all Bedrock customers. Requests may return stop_reason=refusal; the app falls back if ASTRA_CLAUDE_FALLBACK_MODEL is set.",
    enabled: true,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    vendor: "Anthropic",
    provider: "anthropic-bedrock",
    apiModelId: "anthropic.claude-sonnet-5-5",
    capabilities: ["chat", "tools", "vision", "thinking"],
    description: "Fast everyday coding and chat.",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    defaults: { effort: "medium", maxTokens: 32_000, thinking: "adaptive", eagerToolStreaming: true },
    enabled: true,
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    vendor: "Anthropic",
    provider: "anthropic-bedrock",
    apiModelId: "anthropic.claude-haiku-5-5",
    capabilities: ["chat", "tools", "vision", "thinking"],
    description: "Cheapest Claude; good for sub-tasks and quick questions.",
    contextWindow: 1_000_000,
    defaults: { effort: "medium", maxTokens: 16_000, thinking: "adaptive", eagerToolStreaming: true },
    enabled: true,
  },
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    vendor: "Anthropic",
    provider: "anthropic-bedrock",
    apiModelId: "anthropic.claude-opus-4-8",
    capabilities: ["chat", "tools", "vision", "thinking"],
    description: "Previous-generation Opus; open to all Bedrock customers.",
    contextWindow: 1_000_000,
    defaults: { effort: "high", maxTokens: 32_000, thinking: "adaptive", eagerToolStreaming: true },
    enabled: true,
  },

  // ---------------- Amazon Nova (Converse API) ----------------
  {
    id: "nova-2-lite",
    label: "Amazon Nova 2 Lite",
    vendor: "Amazon",
    provider: "bedrock-converse",
    apiModelId: "us.amazon.nova-2-lite-v1:0",
    capabilities: ["chat", "tools", "vision"],
    description: "Fast, low-cost multimodal model with tool use (1M context).",
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    defaults: { maxTokens: 8_000 },
    notes: "Inference-profile id (us.). Use global.amazon.nova-2-lite-v1:0 for global routing.",
    enabled: true,
  },
  {
    id: "nova-pro",
    label: "Amazon Nova Pro",
    vendor: "Amazon",
    provider: "bedrock-converse",
    apiModelId: "us.amazon.nova-pro-v1:0",
    capabilities: ["chat", "tools", "vision"],
    description: "Nova 1 Pro: strong multimodal reasoning with tool use.",
    contextWindow: 300_000,
    defaults: { maxTokens: 5_000 },
    enabled: true,
  },
  {
    id: "nova-premier",
    label: "Amazon Nova Premier",
    vendor: "Amazon",
    provider: "bedrock-converse",
    apiModelId: "us.amazon.nova-premier-v1:0",
    capabilities: ["chat", "tools", "vision"],
    description: "Largest Nova 1 model; teacher model for distillation.",
    contextWindow: 1_000_000,
    defaults: { maxTokens: 8_000 },
    enabled: true,
  },

  // ---------------- Image / video generation (used by agent tools and /image, /video) ----------------
  {
    id: "nova-canvas",
    label: "Amazon Nova Canvas",
    vendor: "Amazon",
    provider: "bedrock-image",
    apiModelId: "amazon.nova-canvas-v1:0",
    capabilities: ["image"],
    description: "Text-to-image. Used by the generate_image tool and /image.",
    notes: "InvokeModel, synchronous. us-east-1 / ap-northeast-1 / eu-west-1.",
    enabled: true,
  },
  {
    id: "nova-reel",
    label: "Amazon Nova Reel 1.1",
    vendor: "Amazon",
    provider: "bedrock-video",
    apiModelId: "amazon.nova-reel-v1:1",
    capabilities: ["video"],
    description: "Text-to-video (6 s single shot, up to 2 min multi-shot). Async; output lands in S3.",
    notes: "verify: nova-reel-v1:0 reached end of life on 2026-09-30; v1:1 is the current id in the model catalog.",
    enabled: true,
  },
  {
    id: "luma-ray-2",
    label: "Luma Ray 2",
    vendor: "Luma",
    provider: "bedrock-video",
    apiModelId: "luma.ray-v2:0",
    capabilities: ["video"],
    description: "Text-to-video, 5 s or 9 s clips at 540p/720p. Async; output lands in S3.",
    notes: "us-west-2 only at launch; check Model access for your region.",
    enabled: true,
  },

  // ---------------- OpenAI GPT-6 family on Bedrock (Converse API; global routing ids) ----------------
  {
    id: "gpt-6-astra",
    label: "OpenAI GPT-6 Astra",
    vendor: "OpenAI",
    provider: "bedrock-converse",
    apiModelId: "global.openai.gpt-6-astra",
    capabilities: ["chat", "tools", "vision", "thinking"],
    description: "OpenAI's most capable GPT-6 model on Bedrock: hybrid reasoning, tool use, 1M context.",
    contextWindow: 1_000_000,
    defaults: { maxTokens: 32_000 },
    notes: "Bedrock model id openai.gpt-6-astra; Converse requires the global. or us. inference-profile prefix.",
    enabled: true,
  },
  {
    id: "gpt-6-1-sol",
    label: "OpenAI GPT-6.1 Sol",
    vendor: "OpenAI",
    provider: "bedrock-converse",
    apiModelId: "global.openai.gpt-6.1-sol",
    capabilities: ["chat", "tools", "vision", "thinking"],
    description: "GPT-6.1 Sol: near-Astra capability at Sol pricing; strong on coding and agentic work.",
    contextWindow: 1_000_000,
    defaults: { maxTokens: 32_000 },
    notes: "Released 2026-10-15. Bedrock model id openai.gpt-6.1-sol.",
    enabled: true,
  },
  {
    id: "gpt-6-sol",
    label: "OpenAI GPT-6 Sol",
    vendor: "OpenAI",
    provider: "bedrock-converse",
    apiModelId: "global.openai.gpt-6-sol",
    capabilities: ["chat", "tools", "vision", "thinking"],
    description: "GPT-6 Sol: balanced performance and cost.",
    contextWindow: 1_000_000,
    defaults: { maxTokens: 16_000 },
    enabled: true,
  },
  {
    id: "gpt-6-luna",
    label: "OpenAI GPT-6 Luna",
    vendor: "OpenAI",
    provider: "bedrock-converse",
    apiModelId: "global.openai.gpt-6-luna",
    capabilities: ["chat", "tools", "vision", "thinking"],
    description: "GPT-6 Luna: fastest and cheapest of the GPT-6 family.",
    contextWindow: 1_000_000,
    defaults: { maxTokens: 16_000 },
    enabled: true,
  },
  {
    id: "gpt-oss-120b",
    label: "OpenAI gpt-oss 120B (open weights)",
    vendor: "OpenAI",
    provider: "bedrock-converse",
    apiModelId: "openai.gpt-oss-120b-1:0",
    capabilities: ["chat"],
    description: "OpenAI's open-weight reasoning model. Chat only.",
    contextWindow: 128_000,
    defaults: { maxTokens: 8_000 },
    notes: "verify: served from us-west-2; disabled by default now that GPT-6 is available.",
    enabled: false,
  },

  // ---------------- Google ----------------
  {
    id: "gemini-2-5-pro",
    label: "Gemini 2.5 Pro (Google API)",
    vendor: "Google",
    provider: "gemini",
    apiModelId: "gemini-2.5-pro",
    capabilities: ["chat", "tools", "vision", "thinking"],
    description: "Google Gemini via Google's API. Gemini is NOT hosted on Bedrock.",
    contextWindow: 1_000_000,
    defaults: { maxTokens: 32_000 },
    notes: "requires GOOGLE_API_KEY (AI Studio) on the server.",
    enabled: true,
  },
  {
    id: "gemini-2-5-flash",
    label: "Gemini 2.5 Flash (Google API)",
    vendor: "Google",
    provider: "gemini",
    apiModelId: "gemini-2.5-flash",
    capabilities: ["chat", "tools", "vision", "thinking"],
    description: "Faster, cheaper Gemini.",
    contextWindow: 1_000_000,
    defaults: { maxTokens: 16_000 },
    notes: "requires GOOGLE_API_KEY on the server.",
    enabled: true,
  },
  {
    id: "gemma-4-31b",
    label: "Google Gemma 4 31B (Bedrock)",
    vendor: "Google",
    provider: "bedrock-converse",
    apiModelId: "google.gemma-4-31b",
    capabilities: ["chat", "vision"],
    description: "Google's open-weight model served by Bedrock. The only Google models on Bedrock are Gemma.",
    notes: "verify: id and Converse support in Bedrock -> Model catalog. Disabled until confirmed.",
    enabled: false,
  },

  // ---------------- Agents for Amazon Bedrock ----------------
  {
    id: "bedrock-agent",
    label: "Bedrock Agent (configured)",
    vendor: "Amazon",
    provider: "bedrock-agent",
    apiModelId: "BEDROCK_AGENT_ID",
    capabilities: ["agent"],
    description: "Routes the conversation to the Bedrock Agent set in BEDROCK_AGENT_ID / BEDROCK_AGENT_ALIAS_ID.",
    notes: "requires BEDROCK_AGENT_ID and BEDROCK_AGENT_ALIAS_ID on the server.",
    enabled: true,
  },
];

export const DEFAULT_MODEL_ID = "claude-opus-5-5";

export function findModel(models: ModelSpec[], id: string): ModelSpec | undefined {
  return models.find((m) => m.id === id);
}

export function isChatModel(m: ModelSpec): boolean {
  return m.capabilities.includes("chat") || m.capabilities.includes("agent");
}
