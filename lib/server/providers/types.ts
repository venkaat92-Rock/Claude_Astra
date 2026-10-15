import type { ModelSpec } from "@/lib/models";
import type { AstraEvent, AstraMessage, AstraPart, Effort, StopReason, Usage } from "@/lib/types";
import type { ToolDef } from "../agent/tools";

export interface TurnRequest {
  model: ModelSpec;
  system: string;
  messages: AstraMessage[];
  tools: ToolDef[];
  effort?: Effort;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface TurnResult {
  parts: AstraPart[];
  /** Provider-native assistant content, replayed verbatim on later turns. */
  raw: unknown;
  stopReason: StopReason;
  usage?: Usage;
}

/** One assistant turn: yields streaming events, returns the completed turn. */
export interface ChatProvider {
  streamTurn(req: TurnRequest): AsyncGenerator<AstraEvent, TurnResult, undefined>;
}

export function textOf(parts: AstraPart[]): string {
  return parts.filter((p): p is Extract<AstraPart, { type: "text" }> => p.type === "text").map((p) => p.text).join("");
}

/** Safely parse accumulated tool-input JSON (may be truncated by max_tokens). */
export function parseToolInput(json: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (json.trim() === "") return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(json) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
