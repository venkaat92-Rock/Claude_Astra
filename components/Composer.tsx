"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SLASH_COMMANDS } from "@/lib/client/slash-commands";
import { prepareAttachment, type Attachment } from "@/lib/client/attachments";
import type { AstraPart } from "@/lib/types";

export function Composer({ busy, onSend, onStop }: {
  busy: boolean;
  onSend: (text: string, attachments: Attachment[]) => void | Promise<void>;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const [sel, setSel] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const showSuggest = value.startsWith("/") && !value.includes(" ") && !value.includes("\n");
  const matches = showSuggest ? SLASH_COMMANDS.filter((c) => ("/" + c.name).startsWith(value.toLowerCase())) : [];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && busy) onStop(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onStop]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const placeholders: Attachment[] = list.map((f) => ({ id: `${f.name}-${f.size}-${Math.random()}`, name: f.name, size: f.size, kind: "file", status: "processing", parts: [] }));
    setAttachments((a) => [...a, ...placeholders]);
    await Promise.all(list.map(async (f, i) => {
      const ready = await prepareAttachment(f);
      setAttachments((a) => a.map((x) => (x.id === placeholders[i].id ? { ...ready, id: x.id } : x)));
    }));
  }, []);

  const submit = () => {
    const text = value.trim();
    const pending = attachments.some((a) => a.status === "processing");
    if ((!text && attachments.length === 0) || pending) return;
    void onSend(text, attachments);
    setValue("");
    setAttachments([]);
    setSel(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setSel((s) => (s + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
      return;
    }
    if (matches.length && (e.key === "Tab" || (e.key === "Enter" && matches.length > 1))) {
      e.preventDefault();
      const c = matches[sel] ?? matches[0];
      setValue("/" + c.name + (c.args ? " " : ""));
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  return (
    <div
      className={`composer ${drag ? "drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}
    >
      {matches.length > 0 && (
        <div className="suggest">
          {matches.map((c, i) => (
            <div key={c.name} className={i === sel ? "active" : ""} onMouseDown={() => setValue("/" + c.name + (c.args ? " " : ""))}>
              <span>/{c.name} {c.args ?? ""}</span>
              <span className="d">{c.description}</span>
            </div>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="attachments">
          {attachments.map((a) => (
            <span key={a.id} className={`chip ${a.status === "error" ? "err" : ""}`} title={a.error ?? a.path ?? a.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {a.preview ? <img src={a.preview} alt="" /> : <span className="k">{a.status === "processing" ? "…" : a.kind === "document" ? "PDF" : a.kind === "text" ? "txt" : "file"}</span>}
              <span className="n">{a.name}</span>
              {a.status === "error" && <span className="k">failed</span>}
              {a.path && <span className="k">→ workspace</span>}
              <button className="x" onClick={() => setAttachments((l) => l.filter((x) => x.id !== a.id))} title="Remove">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-row">
        <span className="caret">❯</span>
        <textarea
          ref={ref}
          value={value}
          rows={1}
          placeholder={busy ? "Running… (Esc to stop)" : "Ask Claude Astra anything, drop files here, or type / for commands"}
          onChange={(e) => { setValue(e.target.value); setSel(0); }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          autoFocus
        />
        <div className="actions">
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
          <button className="icon" title="Attach files (images, PDFs, text, anything else goes to the workspace)" onClick={() => fileRef.current?.click()}>📎</button>
          {busy ? <button onClick={onStop}>stop</button> : <button onClick={submit} disabled={(!value.trim() && attachments.length === 0) || attachments.some((a) => a.status === "processing")}>send</button>}
        </div>
      </div>
      <div className="hint">Enter to send · Shift+Enter newline · Esc stops · / commands · 📎 or drag/paste to attach</div>
    </div>
  );
}

export type { AstraPart };
