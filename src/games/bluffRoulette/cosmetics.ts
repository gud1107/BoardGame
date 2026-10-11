/**
 * Cosmetic, non-gameplay data for 블러프 룰렛 (rulebook §R/§T): the avatar a
 * player picks in the lobby and the emotes they can send mid-game. Both ride
 * the room channel outside the lockstep engine (presence / a broadcast), so
 * anything arriving from the network is passed through the `sanitize*`
 * helpers below before it can reach the 3D scene.
 */

export type HatKind = "fedora" | "bowler" | "top" | "beret";
export type Accessory = "none" | "mustache" | "monocle" | "scarf" | "earring";

export interface Avatar {
  hat: HatKind;
  coat: string;
  accessory: Accessory;
  skin: string;
}

export const HATS: { id: HatKind; label: string; icon: string }[] = [
  { id: "fedora", label: "중절모", icon: "🕵" },
  { id: "bowler", label: "보울러", icon: "🎩" },
  { id: "top", label: "실크햇", icon: "🎓" },
  { id: "beret", label: "베레", icon: "🎨" },
];

export const COATS: { id: string; label: string }[] = [
  { id: "#5b2a14", label: "브라운" },
  { id: "#1f2f5c", label: "네이비" },
  { id: "#1f4d33", label: "포레스트" },
  { id: "#4a2160", label: "플럼" },
  { id: "#6b1d2c", label: "버건디" },
  { id: "#24424d", label: "틸" },
  { id: "#2a2a2e", label: "차콜" },
  { id: "#8a6d3b", label: "카멜" },
];

export const ACCESSORIES: { id: Accessory; label: string }[] = [
  { id: "none", label: "없음" },
  { id: "mustache", label: "콧수염" },
  { id: "monocle", label: "외알안경" },
  { id: "scarf", label: "스카프" },
  { id: "earring", label: "귀걸이" },
];

export const SKINS: string[] = ["#f5d6bd", "#f0c8a4", "#e3b58f", "#c48c68", "#8f5d3e"];

/** Default look per seat when a player hasn't picked one (and for every bot). */
export const SEAT_AVATARS: Avatar[] = [
  { hat: "fedora", coat: "#5b2a14", accessory: "mustache", skin: "#f0c8a4" },
  { hat: "bowler", coat: "#1f2f5c", accessory: "monocle", skin: "#e3b58f" },
  { hat: "top", coat: "#1f4d33", accessory: "scarf", skin: "#c48c68" },
  { hat: "beret", coat: "#4a2160", accessory: "earring", skin: "#f5d6bd" },
  { hat: "fedora", coat: "#6b1d2c", accessory: "monocle", skin: "#8f5d3e" },
  { hat: "bowler", coat: "#24424d", accessory: "mustache", skin: "#f0c8a4" },
];

export function defaultAvatar(seat: number): Avatar {
  return SEAT_AVATARS[((seat % SEAT_AVATARS.length) + SEAT_AVATARS.length) % SEAT_AVATARS.length];
}

/** Anything not exactly one of the offered options falls back to the seat default. */
export function sanitizeAvatar(raw: unknown, seat: number): Avatar {
  const d = defaultAvatar(seat);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  return {
    hat: HATS.some((h) => h.id === r.hat) ? (r.hat as HatKind) : d.hat,
    coat: COATS.some((c) => c.id === r.coat) ? (r.coat as string) : d.coat,
    accessory: ACCESSORIES.some((a) => a.id === r.accessory) ? (r.accessory as Accessory) : d.accessory,
    skin: SKINS.includes(r.skin as string) ? (r.skin as string) : d.skin,
  };
}

// ---------------------------------------------------------------------------
// Emotes
// ---------------------------------------------------------------------------

export type EmoteKind = "smug" | "think" | "nervous" | "angry" | "pray" | "clap" | "point" | "laugh";

export const EMOTES: { id: EmoteKind; icon: string; label: string }[] = [
  { id: "smug", icon: "😏", label: "비웃기" },
  { id: "think", icon: "🤔", label: "의심" },
  { id: "nervous", icon: "😰", label: "식은땀" },
  { id: "angry", icon: "😡", label: "분노" },
  { id: "pray", icon: "🙏", label: "기도" },
  { id: "clap", icon: "👏", label: "박수" },
  { id: "point", icon: "👉", label: "너야!" },
  { id: "laugh", icon: "😂", label: "폭소" },
];

export const EMOTE_DURATION_S = 2.6;
export const EMOTE_COOLDOWN_MS = 1500;

export interface EmoteEvent {
  seat: number;
  kind: EmoteKind;
  /** Sender-side unique id (ms timestamp) — lets the same emote fire twice in a row. */
  id: number;
}

/** Validates an incoming emote broadcast; null when it isn't one of ours. */
export function sanitizeEmote(raw: unknown, playerCount: number): EmoteEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Number.isInteger(r.seat) || (r.seat as number) < 0 || (r.seat as number) >= playerCount) return null;
  if (!EMOTES.some((e) => e.id === r.kind)) return null;
  if (typeof r.id !== "number" || !Number.isFinite(r.id)) return null;
  return { seat: r.seat as number, kind: r.kind as EmoteKind, id: r.id };
}

export function emoteIcon(kind: EmoteKind): string {
  return EMOTES.find((e) => e.id === kind)?.icon ?? "❔";
}
