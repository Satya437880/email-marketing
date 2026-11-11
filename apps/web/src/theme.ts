import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark";
const KEY = "theme";

// Light is the default; a saved "system" value from an earlier version is treated as light.
function read(): ThemePref {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function apply(pref: ThemePref) {
  document.documentElement.classList.toggle("dark", pref === "dark");
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(read);

  useEffect(() => apply(pref), [pref]);

  const set = (p: ThemePref) => {
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* storage blocked: the choice still applies for this session */
    }
    setPref(p);
  };
  return [pref, set];
}
