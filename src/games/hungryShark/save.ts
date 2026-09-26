/**
 * Local save (spec §8 stage 5: "JSON 기반 로컬 암호화 저장소"). Browser-only,
 * so the "encryption" is a light obfuscation + checksum that stops casual
 * devtools edits of the coin balance — not real security (there's no server
 * to trust anyway). Corrupt/tampered saves fall back to a fresh profile.
 */

import { SHARKS, type UpgradeLevels } from "./data";

export interface SharkSave {
  version: 1;
  coins: number;
  owned: string[];
  selected: string;
  upgrades: Record<string, UpgradeLevels>;
  best: Record<string, number>;
  totalRuns: number;
  totalEaten: number;
  muted: boolean;
  /** Target Feed Indicator on/off (older saves lack it → default on). */
  markers: boolean;
}

const KEY = "hungry-shark-save-v1";
const SALT = "deep-blue-43";

export function freshSave(): SharkSave {
  return {
    version: 1,
    coins: 0,
    owned: [SHARKS[0].id],
    selected: SHARKS[0].id,
    upgrades: {},
    best: {},
    totalRuns: 0,
    totalEaten: 0,
    muted: false,
    markers: true,
  };
}

function checksum(s: string): string {
  let h = 2166136261;
  const str = s + SALT;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function encodeSave(save: SharkSave): string {
  const json = JSON.stringify(save);
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json).toString("base64");
  return `${checksum(json)}.${b64.split("").reverse().join("")}`;
}

export function decodeSave(raw: string | null): SharkSave {
  if (!raw) return freshSave();
  try {
    const dot = raw.indexOf(".");
    const sum = raw.slice(0, dot);
    const b64 = raw.slice(dot + 1).split("").reverse().join("");
    const json = typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString();
    if (checksum(json) !== sum) return freshSave();
    const parsed = JSON.parse(json) as SharkSave;
    if (parsed.version !== 1) return freshSave();
    return { ...freshSave(), ...parsed };
  } catch {
    return freshSave();
  }
}

export function loadSave(): SharkSave {
  try {
    return decodeSave(localStorage.getItem(KEY));
  } catch {
    return freshSave();
  }
}

export function writeSave(save: SharkSave) {
  try {
    localStorage.setItem(KEY, encodeSave(save));
  } catch {
    /* private mode / storage full — progress just won't persist */
  }
}

export function upgradesFor(save: SharkSave, sharkId: string): UpgradeLevels {
  return save.upgrades[sharkId] ?? { bite: 0, speed: 0, boost: 0 };
}
