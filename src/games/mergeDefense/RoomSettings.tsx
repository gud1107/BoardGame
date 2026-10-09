import {
  DIFFICULTIES,
  DIFFICULTY_COUNT,
  DIFFICULTY_HP,
  LIMIT_CHOICES,
  loadLimit,
  MAP_IDS,
  MAPS,
  type Difficulty,
  type MapId,
  type GameMode,
} from "./engine";
import { bestAcrossMaps, type BestByMap } from "./bestWave";

/** What the host picked: a map, or 🎲 — a random map drawn when the match starts. */
export type MapChoice = MapId | "random";

export const DIFFICULTY_LABEL: Record<Difficulty, { emoji: string; name: string; desc: string }> = {
  easy: { emoji: "🌱", name: "쉬움", desc: `체력 ×${DIFFICULTY_HP.easy}` },
  normal: { emoji: "⚖️", name: "보통", desc: "기본" },
  hard: { emoji: "🔥", name: "어려움", desc: `체력 ×${DIFFICULTY_HP.hard} · 수 ×${DIFFICULTY_COUNT.hard}` },
};

/** Tiny road + pad sketch of a map, for the picker (🎲 = a question-mark card). */
export function MapThumb({ id, className = "" }: { id: MapChoice; className?: string }) {
  if (id === "random") {
    return (
      <svg viewBox="0 0 400 280" className={`h-auto w-full rounded-md ${className}`} aria-hidden>
        <rect width="400" height="280" rx="24" fill="#3b2a5c" />
        <text x="200" y="185" textAnchor="middle" fontSize="150" fontWeight="900" fill="#e9d5ff">?</text>
      </svg>
    );
  }
  const m = MAPS[id];
  return (
    <svg viewBox="0 0 400 280" className={`h-auto w-full rounded-md ${className}`} aria-hidden>
      <rect width="400" height="280" rx="24" fill={m.grass[1]} />
      <polygon points={m.path.map((p) => p.join(",")).join(" ")} fill="none" stroke="#c8a06a" strokeWidth="30" strokeLinejoin="round" />
      {m.slots.map(([x, y], i) => (
        <rect key={i} x={x - 22} y={y - 22} width="44" height="44" rx="9" fill="#94a3b8" opacity="0.9" />
      ))}
      <circle cx={m.path[0][0]} cy={m.path[0][1]} r="20" fill="#a855f7" />
    </svg>
  );
}

/** Map + difficulty + elimination-limit pickers, shared by the create form and the host's waiting room. */
export default function RoomSettings({
  mode,
  onMode,
  best,
  difficulty,
  limit,
  playerCount,
  onDifficulty,
  onLimit,
  map,
  onMap,
  compact = false,
}: {
  mode: GameMode;
  onMode: (m: GameMode) => void;
  /** This mode's records per map. */
  best: BestByMap;
  difficulty: Difficulty;
  limit: number | null;
  playerCount: number;
  onDifficulty: (d: Difficulty) => void;
  onLimit: (l: number | null) => void;
  map: MapChoice;
  onMap: (m: MapChoice) => void;
  compact?: boolean;
}) {
  const pill = (on: boolean, tone: "orange" | "rose") =>
    `rounded-xl border px-1 py-1.5 text-center transition ${
      on
        ? tone === "orange"
          ? "border-orange-400 bg-orange-500/15 text-white light:bg-orange-50 light:text-slate-900"
          : "border-rose-400 bg-rose-500/15 text-white light:bg-rose-50 light:text-slate-900"
        : "border-white/10 text-white/60 hover:border-white/30 light:border-slate-200 light:text-slate-500"
    }`;
  const shownBest = map === "random" ? bestAcrossMaps(best) : best[map];
  const bestWhere = map === "random" ? "전 맵 " : "";
  return (
    <div className={`flex flex-col ${compact ? "gap-2" : "gap-4"} text-sm break-keep text-white/70 light:text-slate-600`}>
      <div className="flex flex-col gap-1.5">
        모드
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              ["survival", "🛡️ 생존전", "같은 웨이브를 막으며 버티기"],
              ["versus", "⚔️ 유닛 대결", "유닛·몬스터를 상대 길로 보내 공격"],
            ] as const
          ).map(([value, label, desc]) => (
            <button key={value} type="button" onClick={() => onMode(value)} aria-pressed={mode === value} className={`${pill(mode === value, "orange")} px-2 text-left`}>
              <span className="block text-sm font-bold">{label}</span>
              {!compact && <span className="block text-[11px] opacity-75">{desc}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        🗺️ 맵
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {[...MAP_IDS, "random" as const].map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onMap(id)}
              aria-pressed={map === id}
              className={`${pill(map === id, "orange")} flex flex-col items-center gap-1 px-1.5 ${id === "random" ? "col-span-2 sm:col-span-1" : ""}`}
            >
              {!compact && <MapThumb id={id} className={id === "random" ? "max-w-[50%] sm:max-w-none" : ""} />}
              <span className="block text-sm font-bold">{id === "random" ? "🎲 랜덤 맵" : `${MAPS[id].emoji} ${MAPS[id].name}`}</span>
              <span className="block text-[10px] opacity-75">{id === "random" ? "시작할 때 뽑아요" : `칸 ${MAPS[id].slots.length}개`}</span>
            </button>
          ))}
        </div>
        {!compact && (
          <span className="text-[11px] text-white/40 light:text-slate-400">
            {map === "random" ? "게임이 시작될 때 4개 맵 중 하나를 무작위로 골라요(바로 전 판 맵은 빼고)." : MAPS[map].desc} 최고 기록은 맵마다 따로 저장돼요.
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        🌊 웨이브 난이도
        <div className="grid grid-cols-3 gap-1.5">
          {DIFFICULTIES.map((d) => (
            <button key={d} type="button" onClick={() => onDifficulty(d)} aria-pressed={difficulty === d} className={pill(difficulty === d, "orange")}>
              <span className="block text-sm font-bold">
                {DIFFICULTY_LABEL[d].emoji} {DIFFICULTY_LABEL[d].name}
              </span>
              <span className="block text-[10px] opacity-75">{DIFFICULTY_LABEL[d].desc}</span>
              <span className={`block text-[10px] font-semibold ${shownBest[d] ? "text-amber-300 light:text-amber-600" : "opacity-40"}`}>
                🏅 {shownBest[d] ? `${bestWhere}${mode === "versus" ? "대결" : "생존"} 최고 W${shownBest[d]}` : "기록 없음"}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        💀 탈락 기준 (내 길의 몬스터 수)
        <div className="grid grid-cols-5 gap-1.5">
          {([null, ...LIMIT_CHOICES] as (number | null)[]).map((value) => (
            <button key={value ?? "auto"} type="button" onClick={() => onLimit(value)} aria-pressed={limit === value} className={pill(limit === value, "rose")}>
              <span className="block text-sm font-bold">{value === null ? "자동" : value}</span>
              <span className="block text-[10px] opacity-75">
                {value === null ? `${loadLimit(playerCount)}마리` : value <= 35 ? "짧게" : value <= 45 ? "빠듯" : value <= 55 ? "보통" : "여유"}
              </span>
            </button>
          ))}
        </div>
        {!compact && (
          <span className="text-[11px] text-white/40 light:text-slate-400">
            자동 = 인원별 기본값(2인 {loadLimit(2)} · 3인 {loadLimit(3)} · 4인 {loadLimit(4)}마리). 낮을수록 빨리 끝나요.
          </span>
        )}
      </div>
    </div>
  );
}
