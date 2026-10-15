"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelSpec } from "@/lib/models";
import type { AstraEvent, AstraMessage, AstraPart, ConversationRecord, ConversationSummary, Effort, MediaRef, Usage } from "@/lib/types";

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
  order: ("thinking" | "text" | { tool: string })[];
}

export interface Line {
  id: string;
  kind: "system" | "error";
  text: string;
}

export type Entry = { kind: "message"; message: AstraMessage } | { kind: "line"; line: Line };

const LAST_KEY = "claude-astra:last-conversation";

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function messagesOf(entries: Entry[]): AstraMessage[] {
  return entries.filter((e): e is Extract<Entry, { kind: "message" }> => e.kind === "message").map((e) => e.message);
}

export function useAstra() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [region, setRegion] = useState("");
  const [authMode, setAuthMode] = useState("");
  const [modelId, setModelId] = useState("");
  const [effort, setEffort] = useState<Effort | undefined>(undefined);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<Usage>({});
  const [conversationId, setConversationId] = useState<string>(() => uid());
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const entriesRef = useRef<Entry[]>([]);
  entriesRef.current = entries;
  const stateRef = useRef({ modelId, effort, conversationId });
  stateRef.current = { modelId, effort, conversationId };

  const messages = useMemo(() => messagesOf(entries), [entries]);
  const model = models.find((m) => m.id === modelId);

  const pushLine = useCallback((kind: Line["kind"], text: string) => {
    setEntries((es) => [...es, { kind: "line", line: { id: uid(), kind, text } }]);
  }, []);

  /* ---------------- cloud conversations ---------------- */

  const refreshConversations = useCallback(async () => {
    try {
      const r = await fetch("/api/conversations");
      const j = (await r.json()) as { conversations?: ConversationSummary[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setConversations(j.conversations ?? []);
      return j.conversations ?? [];
    } catch (err) {
      pushLine("error", `Could not load conversations: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }, [pushLine]);

  const openConversation = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setLoadingConversation(true);
    try {
      const r = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
      const rec = (await r.json()) as ConversationRecord & { error?: string };
      if (!r.ok) throw new Error(rec.error ?? `HTTP ${r.status}`);
      setConversationId(rec.id);
      setEntries(rec.messages.map((m) => ({ kind: "message", message: m })));
      if (rec.modelId) setModelId(rec.modelId);
      setEffort(rec.effort);
      setUsage({});
      setDraft(null);
      try { localStorage.setItem(LAST_KEY, rec.id); } catch { /* ignore */ }
    } catch (err) {
      pushLine("error", `Could not open conversation: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingConversation(false);
    }
  }, [pushLine]);

  const persist = useCallback(async () => {
    const msgs = messagesOf(entriesRef.current);
    const { modelId: mid, effort: eff, conversationId: cid } = stateRef.current;
    if (msgs.length === 0 || !mid) return;
    try {
      const r = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cid, modelId: mid, effort: eff, messages: msgs }),
      });
      const summary = (await r.json()) as ConversationSummary & { error?: string };
      if (!r.ok) throw new Error(summary.error ?? `HTTP ${r.status}`);
      setConversations((cs) => [summary, ...cs.filter((c) => c.id !== summary.id)]);
      try { localStorage.setItem(LAST_KEY, summary.id); } catch { /* ignore */ }
    } catch (err) {
      pushLine("error", `Could not save conversation: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [pushLine]);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    setEntries([]);
    setDraft(null);
    setUsage({});
    setConversationId(uid());
    try { localStorage.removeItem(LAST_KEY); } catch { /* ignore */ }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
    setConversations((cs) => cs.filter((c) => c.id !== id));
    if (stateRef.current.conversationId === id) newConversation();
  }, [newConversation]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    setConversations((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)));
  }, []);

  // Catalog + conversation list; reopen the last conversation used in this browser.
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
    refreshConversations().then((list) => {
      let last: string | null = null;
      try { last = localStorage.getItem(LAST_KEY); } catch { /* ignore */ }
      if (last && list.some((c) => c.id === last)) void openConversation(last);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- streaming ---------------- */

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

  /** Send a user message (text plus any attachment parts) through the agent loop, then save. */
  const send = useCallback(
    async (parts: AstraPart[]) => {
      if (busy || !modelId) return;
      const userMessage: AstraMessage = { id: uid(), role: "user", parts, createdAt: new Date().toISOString() };
      const history = [...messagesOf(entriesRef.current), userMessage];
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
            try { applyEvent(JSON.parse(line) as AstraEvent); } catch { /* skip malformed line */ }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") pushLine("system", "Stopped.");
        else pushLine("error", err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setDraft(null);
        abortRef.current = null;
        void persist();
      }
    },
    [busy, modelId, effort, conversationId, applyEvent, pushLine, persist],
  );

  return {
    models, model, modelId, setModelId, effort, setEffort, region, authMode,
    entries, messages, draft, busy, usage,
    conversationId, conversations, loadingConversation,
    send, stop, pushLine,
    newConversation, openConversation, deleteConversation, renameConversation, refreshConversations,
  };
}
