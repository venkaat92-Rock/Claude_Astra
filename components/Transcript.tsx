"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AstraMessage, AstraPart } from "@/lib/types";
import type { Draft, Entry } from "@/lib/client/useAstra";
import { Markdown } from "./Markdown";
import { ToolBlock, type ToolView } from "./ToolBlock";

const WELCOME = `Type a request, or / for commands. The agent works inside your workspace
(right panel) and can fetch docs and generate images and video on Bedrock.`;

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div>
      <div className={`thinking ${open ? "open" : ""}`}>{text}</div>
      <button className="toggle" onClick={() => setOpen((o) => !o)}>{open ? "hide thinking" : "show thinking"}</button>
    </div>
  );
}

function AssistantMessage({ message, results, modelLabel }: { message: AstraMessage; results: Map<string, Extract<AstraPart, { type: "tool_result" }>>; modelLabel?: string }) {
  return (
    <div className="msg msg-assistant model-tag" data-model={modelLabel ?? message.modelId ?? ""}>
      {message.parts.map((p, i) => {
        if (p.type === "thinking") return <Thinking key={i} text={p.text} />;
        if (p.type === "text") return <Markdown key={i} text={p.text} />;
        if (p.type === "tool_use") {
          const r = results.get(p.id);
          const view: ToolView = { id: p.id, name: p.name, input: p.input, result: r ? { content: r.content, isError: r.isError, media: r.media } : undefined };
          return <ToolBlock key={i} tool={view} />;
        }
        return null;
      })}
    </div>
  );
}

function DraftView({ draft, modelLabel }: { draft: Draft; modelLabel?: string }) {
  return (
    <div className="msg msg-assistant model-tag" data-model={modelLabel ?? draft.modelId}>
      {draft.order.map((seg, i) => {
        if (seg === "thinking") return <Thinking key={i} text={draft.thinking} />;
        if (seg === "text") return <Markdown key={i} text={draft.text} />;
        const t = draft.tools.find((x) => x.id === seg.tool);
        return t ? <ToolBlock key={i} tool={{ ...t, pending: !t.result }} /> : null;
      })}
      {draft.order.length === 0 && <span className="status-line">thinking…</span>}
      <span className="cursor" />
    </div>
  );
}

export function Transcript({ entries, draft, modelLabels }: { entries: Entry[]; draft: Draft | null; modelLabels: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const m = new Map<string, Extract<AstraPart, { type: "tool_result" }>>();
    for (const e of entries) {
      if (e.kind !== "message") continue;
      for (const p of e.message.parts) if (p.type === "tool_result") m.set(p.toolUseId, p);
    }
    return m;
  }, [entries]);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, draft]);

  return (
    <div className="transcript" ref={ref}>
      {entries.length === 0 && (
        <div className="welcome">
          Welcome to <b>Claude Astra</b>.{"\n\n"}
          {WELCOME}
        </div>
      )}
      {entries.map((e) => {
        if (e.kind === "line") {
          return <div key={e.line.id} className={`status-line ${e.line.kind === "error" ? "err" : ""}`}>{e.line.text}</div>;
        }
        const m = e.message;
        if (m.role === "user") {
          const text = m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
          if (!text && m.parts.every((p) => p.type === "tool_result")) return null; // tool results render under their tool call
          return (
            <div key={m.id} className="msg msg-user">
              <span className="caret">❯</span>
              <span className="body">{text}</span>
            </div>
          );
        }
        return <AssistantMessage key={m.id} message={m} results={results} modelLabel={m.modelId ? modelLabels[m.modelId] : undefined} />;
      })}
      {draft && <DraftView draft={draft} modelLabel={modelLabels[draft.modelId]} />}
    </div>
  );
}
