/**
 * The cosmetic skins a player can pick (🎨 내 스킨): one table skin (felt +
 * room colour of every 3D table), one card-back skin and one 3D name-plate
 * skin, plus a prop skin (Perudo cup, plain coins). All are shown to everyone
 * in the room — the table is the host's, each player's own hand of cards, name
 * plate and props wear that player's pick (see `src/lib/skins/useSkins.ts`).
 *
 * A few skins are rewards (`unlock`): earned from games played/won with other
 * people (bots don't count) or achievements — see `unlocks.ts`.
 *
 * Purely visual: a skin never changes what a card is, and shared piles
 * (decks, discards, the market) always keep the game's own back so nobody
 * can tell whose card is whose in a common pile.
 *
 * Patterns differ per skin (not just colours) so two backs stay tellable
 * apart without relying on colour vision.
 */

export type SkinPattern = "diag" | "diamond" | "dots" | "waves" | "grid" | "plain";

/** Reward skins: what earns them lives in `unlocks.ts`. */
export type UnlockPrefix = "plays" | "humanPlays" | "humanWins" | "games" | "gamesWon" | "achv" | "bot8Wins" | "bot10Wins" | "mastery" | "solo";
export type UnlockId = `${UnlockPrefix}${number}`;

/** Drifting specks over a 3D table (off in low-detail mode). */
export type SkinParticles = "petals" | "stars" | "snow" | "bubbles" | "embers" | "sparkles";

export interface CardBackSkin {
  id: string;
  name: string;
  emoji: string;
  /** [base, stripe] colours of the pattern. */
  colors: [string, string];
  /** Border + emblem colour. */
  accent: string;
  pattern: SkinPattern;
  /** Glyph in the middle of the back. */
  emblem: string;
  /** Painted back (path under public/); `colors`/`accent` still frame it. */
  image?: string;
  unlock?: UnlockId;
}

export interface TableSkin {
  id: string;
  name: string;
  emoji: string;
  felt: string;
  /** Pattern drawn over the felt (subtle, `feltAccent` on `felt`). */
  pattern: SkinPattern;
  feltAccent: string;
  inlay: string;
  /** Room background + fog colour. */
  background: string;
  /** Room theme: hanging-lamp colour (intensity stays the game's, so no table gets darker). */
  lamp: string;
  chairColor: string;
  particles?: SkinParticles;
  particleColor?: string;
  unlock?: UnlockId;
}

/**
 * The 3D name plate over a player's head. The seat colour stays as the inner
 * border (it's how a seat is told apart); the skin adds the outer frame, the
 * patterned fill and an emblem on both ends.
 */
export interface PlateSkin {
  id: string;
  name: string;
  emoji: string;
  colors: [string, string];
  /** Outer frame + emblems. */
  accent: string;
  pattern: SkinPattern;
  emblem: string;
  /** Name text colour. */
  fg: string;
  unlock?: UnlockId;
}

/**
 * A player's own props. The Perudo cup's seat-colour band stays (it tells the cups apart);
 * the skin paints its body and gold ring. Coins only take it where the game left the coin
 * colour unset — a colour that means something (Century's gold/silver, Splendor's gems) stays.
 */
export interface PropSkin {
  id: string;
  name: string;
  emoji: string;
  cup: string;
  ring: string;
  coin: string;
  coinEdge: string;
}

export const DEFAULT_SKIN_ID = "default";

/** `default` = the game's own back. */
export const CARD_BACK_SKINS: readonly CardBackSkin[] = [
  { id: "crimson", name: "로열 크림슨", emoji: "🥀", colors: ["#5b0f1e", "#7a1a2c"], accent: "#f2c14e", pattern: "diamond", emblem: "♛" },
  { id: "midnight", name: "미드나잇 스타", emoji: "🌌", colors: ["#0b1330", "#16224d"], accent: "#a5b4fc", pattern: "dots", emblem: "✦" },
  { id: "sakura", name: "벚꽃", emoji: "🌸", colors: ["#f9a8c4", "#fbcfe0"], accent: "#9d174d", pattern: "waves", emblem: "✿" },
  { id: "gold", name: "황금 문양", emoji: "👑", colors: ["#1c1406", "#3b2a0b"], accent: "#fbbf24", pattern: "grid", emblem: "❖" },
  { id: "emerald", name: "에메랄드", emoji: "💚", colors: ["#053d2e", "#0a5c45"], accent: "#6ee7b7", pattern: "diag", emblem: "♣" },
  { id: "neon", name: "네온 시티", emoji: "🌃", colors: ["#1a0533", "#2e0a59"], accent: "#f0abfc", pattern: "grid", emblem: "⚡" },
  { id: "ocean", name: "딥 오션", emoji: "🌊", colors: ["#063a52", "#0b5675"], accent: "#7dd3fc", pattern: "waves", emblem: "⚓" },
  { id: "mono", name: "모노 체커", emoji: "♟️", colors: ["#111111", "#2a2a2a"], accent: "#f5f5f5", pattern: "diamond", emblem: "♠" },
  // painted rewards
  { id: "oil-rose", name: "유화 장미", emoji: "🌹", colors: ["#4a0d18", "#6b1424"], accent: "#e8c46a", pattern: "plain", emblem: "❀", image: "/images/skins/backs/oil-rose.webp", unlock: "humanPlays5" },
  { id: "celestial", name: "별자리 지도", emoji: "🔭", colors: ["#0a1430", "#14234f"], accent: "#e8c46a", pattern: "plain", emblem: "☾", image: "/images/skins/backs/celestial.webp", unlock: "games8" },
  { id: "dragon", name: "황금 용", emoji: "🐉", colors: ["#04332a", "#0a4d3e"], accent: "#fbbf24", pattern: "plain", emblem: "龍", image: "/images/skins/backs/dragon.webp", unlock: "humanWins10" },
  { id: "nouveau", name: "아르누보 공작", emoji: "🦚", colors: ["#f5ecd7", "#ead9b5"], accent: "#b8860b", pattern: "plain", emblem: "❦", image: "/images/skins/backs/nouveau.webp", unlock: "achv20" },
  // pattern rewards
  { id: "knight", name: "기사단 문장", emoji: "⚔️", colors: ["#3a2a1a", "#4d3a24"], accent: "#d6a560", pattern: "diag", emblem: "⚔", unlock: "plays10" },
  { id: "jade", name: "비취 정원", emoji: "🍀", colors: ["#0f3b2e", "#165a45"], accent: "#a7f3d0", pattern: "grid", emblem: "☘", unlock: "humanWins3" },
  { id: "amethyst", name: "자수정 궁", emoji: "🔮", colors: ["#2a0f45", "#3d1866"], accent: "#e9d5ff", pattern: "diamond", emblem: "✧", unlock: "plays50" },
  { id: "phoenix", name: "불사조", emoji: "🔥", colors: ["#4a1405", "#6b2008"], accent: "#fdba74", pattern: "waves", emblem: "❂", unlock: "gamesWon5" },
  { id: "storm", name: "번개 폭풍", emoji: "⛈️", colors: ["#1e293b", "#334155"], accent: "#fde047", pattern: "diag", emblem: "ϟ", unlock: "bot8Wins3" },
  { id: "sunburst", name: "태양 문양", emoji: "☀️", colors: ["#4a2e05", "#6b440a"], accent: "#fde68a", pattern: "dots", emblem: "☀", unlock: "games20" },
  { id: "obsidian", name: "흑요석", emoji: "🖤", colors: ["#0a0a0f", "#1f1f2e"], accent: "#c084fc", pattern: "grid", emblem: "✶", unlock: "bot8Wins15" },
  { id: "diamond", name: "다이아몬드", emoji: "💎", colors: ["#0c2f45", "#134e6f"], accent: "#e0f2fe", pattern: "diamond", emblem: "◆", unlock: "games35" },
  { id: "cosmos", name: "은하수", emoji: "🌠", colors: ["#05010f", "#1a0b3d"], accent: "#f0abfc", pattern: "dots", emblem: "✺", unlock: "achv80" },
  // dense ladder rewards (2026-11-01)
  { id: "first-step", name: "첫걸음", emoji: "👣", colors: ["#2d2a24", "#3a362e"], accent: "#e7d8b8", pattern: "dots", emblem: "♥", unlock: "plays3" },
  { id: "tavern", name: "주막 등불", emoji: "🏮", colors: ["#4a1d0c", "#5e2812"], accent: "#fca5a5", pattern: "grid", emblem: "✪", unlock: "plays20" },
  { id: "copper", name: "구리 톱니", emoji: "⚙️", colors: ["#9a5b2e", "#b06a36"], accent: "#1c1917", pattern: "grid", emblem: "⚙", unlock: "plays35" },
  { id: "harbor", name: "항구의 밤", emoji: "⛵", colors: ["#0b2238", "#12304d"], accent: "#93c5fd", pattern: "waves", emblem: "☸", unlock: "plays75" },
  { id: "centurion", name: "백 번째 판", emoji: "💯", colors: ["#2a0e0e", "#3d1515"], accent: "#fca5a5", pattern: "diamond", emblem: "⚜", unlock: "plays100" },
  { id: "titan", name: "거신", emoji: "🗿", colors: ["#57534e", "#6b6661"], accent: "#fafaf9", pattern: "diag", emblem: "♜", unlock: "plays200" },
  { id: "handshake", name: "첫 인사", emoji: "🤝", colors: ["#1d3a2f", "#24493a"], accent: "#bbf7d0", pattern: "dots", emblem: "✣", unlock: "humanPlays1" },
  { id: "campfire", name: "모닥불", emoji: "🪵", colors: ["#2b1407", "#3d1d0a"], accent: "#fdba74", pattern: "waves", emblem: "❉", unlock: "humanPlays10" },
  { id: "festival", name: "축제의 밤", emoji: "🎆", colors: ["#1a0b2e", "#2a1347"], accent: "#fbcfe8", pattern: "dots", emblem: "✤", unlock: "humanPlays50" },
  { id: "laurel", name: "월계관", emoji: "🌿", colors: ["#21331a", "#2c4423"], accent: "#d9f99d", pattern: "diamond", emblem: "❋", unlock: "humanWins1" },
  { id: "compass", name: "나침반", emoji: "🧭", colors: ["#e9d5a1", "#d6bf86"], accent: "#5b3a12", pattern: "diag", emblem: "✾", unlock: "games3" },
  { id: "atlas", name: "지도책", emoji: "🗺️", colors: ["#1e3a5f", "#274b78"], accent: "#fcd34d", pattern: "grid", emblem: "❁", unlock: "games5" },
  { id: "caravan", name: "대상 행렬", emoji: "🐫", colors: ["#d6b47a", "#c49d5c"], accent: "#7c2d12", pattern: "waves", emblem: "✥", unlock: "games12" },
  { id: "lantern", name: "등롱 거리", emoji: "🎐", colors: ["#3b0d1f", "#4f132a"], accent: "#fda4af", pattern: "dots", emblem: "☄", unlock: "games16" },
  { id: "navigator", name: "항해사", emoji: "⚓", colors: ["#3f2a0c", "#55380f"], accent: "#7dd3fc", pattern: "diamond", emblem: "♞", unlock: "games25" },
  { id: "voyager", name: "탐험선", emoji: "🚀", colors: ["#1e1b4b", "#312e81"], accent: "#fb923c", pattern: "diag", emblem: "♝", unlock: "games30" },
  { id: "spark", name: "첫 승리의 불꽃", emoji: "✨", colors: ["#3a2a05", "#4d3808"], accent: "#fde047", pattern: "diag", emblem: "⚘", unlock: "gamesWon1" },
  { id: "triad", name: "삼관왕", emoji: "🔱", colors: ["#0d2e2a", "#134039"], accent: "#5eead4", pattern: "grid", emblem: "☯", unlock: "gamesWon3" },
  { id: "crusader", name: "성기사", emoji: "🛡️", colors: ["#e5e7eb", "#cbd5e1"], accent: "#b91c1c", pattern: "diamond", emblem: "✵", unlock: "gamesWon10" },
  { id: "stamp", name: "도장 수집", emoji: "📮", colors: ["#3a1414", "#4d1c1c"], accent: "#fecdd3", pattern: "waves", emblem: "✎", unlock: "achv5" },
  { id: "scholar", name: "학자의 서고", emoji: "📜", colors: ["#2a2015", "#382b1c"], accent: "#f5deb3", pattern: "diamond", emblem: "⚗", unlock: "achv30" },
  { id: "circuit", name: "회로판", emoji: "🔌", colors: ["#06221a", "#0a3326"], accent: "#4ade80", pattern: "grid", emblem: "⌘", unlock: "bot8Wins1" },
  { id: "android", name: "기계 심장", emoji: "🤖", colors: ["#0e7490", "#0891b2"], accent: "#ecfeff", pattern: "dots", emblem: "✹", unlock: "bot8Wins6" },
  { id: "overclock", name: "오버클럭", emoji: "⚡", colors: ["#1a0f00", "#2a1800"], accent: "#fb923c", pattern: "diag", emblem: "✷", unlock: "bot10Wins1" },
  { id: "singularity", name: "특이점", emoji: "🌀", colors: ["#0a0014", "#170029"], accent: "#e879f9", pattern: "diag", emblem: "❄", unlock: "bot10Wins3" },
  { id: "apprentice", name: "견습생", emoji: "🔨", colors: ["#2b2116", "#3a2d1e"], accent: "#fcd34d", pattern: "waves", emblem: "♨", unlock: "mastery3" },
  { id: "artisan", name: "장인", emoji: "🎻", colors: ["#7c2d12", "#9a3412"], accent: "#fef3c7", pattern: "dots", emblem: "♫", unlock: "mastery5" },
  { id: "lone-wolf", name: "외로운 늑대", emoji: "🐺", colors: ["#1c1f26", "#272b35"], accent: "#cbd5e1", pattern: "waves", emblem: "☁", unlock: "solo3" },
  { id: "deep-sea", name: "심해", emoji: "🐋", colors: ["#031a2e", "#062a47"], accent: "#38bdf8", pattern: "dots", emblem: "☂", unlock: "solo25" },
  { id: "lighthouse", name: "등대지기", emoji: "🗼", colors: ["#14232e", "#1c313f"], accent: "#fde68a", pattern: "diamond", emblem: "⚖", unlock: "solo100" },
  { id: "rival", name: "라이벌", emoji: "🥊", colors: ["#9f1239", "#be123c"], accent: "#fff1f2", pattern: "grid", emblem: "☽", unlock: "humanWins5" },
  { id: "firewall", name: "방화벽", emoji: "🧱", colors: ["#1c0a05", "#2e1208"], accent: "#fb7185", pattern: "dots", emblem: "⚛", unlock: "bot10Wins5" },
];

/** `default` = the game's own table. */
export const TABLE_SKINS: readonly TableSkin[] = [
  { id: "casino", name: "카지노 그린", emoji: "🎰", felt: "#0f5132", pattern: "plain", feltAccent: "#14653f", inlay: "#d4af37", background: "#0b1a12", lamp: "#fff1cc", chairColor: "#4a2f1a" },
  { id: "velvet", name: "로열 벨벳", emoji: "🍷", felt: "#6b1022", pattern: "diamond", feltAccent: "#7d1730", inlay: "#e8c46a", background: "#1a0a0e", lamp: "#ffd2b0", chairColor: "#5b1020", particles: "embers", particleColor: "#fbbf24" },
  { id: "midnight", name: "미드나잇", emoji: "🌙", felt: "#16245a", pattern: "dots", feltAccent: "#1e2f70", inlay: "#c7d2fe", background: "#070b1c", lamp: "#dbe4ff", chairColor: "#1e293b", particles: "stars", particleColor: "#e0e7ff" },
  { id: "sakura", name: "벚꽃 정원", emoji: "🌸", felt: "#c9708f", pattern: "waves", feltAccent: "#d7849f", inlay: "#fff1f5", background: "#2a1420", lamp: "#ffe4ef", chairColor: "#7c4a3a", particles: "petals", particleColor: "#f9a8d4" },
  { id: "ocean", name: "딥 오션", emoji: "🌊", felt: "#0b5675", pattern: "waves", feltAccent: "#0f6688", inlay: "#bae6fd", background: "#04141f", lamp: "#d6f3ff", chairColor: "#334155", particles: "bubbles", particleColor: "#bae6fd" },
  { id: "palace", name: "황금 궁전", emoji: "👑", felt: "#2b1d08", pattern: "grid", feltAccent: "#3a280c", inlay: "#fbbf24", background: "#120c03", lamp: "#ffe7a3", chairColor: "#6b4a12", particles: "sparkles", particleColor: "#fbbf24" },
  { id: "neon", name: "네온 시티", emoji: "🌃", felt: "#2a0a4f", pattern: "grid", feltAccent: "#3a0f6b", inlay: "#f0abfc", background: "#0a0216", lamp: "#f5d0fe", chairColor: "#312e81", particles: "sparkles", particleColor: "#f0abfc" },
  { id: "slate", name: "모던 슬레이트", emoji: "🪨", felt: "#3f4650", pattern: "diag", feltAccent: "#48505b", inlay: "#e5e7eb", background: "#121417", lamp: "#f8fafc", chairColor: "#27272a", particles: "snow", particleColor: "#f1f5f9" },
  // reward
  { id: "aurora", name: "오로라 빙궁", emoji: "🧊", felt: "#0d3b4f", pattern: "waves", feltAccent: "#11516b", inlay: "#a7f3d0", background: "#03121a", lamp: "#c7fff0", chairColor: "#1f2937", particles: "stars", particleColor: "#86efac", unlock: "achv40" },
  { id: "library", name: "고서 서재", emoji: "📚", felt: "#3b2414", pattern: "grid", feltAccent: "#4a2f1b", inlay: "#c9a46a", background: "#140c06", lamp: "#ffe2b0", chairColor: "#5a3a20", unlock: "achv10" },
  { id: "forest", name: "숲속 오두막", emoji: "🌲", felt: "#1f4d2b", pattern: "dots", feltAccent: "#275c34", inlay: "#d9f99d", background: "#07140b", lamp: "#f0ffd8", chairColor: "#4a3420", particles: "petals", particleColor: "#bef264", unlock: "solo10" },
  { id: "oasis", name: "사막 오아시스", emoji: "🏜️", felt: "#a8743a", pattern: "waves", feltAccent: "#b88446", inlay: "#fef3c7", background: "#2a1a0a", lamp: "#fff4d6", chairColor: "#7c4a1f", particles: "sparkles", particleColor: "#fde68a", unlock: "humanPlays25" },
  { id: "volcano", name: "용암 화산", emoji: "🌋", felt: "#3a0d05", pattern: "diag", feltAccent: "#4d1408", inlay: "#fb923c", background: "#120302", lamp: "#ffc9a3", chairColor: "#292524", particles: "embers", particleColor: "#f97316", unlock: "bot10Wins10" },
  { id: "station", name: "우주 정거장", emoji: "🛰️", felt: "#111827", pattern: "grid", feltAccent: "#1c2640", inlay: "#67e8f9", background: "#02040a", lamp: "#d6f6ff", chairColor: "#374151", particles: "stars", particleColor: "#a5f3fc", unlock: "mastery30" },
];

/** `default` = the plain dark plate. */
export const PLATE_SKINS: readonly PlateSkin[] = [
  { id: "crown", name: "왕관 골드", emoji: "👑", colors: ["#3b2a0b", "#4d3810"], accent: "#fbbf24", pattern: "diamond", emblem: "♛", fg: "#fef3c7" },
  { id: "starlight", name: "별빛", emoji: "🌌", colors: ["#0b1330", "#1a2a5c"], accent: "#a5b4fc", pattern: "dots", emblem: "✦", fg: "#e0e7ff" },
  { id: "sakura", name: "벚꽃", emoji: "🌸", colors: ["#9d174d", "#b8245f"], accent: "#fbcfe8", pattern: "waves", emblem: "✿", fg: "#fff1f5" },
  { id: "neon", name: "네온", emoji: "⚡", colors: ["#1a0533", "#2e0a59"], accent: "#f0abfc", pattern: "grid", emblem: "⚡", fg: "#fae8ff" },
  { id: "emerald", name: "에메랄드", emoji: "💚", colors: ["#053d2e", "#0a5c45"], accent: "#6ee7b7", pattern: "diag", emblem: "♣", fg: "#ecfdf5" },
  { id: "flame", name: "불꽃", emoji: "🔥", colors: ["#5b0f0f", "#7c2d12"], accent: "#fb923c", pattern: "diag", emblem: "♦", fg: "#ffedd5" },
  { id: "frost", name: "서리", emoji: "❄️", colors: ["#0c3a5a", "#14527a"], accent: "#bae6fd", pattern: "grid", emblem: "❄", fg: "#f0f9ff" },
  { id: "mono", name: "모노", emoji: "♟️", colors: ["#111111", "#2a2a2a"], accent: "#f5f5f5", pattern: "diamond", emblem: "♠", fg: "#fafafa" },
  // reward
  { id: "legend", name: "전설", emoji: "🏆", colors: ["#2a1205", "#4a2108"], accent: "#fde047", pattern: "dots", emblem: "★", fg: "#fef9c3", unlock: "humanWins30" },
  { id: "explorer", name: "탐험가", emoji: "🧭", colors: ["#123a3a", "#1a5050"], accent: "#99f6e4", pattern: "dots", emblem: "✈", fg: "#f0fdfa", unlock: "solo50" },
  { id: "veteran", name: "백전노장", emoji: "🎖️", colors: ["#2b2f1a", "#3d4224"], accent: "#d9c27a", pattern: "waves", emblem: "⚔", fg: "#fefce8", unlock: "plays150" },
  { id: "champion", name: "챔피언", emoji: "🥇", colors: ["#3a2205", "#56340a"], accent: "#fcd34d", pattern: "grid", emblem: "♔", fg: "#fffbeb", unlock: "mastery10" },
  { id: "conqueror", name: "정복자", emoji: "🚩", colors: ["#3b0a1e", "#55102c"], accent: "#fda4af", pattern: "diag", emblem: "⚑", fg: "#fff1f2", unlock: "gamesWon15" },
  { id: "grandmaster", name: "그랜드마스터", emoji: "♚", colors: ["#0f172a", "#1e2a47"], accent: "#e2e8f0", pattern: "diamond", emblem: "♚", fg: "#f8fafc", unlock: "humanPlays75" },
  { id: "immortal", name: "불멸", emoji: "♾️", colors: ["#1a0a2e", "#2d1450"], accent: "#f0abfc", pattern: "diamond", emblem: "✪", fg: "#fdf4ff", unlock: "plays300" },
  { id: "host", name: "모두의 호스트", emoji: "🎪", colors: ["#3b0a0a", "#5a1010"], accent: "#fde047", pattern: "dots", emblem: "♥", fg: "#fef9c3", unlock: "humanPlays100" },
  { id: "duelist", name: "결투가", emoji: "🤺", colors: ["#1f2937", "#2b3747"], accent: "#fca5a5", pattern: "diag", emblem: "⚜", fg: "#fff1f2", unlock: "humanWins20" },
  { id: "emperor", name: "황제", emoji: "🏯", colors: ["#3a1a00", "#5a2a00"], accent: "#fbbf24", pattern: "grid", emblem: "☀", fg: "#fffbeb", unlock: "humanWins50" },
  { id: "worldwalker", name: "세계 여행자", emoji: "🌍", colors: ["#0c3a2e", "#11523f"], accent: "#6ee7b7", pattern: "waves", emblem: "♞", fg: "#ecfdf5", unlock: "games40" },
  { id: "allrounder", name: "만능 해결사", emoji: "🧩", colors: ["#1e1b4b", "#2e2a6b"], accent: "#a5b4fc", pattern: "dots", emblem: "☯", fg: "#eef2ff", unlock: "gamesWon20" },
  { id: "collector", name: "수집가", emoji: "🗃️", colors: ["#2a1f0a", "#3d2e10"], accent: "#facc15", pattern: "diamond", emblem: "♫", fg: "#fefce8", unlock: "achv60" },
  { id: "hall", name: "명예의 전당", emoji: "🏛️", colors: ["#0f0f0f", "#1f1f1f"], accent: "#fde68a", pattern: "grid", emblem: "✺", fg: "#fffbeb", unlock: "achv100" },
  { id: "hunter", name: "봇 사냥꾼", emoji: "🎯", colors: ["#1a1a1a", "#2a2a2a"], accent: "#4ade80", pattern: "diag", emblem: "◆", fg: "#f0fdf4", unlock: "bot8Wins25" },
  { id: "machine-breaker", name: "기계 파괴자", emoji: "🔩", colors: ["#18090a", "#2a0f12"], accent: "#f87171", pattern: "waves", emblem: "✶", fg: "#fef2f2", unlock: "bot10Wins20" },
  { id: "virtuoso", name: "거장", emoji: "🎼", colors: ["#1f1030", "#2e1847"], accent: "#d8b4fe", pattern: "grid", emblem: "❂", fg: "#faf5ff", unlock: "mastery20" },
  { id: "living-legend", name: "살아있는 전설", emoji: "🐐", colors: ["#2b1600", "#452300"], accent: "#fcd34d", pattern: "dots", emblem: "☘", fg: "#fffbeb", unlock: "mastery50" },
];

/** `default` = the game's own props. */
export const PROP_SKINS: readonly PropSkin[] = [
  { id: "ruby", name: "루비", emoji: "❤️", cup: "#7f1d1d", ring: "#fbbf24", coin: "#e11d48", coinEdge: "#9f1239" },
  { id: "sapphire", name: "사파이어", emoji: "💙", cup: "#1e3a8a", ring: "#c7d2fe", coin: "#3b82f6", coinEdge: "#1e40af" },
  { id: "emerald", name: "에메랄드", emoji: "💚", cup: "#064e3b", ring: "#6ee7b7", coin: "#10b981", coinEdge: "#047857" },
  { id: "amethyst", name: "자수정", emoji: "💜", cup: "#4c1d95", ring: "#f0abfc", coin: "#a855f7", coinEdge: "#6b21a8" },
  { id: "rosegold", name: "로즈골드", emoji: "🌷", cup: "#9d4b5b", ring: "#fecdd3", coin: "#f4a6a6", coinEdge: "#b76e79" },
  { id: "silver", name: "실버", emoji: "🥈", cup: "#475569", ring: "#e2e8f0", coin: "#cbd5e1", coinEdge: "#64748b" },
  { id: "ebony", name: "흑단", emoji: "🖤", cup: "#1c1410", ring: "#d4af37", coin: "#f2c14e", coinEdge: "#a8801e" },
  { id: "ivory", name: "상아", emoji: "🤍", cup: "#e7dcc3", ring: "#8b5e34", coin: "#fde68a", coinEdge: "#b45309" },
];

export function propSkin(id: string | null | undefined): PropSkin | null {
  return PROP_SKINS.find((s) => s.id === id) ?? null;
}

/** One tap = a matching table, back, plate and props (free skins only, so every set is open to everyone). */
export interface SkinSet {
  id: string;
  name: string;
  emoji: string;
  table: string;
  back: string;
  plate: string;
  prop: string;
}

export const SKIN_SETS: readonly SkinSet[] = [
  { id: "royal", name: "왕실", emoji: "👑", table: "velvet", back: "crimson", plate: "crown", prop: "ruby" },
  { id: "night", name: "밤하늘", emoji: "🌌", table: "midnight", back: "midnight", plate: "starlight", prop: "sapphire" },
  { id: "sakura", name: "벚꽃", emoji: "🌸", table: "sakura", back: "sakura", plate: "sakura", prop: "rosegold" },
  { id: "neon", name: "네온", emoji: "🌃", table: "neon", back: "neon", plate: "neon", prop: "amethyst" },
  { id: "casino", name: "카지노", emoji: "🎰", table: "casino", back: "emerald", plate: "emerald", prop: "emerald" },
  { id: "ocean", name: "바다", emoji: "🌊", table: "ocean", back: "ocean", plate: "frost", prop: "silver" },
];

export function plateSkin(id: string | null | undefined): PlateSkin | null {
  return PLATE_SKINS.find((s) => s.id === id) ?? null;
}

export function cardBackSkin(id: string | null | undefined): CardBackSkin | null {
  return CARD_BACK_SKINS.find((s) => s.id === id) ?? null;
}

export function tableSkin(id: string | null | undefined): TableSkin | null {
  return TABLE_SKINS.find((s) => s.id === id) ?? null;
}

export interface SkinChoice {
  table: string;
  back: string;
  plate: string;
  prop: string;
}

export const DEFAULT_SKIN: SkinChoice = { table: DEFAULT_SKIN_ID, back: DEFAULT_SKIN_ID, plate: DEFAULT_SKIN_ID, prop: DEFAULT_SKIN_ID };

/** Untrusted input (localStorage, account metadata, another player's presence) → known ids only. */
export function sanitizeSkin(raw: unknown): SkinChoice {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    table: typeof r.table === "string" && tableSkin(r.table) ? r.table : DEFAULT_SKIN_ID,
    back: typeof r.back === "string" && cardBackSkin(r.back) ? r.back : DEFAULT_SKIN_ID,
    plate: typeof r.plate === "string" && plateSkin(r.plate) ? r.plate : DEFAULT_SKIN_ID,
    prop: typeof r.prop === "string" && propSkin(r.prop) ? r.prop : DEFAULT_SKIN_ID,
  };
}

/** CSS `background` for a pattern — the 2D card backs and the picker swatches. */
export function patternCss(pattern: SkinPattern, [a, b]: [string, string]): string {
  switch (pattern) {
    case "diag":
      return `repeating-linear-gradient(135deg,${a} 0px,${a} 6px,${b} 6px,${b} 12px)`;
    case "diamond":
      return `repeating-linear-gradient(45deg,${b} 0 2px,transparent 2px 10px),repeating-linear-gradient(-45deg,${b} 0 2px,transparent 2px 10px),${a}`;
    case "dots":
      return `radial-gradient(circle,${b} 1.6px,transparent 2px) 0 0/9px 9px,${a}`;
    case "waves":
      return `radial-gradient(circle at 50% 100%,transparent 5px,${b} 5px,${b} 7px,transparent 7px) 0 0/14px 8px,${a}`;
    case "grid":
      return `linear-gradient(${b} 1.5px,transparent 1.5px) 0 0/10px 10px,linear-gradient(90deg,${b} 1.5px,transparent 1.5px) 0 0/10px 10px,${a}`;
    default:
      return a;
  }
}

/** Draws `pattern` over a `size`×`size` canvas area — the 3D card backs and felt textures. */
export function drawPattern(ctx: CanvasRenderingContext2D, pattern: SkinPattern, [a, b]: [string, string], w: number, h: number, step: number): void {
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = b;
  ctx.fillStyle = b;
  ctx.lineWidth = Math.max(1, step / 5);
  ctx.beginPath();
  if (pattern === "diag") {
    for (let x = -h; x < w; x += step) {
      ctx.moveTo(x, h);
      ctx.lineTo(x + h, 0);
    }
  } else if (pattern === "diamond") {
    for (let x = -h; x < w + h; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
      ctx.moveTo(x, h);
      ctx.lineTo(x + h, 0);
    }
  } else if (pattern === "grid") {
    for (let x = 0; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
  } else if (pattern === "waves") {
    for (let y = step / 2; y < h; y += step) {
      for (let x = 0; x < w; x += step) ctx.arc(x + step / 2, y, step / 2.4, Math.PI, 2 * Math.PI);
      ctx.moveTo(0, y + step);
    }
  } else if (pattern === "dots") {
    for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) {
      ctx.moveTo(x + step / 6, y);
      ctx.arc(x, y, step / 6, 0, 2 * Math.PI);
    }
    ctx.fill();
    return;
  }
  ctx.stroke();
}
