import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import type { AstraEvent, AstraMessage, AstraPart } from "@/lib/types";
import { serverConfig } from "../config";
import type { ChatProvider, TurnRequest, TurnResult } from "./types";

let ai: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  if (ai) return ai;
  const key = serverConfig().googleApiKey;
  if (!key) throw new Error("GOOGLE_API_KEY is not set; Gemini is not available on Bedrock, so Claude Astra calls Google's API directly.");
  return (ai = new GoogleGenAI({ apiKey: key }));
}

function toGeminiContents(messages: AstraMessage[]): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      let parts: Part[];
      if (m.provider === "gemini" && Array.isArray(m.raw)) {
        parts = m.raw as Part[]; // includes thoughtSignature parts that must be replayed
      } else {
        parts = [];
        for (const p of m.parts) {
          if (p.type === "text" && p.text) parts.push({ text: p.text });
          else if (p.type === "tool_use") parts.push({ functionCall: { id: p.id, name: p.name, args: (p.input ?? {}) as Record<string, unknown> } });
        }
      }
      if (parts.length === 0) parts = [{ text: "(no content)" }];
      out.push({ role: "model", parts });
      continue;
    }
    const parts: Part[] = [];
    for (const p of m.parts) {
      if (p.type === "text") parts.push({ text: p.text });
      else if (p.type === "image") parts.push({ inlineData: { mimeType: p.mediaType, data: p.data } });
      else if (p.type === "tool_result") {
        parts.push({ functionResponse: { id: p.toolUseId, name: p.name ?? "tool", response: p.isError ? { error: p.content } : { output: p.content } } });
      }
    }
    if (parts.length === 0) parts.push({ text: "(empty)" });
    out.push({ role: "user", parts });
  }
  return out;
}

/** Google Gemini through Google's Gen AI SDK (AI Studio API key). */
export const geminiProvider: ChatProvider = {
  async *streamTurn(req: TurnRequest): AsyncGenerator<AstraEvent, TurnResult, undefined> {
    const { model } = req;
    const functionDeclarations: FunctionDeclaration[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: t.inputSchema,
    }));

    const stream = await getClient().models.generateContentStream({
      model: model.apiModelId,
      contents: toGeminiContents(req.messages),
      config: {
        systemInstruction: req.system,
        maxOutputTokens: req.maxTokens ?? model.defaults?.maxTokens ?? 16_000,
        tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
        thinkingConfig: { includeThoughts: true },
        abortSignal: req.signal,
      },
    });

    const parts: AstraPart[] = [];
    const raw: Part[] = [];
    let text = "";
    let thinking = "";
    let callCounter = 0;
    let finish: string | undefined;
    let usage: TurnResult["usage"];

    const flushText = () => {
      if (thinking) {
        parts.push({ type: "thinking", text: thinking });
        thinking = "";
      }
      if (text) {
        parts.push({ type: "text", text });
        text = "";
      }
    };

    for await (const chunk of stream) {
      const cand = chunk.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) {
        raw.push(part);
        if (part.functionCall) {
          flushText();
          const id = part.functionCall.id ?? `gemini_call_${Date.now()}_${callCounter++}`;
          part.functionCall.id = id;
          const name = part.functionCall.name ?? "unknown";
          const input = part.functionCall.args ?? {};
          parts.push({ type: "tool_use", id, name, input });
          yield { type: "tool_start", id, name };
          yield { type: "tool_use", id, name, input };
        } else if (part.text) {
          if (part.thought) {
            thinking += part.text;
            yield { type: "thinking", delta: part.text };
          } else {
            text += part.text;
            yield { type: "text", delta: part.text };
          }
        }
      }
      if (cand?.finishReason) finish = String(cand.finishReason);
      if (chunk.usageMetadata) {
        usage = { inputTokens: chunk.usageMetadata.promptTokenCount, outputTokens: chunk.usageMetadata.candidatesTokenCount };
      }
    }
    flushText();

    const hasCalls = parts.some((p) => p.type === "tool_use");
    let stopReason: TurnResult["stopReason"] = hasCalls ? "tool_use" : "end_turn";
    if (finish === "MAX_TOKENS") stopReason = "max_tokens";
    else if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT" || finish === "BLOCKLIST") {
      stopReason = "refusal";
      yield { type: "status", text: `Gemini stopped: ${finish}` };
    }
    return { parts, raw, stopReason, usage };
  },
};
