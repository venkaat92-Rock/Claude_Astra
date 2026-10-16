"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelInfo } from "@/lib/client/useAstra";
import { usePref } from "@/lib/client/useTheme";

interface FileRow { path: string; size: number; modified?: string }

function Section({ id, title, children, extra }: { id: string; title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  const [folded, setFolded] = usePref(`fold:${id}`, false);
  return (
    <section>
      <h3 onClick={() => setFolded((f) => !f)}>
        <span>{folded ? "▸" : "▾"}</span> {title} {extra}
      </h3>
      {!folded && children}
    </section>
  );
}

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

  const visible = models.filter((m) => m.status !== "retired");
  const chat = visible.filter((m) => m.capabilities.includes("chat") || m.capabilities.includes("agent"));
  const working = chat.filter((m) => m.status === "working");
  const untested = chat.filter((m) => m.status !== "working");
  const media = visible.filter((m) => m.capabilities.includes("image") || m.capabilities.includes("video"));

  const row = (m: ModelInfo) => (
    <div key={m.id} className={`m ${m.id === modelId ? "active" : ""} ${m.available ? "" : "off"}`} title={m.description} onClick={() => m.available && onPickModel(m.id)}>
      <span className="v">{m.vendor}</span>
      <span>{m.label}</span>
      {!m.available && <span className="why">{m.reason}</span>}
    </div>
  );

  return (
    <aside className="panel">
      <Section id="models-working" title="Tested & working">
        <div className="models">{working.length ? working.map(row) : <div className="empty">none verified yet</div>}</div>
      </Section>
      <Section id="models-untested" title="Yet to work">
        <div className="models">{untested.map(row)}</div>
      </Section>
      <Section id="media" title="Media models">
        <div className="models">
          {media.map((m) => (
            <div key={m.id} className={`m ${m.available ? "" : "off"}`} title={m.description}>
              <span className="v">{m.vendor}</span>
              <span>{m.label}</span>
              {!m.available && <span className="why">{m.reason}</span>}
            </div>
          ))}
        </div>
      </Section>
      <Section id="workspace" title="Workspace" extra={<button className="toggle" onClick={(e) => { e.stopPropagation(); load(); }}>↻</button>}>
        {err && <div className="empty">{err}</div>}
        {!err && files && files.length === 0 && <div className="empty">empty — ask the agent to create a file, or attach one</div>}
        {!err && files?.map((f) => (
          <div key={f.path} className="file" onClick={() => onOpenFile(f.path)}>
            <span>{f.path}</span>
            <span className="size">{fmtSize(f.size)}</span>
          </div>
        ))}
      </Section>
    </aside>
  );
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
