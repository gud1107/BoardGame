"use client";

/**
 * 2026-09-13 실시간 블랙/화이트 테마 토글 세션.
 *
 * Global dark/light theme state for the whole hub (로비 + 전 인게임) —
 * persisted to localStorage and applied as `data-theme` on <html> with zero
 * hard reload. The actual visual switch is pure CSS: every game/component
 * opts in by adding `light:` utility overrides on top of its existing
 * (unprefixed, dark) classes — see the `@custom-variant light` rule in
 * globals.css for why this project uses a custom `light:` variant instead of
 * Tailwind's standard `dark:` one.
 *
 * No-flash-of-wrong-theme: an inline blocking script in layout.tsx's <head>
 * reads localStorage and stamps `data-theme` on <html> before hydration, so
 * this provider's initial React state just mirrors whatever the DOM already
 * has rather than defaulting to "dark" and flashing on light-mode revisits.
 */

import { createContext, useCallback, useContext, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "bgh_theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): Theme {
  if (typeof document === "undefined") return "dark"; // SSR — matches the attribute-less default look.
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    // No attribute (rather than data-theme="dark") keeps every existing
    // unprefixed utility class exactly as it already renders today.
    root.removeAttribute("data-theme");
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing / storage disabled — theme just won't persist across visits.
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazy-initialized from the DOM attribute the blocking head script already
  // set, so this never disagrees with what was actually painted first — no
  // extra mount effect re-reading it afterward (that would just be a
  // same-tick setState-in-effect with nothing new to reconcile).
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

/** Source for the inline no-flash script injected in layout.tsx's <head>. */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem("${STORAGE_KEY}");
    if (t === "light") document.documentElement.setAttribute("data-theme", "light");
  } catch (e) {}
})();
`;
