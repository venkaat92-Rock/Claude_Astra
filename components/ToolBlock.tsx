"use client";

import { useState } from "react";
import type { MediaRef } from "@/lib/types";

export interface ToolView {
  id: string;
  name: string;
  input?: unknown;
  inputJson?: string;
  result?: { content: string; isError?: boolean; media?: MediaRef[] };
  pending?: boolean;
}

function summarize(name: string, input: unknown, inputJson?: string): string {
  const i = (input ?? safeParse(inputJson)) as Record<string, unknown> | undefined;
  if (!i) return inputJson ? inputJson.slice(0, 80) : "";
  switch (name) {
    case "read_file": case "write_file": case "edit_file": case "delete_file": case "list_files": case "cat":
      return String(i.path ?? "");
    case "search_files": return `"${i.query}"${i.path ? ` in ${i.path}` : ""}`;
    case "web_fetch": return String(i.url ?? "");
    case "generate_image": case "generate_video": return String(i.prompt ?? "").slice(0, 90);
    case "check_video": return String(i.invocation_arn ?? "").split("/").pop() ?? "";
    default: return JSON.stringify(i).slice(0, 90);
  }
}

function safeParse(json?: string): unknown {
  if (!json) return undefined;
  try { return JSON.parse(json); } catch { return undefined; }
}

const ICONS: Record<string, string> = {
  read_file: "📄", write_file: "✎", edit_file: "✎", delete_file: "✕", list_files: "▤", search_files: "⌕",
  web_fetch: "⇣", generate_image: "▣", generate_video: "▶", check_video: "⟳",
};

export function ToolBlock({ tool }: { tool: ToolView }) {
  const [open, setOpen] = useState(false);
  const state = tool.result ? (tool.result.isError ? "error" : "done") : tool.pending ? "running…" : "";
  const inputText = tool.input !== undefined ? JSON.stringify(tool.input, null, 2) : tool.inputJson ?? "";
  return (
    <div className="tool">
      <div className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span className="icon">{ICONS[tool.name] ?? "⚙"}</span>
        <span className="name">{tool.name}</span>
        <span className="summary">{summarize(tool.name, tool.input, tool.inputJson)}</span>
        <span className={`state ${tool.result ? (tool.result.isError ? "err" : "ok") : ""}`}>{state}</span>
        <span className="toggle">{open ? "▾" : "▸"}</span>
      </div>
      {(open || tool.result?.media?.length) && (
        <div className="tool-body">
          {open && (
            <>
              <div className="label">input</div>
              <pre>{inputText}</pre>
              {tool.result && (
                <>
                  <div className="label">result</div>
                  <pre>{tool.result.content.length > 4000 ? tool.result.content.slice(0, 4000) + "\n…" : tool.result.content}</pre>
                </>
              )}
            </>
          )}
          {tool.result?.media?.map((m, i) => (
            <div className="tool-media" key={i}>
              {m.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url ?? `data:${m.mediaType};base64,${m.data}`} alt={m.path ?? "generated image"} />
              ) : (
                <video src={m.url} controls />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
