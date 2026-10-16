import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
  type Tool,
  type ToolInputSchema,
  type ImageFormat,
  type DocumentFormat,
} from "@aws-sdk/client-bedrock-runtime";
import type { AstraEvent, AstraMessage, AstraPart } from "@/lib/types";
import { bedrockClaudeModelId, serverConfig } from "../config";
import { parseToolInput, type ChatProvider, type TurnRequest, type TurnResult } from "./types";

type JsonDoc = ToolInputSchema.JsonMember["json"];

let client: BedrockRuntimeClient | undefined;
function getClient(): BedrockRuntimeClient {
  return (client ??= new BedrockRuntimeClient({ region: serverConfig().region }));
}

function imageFormat(mediaType: string): ImageFormat {
  const sub = mediaType.split("/")[1] ?? "png";
  return (sub === "jpg" ? "jpeg" : sub) as ImageFormat;
}

const DOC_FORMATS: Record<string, DocumentFormat> = {
  "application/pdf": "pdf", "text/csv": "csv", "text/plain": "txt", "text/markdown": "md", "text/html": "html",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

/** Converse document names allow only letters, digits, spaces, hyphens, parentheses and brackets. */
function docName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9 ()\[\]-]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "document").slice(0, 60);
}

function toConverseMessages(messages: AstraMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      let content: ContentBlock[];
      if (m.provider === "bedrock-converse" && Array.isArray(m.raw)) {
        content = m.raw as ContentBlock[];
      } else {
        content = [];
        for (const p of m.parts) {
          if (p.type === "text" && p.text.trim()) content.push({ text: p.text });
          else if (p.type === "tool_use") content.push({ toolUse: { toolUseId: p.id, name: p.name, input: (p.input ?? {}) as JsonDoc } });
        }
      }
      if (content.length === 0) content = [{ text: "(no content)" }];
      out.push({ role: "assistant", content });
      continue;
    }
    const content: ContentBlock[] = [];
    for (const p of m.parts) {
      if (p.type === "text" && p.text.trim()) content.push({ text: p.text });
      else if (p.type === "image") content.push({ image: { format: imageFormat(p.mediaType), source: { bytes: Buffer.from(p.data, "base64") } } });
      else if (p.type === "document") {
        const format = DOC_FORMATS[p.mediaType] ?? "txt";
        content.push({ document: { format, name: docName(p.name), source: { bytes: Buffer.from(p.data, "base64") } } });
      }
      else if (p.type === "tool_result") {
        content.push({ toolResult: { toolUseId: p.toolUseId, content: [{ text: p.content || "(empty)" }], status: p.isError ? "error" : "success" } });
      }
    }
    if (content.length === 0) content.push({ text: "(empty)" });
    out.push({ role: "user", content });
  }
  return out;
}

/** Amazon Nova and other Bedrock chat models through the Converse API. */
export const bedrockConverseProvider: ChatProvider = {
  async *streamTurn(req: TurnRequest): AsyncGenerator<AstraEvent, TurnResult, undefined> {
    const { model } = req;
    const tools: Tool[] = req.tools.map((t) => {
      const { additionalProperties: _omit, ...json } = t.inputSchema as Record<string, unknown>;
      void _omit;
      return { toolSpec: { name: t.name, description: t.description, inputSchema: { json: json as JsonDoc } } };
    });

    const res = await getClient().send(
      new ConverseStreamCommand({
        modelId: bedrockClaudeModelId(model.apiModelId),
        system: [{ text: req.system }],
        messages: toConverseMessages(req.messages),
        inferenceConfig: { maxTokens: req.maxTokens ?? model.defaults?.maxTokens ?? 8_000 },
        ...(tools.length && model.capabilities.includes("tools") ? { toolConfig: { tools } } : {}),
      }),
      { abortSignal: req.signal },
    );

    const parts: AstraPart[] = [];
    const raw: ContentBlock[] = [];
    const openTools = new Map<number, { id: string; name: string; json: string }>();
    let text = "";
    let stopReason: TurnResult["stopReason"] = "end_turn";
    let usage: TurnResult["usage"];

    const flushText = () => {
      if (text) {
        parts.push({ type: "text", text });
        raw.push({ text });
        text = "";
      }
    };

    for await (const ev of res.stream ?? []) {
      if (ev.contentBlockStart?.start?.toolUse) {
        flushText();
        const { toolUseId, name } = ev.contentBlockStart.start.toolUse;
        const idx = ev.contentBlockStart.contentBlockIndex ?? openTools.size;
        openTools.set(idx, { id: toolUseId ?? `tool_${idx}`, name: name ?? "unknown", json: "" });
        yield { type: "tool_start", id: toolUseId ?? `tool_${idx}`, name: name ?? "unknown" };
      } else if (ev.contentBlockDelta?.delta) {
        const d = ev.contentBlockDelta.delta;
        const idx = ev.contentBlockDelta.contentBlockIndex ?? 0;
        if (d.text) {
          text += d.text;
          yield { type: "text", delta: d.text };
        } else if (d.toolUse?.input !== undefined) {
          const t = openTools.get(idx);
          if (t) {
            t.json += d.toolUse.input;
            yield { type: "tool_input", id: t.id, delta: d.toolUse.input };
          }
        } else if (d.reasoningContent?.text) {
          yield { type: "thinking", delta: d.reasoningContent.text };
        }
      } else if (ev.contentBlockStop) {
        const idx = ev.contentBlockStop.contentBlockIndex ?? 0;
        const t = openTools.get(idx);
        if (t) {
          flushText();
          const parsed = parseToolInput(t.json);
          const input = parsed.ok ? parsed.value : {};
          parts.push({ type: "tool_use", id: t.id, name: t.name, input });
          raw.push({ toolUse: { toolUseId: t.id, name: t.name, input: input as JsonDoc } });
          yield { type: "tool_use", id: t.id, name: t.name, input };
          openTools.delete(idx);
        }
      } else if (ev.messageStop) {
        const r = ev.messageStop.stopReason;
        stopReason = r === "tool_use" ? "tool_use" : r === "max_tokens" ? "max_tokens" : r === "content_filtered" || r === "guardrail_intervened" ? "refusal" : "end_turn";
      } else if (ev.metadata?.usage) {
        usage = { inputTokens: ev.metadata.usage.inputTokens, outputTokens: ev.metadata.usage.outputTokens };
      } else if (ev.internalServerException || ev.modelStreamErrorException || ev.validationException || ev.throttlingException || ev.serviceUnavailableException) {
        const e = ev.internalServerException ?? ev.modelStreamErrorException ?? ev.validationException ?? ev.throttlingException ?? ev.serviceUnavailableException;
        throw new Error(`Bedrock stream error: ${e?.message ?? "unknown"}`);
      }
    }
    flushText();
    return { parts, raw, stopReason, usage };
  },
};
