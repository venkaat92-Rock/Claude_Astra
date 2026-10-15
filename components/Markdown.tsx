"use client";

import { Fragment } from "react";

/** Minimal, dependency-free markdown: fenced code, inline code, bold. */
export function Markdown({ text }: { text: string }) {
  const chunks = text.split(/(```[\s\S]*?```|```[\s\S]*$)/g);
  return (
    <div className="md">
      {chunks.map((chunk, i) => {
        if (chunk.startsWith("```")) {
          const body = chunk.replace(/^```/, "").replace(/```$/, "");
          const nl = body.indexOf("\n");
          const lang = nl >= 0 ? body.slice(0, nl).trim() : "";
          const code = nl >= 0 ? body.slice(nl + 1) : body;
          return (
            <pre key={i}>
              {lang && <span className="lang">{lang}</span>}
              <code>{code.replace(/\n$/, "")}</code>
            </pre>
          );
        }
        return <Fragment key={i}>{inline(chunk)}</Fragment>;
      })}
    </div>
  );
}

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) out.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else out.push(<b key={k++}>{tok.slice(2, -2)}</b>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
