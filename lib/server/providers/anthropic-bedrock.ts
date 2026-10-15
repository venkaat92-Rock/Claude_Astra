import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk/lib/middleware";
import type { AstraEvent, AstraMessage, AstraPart } from "@/lib/types";
import { serverConfig } from "../config";
import { parseToolInput, type ChatProvider, type TurnRequest, type TurnResult } from "./types";

let client: AnthropicBedrockMantle | undefined;

/**
 * Claude via Amazon Bedrock's Messages-API endpoint (`bedrock-mantle`).
 * Same request shape as the first-party API; SigV4 auth from the AWS credential chain.
 */
function getClient(): AnthropicBedrockMantle {
  if (client) return client;
  const cfg = serverConfig();
  client = new AnthropicBedrockMantle({
    awsRegion: cfg.region,
    // Bedrock has no server-side `fallbacks`; the SDK middleware re-issues a refused
    // request on the fallback model client-side when ASTRA_CLAUDE_FALLBACK_MODEL is set.
    middleware: cfg.claudeFallbackModel ? [betaRefusalFallbackMiddleware([{ model: cfg.claudeFallbackModel }])] : undefined,
  });
  return client;
}

type RawBlocks = Anthropic.ContentBlockParam[];

function isThinkingBlock(b: Anthropic.ContentBlockParam): boolean {
  return b.type === "thinking" || b.type === "redacted_thinking";
}

/** Convert the neutral history to Anthropic MessageParams (append-only, deterministic). */
function toAnthropicMessages(messages: AstraMessage[], modelId: string): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      let content: RawBlocks | undefined;
      if (m.provider === "anthropic-bedrock" && Array.isArray(m.raw)) {
        const raw = m.raw as RawBlocks;
        // Same model: replay verbatim (keeps thinking blocks valid).
        // Different Claude model: strip thinking blocks deterministically.
        content = m.modelId === modelId ? raw : raw.filter((b) => !isThinkingBlock(b));
      } else {
        content = [];
        for (const p of m.parts) {
          if (p.type === "text" && p.text) content.push({ type: "text", text: p.text });
          else if (p.type === "tool_use") content.push({ type: "tool_use", id: p.id, name: p.name, input: p.input ?? {} });
        }
      }
      if (content.length === 0) content = [{ type: "text", text: "(no content)" }];
      out.push({ role: "assistant", content });
      continue;
    }
    const content: RawBlocks = [];
    for (const p of m.parts) {
      if (p.type === "text") content.push({ type: "text", text: p.text });
      else if (p.type === "image") content.push({ type: "image", source: { type: "base64", media_type: p.mediaType as Anthropic.Base64ImageSource["media_type"], data: p.data } });
      else if (p.type === "document") {
        if (p.mediaType === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data }, title: p.name });
        else content.push({ type: "document", source: { type: "text", media_type: "text/plain", data: Buffer.from(p.data, "base64").toString("utf8") }, title: p.name });
      }
      else if (p.type === "tool_result") content.push({ type: "tool_result", tool_use_id: p.toolUseId, content: p.content, is_error: p.isError ?? false });
    }
    if (content.length === 0) content.push({ type: "text", text: "(empty)" });
    out.push({ role: "user", content });
  }
  return out;
}

export const anthropicBedrockProvider: ChatProvider = {
  async *streamTurn(req: TurnRequest): AsyncGenerator<AstraEvent, TurnResult, undefined> {
    const { model } = req;
    const defaults = model.defaults ?? {};
    const tools: Anthropic.Tool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      ...(defaults.eagerToolStreaming && t.streamInput ? { eager_input_streaming: true } : {}),
    }));

    const params: Anthropic.MessageStreamParams = {
      model: model.apiModelId,
      max_tokens: req.maxTokens ?? defaults.maxTokens ?? 32_000,
      system: req.system,
      messages: toAnthropicMessages(req.messages, model.id),
      tools,
    };
    const thinkingMode = defaults.thinking ?? "adaptive";
    if (thinkingMode === "adaptive") {
      params.thinking = { type: "adaptive", display: "summarized" };
      params.output_config = { effort: req.effort ?? defaults.effort ?? "high" };
    } else if (thinkingMode === "budget") {
      params.thinking = { type: "enabled", budget_tokens: Math.min(8_000, (params.max_tokens ?? 16_000) - 1_024) };
    }

    const stream = getClient().messages.stream(params, { signal: req.signal });
    const toolIds = new Map<number, string>();

    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start":
          if (event.content_block.type === "tool_use") {
            toolIds.set(event.index, event.content_block.id);
            yield { type: "tool_start", id: event.content_block.id, name: event.content_block.name };
          }
          break;
        case "content_block_delta":
          if (event.delta.type === "text_delta") yield { type: "text", delta: event.delta.text };
          else if (event.delta.type === "thinking_delta" && event.delta.thinking) yield { type: "thinking", delta: event.delta.thinking };
          else if (event.delta.type === "input_json_delta") {
            const id = toolIds.get(event.index);
            if (id) yield { type: "tool_input", id, delta: event.delta.partial_json };
          }
          break;
      }
    }

    const message = await stream.finalMessage();
    const parts: AstraPart[] = [];
    for (const block of message.content) {
      if (block.type === "text") parts.push({ type: "text", text: block.text });
      else if (block.type === "thinking" && block.thinking) parts.push({ type: "thinking", text: block.thinking });
      else if (block.type === "tool_use") {
        parts.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
        yield { type: "tool_use", id: block.id, name: block.name, input: block.input };
      }
    }

    let stopReason: TurnResult["stopReason"] = "end_turn";
    if (message.stop_reason === "tool_use") stopReason = "tool_use";
    else if (message.stop_reason === "max_tokens") stopReason = "max_tokens";
    else if (message.stop_reason === "refusal") {
      stopReason = "refusal";
      const details = message.stop_details;
      yield { type: "status", text: `Claude declined this request${details?.category ? ` (${details.category})` : ""}${details?.explanation ? `: ${details.explanation}` : "."}` };
    }
    // A truncated tool input can parse but be incomplete; never execute tools after max_tokens.
    if (stopReason === "max_tokens" && parts.some((p) => p.type === "tool_use")) {
      yield { type: "status", text: "Response hit max_tokens mid tool call; raise max tokens or lower effort and retry." };
    }
    // Guard: a tool_use block with unparseable input (possible with eager streaming).
    for (const p of parts) {
      if (p.type === "tool_use" && typeof p.input === "string") {
        const parsed = parseToolInput(p.input);
        p.input = parsed.ok ? parsed.value : {};
      }
    }

    return {
      parts,
      raw: message.content,
      stopReason,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadInputTokens: message.usage.cache_read_input_tokens ?? undefined,
        cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? undefined,
      },
    };
  },
};
