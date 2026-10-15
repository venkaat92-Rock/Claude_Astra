"use client";

import { useState } from "react";
import type { ConversationSummary } from "@/lib/types";

function when(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Sidebar({ conversations, activeId, onOpen, onNew, onDelete, onRename }: {
  conversations: ConversationSummary[];
  activeId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");

  const commit = (id: string) => {
    const t = value.trim();
    setEditing(null);
    if (t) onRename(id, t);
  };

  return (
    <aside className="sidebar">
      <div className="side-head">
        <h3 style={{ margin: 0, padding: 0, cursor: "default" }}>Chats</h3>
        <button className="icon" onClick={onNew} title="New chat">+ new</button>
      </div>
      {conversations.length === 0 && <div className="empty">No saved chats yet. Your first message creates one.</div>}
      {conversations.map((c) => (
        <div key={c.id} className={`conv ${c.id === activeId ? "active" : ""}`} onClick={() => editing !== c.id && onOpen(c.id)} onDoubleClick={() => { setEditing(c.id); setValue(c.title); }} title={c.title}>
          {editing === c.id ? (
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => commit(c.id)}
              onKeyDown={(e) => { if (e.key === "Enter") commit(c.id); if (e.key === "Escape") setEditing(null); }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="title">{c.title}</span>
              <span className="when">{when(c.updatedAt)}</span>
              <button className="x" title="Delete" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${c.title}"?`)) onDelete(c.id); }}>✕</button>
            </>
          )}
        </div>
      ))}
    </aside>
  );
}
