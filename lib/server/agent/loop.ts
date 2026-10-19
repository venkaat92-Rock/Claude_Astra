import { randomUUID } from "node:crypto";
import type { ModelSpec } from "@/lib/models";
import type { AstraEvent, AstraMessage, AstraPart, Effort, ProviderKind } from "@/lib/types";
import { serverConfig } from "../config";
import { anthropicBedrockProvider } from "../providers/anthropic-bedrock";
import { bedrockAgentProvider } from "../providers/bedrock-agent";
import { bedrockConverseProvider } from "../providers/bedrock-converse";
import { geminiProvider } from "../providers/gemini";
import type { ChatProvider, TurnResult } from "../providers/types";
import { ASTRA_SYSTEM_PROMPT } from "./system-prompt";
import { TOOL_DEFS, executeTool, type ToolContext, type ToolDef } from "./tools";

export const MAX_ITERATIONS = 30;

/** Resolve the provider that will actually serve this model, and the kind to stamp on its turns. */
export function providerFor(model: ModelSpec, sessionId: string): { provider: ChatProvider; kind: ProviderKind } {
  switch (model.provider) {
    case "anthropic-bedrock":
      // Claude goes through the Converse API unless ASTRA_CLAUDE_API=messages selects the
      // Claude Messages endpoint (bedrock-mantle). Converse is what most accounts permit.
      return serverConfig().claudeApi === "messages"
        ? { provider: anthropicBedrockProvider, kind: "anthropic-bedrock" }
        : { provider: bedrockConverseProvider, kind: "bedrock-converse" };
    case "bedrock-converse": return { provider: bedrockConverseProvider, kind: "bedrock-converse" };
    case "gemini": return { provider: geminiProvider, kind: "gemini" };
    case "bedrock-agent": return { provider: bedrockAgentProvider(sessionId), kind: "bedrock-agent" };
    default: throw new Error(`Model ${model.id} (${model.provider}) is not a chat provider`);
  }
}

export interface AgentRunOptions {
  model: ModelSpec;
  messages: AstraMessage[];
  effort?: Effort;
  ctx: ToolContext;
  sessionId: string;
  tools?: ToolDef[];
  /**
   * Epoch ms after which the loop pauses between tool rounds and returns
   * stopReason "continue"; the client then resumes with a fresh request. This keeps
   * each HTTP request well inside the hosting platform's time limit.
   */
  deadline?: number;
}

/**
 * The agentic loop: model turn -> execute tool calls (in parallel) -> append
 * results -> repeat until the model stops calling tools. Append-only history.
 */
export async function* runAgent(opts: AgentRunOptions): AsyncGenerator<AstraEvent, void, unknown> {
  const { model, ctx } = opts;
  const { provider, kind } = providerFor(model, opts.sessionId);
  const supportsTools = model.capabilities.includes("tools");
  const tools = supportsTools ? (opts.tools ?? TOOL_DEFS) : [];
  const history: AstraMessage[] = [...opts.messages];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (ctx.signal?.aborted) {
      yield { type: "done", stopReason: "aborted", iterations: iteration - 1 };
      return;
    }
    const messageId = randomUUID();
    yield { type: "turn_start", messageId, modelId: model.id, provider: kind };

    const gen = provider.streamTurn({
      model,
      system: ASTRA_SYSTEM_PROMPT,
      messages: history,
      tools,
      effort: opts.effort,
      signal: ctx.signal,
    });

    let result: TurnResult;
    while (true) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
      yield next.value;
    }

    const assistant: AstraMessage = {
      id: messageId,
      role: "assistant",
      parts: result.parts,
      provider: kind,
      modelId: model.id,
      raw: result.raw,
      createdAt: new Date().toISOString(),
    };
    history.push(assistant);
    yield { type: "turn_end", message: assistant, stopReason: result.stopReason, usage: result.usage };

    const toolUses = result.parts.filter((p): p is Extract<AstraPart, { type: "tool_use" }> => p.type === "tool_use");
    if (result.stopReason !== "tool_use" || toolUses.length === 0) {
      yield { type: "done", stopReason: result.stopReason, iterations: iteration };
      return;
    }

    // Execute all tool calls from this turn concurrently; return every result in ONE user message.
    const outcomes = await Promise.all(toolUses.map((t) => executeTool(t.name, t.input, ctx)));
    const resultParts: AstraPart[] = [];
    for (let i = 0; i < toolUses.length; i++) {
      const t = toolUses[i];
      const o = outcomes[i];
      resultParts.push({ type: "tool_result", toolUseId: t.id, name: t.name, content: o.content, isError: o.isError, media: o.media });
      yield { type: "tool_result", id: t.id, name: t.name, content: o.content, isError: o.isError, media: o.media };
    }
    const toolMessage: AstraMessage = { id: randomUUID(), role: "user", parts: resultParts, createdAt: new Date().toISOString() };
    history.push(toolMessage);
    yield { type: "turn_end", message: toolMessage, stopReason: "tool_use" };

    if (opts.deadline && Date.now() > opts.deadline && iteration < MAX_ITERATIONS) {
      yield { type: "done", stopReason: "continue", iterations: iteration };
      return;
    }
  }

  yield { type: "status", text: `Stopped after ${MAX_ITERATIONS} tool iterations. Send another message to continue.` };
  yield { type: "done", stopReason: "end_turn", iterations: MAX_ITERATIONS };
}
