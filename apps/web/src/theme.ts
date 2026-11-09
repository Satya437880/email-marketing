import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
const KEY = "theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(read);

  useEffect(() => {
    apply(pref);
    if (pref !== "system") return;
    const m = media();
    const onChange = () => apply("system");
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [pref]);

  const set = (p: ThemePref) => {
    try {
      if (p === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
    } catch {
      /* storage blocked: the choice still applies for this session */
    }
    setPref(p);
  };
  return [pref, set];
}
