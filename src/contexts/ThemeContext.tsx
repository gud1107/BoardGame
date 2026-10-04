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
 *
 * 2026-10-04: three-way preference (dark / light / system), the pattern
 * YouTube/GitHub/Discord/Slack use. "system" follows the OS
 * `prefers-color-scheme` live. Default for a *new* browser is "system"; a
 * browser that already has `bg_device_id` (every pre-existing visitor, set
 * by the analytics tracker) but no saved theme gets "dark" pinned instead,
 * so nobody who's been here before has the page flip under them.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
export type ThemePreference = Theme | "system";

const STORAGE_KEY = "bgh_theme";
/** Set by src/lib/identity/deviceId.ts on any earlier visit — the "returning visitor" signal. */
const DEVICE_ID_KEY = "bg_device_id";
const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** Mobile browser chrome (address bar / status bar) tint per theme — matches
 *  each theme's `--background` in globals.css so the bar doesn't sit as a
 *  dark-navy stripe above the light page (or vice versa). */
export const THEME_COLORS: Record<Theme, string> = { dark: "#0b0b12", light: "#f1f5f9" };

interface ThemeContextValue {
  /** What's actually painted right now. */
  theme: Theme;
  /** What the user picked ("system" = follow the OS). */
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  /** Cycles dark → light → system → dark. */
  cyclePreference: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isPreference(v: string | null): v is ThemePreference {
  return v === "dark" || v === "light" || v === "system";
}

/** Mirrors THEME_INIT_SCRIPT's choice; that script has normally already
 *  persisted it, so this only falls back when storage is unavailable. */
function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isPreference(saved)) return saved;
    return localStorage.getItem(DEVICE_ID_KEY) ? "dark" : "system";
  } catch {
    return "system";
  }
}

function resolve(pref: ThemePreference): Theme {
  if (pref !== "system") return pref;
  return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

function paint(theme: Theme) {
  const root = document.documentElement;
  if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    // No attribute (rather than data-theme="dark") keeps every existing
    // unprefixed utility class exactly as it already renders today.
    root.removeAttribute("data-theme");
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

// Tiny external store so the toggle hydrates against the server snapshot
// (dark default) and then switches to the real value without a mismatch.
const listeners = new Set<() => void>();
let snapshot: string | null = null; // `${preference}|${theme}`

function getSnapshot(): string {
  if (snapshot === null) {
    const pref = readPreference();
    snapshot = `${pref}|${resolve(pref)}`;
  }
  return snapshot;
}
const getServerSnapshot = () => "dark|dark";

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function commit(pref: ThemePreference) {
  const theme = resolve(pref);
  paint(theme);
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Private browsing / storage disabled — theme just won't persist across visits.
  }
  snapshot = `${pref}|${theme}`;
  listeners.forEach((l) => l());
}

const CYCLE: Record<ThemePreference, ThemePreference> = { dark: "light", light: "system", system: "dark" };

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [preference, theme] = snap.split("|") as [ThemePreference, Theme];

  // While following the OS, repaint live when the OS scheme flips (e.g. at sunset).
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia(LIGHT_QUERY);
    const onChange = () => commit("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((pref: ThemePreference) => commit(pref), []);
  const cyclePreference = useCallback(() => commit(CYCLE[getSnapshot().split("|")[0] as ThemePreference]), []);

  const value = useMemo(
    () => ({ theme, preference, setPreference, cyclePreference }),
    [theme, preference, setPreference, cyclePreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

/** Source for the inline no-flash script injected in layout.tsx's <head>. */
export const THEME_INIT_SCRIPT = `
(function () {
  var light = false;
  try {
    var p = localStorage.getItem("${STORAGE_KEY}");
    if (p !== "dark" && p !== "light" && p !== "system") {
      p = localStorage.getItem("${DEVICE_ID_KEY}") ? "dark" : "system";
      localStorage.setItem("${STORAGE_KEY}", p);
    }
    light = p === "light" || (p === "system" && window.matchMedia("${LIGHT_QUERY}").matches);
  } catch (e) {}
  if (light) document.documentElement.setAttribute("data-theme", "light");
  var m = document.createElement("meta");
  m.name = "theme-color";
  m.content = light ? "${THEME_COLORS.light}" : "${THEME_COLORS.dark}";
  document.head.appendChild(m);
})();
`;
