/**
 * 여관 난투 3D 캐릭터 스펙 표 — 유닛마다 몸 형태·색·장비. three.js에 의존하지 않아서
 * 2D 화면(attackStyle.ts)도 가볍게 쓸 수 있다. 실제 조립은 three/figures.tsx.
 */

/* ── 스펙 ─────────────────────────────────────────────────── */

export type Weapon = "sword" | "bigsword" | "shield" | "swordShield" | "bow" | "staff" | "dagger" | "wrench" | "hammer" | "shovel" | "flask" | "mace" | "none";
export type Head = "helm" | "plume" | "hood" | "crown" | "wizard" | "hair" | "skull" | "visor" | "horns" | "bare";

export type FigureSpec =
  | { kind: "human"; skin: string; body: string; accent: string; head: Head; weapon: Weapon; cape?: string; robe?: boolean; mount?: string; size?: number; glowEyes?: string; wings?: string }
  | { kind: "beast"; fur: string; belly: string; ears: "pointy" | "long" | "round"; tail: "bushy" | "short" | "none"; tusks?: boolean; trunk?: boolean; shell?: string; size: number; long?: boolean; antlers?: boolean; horn?: boolean }
  | { kind: "robot"; metal: string; accent: string; eye: string; form: "mouse" | "bot" | "golem" | "tank" | "smith" | "titan"; size?: number }
  | { kind: "elemental"; color: string; core: string; form: "flame" | "drop" | "tornado" | "lava" | "storm" | "star"; size?: number }
  | { kind: "wraith"; cloak: string; eye: string; size?: number }
  | { kind: "dragon"; skin: string; belly: string; wing: string; size: number; form: "whelp" | "lizard" | "wyrm" | "bat" | "drake" | "elder" }
  | { kind: "bird"; color: string; beak: string }
  | { kind: "critter"; form: "crab" | "fish" | "octopus" | "eel" | "shark" | "sprout" | "mushroom" | "tree" | "butterfly" | "moon"; color: string; accent: string; size?: number };

const H = (o: Partial<Extract<FigureSpec, { kind: "human" }>> & { head: Head; weapon: Weapon }): FigureSpec => ({ kind: "human", skin: "#f1c27d", body: "#64748b", accent: "#facc15", ...o });

export const FIGURES: Record<string, FigureSpec> = {
  // 기사단
  k_squire: H({ body: "#78716c", accent: "#a8a29e", head: "helm", weapon: "shield", size: 0.85 }),
  k_guardian: H({ body: "#e2e8f0", accent: "#facc15", head: "helm", weapon: "swordShield" }),
  k_rider: H({ body: "#cbd5e1", accent: "#60a5fa", head: "plume", weapon: "sword", mount: "#f8fafc", size: 0.8 }),
  k_paladin: H({ body: "#fbbf24", accent: "#fef3c7", head: "helm", weapon: "hammer", cape: "#1d4ed8", size: 1.05 }),
  k_oath: H({ body: "#3b82f6", accent: "#e0f2fe", head: "plume", weapon: "swordShield", cape: "#e0f2fe", size: 1.1 }),
  k_lord: H({ body: "#f8fafc", accent: "#facc15", head: "crown", weapon: "bigsword", cape: "#b91c1c", size: 1.2 }),
  // 야수
  b_rabbit: { kind: "beast", fur: "#d6d3d1", belly: "#fafaf9", ears: "long", tail: "short", size: 0.55 },
  b_dog: { kind: "beast", fur: "#b45309", belly: "#fde68a", ears: "pointy", tail: "short", size: 0.7 },
  b_wolfmom: { kind: "beast", fur: "#6b7280", belly: "#e5e7eb", ears: "pointy", tail: "bushy", size: 0.85 },
  b_hunter: H({ body: "#166534", accent: "#a3e635", head: "hood", weapon: "bow" }),
  b_bear: { kind: "beast", fur: "#78350f", belly: "#d6a46b", ears: "round", tail: "short", size: 1.05 },
  b_turtle: { kind: "beast", fur: "#65a30d", belly: "#d9f99d", ears: "round", tail: "short", shell: "#3f6212", size: 1.05, long: true },
  b_mammoth: { kind: "beast", fur: "#7c2d12", belly: "#a16207", ears: "round", tail: "short", tusks: true, trunk: true, size: 1.3 },
  // 기계
  m_mouse: { kind: "robot", metal: "#94a3b8", accent: "#f59e0b", eye: "#ef4444", form: "mouse", size: 0.7 },
  m_repair: { kind: "robot", metal: "#cbd5e1", accent: "#f97316", eye: "#38bdf8", form: "bot" },
  m_golem: { kind: "robot", metal: "#92400e", accent: "#57534e", eye: "#fbbf24", form: "golem" },
  m_tank: { kind: "robot", metal: "#475569", accent: "#b45309", eye: "#fb923c", form: "tank" },
  m_smith: { kind: "robot", metal: "#a16207", accent: "#78716c", eye: "#f87171", form: "smith", size: 1.05 },
  m_titan: { kind: "robot", metal: "#e5e7eb", accent: "#6366f1", eye: "#22d3ee", form: "titan", size: 1.2 },
  // 원소
  e_ember: { kind: "elemental", color: "#f97316", core: "#fde047", form: "flame", size: 0.7 },
  e_droplet: { kind: "elemental", color: "#38bdf8", core: "#e0f2fe", form: "drop", size: 0.85 },
  e_wind: { kind: "elemental", color: "#a5f3fc", core: "#ecfeff", form: "tornado" },
  e_lava: { kind: "elemental", color: "#44403c", core: "#f97316", form: "lava", size: 1.1 },
  e_storm: { kind: "elemental", color: "#64748b", core: "#fde047", form: "storm", size: 1.1 },
  e_origin: { kind: "elemental", color: "#fef08a", core: "#ffffff", form: "star", size: 1.15 },
  // 망령
  u_skeleton: H({ skin: "#f5f5f4", body: "#e7e5e4", accent: "#a8a29e", head: "skull", weapon: "sword", size: 0.85 }),
  u_crow: { kind: "bird", color: "#1f2937", beak: "#fbbf24" },
  u_keeper: H({ skin: "#d6d3d1", body: "#3f3f46", accent: "#71717a", head: "hood", weapon: "shovel" }),
  u_wraith: { kind: "wraith", cloak: "#14532d", eye: "#4ade80" },
  u_lich: H({ skin: "#a5b4fc", body: "#4c1d95", accent: "#c4b5fd", head: "crown", weapon: "staff", robe: true, glowEyes: "#a78bfa", size: 1.1 }),
  u_dk: H({ skin: "#334155", body: "#1e293b", accent: "#7f1d1d", head: "visor", weapon: "bigsword", cape: "#450a0a", glowEyes: "#ef4444", size: 1.2 }),
  // 용족
  d_whelp: { kind: "dragon", skin: "#22c55e", belly: "#bbf7d0", wing: "#15803d", size: 0.6, form: "whelp" },
  d_flame: { kind: "dragon", skin: "#ea580c", belly: "#fed7aa", wing: "#9a3412", size: 0.75, form: "lizard" },
  d_guard: { kind: "dragon", skin: "#0e7490", belly: "#a5f3fc", wing: "#155e75", size: 1.0, form: "wyrm" },
  d_dusk: { kind: "dragon", skin: "#581c87", belly: "#d8b4fe", wing: "#3b0764", size: 1.0, form: "bat" },
  d_drake: { kind: "dragon", skin: "#b91c1c", belly: "#fecaca", wing: "#7f1d1d", size: 1.1, form: "drake" },
  d_elder: { kind: "dragon", skin: "#a16207", belly: "#fef3c7", wing: "#713f12", size: 1.3, form: "elder" },
  // 중립
  n_kid: H({ body: "#ef4444", accent: "#fde68a", head: "hair", weapon: "none", size: 0.7 }),
  n_rogue: H({ body: "#1f2937", accent: "#4ade80", head: "hood", weapon: "dagger" }),
  n_merc: H({ body: "#92400e", accent: "#d6d3d1", head: "helm", weapon: "swordShield", size: 1.05 }),
  n_priest: H({ body: "#f8fafc", accent: "#fbbf24", head: "hood", weapon: "staff", robe: true }),
  n_general: H({ body: "#991b1b", accent: "#facc15", head: "plume", weapon: "sword", cape: "#facc15", size: 1.1 }),
  n_alch: H({ body: "#7e22ce", accent: "#fbbf24", head: "wizard", weapon: "flask", robe: true, size: 1.05 }),
  // 해양
  s_crab: { kind: "critter", form: "crab", color: "#dc2626", accent: "#fca5a5", size: 0.85 },
  s_fish: { kind: "critter", form: "fish", color: "#f97316", accent: "#fde68a", size: 0.8 },
  s_eel: { kind: "critter", form: "eel", color: "#65a30d", accent: "#fde047" },
  s_pirate: H({ body: "#1e3a8a", accent: "#facc15", head: "hair", weapon: "sword", cape: "#111827" }),
  s_octo: { kind: "critter", form: "octopus", color: "#9333ea", accent: "#e9d5ff" },
  s_shark: { kind: "critter", form: "shark", color: "#64748b", accent: "#e2e8f0", size: 1.05 },
  s_siren: H({ skin: "#99f6e4", body: "#0f766e", accent: "#67e8f9", head: "hair", weapon: "staff", robe: true, size: 1.05 }),
  s_kraken: { kind: "critter", form: "octopus", color: "#7f1d1d", accent: "#fca5a5", size: 1.35 },
  // 악마
  dm_imp: H({ skin: "#dc2626", body: "#7f1d1d", accent: "#1c1917", head: "horns", weapon: "dagger", size: 0.7, glowEyes: "#fde047" }),
  dm_boar: { kind: "beast", fur: "#7f1d1d", belly: "#fb923c", ears: "pointy", tail: "short", tusks: true, size: 0.85 },
  dm_warlock: H({ skin: "#d8b4fe", body: "#3b0764", accent: "#a21caf", head: "hood", weapon: "staff", robe: true, glowEyes: "#ef4444" }),
  dm_shade: { kind: "wraith", cloak: "#3b0764", eye: "#f472b6" },
  dm_brute: H({ skin: "#b91c1c", body: "#450a0a", accent: "#fef3c7", head: "horns", weapon: "hammer", size: 1.15, glowEyes: "#fde047" }),
  dm_general: H({ skin: "#7f1d1d", body: "#1c1917", accent: "#f97316", head: "horns", weapon: "bigsword", cape: "#7f1d1d", size: 1.15, glowEyes: "#f97316" }),
  dm_archfiend: H({ skin: "#44403c", body: "#292524", accent: "#e7e5e4", head: "horns", weapon: "bigsword", cape: "#450a0a", size: 1.32, glowEyes: "#ef4444" }),
  // 숲
  sy_sprout: { kind: "critter", form: "sprout", color: "#16a34a", accent: "#4ade80", size: 0.8 },
  sy_mush: { kind: "critter", form: "mushroom", color: "#dc2626", accent: "#fafafa" },
  sy_fox: { kind: "beast", fur: "#ea580c", belly: "#fff7ed", ears: "pointy", tail: "bushy", size: 0.7 },
  sy_elf: H({ skin: "#fde7c7", body: "#15803d", accent: "#bbf7d0", head: "hood", weapon: "bow" }),
  sy_treant: { kind: "critter", form: "tree", color: "#15803d", accent: "#22c55e", size: 1.1 },
  sy_druid: { kind: "beast", fur: "#a16207", belly: "#fef3c7", ears: "pointy", tail: "short", antlers: true, size: 1.05 },
  sy_worldtree: { kind: "critter", form: "tree", color: "#4d7c0f", accent: "#a3e635", size: 1.4 },
  // 요정
  f_butterfly: { kind: "critter", form: "butterfly", color: "#f472b6", accent: "#fbcfe8", size: 0.8 },
  f_trickster: H({ skin: "#fbcfe8", body: "#7e22ce", accent: "#facc15", head: "wizard", weapon: "dagger", size: 0.75, wings: "#e9d5ff" }),
  f_moon: { kind: "critter", form: "moon", color: "#c7d2fe", accent: "#e0e7ff" },
  f_unicorn: { kind: "beast", fur: "#f8fafc", belly: "#fbcfe8", ears: "pointy", tail: "bushy", horn: true, size: 0.95 },
  f_nymph: H({ skin: "#fbcfe8", body: "#16a34a", accent: "#f9a8d4", head: "hair", weapon: "bow", wings: "#bbf7d0" }),
  f_queen: H({ skin: "#fde7f3", body: "#f9a8d4", accent: "#fef08a", head: "crown", weapon: "staff", robe: true, wings: "#f5d0fe", size: 1.1 }),
  f_oberon: H({ skin: "#e0e7ff", body: "#4338ca", accent: "#fde047", head: "crown", weapon: "staff", robe: true, wings: "#a5f3fc", size: 1.2 }),
  // 중립 추가
  n_bandit: H({ body: "#78350f", accent: "#dc2626", head: "hair", weapon: "dagger" }),
  n_ninja: H({ skin: "#e5e7eb", body: "#111827", accent: "#ef4444", head: "hood", weapon: "dagger" }),
  n_sniper: H({ body: "#3f6212", accent: "#d9f99d", head: "plume", weapon: "bow", cape: "#365314" }),
  // 토큰 추가
  t_imp: H({ skin: "#ef4444", body: "#991b1b", accent: "#1c1917", head: "horns", weapon: "none", size: 0.55, glowEyes: "#fde047" }),
  t_sapling: { kind: "critter", form: "sprout", color: "#15803d", accent: "#86efac", size: 1 },
  t_fairy: { kind: "critter", form: "butterfly", color: "#c084fc", accent: "#f5d0fe", size: 0.65 },
  t_spirit: { kind: "elemental", color: "#93c5fd", core: "#eff6ff", form: "star", size: 0.6 },
  // 토큰
  t_bunny: { kind: "beast", fur: "#fafaf9", belly: "#fecdd3", ears: "long", tail: "short", size: 0.45 },
  t_wolf: { kind: "beast", fur: "#9ca3af", belly: "#f3f4f6", ears: "pointy", tail: "bushy", size: 0.6 },
  t_cub: { kind: "beast", fur: "#92400e", belly: "#e7c39b", ears: "round", tail: "short", size: 0.7 },
  t_calf: { kind: "beast", fur: "#9a3412", belly: "#ca8a04", ears: "round", tail: "short", tusks: true, trunk: true, size: 0.85 },
  t_scrap: { kind: "robot", metal: "#78716c", accent: "#a8a29e", eye: "#fbbf24", form: "bot", size: 0.7 },
  t_skel: H({ skin: "#f5f5f4", body: "#e7e5e4", accent: "#a8a29e", head: "skull", weapon: "dagger", size: 0.65 }),
};

/** 플레이어 아바타(롤토체스 꼬마 전설이 같은 대표 캐릭터) — 고른 영웅의 모습 */
export const HERO_FIGURES: Record<string, FigureSpec> = {
  mage: H({ skin: "#f8d7b0", body: "#1d4ed8", accent: "#93c5fd", head: "wizard", weapon: "staff", robe: true, size: 1.1 }),
  mercenary: H({ body: "#78350f", accent: "#dc2626", head: "hair", weapon: "bigsword", cape: "#991b1b", size: 1.1 }),
  castellan: H({ body: "#94a3b8", accent: "#1d4ed8", head: "helm", weapon: "swordShield", cape: "#1e40af", size: 1.12 }),
  merchant: H({ skin: "#f1c27d", body: "#ca8a04", accent: "#fef08a", head: "crown", weapon: "flask", robe: true, size: 1.15 }),
  tamer: H({ skin: "#fde7c7", body: "#166534", accent: "#fb923c", head: "hood", weapon: "staff", cape: "#14532d", size: 1.08 }),
  prophet: H({ skin: "#e9d5ff", body: "#6b21a8", accent: "#f0abfc", head: "hood", weapon: "staff", robe: true, glowEyes: "#e879f9", size: 1.1 }),
  necro: H({ skin: "#e7e5e4", body: "#1c1917", accent: "#4ade80", head: "skull", weapon: "staff", robe: true, glowEyes: "#4ade80", size: 1.1 }),
  architect: H({ body: "#ea580c", accent: "#facc15", head: "helm", weapon: "hammer", size: 1.08 }),
};
