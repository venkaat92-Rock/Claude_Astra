"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * GitHub-flavoured markdown (tables, task lists, strikethrough, autolinks).
 * react-markdown renders to React elements and never injects raw HTML, so
 * model output is safe to display as-is.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          pre: ({ children }) => <pre>{children}</pre>,
          code: ({ className, children, ...rest }) => {
            const lang = /language-(\w+)/.exec(className ?? "")?.[1];
            const inline = !className && !String(children).includes("\n");
            if (inline) return <code {...rest}>{children}</code>;
            return (
              <>
                {lang && <span className="lang">{lang}</span>}
                <code className={className}>{children}</code>
              </>
            );
          },
          table: ({ children }) => (
            <div className="table-wrap"><table>{children}</table></div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
