"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelSpec } from "@/lib/models";
import type { AstraEvent, AstraMessage, AstraPart, Effort, MediaRef, Usage } from "@/lib/types";

export type ModelInfo = ModelSpec & { available: boolean; reason?: string };

export interface LiveTool {
  id: string;
  name: string;
  inputJson: string;
  input?: unknown;
  result?: { content: string; isError?: boolean; media?: MediaRef[] };
}

export interface Draft {
  messageId: string;
  modelId: string;
  thinking: string;
  text: string;
  tools: LiveTool[];
  /** Ordered stream of segments so text and tool blocks interleave the way they arrived. */
  order: ("thinking" | "text" | { tool: string })[];
}

export interface Line {
  id: string;
  kind: "system" | "error";
  text: string;
}

export type Entry = { kind: "message"; message: AstraMessage } | { kind: "line"; line: Line };

const STORAGE_KEY = "claude-astra:conversation:v1";

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function useAstra() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [region, setRegion] = useState<string>("");
  const [authMode, setAuthMode] = useState<string>("");
  const [modelId, setModelId] = useState<string>("");
  const [effort, setEffort] = useState<Effort | undefined>(undefined);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<Usage>({});
  const [conversationId, setConversationId] = useState<string>(() => uid());
  const abortRef = useRef<AbortController | null>(null);

  const messages = useMemo(() => entries.filter((e): e is Extract<Entry, { kind: "message" }> => e.kind === "message").map((e) => e.message), [entries]);
  const model = models.find((m) => m.id === modelId);

  // Load catalog + persisted conversation.
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((j: { models: ModelInfo[]; defaultModelId: string; region: string; authMode: string }) => {
        setModels(j.models);
        setRegion(j.region);
        setAuthMode(j.authMode);
        setModelId((cur) => cur || j.defaultModelId);
      })
      .catch(() => pushLine("error", "Could not load /api/models"));
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { entries: Entry[]; modelId?: string; conversationId?: string; effort?: Effort };
        setEntries(parsed.entries ?? []);
        if (parsed.modelId) setModelId(parsed.modelId);
        if (parsed.conversationId) setConversationId(parsed.conversationId);
        if (parsed.effort) setEffort(parsed.effort);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, modelId, conversationId, effort }));
    } catch { /* ignore quota */ }
  }, [entries, modelId, conversationId, effort]);

  const pushLine = useCallback((kind: Line["kind"], text: string) => {
    setEntries((es) => [...es, { kind: "line", line: { id: uid(), kind, text } }]);
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setEntries([]);
    setDraft(null);
    setUsage({});
    setConversationId(uid());
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const applyEvent = useCallback((ev: AstraEvent) => {
    switch (ev.type) {
      case "turn_start":
        setDraft({ messageId: ev.messageId, modelId: ev.modelId, thinking: "", text: "", tools: [], order: [] });
        break;
      case "thinking":
        setDraft((d) => d && { ...d, thinking: d.thinking + ev.delta, order: d.order.at(-1) === "thinking" ? d.order : [...d.order, "thinking"] });
        break;
      case "text":
        setDraft((d) => d && { ...d, text: d.text + ev.delta, order: d.order.at(-1) === "text" ? d.order : [...d.order, "text"] });
        break;
      case "tool_start":
        setDraft((d) => d && { ...d, tools: [...d.tools, { id: ev.id, name: ev.name, inputJson: "" }], order: [...d.order, { tool: ev.id }] });
        break;
      case "tool_input":
        setDraft((d) => d && { ...d, tools: d.tools.map((t) => (t.id === ev.id ? { ...t, inputJson: t.inputJson + ev.delta } : t)) });
        break;
      case "tool_use":
        setDraft((d) => {
          if (!d) return d;
          const exists = d.tools.some((t) => t.id === ev.id);
          const tools = exists
            ? d.tools.map((t) => (t.id === ev.id ? { ...t, input: ev.input } : t))
            : [...d.tools, { id: ev.id, name: ev.name, inputJson: JSON.stringify(ev.input), input: ev.input }];
          return { ...d, tools, order: exists ? d.order : [...d.order, { tool: ev.id }] };
        });
        break;
      case "tool_result":
        // Results are persisted via the following turn_end (a user message of tool_result parts).
        setDraft((d) => d && { ...d, tools: d.tools.map((t) => (t.id === ev.id ? { ...t, result: { content: ev.content, isError: ev.isError, media: ev.media } } : t)) });
        break;
      case "turn_end":
        setEntries((es) => [...es, { kind: "message", message: ev.message }]);
        if (ev.message.role === "assistant") setDraft(null);
        if (ev.usage) {
          setUsage((u) => ({
            inputTokens: (u.inputTokens ?? 0) + (ev.usage?.inputTokens ?? 0),
            outputTokens: (u.outputTokens ?? 0) + (ev.usage?.outputTokens ?? 0),
            cacheReadInputTokens: (u.cacheReadInputTokens ?? 0) + (ev.usage?.cacheReadInputTokens ?? 0),
          }));
        }
        break;
      case "status":
        pushLine("system", ev.text);
        break;
      case "error":
        pushLine("error", ev.message);
        break;
      case "done":
        setDraft(null);
        break;
    }
  }, [pushLine]);

  /** Send a user message (with optional image parts) through the agent loop. */
  const send = useCallback(
    async (text: string, extraParts: AstraPart[] = []) => {
      if (busy || !modelId) return;
      const userMessage: AstraMessage = { id: uid(), role: "user", parts: [...extraParts, { type: "text", text }], createdAt: new Date().toISOString() };
      const history = [...messages, userMessage];
      setEntries((es) => [...es, { kind: "message", message: userMessage }]);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, modelId, effort, conversationId }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          pushLine("error", j.error ?? `HTTP ${res.status}`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              applyEvent(JSON.parse(line) as AstraEvent);
            } catch {
              /* skip malformed line */
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") pushLine("system", "Stopped.");
        else pushLine("error", err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setDraft(null);
        abortRef.current = null;
      }
    },
    [busy, modelId, effort, messages, conversationId, applyEvent, pushLine],
  );

  return {
    models, model, modelId, setModelId, effort, setEffort, region, authMode,
    entries, messages, draft, busy, usage, conversationId,
    send, stop, clear, pushLine,
  };
}
