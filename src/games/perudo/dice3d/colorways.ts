/**
 * Color/material definitions for the 3D dice (see `DiceMesh.tsx`). This is
 * the WebGL-side analogue of the old `CubeColorway` Tailwind-class records in
 * `PerudoBoard.tsx` — same idea (one shared record type, a handful of named
 * presets), but as real hex colors + PBR roughness/metalness because
 * `meshStandardMaterial` can't consume Tailwind gradient classes.
 *
 * Two different kinds of colorway live here on purpose:
 *   - "Role" colorways (`IVORY`/`PERUDO_MARK`/`BETTING`/`CUP_WOOD`) are tied
 *     to what a die *means*, not who owns it, and are unconditional: a die
 *     showing face 1 is ALWAYS the red 페루도 skull die, on every seat's
 *     dice, exactly like the CSS version before it (Phase 21) — this was a
 *     deliberate legibility choice (spot the joker at a glance across the
 *     whole table) and this session's player-color feature deliberately does
 *     NOT touch it, to avoid regressing an already screenshot-verified UX.
 *   - "Player" colorways (`PLAYER_COLORWAYS`) are the new per-seat/personal
 *     identity layer this session adds: they only ever tint a die's 2-6
 *     faces and the dice-cup shell, never the face-1 skull die or the
 *     purple betting marker.
 */

export interface DiceColorway {
  id: string;
  /** Human label for the swatch picker. */
  label: string;
  /** Main face/body color (hex). */
  body: string;
  /** Darker shade for ambient-occlusion-ish crevices / cup shadow gradient. */
  shadow: string;
  /** Pip / skull ink color — must contrast against `body`. */
  ink: string;
  /** `meshStandardMaterial` roughness (0 = mirror, 1 = chalk). */
  roughness: number;
  /** `meshStandardMaterial` metalness (0 = plastic/wood, 1 = metal). */
  metalness: number;
}

export const IVORY_COLORWAY: DiceColorway = {
  id: "ivory",
  label: "아이보리(기본)",
  body: "#f2ede1",
  shadow: "#b9b3a1",
  ink: "#18181b",
  roughness: 0.35,
  metalness: 0.04,
};

/** The universal red/white 페루도 (face value 1) skull die — see file header. */
export const PERUDO_MARK_COLORWAY: DiceColorway = {
  id: "perudo-mark",
  label: "페루도",
  body: "#b3182c",
  shadow: "#5c0d16",
  ink: "#fdf2f2",
  roughness: 0.3,
  metalness: 0.05,
};

/** The purple board-piece betting die — unrelated to any one player. */
export const BETTING_COLORWAY: DiceColorway = {
  id: "betting",
  label: "베팅",
  body: "#7c3aed",
  shadow: "#3b0a75",
  ink: "#f5f3ff",
  roughness: 0.25,
  metalness: 0.08,
};

/** Hidden opponent dice / the cup's own default wood shell before a player color is layered on. */
export const CUP_WOOD_COLORWAY: DiceColorway = {
  id: "cup-wood",
  label: "원목",
  body: "#7a4a22",
  shadow: "#3a2410",
  ink: "#e7c98f",
  roughness: 0.75,
  metalness: 0,
};

/**
 * Six selectable player identities — echoes real Cacho/Perudo boxed sets,
 * which ship as full-color dice+cup pairs per player. `playerColorwayForSeat`
 * gives every seat a sensible default (cycling mod 6 past 6 players, since
 * this game allows up to `MAX_PLAYERS = 8`); each viewer can additionally
 * override their OWN colorway locally (see `PerudoBoard.tsx`'s swatch
 * picker) — purely a client-local cosmetic preference, never synced, the
 * same trust tier as the existing `muted` toggle.
 */
export const PLAYER_COLORWAYS: DiceColorway[] = [
  { id: "player-crimson", label: "다홍", body: "#c1432c", shadow: "#5e1c11", ink: "#fdf4ee", roughness: 0.4, metalness: 0.05 },
  { id: "player-cobalt", label: "코발트", body: "#2b5fc1", shadow: "#12275c", ink: "#f0f5ff", roughness: 0.4, metalness: 0.05 },
  { id: "player-emerald", label: "에메랄드", body: "#1f8a58", shadow: "#0d3f28", ink: "#eefff5", roughness: 0.4, metalness: 0.05 },
  { id: "player-amber", label: "호박", body: "#d69a1f", shadow: "#6b4a0c", ink: "#241601", roughness: 0.4, metalness: 0.05 },
  { id: "player-slate", label: "먹색", body: "#3a3d44", shadow: "#131417", ink: "#f5f6f8", roughness: 0.45, metalness: 0.1 },
  { id: "player-ivory", label: "설백", body: "#e9e4d8", shadow: "#a39c88", ink: "#161513", roughness: 0.35, metalness: 0.02 },
];

export function playerColorwayForSeat(seat: number): DiceColorway {
  return PLAYER_COLORWAYS[((seat % PLAYER_COLORWAYS.length) + PLAYER_COLORWAYS.length) % PLAYER_COLORWAYS.length];
}
