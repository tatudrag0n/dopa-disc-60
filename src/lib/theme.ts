import { useCallback, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const KEY = "dopa_theme";

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* noop */
    }
  } else {
    root.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* noop */
    }
  }
}

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* noop */
  }
  return "system";
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => read());

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      if (prev === "system") {
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        return dark ? "light" : "dark";
      }
      return prev === "dark" ? "light" : "dark";
    });
  }, []);

  return { theme, toggle };
}
