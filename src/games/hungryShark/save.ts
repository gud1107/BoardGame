/**
 * Local save (spec §8 stage 5: "JSON 기반 로컬 암호화 저장소"). Browser-only,
 * so the "encryption" is a light obfuscation + checksum that stops casual
 * devtools edits of the coin balance — not real security (there's no server
 * to trust anyway). Corrupt/tampered saves fall back to a fresh profile.
 */

import { evolutionPath, SHARKS, type MapId, type UpgradeLevels } from "./data";

/** Shark picker sort keys ("tree" = the evolution-tree layout). */
export const PICKER_SORTS = ["tree", "cost", "tier", "health", "speed", "gold", "boostEff", "best"] as const;
export type PickerSort = (typeof PICKER_SORTS)[number];

/** Shark picker sort/filter choices, remembered across visits. */
export interface PickerPrefs {
  sort: PickerSort;
  dir: "desc" | "asc";
  hideOwned: boolean;
  /** Only sharks that can be unlocked right now (parent owned + enough coins). */
  buyableOnly: boolean;
}

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
  /** Last chosen dive map (older saves lack it → 딥 블루 오션). */
  mapId: MapId;
  /** Shark picker sort/filter (older saves lack it → tree, no filters). */
  picker: PickerPrefs;
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
    mapId: "deepBlue",
    picker: { sort: "tree", dir: "desc", hideOwned: false, buyableOnly: false },
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
    return migrateSave({ ...freshSave(), ...parsed });
  } catch {
    return freshSave();
  }
}

/** Old linear-ladder shark that no longer exists in the evolution tree. */
const RETIRED: Record<string, { to: string; refund: number }> = {
  // 뱀상어 (old T4, 9,000🪙) → 샌드타이거 (T2 BRUTE, 1,200🪙) + the difference back.
  tiger: { to: "sandTiger", refund: 9000 - 1200 },
};

/**
 * Linear 6-shark ladder → 3-branch evolution tree. Retired ids are swapped
 * (with a coin refund), and every owned shark's ancestors become owned too so
 * the tree's "parent first" rule never strands an existing purchase.
 * Idempotent: a migrated save has no retired ids left.
 */
export function migrateSave(save: SharkSave): SharkSave {
  const known = new Set(SHARKS.map((s) => s.id));
  let coins = save.coins;
  const upgrades = { ...save.upgrades };
  const best = { ...save.best };
  const owned = new Set<string>();
  for (const id of save.owned) {
    const r = RETIRED[id];
    if (r) {
      coins += r.refund;
      owned.add(r.to);
      if (upgrades[id] && !upgrades[r.to]) upgrades[r.to] = upgrades[id];
      if (best[id]) best[r.to] = Math.max(best[r.to] ?? 0, best[id]);
      delete upgrades[id];
      delete best[id];
    } else if (known.has(id)) owned.add(id);
  }
  for (const id of [...owned]) for (const anc of evolutionPath(id)) owned.add(anc.id);
  owned.add(SHARKS[0].id);
  let selected = RETIRED[save.selected]?.to ?? save.selected;
  if (!owned.has(selected)) selected = SHARKS[0].id;
  const p = { ...freshSave().picker, ...save.picker };
  const picker: PickerPrefs = {
    sort: (PICKER_SORTS as readonly string[]).includes(p.sort) ? p.sort : "tree",
    dir: p.dir === "asc" ? "asc" : "desc",
    hideOwned: !!p.hideOwned,
    buyableOnly: !!p.buyableOnly,
  };
  return { ...save, coins, owned: SHARKS.map((s) => s.id).filter((id) => owned.has(id)), selected, upgrades, best, picker };
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
