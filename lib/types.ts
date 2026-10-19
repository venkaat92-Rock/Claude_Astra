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
  /** "file" is a downloadable workspace file (PowerPoint, Word, Excel, text...). */
  kind: "image" | "video" | "file";
  /** Display name for downloadable files. */
  name?: string;
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
  /**
   * Image attached by the user. When `path` is set the bytes live in the workspace and
   * `data` may be empty: the server loads them before calling the model, which keeps
   * chat requests small (Amplify rejects very large request bodies).
   */
  | { type: "image"; mediaType: string; data: string; name?: string; path?: string }
  /** PDF (or other document) attached by the user; base64 `data`, or empty with a workspace `path`. */
  | { type: "document"; mediaType: string; data: string; name: string; path?: string }
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

/** "continue": the server paused between tool rounds to keep each HTTP request short; the client resumes automatically. */
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "error" | "aborted" | "continue";

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

export interface ConversationSummary {
  id: string;
  title: string;
  modelId: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationRecord extends ConversationSummary {
  messages: AstraMessage[];
  effort?: Effort;
}

export interface ChatRequestBody {
  messages: AstraMessage[];
  modelId: string;
  effort?: Effort;
  /** Optional per-conversation instructions appended to the frozen system prompt at turn 1. */
  projectInstructions?: string;
  conversationId?: string;
}
