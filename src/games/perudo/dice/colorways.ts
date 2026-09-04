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
 * Ten selectable player identities — echoes real Cacho/Perudo boxed sets,
 * which ship as full-color dice+cup pairs per player, extended for this
 * digital version (2026-08 페루도 UI 전면 개편 원본 6색 + 2026-09-04 색상 팔레트
 * 확장/중복 방지 세션에서 5색 추가). Original 6: red/blue/yellow/green/
 * **purple** /orange. **Purple was removed 2026-09-04** — it's too close to
 * `BETTING_COLORWAY` (the always-on-track purple bid marker, see this
 * session's earlier fix keeping that marker visible on every turn), so a
 * player using purple dice would read as "is that my die or the bid
 * marker?" — dropped from the selectable pool entirely rather than merely
 * disabled, per user request. 5 new additions (mint/pink/lime/charcoal/
 * white) keep every player visually distinct up to `MAX_PLAYERS = 8` with
 * headroom to spare (10 colors ≥ 8 seats). `playerColorwayForSeat` remains
 * the fallback/default-order lookup (cycling mod 10 past 10 players) for
 * anywhere a seat has no explicit chosen colorway yet.
 *
 * Colorway CHOICE itself is no longer purely local — as of the same
 * session, each human's pick is broadcast via Supabase Realtime presence
 * (`Occupant.colorwayId` in `PerudoGame.tsx`) and each bot's pick via the
 * existing `bot-roster` broadcast (`botColorwayIds`, parallel to
 * `botLevels`), so every client renders the SAME color for a given seat —
 * unlike the pre-2026-09-04 "local override, never synced" design this
 * module's own older comments used to describe. `nextAvailableColorwayId`
 * below is the shared picker for "assign me/this new bot whichever color
 * nobody else in the room has yet".
 */
export const PLAYER_COLORWAYS: DiceColorway[] = [
  { id: "player-red", label: "빨강", body: "#c1272d", shadow: "#5e0f12", ink: "#fdf1f0" },
  { id: "player-blue", label: "파랑", body: "#1d4fbf", shadow: "#0c2660", ink: "#eef3ff" },
  { id: "player-yellow", label: "노랑", body: "#eab308", shadow: "#7a5c05", ink: "#1c1400" },
  { id: "player-green", label: "초록", body: "#1f8a4c", shadow: "#0d4020", ink: "#eafff0" },
  { id: "player-orange", label: "주황", body: "#e2711d", shadow: "#7a3805", ink: "#2a1200" },
  { id: "player-mint", label: "민트", body: "#06b6d4", shadow: "#164e63", ink: "#083344" },
  { id: "player-pink", label: "핫핑크", body: "#ec4899", shadow: "#831843", ink: "#500724" },
  { id: "player-lime", label: "라임", body: "#84cc16", shadow: "#365314", ink: "#1a2e05" },
  { id: "player-charcoal", label: "차콜", body: "#1e293b", shadow: "#020617", ink: "#f1f5f9" },
  { id: "player-white", label: "화이트", body: "#f8fafc", shadow: "#94a3b8", ink: "#0f172a" },
];

export function playerColorwayForSeat(seat: number): DiceColorway {
  return PLAYER_COLORWAYS[((seat % PLAYER_COLORWAYS.length) + PLAYER_COLORWAYS.length) % PLAYER_COLORWAYS.length];
}

export function colorwayById(id: string | null | undefined): DiceColorway | undefined {
  return PLAYER_COLORWAYS.find((c) => c.id === id);
}

/**
 * Picks the first colorway (in `PLAYER_COLORWAYS` order) not present in
 * `takenIds` — the shared "assign the next free color" rule used both when
 * a human first joins a room (no stored preference, or their stored one got
 * taken while they were away) and when the host adds a bot
 * (`PerudoGame.tsx`'s `addBotAtSeat`/`fillEmptySeatsWithBots`). Falls back
 * to cycling by `fallbackSeat` (same rule as `playerColorwayForSeat`) if
 * every color is somehow already taken — never actually reachable within
 * `MAX_PLAYERS = 8` against 10 colors, but keeps the function total instead
 * of possibly returning `undefined` for an 8-player room with a weird
 * duplicate-tracking edge case.
 */
export function nextAvailableColorwayId(takenIds: ReadonlySet<string>, fallbackSeat = 0): string {
  const free = PLAYER_COLORWAYS.find((c) => !takenIds.has(c.id));
  return free ? free.id : playerColorwayForSeat(fallbackSeat).id;
}
