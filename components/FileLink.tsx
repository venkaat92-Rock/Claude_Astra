"use client";

import { useState } from "react";
import { downloadWorkspaceFile } from "@/lib/client/download";

const KIND: Record<string, string> = { pptx: "PPT", docx: "DOC", xlsx: "XLS", pdf: "PDF", csv: "CSV", md: "MD", txt: "TXT", html: "HTML", json: "JSON", png: "PNG", jpg: "JPG", jpeg: "JPG", mp4: "MP4" };

/** A workspace file the user can download (PowerPoint, Word, Excel, text...). */
export function FileLink({ path, name }: { path: string; name?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [err, setErr] = useState("");
  const label = name ?? path.split("/").pop() ?? path;
  const ext = label.split(".").pop()?.toLowerCase() ?? "";
  return (
    <button
      className={`file-link ${state === "error" ? "err" : ""}`}
      title={err || `Download ${path}`}
      disabled={state === "busy"}
      onClick={async () => {
        setState("busy");
        try {
          await downloadWorkspaceFile(path);
          setState("idle");
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
          setState("error");
        }
      }}
    >
      <span className="k">{KIND[ext] ?? "FILE"}</span>
      <span className="n">{label}</span>
      <span className="dl">{state === "busy" ? "…" : state === "error" ? "retry" : "⬇ download"}</span>
    </button>
  );
}
