import {
  DIFFICULTIES,
  DIFFICULTY_COUNT,
  DIFFICULTY_HP,
  LIMIT_CHOICES,
  loadLimit,
  type Difficulty,
  type GameMode,
} from "./engine";
import type { BestWaves } from "./bestWave";

export const DIFFICULTY_LABEL: Record<Difficulty, { emoji: string; name: string; desc: string }> = {
  easy: { emoji: "🌱", name: "쉬움", desc: `체력 ×${DIFFICULTY_HP.easy}` },
  normal: { emoji: "⚖️", name: "보통", desc: "기본" },
  hard: { emoji: "🔥", name: "어려움", desc: `체력 ×${DIFFICULTY_HP.hard} · 수 ×${DIFFICULTY_COUNT.hard}` },
};

/** Difficulty + elimination-limit pickers, shared by the create form and the host's waiting room. */
export default function RoomSettings({
  mode,
  onMode,
  best,
  difficulty,
  limit,
  playerCount,
  onDifficulty,
  onLimit,
  compact = false,
}: {
  mode: GameMode;
  onMode: (m: GameMode) => void;
  best: BestWaves;
  difficulty: Difficulty;
  limit: number | null;
  playerCount: number;
  onDifficulty: (d: Difficulty) => void;
  onLimit: (l: number | null) => void;
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
        🌊 웨이브 난이도
        <div className="grid grid-cols-3 gap-1.5">
          {DIFFICULTIES.map((d) => (
            <button key={d} type="button" onClick={() => onDifficulty(d)} aria-pressed={difficulty === d} className={pill(difficulty === d, "orange")}>
              <span className="block text-sm font-bold">
                {DIFFICULTY_LABEL[d].emoji} {DIFFICULTY_LABEL[d].name}
              </span>
              <span className="block text-[10px] opacity-75">{DIFFICULTY_LABEL[d].desc}</span>
              <span className={`block text-[10px] font-semibold ${best[d] ? "text-amber-300 light:text-amber-600" : "opacity-40"}`}>
                🏅 {best[d] ? `${mode === "versus" ? "대결" : "생존"} 최고 W${best[d]}` : "기록 없음"}
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
