/**
 * Player look data for the 3D table rigs (SeatedPerson / RealisticPerson) —
 * deliberately free of three.js / React so a profile editor, the lobby, or
 * server-side storage can import it without pulling the 3D chunk.
 *
 * Flow:  stored profile JSON ──sanitizeAvatar──▶ AvatarProfile
 *        resolveLook(seat, gameHats, profile) ──▶ PersonLook ──▶ rig
 *
 * - `AvatarProfile` is what a player owns (gender, skin, hair, outfit …).
 *   Hats are NOT part of it: each game's theme dresses its table (코요테 cowboy
 *   hats, 달무티 crowns), and a profile shouldn't break that.
 * - Anything missing or invalid in a profile falls back to the seat default,
 *   so old/partial profiles keep rendering when new fields are added.
 * - Adding an option = append it to the matching list below; the rigs only
 *   ever read `PersonLook`, and unknown hair styles fall back per rig.
 */

export type HatKind = "none" | "cowboy" | "fedora" | "beret" | "cap" | "bowler" | "crown" | "circlet" | "hood" | "helmet";
/** "short" … "spiky" are the original cartoon cuts; the rest are the K-pop idol cuts used by default. */
export type HairStyle = "short" | "long" | "bun" | "spiky" | "straight" | "hush" | "pony" | "comma" | "curtain" | "dandy";
export type PersonGender = "f" | "m";

export interface PersonLook {
  gender: PersonGender;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  coat: string;
  shirt: string;
  hat: HatKind;
  hatColor: string;
  beard: boolean;
  glasses: boolean;
  /** Lip tint (K-beauty gradient lip for the women, a natural tone for the men). */
  lip: string;
}

/** The part of a look a player can choose in their profile (+ which preset it started from, for the list's highlight). */
export type AvatarProfile = Partial<Pick<PersonLook, "gender" | "skin" | "hair" | "hairStyle" | "coat" | "shirt" | "glasses" | "lip">> & { presetId?: string };

/** Bump when the stored shape changes incompatibly; sanitizeAvatar can then migrate by version. */
export const AVATAR_VERSION = 1;

interface Option<T> {
  id: T;
  label: string;
}
const opt = <T,>(id: T, label: string): Option<T> => ({ id, label });

/**
 * Every choosable value, with Korean labels for a future profile editor.
 * Defaults are drawn from these same lists, so the editor and the tables never disagree.
 */
export const AVATAR_OPTIONS = {
  gender: [opt<PersonGender>("f", "여자"), opt<PersonGender>("m", "남자")],
  // K-pop idol cast: fair-to-warm East Asian skin
  skin: [opt("#fbe4d5", "밝은 톤"), opt("#f6d9c4", "핑크 톤"), opt("#f2cfb5", "웜 톤"), opt("#f9ddca", "아이보리"), opt("#ecc6a8", "건강한 톤"), opt("#f4d6c0", "내추럴")],
  // mostly natural black/brown with the odd idol dye
  hairF: [opt("#16110f", "흑발"), opt("#2a1c16", "자연 흑갈색"), opt("#4a3022", "다크 브라운"), opt("#7a5640", "밀크티 브라운"), opt("#d7b48c", "애쉬 블론드"), opt("#b8707e", "로즈 핑크"), opt("#5e3c2c", "초코 브라운")],
  hairM: [opt("#121010", "흑발"), opt("#1e1714", "자연 흑갈색"), opt("#3a2a22", "다크 브라운"), opt("#5a4c48", "애쉬 브라운"), opt("#d9d6de", "플래티넘 실버"), opt("#2a3148", "블루 블랙"), opt("#6b4a3a", "카키 브라운")],
  hairStyle: [
    opt<HairStyle>("straight", "긴 생머리 + 시스루뱅"),
    opt<HairStyle>("hush", "허쉬컷"),
    opt<HairStyle>("pony", "하이 포니테일"),
    opt<HairStyle>("comma", "쉼표머리"),
    opt<HairStyle>("curtain", "가르마펌"),
    opt<HairStyle>("dandy", "댄디컷"),
  ],
  coat: [opt("#1c1c22", "블랙"), opt("#ece4d6", "크림"), opt("#2b3a5c", "네이비"), opt("#b9a6d6", "라벤더"), opt("#8fb6d9", "스카이"), opt("#7a2238", "버건디"), opt("#c9b28f", "베이지"), opt("#3a3a40", "차콜"), opt("#9fc8b4", "민트"), opt("#e7b7c4", "베이비 핑크")],
  shirt: [opt("#ffffff", "화이트"), opt("#f5f0e6", "아이보리"), opt("#e8eef8", "연하늘"), opt("#fdf1f4", "연분홍"), opt("#1f1f24", "블랙"), opt("#eeeae2", "오트밀")],
  lip: [opt("#e05a6e", "로즈"), opt("#d8485e", "체리"), opt("#e8766e", "코랄"), opt("#c94a62", "말린 장미"), opt("#ef8a84", "피치"), opt("#d4607a", "핑크"), opt("#c27a6e", "내추럴")],
} as const;

export interface CharacterPreset {
  id: string;
  /** Fictional stage name — never a real idol. */
  name: string;
  /** One-line concept shown under the card. */
  concept: string;
  look: Required<Omit<AvatarProfile, "presetId">>;
}

const preset = (id: string, name: string, concept: string, look: CharacterPreset["look"]): CharacterPreset => ({ id, name, concept, look });

/**
 * The ready-made cast shown as a list in the profile (프로필 → 캐릭터 선택).
 * Any number of players may pick the same one — the tables never require
 * unique looks. To add a character, append here (ids must stay stable:
 * they're stored in profiles).
 */
export const CHARACTER_PRESETS: readonly CharacterPreset[] = [
  preset("haerin", "하린", "청순 생머리 비주얼", { gender: "f", skin: "#fbe4d5", hair: "#16110f", hairStyle: "straight", coat: "#ece4d6", shirt: "#ffffff", glasses: false, lip: "#e05a6e" }),
  preset("yuna", "유나", "허쉬컷 걸크러시", { gender: "f", skin: "#f6d9c4", hair: "#4a3022", hairStyle: "hush", coat: "#1c1c22", shirt: "#1f1f24", glasses: false, lip: "#d8485e" }),
  preset("sia", "시아", "핑크 포니테일 막내", { gender: "f", skin: "#f9ddca", hair: "#b8707e", hairStyle: "pony", coat: "#e7b7c4", shirt: "#fdf1f4", glasses: false, lip: "#ef8a84" }),
  preset("chaewon", "채원", "애쉬 블론드 센터", { gender: "f", skin: "#fbe4d5", hair: "#d7b48c", hairStyle: "straight", coat: "#2b3a5c", shirt: "#e8eef8", glasses: false, lip: "#d4607a" }),
  preset("minji", "민지", "밀크티 허쉬컷 리더", { gender: "f", skin: "#f2cfb5", hair: "#7a5640", hairStyle: "hush", coat: "#b9a6d6", shirt: "#ffffff", glasses: false, lip: "#e8766e" }),
  preset("seoa", "서아", "흑발 포니 댄서", { gender: "f", skin: "#ecc6a8", hair: "#2a1c16", hairStyle: "pony", coat: "#7a2238", shirt: "#f5f0e6", glasses: false, lip: "#c94a62" }),
  preset("doyoon", "도윤", "쉼표머리 비주얼", { gender: "m", skin: "#f6d9c4", hair: "#121010", hairStyle: "comma", coat: "#1c1c22", shirt: "#ffffff", glasses: false, lip: "#c27a6e" }),
  preset("jun", "준", "플래티넘 가르마펌", { gender: "m", skin: "#fbe4d5", hair: "#d9d6de", hairStyle: "curtain", coat: "#ece4d6", shirt: "#1f1f24", glasses: false, lip: "#c27a6e" }),
  preset("taeo", "태오", "댄디컷 메인보컬", { gender: "m", skin: "#f2cfb5", hair: "#3a2a22", hairStyle: "dandy", coat: "#2b3a5c", shirt: "#e8eef8", glasses: false, lip: "#c27a6e" }),
  preset("hyun", "현", "안경 쓴 브레인", { gender: "m", skin: "#f4d6c0", hair: "#1e1714", hairStyle: "comma", coat: "#c9b28f", shirt: "#ffffff", glasses: true, lip: "#c27a6e" }),
  preset("riku", "리쿠", "블루블랙 가르마펌", { gender: "m", skin: "#f9ddca", hair: "#2a3148", hairStyle: "curtain", coat: "#8fb6d9", shirt: "#eeeae2", glasses: false, lip: "#c27a6e" }),
  preset("ian", "이안", "애쉬 브라운 댄디 막내", { gender: "m", skin: "#ecc6a8", hair: "#5a4c48", hairStyle: "dandy", coat: "#9fc8b4", shirt: "#ffffff", glasses: false, lip: "#c27a6e" }),
];

const STYLES_F: HairStyle[] = ["straight", "hush", "pony"];
const STYLES_M: HairStyle[] = ["comma", "curtain", "dandy"];
const ids = <T,>(list: readonly Option<T>[]) => list.map((o) => o.id);

/**
 * A stable, varied default look per seat: pretty K-pop women and handsome
 * K-pop men alternating around the table. `hats` restricts the hat pool
 * (e.g. the 코요테 desert table wants cowboy hats, the 라이어 room none).
 */
export function defaultLook(seat: number, hats: readonly HatKind[] = ["none"]): PersonLook {
  const h = (k: number) => Math.abs(Math.floor(Math.sin(seat * 91.7 + k * 13.3) * 10000));
  const gender: PersonGender = seat % 2 === 0 ? "f" : "m";
  const f = gender === "f";
  const pair = Math.floor(seat / 2);
  const hairs = ids(f ? AVATAR_OPTIONS.hairF : AVATAR_OPTIONS.hairM);
  const skins = ids(AVATAR_OPTIONS.skin);
  const coats = ids(AVATAR_OPTIONS.coat);
  const shirts = ids(AVATAR_OPTIONS.shirt);
  const lips = ids(AVATAR_OPTIONS.lip).slice(0, 6);
  return {
    gender,
    skin: skins[h(1) % skins.length],
    hair: hairs[(pair * 3 + (f ? 1 : 2)) % hairs.length],
    hairStyle: (f ? STYLES_F : STYLES_M)[pair % 3],
    coat: coats[seat % coats.length],
    shirt: shirts[h(4) % shirts.length],
    hat: hats[seat % hats.length],
    hatColor: ["#5b3a1e", "#2b2118", "#8b5a2b", "#3a2a1a", "#6b4423"][h(5) % 5],
    beard: false,
    glasses: !f && seat % 5 === 3,
    lip: f ? lips[h(6) % lips.length] : "#c27a6e",
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const ALL_STYLES: readonly HairStyle[] = ["short", "long", "bun", "spiky", ...ids(AVATAR_OPTIONS.hairStyle)];

/**
 * Keep only valid fields of an untrusted stored profile (DB row, localStorage, another
 * client's broadcast). Colours may be any #rrggbb so a future custom picker works;
 * enums must be known values. Returns {} for anything unusable.
 */
export function sanitizeAvatar(raw: unknown): AvatarProfile {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: AvatarProfile = {};
  if (r.gender === "f" || r.gender === "m") out.gender = r.gender;
  for (const k of ["skin", "hair", "coat", "shirt", "lip"] as const) {
    const v = r[k];
    if (typeof v === "string" && HEX.test(v)) out[k] = v.toLowerCase();
  }
  if (typeof r.hairStyle === "string" && (ALL_STYLES as readonly string[]).includes(r.hairStyle)) out.hairStyle = r.hairStyle as HairStyle;
  if (typeof r.glasses === "boolean") out.glasses = r.glasses;
  if (typeof r.presetId === "string" && CHARACTER_PRESETS.some((c) => c.id === r.presetId)) out.presetId = r.presetId;
  return out;
}

/**
 * The look a seat actually renders: seat default (with the game's hats) overlaid
 * with the player's profile, if any. When a profile switches gender without
 * choosing a cut or lip, the seat default's ones for that gender are used so a
 * man doesn't inherit the seat's ponytail and lipstick.
 */
export function resolveLook(seat: number, hats?: readonly HatKind[], profile?: unknown): PersonLook {
  const base = defaultLook(seat, hats);
  const p = sanitizeAvatar(profile);
  if (p.gender && p.gender !== base.gender) {
    const other = defaultLook(seat + 1, hats);
    base.hairStyle = other.hairStyle;
    base.lip = other.lip;
    base.hair = other.hair;
  }
  delete p.presetId;
  return { ...base, ...p };
}
