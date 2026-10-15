/**
 * Provider-neutral message and streaming types shared by the server
 * (agent loop, providers) and the client (terminal UI).
 */

export type ProviderKind =
  | "anthropic-bedrock" // Claude via Bedrock's Messages-API endpoint (bedrock-mantle)
  | "bedrock-converse" // Amazon Nova and other Bedrock chat models via the Converse API
  | "gemini" // Google Gemini via Google's API (not on Bedrock)
  | "bedrock-image" // Amazon Nova Canvas (InvokeModel)
  | "bedrock-video" // Amazon Nova Reel / Luma Ray 2 (StartAsyncInvoke)
  | "bedrock-agent"; // Agents for Amazon Bedrock (InvokeAgent)

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type MediaRef = {
  kind: "image" | "video";
  /** Presigned URL (preferred for large media). */
  url?: string;
  /** Inline base64 (small images only). */
  data?: string;
  mediaType?: string;
  /** Workspace path or S3 key the media was saved to. */
  path?: string;
};

export type AstraPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "image"; mediaType: string; data: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      toolUseId: string;
      name?: string;
      content: string;
      isError?: boolean;
      media?: MediaRef[];
    };

export interface AstraMessage {
  id: string;
  role: "user" | "assistant";
  parts: AstraPart[];
  /** Provider that produced an assistant message. */
  provider?: ProviderKind;
  modelId?: string;
  /**
   * Provider-native content for assistant turns. Replayed verbatim when the
   * next request targets the same provider + model so that Claude thinking
   * blocks (which are bound to the conversation prefix) stay valid.
   */
  raw?: unknown;
  createdAt?: string;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "error" | "aborted";

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/** NDJSON events streamed from /api/chat to the terminal UI. */
export type AstraEvent =
  | { type: "turn_start"; messageId: string; modelId: string; provider: ProviderKind }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; id: string; name: string }
  | { type: "tool_input"; id: string; delta: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; content: string; isError?: boolean; media?: MediaRef[] }
  | { type: "turn_end"; message: AstraMessage; stopReason: StopReason; usage?: Usage }
  | { type: "status"; text: string }
  | { type: "error"; message: string; code?: string }
  | { type: "done"; stopReason: StopReason; iterations: number };

export interface ChatRequestBody {
  messages: AstraMessage[];
  modelId: string;
  effort?: Effort;
  /** Optional per-conversation instructions appended to the frozen system prompt at turn 1. */
  projectInstructions?: string;
  conversationId?: string;
}
