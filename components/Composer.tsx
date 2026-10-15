"use client";

import { useEffect, useRef, useState } from "react";
import { SLASH_COMMANDS } from "@/lib/client/slash-commands";

export function Composer({ busy, onSend, onStop }: { busy: boolean; onSend: (text: string) => void; onStop: () => void }) {
  const [value, setValue] = useState("");
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  const showSuggest = value.startsWith("/") && !value.includes(" ") && !value.includes("\n");
  const matches = showSuggest ? SLASH_COMMANDS.filter((c) => ("/" + c.name).startsWith(value.toLowerCase())) : [];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy) onStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onStop]);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
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

  return (
    <div className="composer">
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
      <div className="composer-row">
        <span className="caret">❯</span>
        <textarea
          ref={ref}
          value={value}
          rows={1}
          placeholder={busy ? "Running… (Esc to stop)" : "Ask Claude Astra anything, or type / for commands"}
          onChange={(e) => { setValue(e.target.value); setSel(0); }}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <div className="actions">
          {busy ? <button onClick={onStop}>stop</button> : <button onClick={submit} disabled={!value.trim()}>send</button>}
        </div>
      </div>
      <div className="hint">Enter to send · Shift+Enter newline · Esc stops · / commands</div>
    </div>
  );
}
