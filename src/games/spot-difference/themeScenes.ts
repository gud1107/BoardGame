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
  // 2026-09-30: +6 themes (10 total) so back-to-back matches stop landing on the same picture.
  {
    id: "theme-bazaar",
    name: "실크로드 황혼의 바자르",
    mutations: [
      { id: "moonStar", name: "초승달 옆 별", xPct: 26, yPct: 16, rPct: 6 },
      { id: "pennant", name: "천막 깃발 색", xPct: 50, yPct: 10, rPct: 6 },
      { id: "carpet", name: "양탄자 가운데 문양", xPct: 84, yPct: 28, rPct: 7 },
      { id: "camelBell", name: "낙타 안장 방울", xPct: 16, yPct: 46, rPct: 6 },
      { id: "lampSmoke", name: "황동 향로 연기", xPct: 66, yPct: 48, rPct: 6 },
      { id: "spice", name: "향신료 더미 색", xPct: 30, yPct: 66, rPct: 7 },
      { id: "scales", name: "천칭 저울 기울기", xPct: 56, yPct: 70, rPct: 6 },
      { id: "pomegranate", name: "바구니 석류 개수", xPct: 38, yPct: 87, rPct: 6 },
      { id: "copperPot", name: "구리 주전자 문양", xPct: 80, yPct: 82, rPct: 6 },
    ],
  },
  {
    id: "theme-orbital",
    name: "궤도 정거장 라운지",
    mutations: [
      { id: "star", name: "창밖의 밝은 별", xPct: 58, yPct: 13, rPct: 5 },
      { id: "antenna", name: "위성 안테나 각도", xPct: 80, yPct: 18, rPct: 6 },
      { id: "aurora", name: "지구 오로라 색", xPct: 40, yPct: 34, rPct: 7 },
      { id: "dockLight", name: "도킹 신호등", xPct: 12, yPct: 44, rPct: 5 },
      { id: "solarPanel", name: "태양광 패널 반사", xPct: 88, yPct: 48, rPct: 6 },
      { id: "coffee", name: "무중력 커피 방울 위치", xPct: 28, yPct: 66, rPct: 6 },
      { id: "robotArm", name: "로봇 집게 모양", xPct: 72, yPct: 68, rPct: 7 },
      { id: "helmet", name: "헬멧 바이저 줄무늬", xPct: 52, yPct: 76, rPct: 6 },
      { id: "holoPlant", name: "홀로그램 분재 잎 색", xPct: 30, yPct: 86, rPct: 6 },
    ],
  },
  {
    id: "theme-bakery",
    name: "새벽의 골목 베이커리",
    mutations: [
      { id: "awning", name: "차양 가운데 줄무늬 색", xPct: 50, yPct: 11, rPct: 6 },
      { id: "sign", name: "간판 빵 모양", xPct: 26, yPct: 27, rPct: 6 },
      { id: "clock", name: "벽시계 바늘", xPct: 76, yPct: 27, rPct: 6 },
      { id: "chefHat", name: "제빵사 모자", xPct: 58, yPct: 45, rPct: 6 },
      { id: "flowerBox", name: "창가 제라늄 색", xPct: 88, yPct: 47, rPct: 6 },
      { id: "croissants", name: "크루아상 개수", xPct: 26, yPct: 60, rPct: 7 },
      { id: "ribbon", name: "바구니 리본 색", xPct: 46, yPct: 75, rPct: 6 },
      { id: "flourSack", name: "밀가루 포대 인장", xPct: 80, yPct: 78, rPct: 6 },
      { id: "chalkboard", name: "입간판 바게트 그림", xPct: 12, yPct: 84, rPct: 6 },
    ],
  },
  {
    id: "theme-arcade",
    name: "80년대 레트로 오락실",
    mutations: [
      { id: "ceilingLight", name: "천장 조명", xPct: 40, yPct: 11, rPct: 6 },
      { id: "ghostSign", name: "픽셀 유령 네온 색", xPct: 70, yPct: 18, rPct: 7 },
      { id: "hiScore", name: "하이스코어 막대", xPct: 24, yPct: 37, rPct: 6 },
      { id: "claw", name: "인형뽑기 속 인형", xPct: 86, yPct: 54, rPct: 7 },
      { id: "soda", name: "음료 캔 색", xPct: 9, yPct: 60, rPct: 5 },
      { id: "jukebox", name: "주크박스 조명 색", xPct: 58, yPct: 58, rPct: 7 },
      { id: "joystick", name: "조이스틱 볼 색", xPct: 26, yPct: 63, rPct: 6 },
      { id: "coinLed", name: "동전 투입구 LED", xPct: 28, yPct: 82, rPct: 5 },
      { id: "carpet", name: "카펫 무늬", xPct: 56, yPct: 89, rPct: 6 },
    ],
  },
  {
    id: "theme-camping",
    name: "은하수 캠핑장과 모닥불",
    mutations: [
      { id: "moon", name: "초승달 방향", xPct: 11, yPct: 13, rPct: 6 },
      { id: "shootingStar", name: "별똥별", xPct: 34, yPct: 14, rPct: 7 },
      { id: "dipper", name: "북두칠성 연결선", xPct: 66, yPct: 19, rPct: 7 },
      { id: "owl", name: "전나무 위 부엉이", xPct: 88, yPct: 38, rPct: 6 },
      { id: "lantern", name: "텐트 랜턴 색", xPct: 22, yPct: 56, rPct: 6 },
      { id: "sparks", name: "모닥불 불티", xPct: 50, yPct: 61, rPct: 6 },
      { id: "marshmallow", name: "꼬치 마시멜로 개수", xPct: 67, yPct: 72, rPct: 6 },
      { id: "guitarStrap", name: "기타 멜빵 색", xPct: 86, yPct: 78, rPct: 6 },
      { id: "thermos", name: "보온병 컵 색", xPct: 38, yPct: 86, rPct: 6 },
    ],
  },
  {
    id: "theme-haunted",
    name: "할로윈 유령의 대저택",
    mutations: [
      { id: "bats", name: "달 앞 박쥐 수", xPct: 24, yPct: 17, rPct: 7 },
      { id: "atticHand", name: "다락방 창문 손자국", xPct: 60, yPct: 15, rPct: 6 },
      { id: "gargoyle", name: "가고일 눈빛", xPct: 12, yPct: 42, rPct: 6 },
      { id: "spider", name: "샹들리에 거미", xPct: 46, yPct: 36, rPct: 6 },
      { id: "portrait", name: "초상화 눈동자", xPct: 84, yPct: 38, rPct: 6 },
      { id: "floatCandle", name: "떠 있는 촛불", xPct: 32, yPct: 57, rPct: 6 },
      { id: "ghost", name: "창가 유령", xPct: 87, yPct: 64, rPct: 6 },
      { id: "pumpkin", name: "호박 입 모양", xPct: 68, yPct: 78, rPct: 7 },
      { id: "gateCrest", name: "카펫 문장", xPct: 46, yPct: 87, rPct: 6 },
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

/**
 * Recently-played deck (host-side, per device): which themes were just shown,
 * oldest first, so the next `startGame` pushes them to the back of the order.
 * Capped at one fewer than the theme count — once nearly every theme has had
 * its turn the oldest drops off, so the deck cycles without ever blocking
 * the whole pool, and the most recent theme is always last in line.
 */
export function nextRecentSceneIds(prev: string[], played: string[], cap = THEME_SCENES.length - 1): string[] {
  const playedThemes = played.filter((id) => findThemeScene(id));
  const merged = [...prev.filter((id) => findThemeScene(id) && !playedThemes.includes(id)), ...playedThemes];
  return merged.slice(Math.max(0, merged.length - cap));
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
