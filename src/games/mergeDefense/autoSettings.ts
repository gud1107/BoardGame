import { AUTO_GAMBLE_SAVE, AUTO_PARTS, AUTO_UPGRADE_MIN_GOLD, type AutoPart } from "./engine";

/**
 * 🤖 자동 setup this device remembers (localStorage): what the bot may do,
 * its two conditions, and the player's named presets of all three.
 */
export interface AutoConfig {
  parts: AutoPart[];
  /** Upgrades wait for this much gold (0 = any time). */
  upgradeMinGold: number;
  /** Gems banked before gambling them all (1 = right away). */
  gambleSave: number;
}
export interface AutoPreset extends AutoConfig {
  name: string;
}

export const AUTO_DEFAULT: AutoConfig = { parts: [...AUTO_PARTS], upgradeMinGold: 0, gambleSave: 1 };
export const MAX_AUTO_PRESETS = 6;
export const AUTO_PRESET_NAME_MAX = 10;

const PARTS_KEY = "merge-defense:auto-parts";
const GOLD_KEY = "merge-defense:auto-upgrade-gold";
const GEMS_KEY = "merge-defense:auto-gamble-save";
const PRESETS_KEY = "merge-defense:auto-presets";

function get(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked — just not remembered */
  }
}

/** Coerces anything stored (or pasted) into a valid config. */
export function sanitizeAutoConfig(raw: unknown): AutoConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const parts = Array.isArray(r.parts) ? AUTO_PARTS.filter((p) => (r.parts as unknown[]).includes(p)) : [...AUTO_DEFAULT.parts];
  const gold = Number(r.upgradeMinGold);
  const gems = Number(r.gambleSave);
  return {
    parts,
    upgradeMinGold: AUTO_UPGRADE_MIN_GOLD.includes(gold) ? gold : AUTO_DEFAULT.upgradeMinGold,
    gambleSave: AUTO_GAMBLE_SAVE.includes(gems) ? gems : AUTO_DEFAULT.gambleSave,
  };
}

export function loadAutoConfig(): AutoConfig {
  let parts: unknown;
  try {
    parts = JSON.parse(get(PARTS_KEY) ?? "null");
  } catch {
    parts = null;
  }
  return sanitizeAutoConfig({
    parts: Array.isArray(parts) ? parts : undefined,
    upgradeMinGold: get(GOLD_KEY) ?? undefined,
    gambleSave: get(GEMS_KEY) ?? undefined,
  });
}

export function saveAutoConfig(c: AutoConfig) {
  set(PARTS_KEY, JSON.stringify(c.parts));
  set(GOLD_KEY, String(c.upgradeMinGold));
  set(GEMS_KEY, String(c.gambleSave));
}

export function loadAutoPresets(): AutoPreset[] {
  try {
    const v: unknown = JSON.parse(get(PRESETS_KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string")
      .slice(0, MAX_AUTO_PRESETS)
      .map((p) => ({ ...sanitizeAutoConfig(p), name: String(p.name).trim().slice(0, AUTO_PRESET_NAME_MAX) || "프리셋" }));
  } catch {
    return [];
  }
}

export function saveAutoPresets(list: AutoPreset[]) {
  set(PRESETS_KEY, JSON.stringify(list.slice(0, MAX_AUTO_PRESETS)));
}

export function sameAutoConfig(a: AutoConfig, b: AutoConfig): boolean {
  return a.upgradeMinGold === b.upgradeMinGold && a.gambleSave === b.gambleSave && a.parts.length === b.parts.length && a.parts.every((p) => b.parts.includes(p));
}

// ---------------------------------------------------------------------------
// Share links: `?autopreset=<code>` — compact JSON [v, name, parts bitmask,
// gold floor, gem bank] in UTF-8 base64url (same idea as 낙서 결투's presets).
// ---------------------------------------------------------------------------

export const AUTO_PRESET_PARAM = "autopreset";

function toBase64Url(text: string): string {
  const bin = Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join("");
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(code: string): string {
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((code.length + 3) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

export function encodeAutoPreset(p: AutoPreset): string {
  const mask = AUTO_PARTS.reduce((m, part, i) => (p.parts.includes(part) ? m | (1 << i) : m), 0);
  return toBase64Url(JSON.stringify([1, p.name, mask, p.upgradeMinGold, p.gambleSave]));
}

/** Accepts a bare code or a whole share link; null when it isn't a valid preset. */
export function decodeAutoPreset(input: string): AutoPreset | null {
  try {
    const text = input.trim();
    const code = text.includes(`${AUTO_PRESET_PARAM}=`) ? (new URL(text, "https://x.invalid").searchParams.get(AUTO_PRESET_PARAM) ?? "") : text;
    if (!code || code.length > 200) return null;
    const a = JSON.parse(fromBase64Url(code)) as unknown[];
    if (!Array.isArray(a) || a[0] !== 1 || typeof a[1] !== "string" || typeof a[2] !== "number") return null;
    const mask = a[2];
    const name = a[1].trim().slice(0, AUTO_PRESET_NAME_MAX) || "프리셋";
    return { name, ...sanitizeAutoConfig({ parts: AUTO_PARTS.filter((_, i) => mask & (1 << i)), upgradeMinGold: a[3], gambleSave: a[4] }) };
  } catch {
    return null;
  }
}

export function autoPresetLink(p: AutoPreset): string {
  return `${window.location.origin}${window.location.pathname}?${AUTO_PRESET_PARAM}=${encodeAutoPreset(p)}`;
}

/** Adds (or replaces, by name) a preset, keeping the newest MAX_AUTO_PRESETS. */
export function upsertAutoPreset(list: AutoPreset[], p: AutoPreset): AutoPreset[] {
  return [...list.filter((x) => x.name !== p.name), { ...p, parts: [...p.parts] }].slice(-MAX_AUTO_PRESETS);
}

/** One-line summary of what a preset hands to the bot. */
export function describeAutoConfig(c: AutoConfig): string {
  const label: Record<AutoPart, string> = { build: "소환·도박", merge: "합성", upgrade: "강화", move: "배치", attack: "공격" };
  const parts = c.parts.length === AUTO_PARTS.length ? "전부" : c.parts.length ? c.parts.map((p) => label[p]).join("·") : "없음";
  const conds = [c.gambleSave > 1 ? `💎${c.gambleSave}개 모아 도박` : "", c.upgradeMinGold ? `골드 ${c.upgradeMinGold}+ 강화` : ""].filter(Boolean);
  return conds.length ? `${parts} · ${conds.join(" · ")}` : parts;
}

const START_KEY = "merge-defense:auto-on-start";
/** Whether 자동 switches itself on when a match starts (with the last-used setup). */
export function loadAutoOnStart(): boolean {
  return get(START_KEY) === "1";
}
export function saveAutoOnStart(on: boolean) {
  set(START_KEY, on ? "1" : "0");
}
