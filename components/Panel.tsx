"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelInfo } from "@/lib/client/useAstra";

interface FileRow { path: string; size: number; modified?: string }

export function Panel({ models, modelId, onPickModel, refreshKey, onOpenFile }: {
  models: ModelInfo[];
  modelId: string;
  onPickModel: (id: string) => void;
  refreshKey: number;
  onOpenFile: (path: string) => void;
}) {
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/workspace")
      .then(async (r) => {
        const j = (await r.json()) as { files?: FileRow[]; error?: string };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setFiles(j.files ?? []);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  useEffect(load, [load, refreshKey]);

  const chat = models.filter((m) => m.capabilities.includes("chat") || m.capabilities.includes("agent"));
  const media = models.filter((m) => m.capabilities.includes("image") || m.capabilities.includes("video"));

  return (
    <aside className="panel">
      <h3>Models</h3>
      <div className="models">
        {chat.map((m) => (
          <div key={m.id} className={`m ${m.id === modelId ? "active" : ""} ${m.available ? "" : "off"}`} title={m.description} onClick={() => m.available && onPickModel(m.id)}>
            <span className="v">{m.vendor}</span>
            <span>{m.label}</span>
            {!m.available && <span className="why">{m.reason}</span>}
          </div>
        ))}
      </div>
      <h3 style={{ marginTop: 14 }}>Media models</h3>
      <div className="models">
        {media.map((m) => (
          <div key={m.id} className={`m ${m.available ? "" : "off"}`} title={m.description}>
            <span className="v">{m.vendor}</span>
            <span>{m.label}</span>
            {!m.available && <span className="why">{m.reason}</span>}
          </div>
        ))}
      </div>
      <h3 style={{ marginTop: 14 }}>Workspace <button className="toggle" onClick={load}>↻</button></h3>
      {err && <div className="empty">{err}</div>}
      {!err && files && files.length === 0 && <div className="empty">empty — ask the agent to create a file</div>}
      {!err && files?.map((f) => (
        <div key={f.path} className="file" onClick={() => onOpenFile(f.path)}>
          <span>{f.path}</span>
          <span className="size">{fmtSize(f.size)}</span>
        </div>
      ))}
    </aside>
  );
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
