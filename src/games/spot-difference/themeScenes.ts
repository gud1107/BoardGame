/**
 * Detailed themed scenes with a procedural mutation pool (2026-09-29).
 *
 * The three classic shape scenes (scenes.ts) ship a fixed answer key, so the
 * same five differences came back every time. Each theme here instead lists
 * a larger pool of candidate mutations; `pickThemeMutations` draws
 * `THEME_DIFFS_PER_STAGE` of them from the room's seeded RNG at `startGame`,
 * so the same picture shows a different set of differences each match while
 * every client still derives the identical answer key.
 *
 * Pure data — the SVG artwork lives in ThemeSceneArt.tsx, keyed by the same
 * mutation ids. Coordinates share the 0..100 viewBox / click space used
 * everywhere else in this game, and every pair of candidates is spaced
 * farther apart than the sum of their radii so hit regions never overlap
 * (asserted in SpotDifference.test.ts).
 */

export interface ThemeMutation {
  id: string;
  /** Short Korean label, for tests/debugging and future answer reveals. */
  name: string;
  xPct: number;
  yPct: number;
  rPct: number;
}

export interface ThemeScene {
  id: string;
  name: string;
  mutations: ThemeMutation[];
}

export const THEME_DIFFS_PER_STAGE = 5;

export const THEME_SCENES: ThemeScene[] = [
  {
    id: "theme-cyberpunk",
    name: "사이버펑크 네온 골목",
    mutations: [
      { id: "neonSign", name: "네온 간판 색", xPct: 22, yPct: 26, rPct: 7 },
      { id: "drone", name: "감시 드론", xPct: 60, yPct: 14, rPct: 7 },
      { id: "holoFish", name: "홀로그램 물고기 방향", xPct: 44, yPct: 34, rPct: 7 },
      { id: "wireSpark", name: "전선 스파크", xPct: 34, yPct: 49, rPct: 6 },
      { id: "vending", name: "자판기 불빛", xPct: 86, yPct: 60, rPct: 7 },
      { id: "roboCat", name: "기계 고양이 꼬리", xPct: 38, yPct: 80, rPct: 7 },
      { id: "puddle", name: "물웅덩이 반사광", xPct: 62, yPct: 89, rPct: 7 },
      { id: "window", name: "빌딩 창문 불빛", xPct: 82, yPct: 24, rPct: 6 },
      { id: "streetLamp", name: "가로등 불빛", xPct: 62, yPct: 54, rPct: 6 },
    ],
  },
  {
    id: "theme-greenhouse",
    name: "보태니컬 온실 티하우스",
    mutations: [
      { id: "monstera", name: "몬스테라 잎", xPct: 18, yPct: 24, rPct: 7 },
      { id: "birdCage", name: "새장 속 새", xPct: 84, yPct: 28, rPct: 7 },
      { id: "stainedGlass", name: "천장 스테인드글라스", xPct: 50, yPct: 11, rPct: 6 },
      { id: "butterfly", name: "나비 날개 색", xPct: 38, yPct: 34, rPct: 6 },
      { id: "teaSteam", name: "찻잔 김 방향", xPct: 30, yPct: 58, rPct: 6 },
      { id: "cakeCherry", name: "케이크 체리", xPct: 52, yPct: 50, rPct: 6 },
      { id: "macaron", name: "마카롱 색", xPct: 68, yPct: 64, rPct: 6 },
      { id: "catBell", name: "고양이 방울", xPct: 82, yPct: 78, rPct: 7 },
      { id: "wateringCan", name: "물뿌리개 색", xPct: 16, yPct: 84, rPct: 7 },
    ],
  },
  {
    id: "theme-alchemy",
    name: "연금술사의 마법 서재",
    mutations: [
      { id: "books", name: "책장 책 한 권", xPct: 28, yPct: 15, rPct: 6 },
      { id: "globeRing", name: "천구의 고리 각도", xPct: 22, yPct: 38, rPct: 7 },
      { id: "crystal", name: "매달린 수정 색", xPct: 52, yPct: 16, rPct: 6 },
      { id: "candle", name: "촛불 불꽃 색", xPct: 86, yPct: 30, rPct: 6 },
      { id: "owl", name: "부엉이 눈", xPct: 76, yPct: 50, rPct: 6 },
      { id: "potion", name: "플라스크 물약", xPct: 64, yPct: 68, rPct: 7 },
      { id: "hourglass", name: "모래시계 모래", xPct: 44, yPct: 68, rPct: 6 },
      { id: "rune", name: "양피지 룬 문자", xPct: 58, yPct: 88, rPct: 6 },
      { id: "quill", name: "깃털 펜 색", xPct: 26, yPct: 82, rPct: 7 },
    ],
  },
  {
    id: "theme-deepsea",
    name: "심해 연구 돔",
    mutations: [
      { id: "whaleTail", name: "고래 꼬리", xPct: 28, yPct: 26, rPct: 7 },
      { id: "jelly", name: "해파리 촉수 수", xPct: 70, yPct: 20, rPct: 7 },
      { id: "subBeam", name: "잠수정 라이트 방향", xPct: 50, yPct: 44, rPct: 7 },
      { id: "fish", name: "물고기 떼 색", xPct: 82, yPct: 44, rPct: 6 },
      { id: "starfish", name: "산호 위 불가사리", xPct: 18, yPct: 58, rPct: 6 },
      { id: "warnLight", name: "계기판 경고등", xPct: 36, yPct: 82, rPct: 6 },
      { id: "gauge", name: "게이지 바늘", xPct: 58, yPct: 82, rPct: 7 },
      { id: "mug", name: "콘솔 위 머그컵", xPct: 84, yPct: 84, rPct: 6 },
    ],
  },
];

export function findThemeScene(id: string): ThemeScene | undefined {
  return THEME_SCENES.find((t) => t.id === id);
}

/** Spot id is `${themeId}:${mutationId}` — the renderer recovers the active mutations straight from the stage's spots. */
export function themeSpotId(themeId: string, mutationId: string): string {
  return `${themeId}:${mutationId}`;
}

export function activeThemeMutationIds(themeId: string, spotIds: string[]): Set<string> {
  const prefix = `${themeId}:`;
  return new Set(spotIds.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length)));
}

/** Seeded draw of this stage's differences from the theme's pool (partial Fisher–Yates on a copy). */
export function pickThemeMutations(theme: ThemeScene, rng: () => number, count = THEME_DIFFS_PER_STAGE): ThemeMutation[] {
  const pool = [...theme.mutations];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}
