/**
 * Color definitions for the top-down CSS/SVG dice (see `PerudoDie.tsx`).
 * Was `dice3d/colorways.ts`'s `meshStandardMaterial`-oriented record before
 * the 2026-08-16 switch away from the WebGL physics dice (see HANDOFF.md) —
 * `roughness`/`metalness` were PBR-only knobs with no CSS analogue and were
 * dropped when this module moved here; `body`/`shadow`/`ink` carried over
 * unchanged since `PerudoDie.tsx` still needs all three (body fill, a
 * darker shade for the chamfer/vignette, and a contrasting pip/mark ink).
 *
 * Two different kinds of colorway live here on purpose:
 *   - "Role" colorways (`IVORY`/`BETTING`) are tied to what a die *means*,
 *     not who owns it: the purple betting marker on the bid track is always
 *     `BETTING_COLORWAY` regardless of whose turn it is.
 *   - "Player" colorways (`PLAYER_COLORWAYS`) are the per-seat/personal
 *     identity layer: every one of a seat's dice — faces 2-6 AND the face-1
 *     페루도 joker mark — renders in that seat's own body/ink colors. An
 *     earlier version force-painted every face-1 die a fixed universal red
 *     regardless of owner; that was changed on user request (2026-08 페루도
 *     UI 개편) so the joker mark reads as an embossed crest on the OWNING
 *     player's own colored die rather than a one-size-fits-all skin — see
 *     `PerudoBoard.tsx`'s `DieFace`.
 */

export interface DiceColorway {
  id: string;
  /** Human label for the swatch picker. */
  label: string;
  /** Main face/body color (hex). */
  body: string;
  /** Darker shade for the chamfer bevel / vignette (hex). */
  shadow: string;
  /** Pip / ladybug-mark ink color — must contrast against `body`. */
  ink: string;
}

export const IVORY_COLORWAY: DiceColorway = {
  id: "ivory",
  label: "아이보리(기본)",
  body: "#f2ede1",
  shadow: "#b9b3a1",
  ink: "#18181b",
};

/** The purple board-piece betting die — unrelated to any one player. */
export const BETTING_COLORWAY: DiceColorway = {
  id: "betting",
  label: "베팅",
  body: "#7c3aed",
  shadow: "#3b0a75",
  ink: "#f5f3ff",
};

/**
 * Six selectable player identities — echoes real Cacho/Perudo boxed sets,
 * which ship as full-color dice+cup pairs per player, and pins the exact
 * seat→color mapping requested for this UI overhaul (2026-08 페루도 UI 전면
 * 개편): seat 1 red, seat 2 blue, seat 3 yellow, seat 4 green, seat 5
 * purple, seat 6 orange. `playerColorwayForSeat` gives every seat a sensible
 * default (cycling mod 6 past 6 players, since this game allows up to
 * `MAX_PLAYERS = 8`); each viewer can additionally override their OWN
 * colorway locally (see `PerudoBoard.tsx`'s swatch picker) — purely a
 * client-local cosmetic preference, never synced, the same trust tier as the
 * existing `muted` toggle.
 */
export const PLAYER_COLORWAYS: DiceColorway[] = [
  { id: "player-red", label: "빨강", body: "#c1272d", shadow: "#5e0f12", ink: "#fdf1f0" },
  { id: "player-blue", label: "파랑", body: "#1d4fbf", shadow: "#0c2660", ink: "#eef3ff" },
  { id: "player-yellow", label: "노랑", body: "#eab308", shadow: "#7a5c05", ink: "#1c1400" },
  { id: "player-green", label: "초록", body: "#1f8a4c", shadow: "#0d4020", ink: "#eafff0" },
  { id: "player-purple", label: "보라", body: "#7e22ce", shadow: "#3b0764", ink: "#f5ecff" },
  { id: "player-orange", label: "주황", body: "#e2711d", shadow: "#7a3805", ink: "#2a1200" },
];

export function playerColorwayForSeat(seat: number): DiceColorway {
  return PLAYER_COLORWAYS[((seat % PLAYER_COLORWAYS.length) + PLAYER_COLORWAYS.length) % PLAYER_COLORWAYS.length];
}
