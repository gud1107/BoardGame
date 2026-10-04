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
 *
 * Same day, two more pieces:
 * - Account sync: a signed-in user's pick is saved to Supabase Auth
 *   `user_metadata.theme_pref` (no table needed). On sign-in the account's
 *   value wins; an account with none yet is seeded from this browser only if
 *   the theme here was actually picked by hand (not an automatic default).
 * - Stats: each browser reports its first theme once and every hand-picked
 *   change (`/api/analytics/theme` → supabase/theme_prefs.sql), shown on
 *   /admin/games' 🌗 테마 tab.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { getDeviceId } from "@/lib/identity/deviceId";
import { getAuthSupabase } from "@/lib/supabase/authClient";

export type Theme = "dark" | "light";
export type ThemePreference = Theme | "system";

const STORAGE_KEY = "bgh_theme";
/** How this browser's theme was first decided: "new" | "returning" (set by THEME_INIT_SCRIPT); absent = picked with the old two-way toggle ("legacy"). */
const ORIGIN_KEY = "bgh_theme_origin";
/** "1" once the user has picked a theme by hand on this browser. */
const CHOSEN_KEY = "bgh_theme_chosen";
/** "1" once this browser's first theme has been sent to the stats endpoint. */
const REPORTED_KEY = "bgh_theme_reported";
/** Set by src/lib/identity/deviceId.ts on any earlier visit — the "returning visitor" signal. */
const DEVICE_ID_KEY = "bg_device_id";
const LIGHT_QUERY = "(prefers-color-scheme: light)";
/** Key inside Supabase Auth user_metadata. */
const META_KEY = "theme_pref";

/** Mobile browser chrome (address bar / status bar) tint per theme — matches
 *  each theme's `--background` in globals.css so the bar doesn't sit as a
 *  dark-navy stripe above the light page (or vice versa). */
export const THEME_COLORS: Record<Theme, string> = { dark: "#0b0b12", light: "#dde2e8" };

interface ThemeContextValue {
  /** What's actually painted right now. */
  theme: Theme;
  /** What the user picked ("system" = follow the OS). */
  preference: ThemePreference;
  /** A hand-picked change: persisted, synced to the signed-in account, counted in stats. */
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isPreference(v: unknown): v is ThemePreference {
  return v === "dark" || v === "light" || v === "system";
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing / storage disabled — theme just won't persist across visits.
  }
}

/** Mirrors THEME_INIT_SCRIPT's choice; that script has normally already
 *  persisted it, so this only falls back when storage is unavailable. */
function readPreference(): ThemePreference {
  const saved = storageGet(STORAGE_KEY);
  if (isPreference(saved)) return saved;
  return storageGet(DEVICE_ID_KEY) ? "dark" : "system";
}

function osScheme(): Theme {
  return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

function resolve(pref: ThemePreference): Theme {
  return pref === "system" ? osScheme() : pref;
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

/** Fire-and-forget stats beacon (see /api/analytics/theme). */
function reportTheme(event: "first" | "change", pref: ThemePreference, theme: Theme) {
  try {
    const body = JSON.stringify({
      event,
      pref,
      theme,
      deviceId: getDeviceId(),
      origin: storageGet(ORIGIN_KEY) ?? "legacy",
      osScheme: osScheme(),
      automated: navigator.webdriver === true,
    });
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/analytics/theme", blob)) return;
    void fetch("/api/analytics/theme", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Best-effort only.
  }
}

/** Saves the pick to the signed-in account, if any. Best-effort. */
async function pushToAccount(pref: ThemePreference) {
  const supabase = getAuthSupabase();
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user || user.user_metadata?.[META_KEY] === pref) return;
    await supabase.auth.updateUser({ data: { [META_KEY]: pref } });
  } catch {
    // Offline / auth disabled — the account just keeps its older value.
  }
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

function currentPreference(): ThemePreference {
  return getSnapshot().split("|")[0] as ThemePreference;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * `source` decides the side effects: "user" = hand-picked (stats + account),
 * "sync" = pulled from the account, "os" = the OS scheme flipped under 🖥️.
 */
function commit(pref: ThemePreference, source: "user" | "sync" | "os") {
  const theme = resolve(pref);
  paint(theme);
  storageSet(STORAGE_KEY, pref);
  snapshot = `${pref}|${theme}`;
  listeners.forEach((l) => l());
  if (source === "user") {
    storageSet(CHOSEN_KEY, "1");
    reportTheme("change", pref, theme);
    void pushToAccount(pref);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [preference, theme] = snap.split("|") as [ThemePreference, Theme];

  // While following the OS, repaint live when the OS scheme flips (e.g. at sunset).
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia(LIGHT_QUERY);
    const onChange = () => commit("system", "os");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  // One-time "what did this browser first get" report for the admin stats.
  useEffect(() => {
    if (storageGet(REPORTED_KEY)) return;
    storageSet(REPORTED_KEY, "1");
    const pref = currentPreference();
    reportTheme("first", pref, resolve(pref));
  }, []);

  // Account sync on sign-in / page load with a session.
  useEffect(() => {
    const supabase = getAuthSupabase();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event !== "INITIAL_SESSION" && event !== "SIGNED_IN") || !session?.user) return;
      const remote: unknown = session.user.user_metadata?.[META_KEY];
      // Deferred: Supabase deadlocks if another auth call runs inside this callback.
      setTimeout(() => {
        if (isPreference(remote)) {
          if (remote !== currentPreference()) commit(remote, "sync");
        } else if (storageGet(CHOSEN_KEY) || !storageGet(ORIGIN_KEY)) {
          // Account has no theme yet: seed it, but only with a hand-picked one
          // (CHOSEN_KEY, or a "legacy" pick from the old two-way toggle).
          void pushToAccount(currentPreference());
        }
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => commit(pref, "user"), []);

  const value = useMemo(() => ({ theme, preference, setPreference }), [theme, preference, setPreference]);
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
      var returning = !!localStorage.getItem("${DEVICE_ID_KEY}");
      p = returning ? "dark" : "system";
      localStorage.setItem("${STORAGE_KEY}", p);
      localStorage.setItem("${ORIGIN_KEY}", returning ? "returning" : "new");
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
