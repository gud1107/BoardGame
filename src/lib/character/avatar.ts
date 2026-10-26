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
/** 체격: shoulder width / height / limb thickness of the seated body. */
export type BodyBuild = "petite" | "slim" | "standard" | "broad";
/** 얼굴형: how the lower face tapers from the cheekbones to the chin. */
export type FaceShape = "oval" | "vline" | "round" | "square";
/** 눈매: painted eye shape + the brow line that goes with it. */
export type EyeShape = "round" | "fox" | "puppy" | "sharp";
/** 포인트: a small personal mark on the face. */
export type FaceMark = "none" | "mole" | "freckles";
/**
 * Which VRoid (VRM) body the 3D tables use — files in public/models/vrm. The model
 * fixes the face; hair, outfit and shoes can come from another model of the
 * classic family (`VRM_WARDROBE`), and colours are tinted on top.
 */
export type VrmModel =
  | "pixiv-sample"
  | "three-vrm-girl"
  | "seed-san"
  | "vroid-d"
  | "vroid-d-darkness"
  | "vroid-e"
  | "vroid-f"
  | "vroid-g"
  | "vroid-hair-f"
  | "vroid-shino"
  | "vroid-hair-m"
  | "vroid-fumiriya";
/** The gender each model reads as (voice pitch, hair-colour list). */
export const VRM_MODEL_GENDER: Record<VrmModel, PersonGender> = {
  "pixiv-sample": "f",
  "three-vrm-girl": "f",
  "seed-san": "m",
  "vroid-d": "f",
  "vroid-d-darkness": "f",
  "vroid-e": "f",
  "vroid-f": "f",
  "vroid-g": "f",
  "vroid-hair-f": "f",
  "vroid-shino": "f",
  "vroid-hair-m": "m",
  "vroid-fumiriya": "m",
};
/**
 * The classic VRoid family (VRM 0.x exports sharing one `J_Bip_*` skeleton): their
 * hair, outfit and shoes can be worn by each other. pixiv-sample (VRM 1.0, mirrored
 * axes) and Seed-san (another rig) only ever wear their own. Each entry names what
 * that model contributes when worn by someone else.
 */
export const VRM_WARDROBE: Partial<Record<VrmModel, { hair: string; outfit: string; shoes: string }>> = {
  "three-vrm-girl": { hair: "흑발 생머리", outfit: "반팔 티·반바지", shoes: "흰 스니커즈" },
  "vroid-d": { hair: "남색 단발 헤어핀", outfit: "교복 (빨간 리본)", shoes: "교복 로퍼" },
  "vroid-d-darkness": { hair: "은발 엘프", outfit: "블랙 고스 코트", shoes: "블랙 부츠" },
  "vroid-e": { hair: "밤색 단발", outfit: "크림 원피스", shoes: "메리제인" },
  "vroid-f": { hair: "은발 사이버", outfit: "사이버 수트", shoes: "사이버 부츠" },
  "vroid-g": { hair: "민트·핑크 롱 포니", outfit: "핑크 드레스", shoes: "드레스 슈즈" },
  "vroid-hair-f": { hair: "고양이 귀 트윈테일", outfit: "화이트 재킷", shoes: "화이트 부츠" },
  "vroid-shino": { hair: "남색 생머리", outfit: "교복 (파란 리본)", shoes: "로퍼" },
  "vroid-hair-m": { hair: "흑발 숏컷", outfit: "화이트 후드", shoes: "스니커즈" },
  "vroid-fumiriya": { hair: "주황 투블럭", outfit: "교복 (넥타이)", shoes: "로퍼" },
};
export type WardrobeSlot = "hair" | "outfit" | "shoes";
/** Models whose hair / top take the look's colours unless told otherwise (`hairDye`/`outfitDye`): the original three, which presets colour-tint. */
export const DYED_BY_DEFAULT: ReadonlySet<VrmModel> = new Set<VrmModel>(["pixiv-sample", "three-vrm-girl", "seed-san"]);
/**
 * What `model` may wear in each slot: any classic model's hair, and outfits/shoes
 * cut for the same body (men's and women's VRoid bodies differ). Empty for models
 * outside the classic family.
 */
export function wardrobeFor(model: VrmModel): Record<WardrobeSlot, VrmModel[]> {
  if (!VRM_WARDROBE[model]) return { hair: [], outfit: [], shoes: [] };
  const all = Object.keys(VRM_WARDROBE) as VrmModel[];
  const same = all.filter((m) => VRM_MODEL_GENDER[m] === VRM_MODEL_GENDER[model]);
  return { hair: all, outfit: same, shoes: same };
}

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
  build: BodyBuild;
  face: FaceShape;
  eyes: EyeShape;
  mark: FaceMark;
  /** VRM body; unset → chosen from gender and seat (VrmPerson). */
  model?: VrmModel;
  /** Hair / outfit / shoes borrowed from another classic model (`wardrobeFor`); unset → the model's own. */
  hairFrom?: VrmModel;
  outfitFrom?: VrmModel;
  shoesFrom?: VrmModel;
  /**
   * Tint the hair / the top with `hair` / `coat`. Unset: on for the original three
   * models (their presets are colour-tinted), off for the classic family, whose
   * hand-painted colours are the point.
   */
  hairDye?: boolean;
  outfitDye?: boolean;
}

/** The part of a look a player can choose in their profile (+ which preset it started from, for the list's highlight). */
export type AvatarProfile = Partial<Pick<PersonLook, "gender" | "skin" | "hair" | "hairStyle" | "coat" | "shirt" | "glasses" | "lip" | "build" | "face" | "eyes" | "mark" | "model" | "hairFrom" | "outfitFrom" | "shoesFrom" | "hairDye" | "outfitDye">> & { presetId?: string };

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
  model: [
    opt<VrmModel>("pixiv-sample", "갈색 긴 머리"),
    opt<VrmModel>("three-vrm-girl", "흑발 생머리"),
    opt<VrmModel>("vroid-d", "남색 단발 교복"),
    opt<VrmModel>("vroid-shino", "남색 생머리 교복"),
    opt<VrmModel>("vroid-e", "밤색 단발 꼬마"),
    opt<VrmModel>("vroid-g", "민트·핑크 공주"),
    opt<VrmModel>("vroid-hair-f", "고양이 귀 트윈테일"),
    opt<VrmModel>("vroid-f", "은발 사이버"),
    opt<VrmModel>("vroid-d-darkness", "은발 다크 엘프"),
    opt<VrmModel>("seed-san", "짧은 흑발 탐험가"),
    opt<VrmModel>("vroid-hair-m", "흑발 후드 소년"),
    opt<VrmModel>("vroid-fumiriya", "주황 머리 교복"),
  ],
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
  build: [opt<BodyBuild>("petite", "아담한"), opt<BodyBuild>("slim", "슬림"), opt<BodyBuild>("standard", "보통"), opt<BodyBuild>("broad", "어깨 넓은")],
  face: [opt<FaceShape>("oval", "계란형"), opt<FaceShape>("vline", "V라인"), opt<FaceShape>("round", "동글동글"), opt<FaceShape>("square", "각진 턱선")],
  eyes: [opt<EyeShape>("round", "동그란 사슴눈"), opt<EyeShape>("fox", "올라간 여우눈"), opt<EyeShape>("puppy", "처진 강아지눈"), opt<EyeShape>("sharp", "날카로운 무쌍")],
  mark: [opt<FaceMark>("none", "없음"), opt<FaceMark>("mole", "눈밑 점"), opt<FaceMark>("freckles", "주근깨")],
  lip: [opt("#e05a6e", "로즈"), opt("#d8485e", "체리"), opt("#e8766e", "코랄"), opt("#c94a62", "말린 장미"), opt("#ef8a84", "피치"), opt("#d4607a", "핑크"), opt("#c27a6e", "내추럴")],
} as const;

type WardrobeKey = "hairFrom" | "outfitFrom" | "shoesFrom" | "hairDye" | "outfitDye";

export interface CharacterPreset {
  id: string;
  /** Fictional stage name — never a real idol. */
  name: string;
  /** One-line concept shown under the card. */
  concept: string;
  look: Required<Omit<AvatarProfile, "presetId" | WardrobeKey>> & Pick<AvatarProfile, WardrobeKey>;
}

const preset = (id: string, name: string, concept: string, look: CharacterPreset["look"]): CharacterPreset => ({ id, name, concept, look });

/**
 * The ready-made cast shown as a list in the profile (프로필 → 캐릭터 선택).
 * Any number of players may pick the same one — the tables never require
 * unique looks. To add a character, append here (ids must stay stable:
 * they're stored in profiles).
 */
export const CHARACTER_PRESETS: readonly CharacterPreset[] = [
  preset("haerin", "하린", "청순 흑발 비주얼", { gender: "f", skin: "#fbe4d5", hair: "#16110f", hairStyle: "straight", coat: "#ece4d6", shirt: "#ffffff", glasses: false, lip: "#e05a6e", build: "slim", face: "oval", eyes: "round", mark: "none", model: "three-vrm-girl" }),
  preset("yuna", "유나", "다크 브라운 걸크러시", { gender: "f", skin: "#f6d9c4", hair: "#4a3022", hairStyle: "hush", coat: "#1c1c22", shirt: "#1f1f24", glasses: false, lip: "#d8485e", build: "standard", face: "vline", eyes: "fox", mark: "mole", model: "pixiv-sample" }),
  preset("sia", "시아", "핑크 헤어 막내", { gender: "f", skin: "#f9ddca", hair: "#b8707e", hairStyle: "pony", coat: "#e7b7c4", shirt: "#fdf1f4", glasses: false, lip: "#ef8a84", build: "petite", face: "round", eyes: "puppy", mark: "freckles", model: "pixiv-sample" }),
  preset("chaewon", "채원", "애쉬 블론드 센터", { gender: "f", skin: "#fbe4d5", hair: "#d7b48c", hairStyle: "straight", coat: "#2b3a5c", shirt: "#e8eef8", glasses: false, lip: "#d4607a", build: "slim", face: "vline", eyes: "round", mark: "mole", model: "three-vrm-girl" }),
  preset("minji", "민지", "밀크티 브라운 리더", { gender: "f", skin: "#f2cfb5", hair: "#7a5640", hairStyle: "hush", coat: "#b9a6d6", shirt: "#ffffff", glasses: false, lip: "#e8766e", build: "standard", face: "oval", eyes: "puppy", mark: "none", model: "pixiv-sample" }),
  preset("seoa", "서아", "흑발 댄서", { gender: "f", skin: "#ecc6a8", hair: "#2a1c16", hairStyle: "pony", coat: "#7a2238", shirt: "#f5f0e6", glasses: false, lip: "#c94a62", build: "broad", face: "square", eyes: "sharp", mark: "none", model: "three-vrm-girl" }),
  preset("doyoon", "도윤", "흑발 비주얼", { gender: "m", skin: "#f6d9c4", hair: "#121010", hairStyle: "comma", coat: "#1c1c22", shirt: "#ffffff", glasses: false, lip: "#c27a6e", build: "slim", face: "vline", eyes: "fox", mark: "none", model: "seed-san" }),
  preset("jun", "준", "플래티넘 실버 헤어", { gender: "m", skin: "#fbe4d5", hair: "#d9d6de", hairStyle: "curtain", coat: "#ece4d6", shirt: "#1f1f24", glasses: false, lip: "#c27a6e", build: "standard", face: "oval", eyes: "sharp", mark: "mole", model: "seed-san" }),
  preset("taeo", "태오", "다크 브라운 메인보컬", { gender: "m", skin: "#f2cfb5", hair: "#3a2a22", hairStyle: "dandy", coat: "#2b3a5c", shirt: "#e8eef8", glasses: false, lip: "#c27a6e", build: "broad", face: "square", eyes: "puppy", mark: "none", model: "seed-san" }),
  preset("hyun", "현", "차분한 브레인", { gender: "m", skin: "#f4d6c0", hair: "#1e1714", hairStyle: "comma", coat: "#c9b28f", shirt: "#ffffff", glasses: true, lip: "#c27a6e", build: "standard", face: "round", eyes: "round", mark: "none", model: "seed-san" }),
  preset("riku", "리쿠", "블루블랙 헤어", { gender: "m", skin: "#f9ddca", hair: "#2a3148", hairStyle: "curtain", coat: "#8fb6d9", shirt: "#eeeae2", glasses: false, lip: "#c27a6e", build: "broad", face: "vline", eyes: "sharp", mark: "none", model: "seed-san" }),
  preset("ian", "이안", "애쉬 브라운 막내", { gender: "m", skin: "#ecc6a8", hair: "#5a4c48", hairStyle: "dandy", coat: "#9fc8b4", shirt: "#ffffff", glasses: false, lip: "#c27a6e", build: "petite", face: "round", eyes: "puppy", mark: "freckles", model: "seed-san" }),
  // the classic VRoid cast: their own hand-painted hair and outfit colours (no dye)
  preset("danbi", "단비", "남색 단발 교복", { gender: "f", skin: "#fbe4d5", hair: "#16110f", hairStyle: "straight", coat: "#2b3a5c", shirt: "#ffffff", glasses: false, lip: "#e05a6e", build: "petite", face: "oval", eyes: "sharp", mark: "none", model: "vroid-d" }),
  preset("sua", "수아", "남색 생머리 교복", { gender: "f", skin: "#fbe4d5", hair: "#16110f", hairStyle: "straight", coat: "#2b3a5c", shirt: "#ffffff", glasses: false, lip: "#d4607a", build: "slim", face: "oval", eyes: "fox", mark: "mole", model: "vroid-shino" }),
  preset("bomi", "보미", "밤색 단발 꼬마", { gender: "f", skin: "#f9ddca", hair: "#5e3c2c", hairStyle: "straight", coat: "#ece4d6", shirt: "#ffffff", glasses: false, lip: "#ef8a84", build: "petite", face: "round", eyes: "round", mark: "freckles", model: "vroid-e" }),
  preset("ella", "엘라", "민트·핑크 공주", { gender: "f", skin: "#fbe4d5", hair: "#d7b48c", hairStyle: "pony", coat: "#e7b7c4", shirt: "#fdf1f4", glasses: false, lip: "#e8766e", build: "slim", face: "round", eyes: "puppy", mark: "none", model: "vroid-g" }),
  preset("nabi", "나비", "고양이 귀 트윈테일", { gender: "f", skin: "#f6d9c4", hair: "#16110f", hairStyle: "pony", coat: "#ece4d6", shirt: "#ffffff", glasses: false, lip: "#d8485e", build: "petite", face: "vline", eyes: "fox", mark: "none", model: "vroid-hair-f" }),
  preset("vita", "비타", "은발 사이버", { gender: "f", skin: "#fbe4d5", hair: "#d9d6de", hairStyle: "hush", coat: "#8fb6d9", shirt: "#1f1f24", glasses: false, lip: "#c94a62", build: "standard", face: "square", eyes: "round", mark: "none", model: "vroid-f" }),
  preset("ria", "리아", "은발 다크 엘프", { gender: "f", skin: "#fbe4d5", hair: "#d9d6de", hairStyle: "straight", coat: "#1c1c22", shirt: "#1f1f24", glasses: false, lip: "#c94a62", build: "slim", face: "square", eyes: "fox", mark: "mole", model: "vroid-d-darkness" }),
  preset("geonu", "건우", "흑발 후드 소년", { gender: "m", skin: "#f6d9c4", hair: "#121010", hairStyle: "comma", coat: "#ece4d6", shirt: "#ffffff", glasses: false, lip: "#c27a6e", build: "slim", face: "oval", eyes: "round", mark: "none", model: "vroid-hair-m" }),
  preset("haechan", "해찬", "주황 머리 교복", { gender: "m", skin: "#f9ddca", hair: "#6b4a3a", hairStyle: "dandy", coat: "#2b3a5c", shirt: "#ffffff", glasses: false, lip: "#c27a6e", build: "standard", face: "vline", eyes: "puppy", mark: "freckles", model: "vroid-fumiriya" }),
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
    build: (f ? (["slim", "petite", "standard"] as const) : (["standard", "broad", "slim"] as const))[h(7) % 3],
    face: ids(AVATAR_OPTIONS.face)[h(8) % 4],
    eyes: ids(AVATAR_OPTIONS.eyes)[(seat + h(9)) % 4],
    mark: h(10) % 5 === 0 ? "mole" : "none",
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
  for (const k of ["build", "face", "eyes", "mark"] as const) {
    const v = r[k];
    if (typeof v === "string" && (ids(AVATAR_OPTIONS[k]) as readonly string[]).includes(v)) (out as Record<string, string>)[k] = v;
  }
  const isModel = (v: unknown): v is VrmModel => typeof v === "string" && (ids(AVATAR_OPTIONS.model) as readonly string[]).includes(v);
  if (isModel(r.model)) out.model = r.model;
  for (const k of ["hairFrom", "outfitFrom", "shoesFrom"] as const) if (isModel(r[k]) && VRM_WARDROBE[r[k] as VrmModel]) out[k] = r[k] as VrmModel;
  for (const k of ["hairDye", "outfitDye"] as const) if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
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
  // a chosen VRM body decides how the character reads (older profiles may lack gender)
  if (p.model && !p.gender) p.gender = VRM_MODEL_GENDER[p.model];
  // borrowed parts only where they fit this body (a stale pick after a body change is dropped)
  if (p.model) {
    const w = wardrobeFor(p.model);
    if (p.hairFrom && !w.hair.includes(p.hairFrom)) delete p.hairFrom;
    if (p.outfitFrom && !w.outfit.includes(p.outfitFrom)) delete p.outfitFrom;
    if (p.shoesFrom && !w.shoes.includes(p.shoesFrom)) delete p.shoesFrom;
  } else {
    delete p.hairFrom;
    delete p.outfitFrom;
    delete p.shoesFrom;
  }
  if (p.gender && p.gender !== base.gender) {
    const other = defaultLook(seat + 1, hats);
    base.hairStyle = other.hairStyle;
    base.lip = other.lip;
    base.hair = other.hair;
    base.build = other.build;
  }
  delete p.presetId;
  return { ...base, ...p };
}
