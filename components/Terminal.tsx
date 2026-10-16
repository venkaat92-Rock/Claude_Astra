"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAstra } from "@/lib/client/useAstra";
import { EFFORTS, HELP_TEXT, parseSlash } from "@/lib/client/slash-commands";
import { partsForSend, type Attachment } from "@/lib/client/attachments";
import { usePref, useTheme } from "@/lib/client/useTheme";
import type { Effort } from "@/lib/types";
import { Composer } from "./Composer";
import { Panel } from "./Panel";
import { Sidebar } from "./Sidebar";
import { Transcript } from "./Transcript";

export function Terminal() {
  const astra = useAstra();
  const {
    models, model, modelId, setModelId, effort, setEffort, region, authMode,
    entries, draft, busy, usage, conversationId, conversations, loadingConversation,
    send, stop, pushLine, newConversation, openConversation, deleteConversation, renameConversation,
  } = astra;
  const [theme, toggleTheme] = useTheme();
  const [hideSidebar, setHideSidebar] = usePref("hide-sidebar", false);
  const [hidePanel, setHidePanel] = usePref("hide-panel", false);
  const [refreshKey, setRefreshKey] = useState(0);
  const modelLabels = useMemo(() => Object.fromEntries(models.map((m) => [m.id, m.label])), [models]);

  // Refresh the workspace panel whenever a run finishes (tools may have written files).
  useEffect(() => {
    if (!busy) setRefreshKey((k) => k + 1);
  }, [busy]);

  const openFile = useCallback(async (path: string) => {
    const r = await fetch(`/api/workspace?path=${encodeURIComponent(path)}`);
    const j = (await r.json()) as { content?: string; error?: string };
    pushLine(j.error ? "error" : "system", j.error ?? `── ${path} ──\n${j.content}`);
  }, [pushLine]);

  const openList = useCallback(async () => {
    const r = await fetch("/api/workspace");
    const j = (await r.json()) as { files?: { path: string; size: number }[]; error?: string };
    if (j.error) return pushLine("error", j.error);
    pushLine("system", j.files?.length ? j.files.map((f) => `${f.path}  (${f.size} B)`).join("\n") : "workspace is empty");
  }, [pushLine]);

  const handle = useCallback(
    async (text: string, attachments: Attachment[]) => {
      const cmd = attachments.length === 0 ? parseSlash(text) : null;
      if (!cmd) return send(partsForSend(text, attachments));
      switch (cmd.name) {
        case "help":
          return pushLine("system", HELP_TEXT);
        case "clear":
        case "new":
          return newConversation();
        case "models":
          return pushLine(
            "system",
            models.map((m) => `${m.id.padEnd(18)} ${m.vendor.padEnd(9)} ${m.label.padEnd(32)} ${m.available ? "available" : `unavailable: ${m.reason}`}`).join("\n"),
          );
        case "model": {
          if (!cmd.rest) return pushLine("system", `model: ${modelId}${model ? ` (${model.label}, ${model.provider})` : ""}`);
          const next = models.find((m) => m.id === cmd.rest || m.label.toLowerCase() === cmd.rest.toLowerCase());
          if (!next) return pushLine("error", `unknown model "${cmd.rest}" — try /models`);
          if (!next.available) return pushLine("error", `${next.label} is unavailable: ${next.reason}`);
          setModelId(next.id);
          return pushLine("system", `model → ${next.label}`);
        }
        case "agent": {
          const agent = models.find((m) => m.provider === "bedrock-agent");
          if (!agent?.available) return pushLine("error", `Bedrock Agent unavailable: ${agent?.reason ?? "not in catalog"}`);
          setModelId(agent.id);
          return pushLine("system", "model → Bedrock Agent. Messages now go to InvokeAgent; workspace tools are the agent's action groups.");
        }
        case "effort": {
          const e = cmd.rest as Effort;
          if (!EFFORTS.includes(e)) return pushLine("error", `effort must be one of ${EFFORTS.join(", ")}`);
          setEffort(e);
          return pushLine("system", `effort → ${e}`);
        }
        case "theme":
          return toggleTheme();
        case "files":
          return openList();
        case "cat":
          if (!cmd.rest) return pushLine("error", "usage: /cat <path>");
          return openFile(cmd.rest);
        case "image": {
          if (!cmd.rest) return pushLine("error", "usage: /image <prompt>");
          pushLine("system", "generating image with Nova Canvas…");
          const r = await fetch("/api/generate/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: cmd.rest }) });
          const j = (await r.json()) as { path?: string; url?: string; error?: string };
          if (!r.ok) return pushLine("error", j.error ?? `HTTP ${r.status}`);
          setRefreshKey((k) => k + 1);
          return pushLine("system", `saved ${j.path}\n${j.url}`);
        }
        case "video": {
          const m = /^status\s+(\S+)/.exec(cmd.rest);
          if (m) {
            const r = await fetch(`/api/generate/video?arn=${encodeURIComponent(m[1])}`);
            const j = (await r.json()) as { status?: string; videoUrl?: string; failureMessage?: string; error?: string };
            if (!r.ok) return pushLine("error", j.error ?? `HTTP ${r.status}`);
            return pushLine("system", `status: ${j.status}${j.videoUrl ? `\n${j.videoUrl}` : ""}${j.failureMessage ? `\n${j.failureMessage}` : ""}`);
          }
          if (!cmd.rest) return pushLine("error", "usage: /video <prompt>   or   /video status <invocationArn>");
          const luma = /^luma\s+/i.test(cmd.rest);
          const r = await fetch("/api/generate/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: cmd.rest.replace(/^luma\s+/i, ""), modelId: luma ? "luma-ray-2" : "nova-reel" }) });
          const j = (await r.json()) as { invocationArn?: string; modelId?: string; error?: string };
          if (!r.ok) return pushLine("error", j.error ?? `HTTP ${r.status}`);
          return pushLine("system", `video job started on ${j.modelId}\n${j.invocationArn}\nPoll with: /video status ${j.invocationArn}`);
        }
        default:
          return pushLine("error", `unknown command /${cmd.name} — try /help`);
      }
    },
    [send, pushLine, newConversation, models, model, modelId, setModelId, setEffort, openFile, openList, toggleTheme],
  );

  const chatModels = models.filter((m) => m.status !== "retired" && (m.capabilities.includes("chat") || m.capabilities.includes("agent")));
  const workingModels = chatModels.filter((m) => m.status === "working");
  const untestedModels = chatModels.filter((m) => m.status !== "working");

  return (
    <div className={`astra ${hideSidebar ? "no-sidebar" : ""} ${hidePanel ? "no-panel" : ""}`}>
      <header className="astra-header">
        <button className="icon" title={hideSidebar ? "Show chats" : "Hide chats"} onClick={() => setHideSidebar((v) => !v)}>☰</button>
        <span className="astra-logo">✦ Claude Astra <span>· Bedrock agent workbench</span></span>
        <span className="spacer" />
        <select value={modelId} onChange={(e) => setModelId(e.target.value)} style={{ padding: "3px 8px", maxWidth: 280 }} title="Model">
          <optgroup label="Tested & working">
            {workingModels.map((m) => <option key={m.id} value={m.id} disabled={!m.available}>{m.label}{m.available ? "" : " (unavailable)"}</option>)}
          </optgroup>
          <optgroup label="Yet to work">
            {untestedModels.map((m) => <option key={m.id} value={m.id} disabled={!m.available}>{m.label}{m.available ? "" : " (unavailable)"}</option>)}
          </optgroup>
        </select>
        {model?.capabilities.includes("thinking") && model.provider === "anthropic-bedrock" && (
          <select value={effort ?? model.defaults?.effort ?? "high"} onChange={(e) => setEffort(e.target.value as Effort)} style={{ padding: "3px 8px" }} title="Reasoning effort">
            {EFFORTS.map((e) => <option key={e} value={e}>effort: {e}</option>)}
          </select>
        )}
        <button className="icon" onClick={toggleTheme} title="Toggle light/dark">{theme === "light" ? "☾" : "☀"}</button>
        <button className="icon" title={hidePanel ? "Show models & workspace" : "Hide models & workspace"} onClick={() => setHidePanel((v) => !v)}>⫼</button>
        <button onClick={newConversation} title="New chat">new</button>
      </header>
      <div className="banner">{authMode === "none" ? "Local dev mode: authentication disabled (ASTRA_AUTH_MODE=none). Never deploy with this set." : ""}</div>
      <Sidebar conversations={conversations} activeId={conversationId} onOpen={openConversation} onNew={newConversation} onDelete={deleteConversation} onRename={renameConversation} />
      <Transcript entries={entries} draft={draft} modelLabels={modelLabels} />
      <Composer busy={busy || loadingConversation} onSend={handle} onStop={stop} />
      <Panel models={models} modelId={modelId} onPickModel={setModelId} refreshKey={refreshKey} onOpenFile={openFile} />
      <footer className="footer">
        <span><span className="k">model</span> {model?.label ?? "…"}</span>
        <span><span className="k">provider</span> {model?.provider ?? ""}</span>
        <span><span className="k">region</span> {region}</span>
        <span className="spacer" />
        <span><span className="k">tokens</span> {usage.inputTokens ?? 0} in · {usage.outputTokens ?? 0} out{usage.cacheReadInputTokens ? ` · ${usage.cacheReadInputTokens} cached` : ""}</span>
        <span>{busy ? "● running" : "○ idle"}</span>
      </footer>
    </div>
  );
}
