"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "claude-astra:theme";

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "light") return v;
  } catch { /* ignore */ }
  return "light";
}

/** Light by default; persisted per browser. app/layout.tsx applies it before first paint. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => setTheme(readTheme()), []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), []);
  return [theme, toggle];
}

/** Small boolean preference (sidebar/panel collapsed, section folded). */
export function usePref(key: string, initial: boolean): [boolean, (v: boolean | ((p: boolean) => boolean)) => void] {
  const [v, setV] = useState(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`claude-astra:pref:${key}`);
      if (raw !== null) setV(raw === "1");
    } catch { /* ignore */ }
  }, [key]);
  const set = useCallback((next: boolean | ((p: boolean) => boolean)) => {
    setV((p) => {
      const n = typeof next === "function" ? next(p) : next;
      try { localStorage.setItem(`claude-astra:pref:${key}`, n ? "1" : "0"); } catch { /* ignore */ }
      return n;
    });
  }, [key]);
  return [v, set];
}

/** True when the viewport matches the CSS query (false during SSR). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}
