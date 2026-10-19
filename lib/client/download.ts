"use client";

import { useEffect, useState } from "react";

/** Fresh presigned URL for a workspace file (links stored in chats would otherwise expire). */
export async function workspaceUrl(path: string, download = false): Promise<string> {
  const r = await fetch(`/api/workspace?path=${encodeURIComponent(path)}&url=1${download ? "&download=1" : ""}`);
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!r.ok || !j.url) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j.url;
}

/** Save a workspace file to the user's device. */
export async function downloadWorkspaceFile(path: string): Promise<void> {
  const url = await workspaceUrl(path, true);
  const a = document.createElement("a");
  a.href = url;
  a.download = path.split("/").pop() ?? "file";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Presigned URL for showing a workspace image inline. */
export function useWorkspaceUrl(path: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!path) return;
    let live = true;
    workspaceUrl(path).then((u) => live && setUrl(u)).catch(() => undefined);
    return () => { live = false; };
  }, [path]);
  return url;
}
