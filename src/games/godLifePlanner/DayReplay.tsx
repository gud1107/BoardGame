"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { ACTIVITY_INFO, BLOCK_INFO, OPPORTUNITY_BY_ID, TEMPTATIONS, TRACKS, TRACK_INFO, TUNING, type Track } from "./data";
import { resistCost, type BlockOutcome, type DayRecord, type GameState, type Tracks } from "./engine";

/**
 * 하루 재생 — 내가 짠 계획이 B1(0시)부터 B8(24시)까지 실행되며 체력·멘탈·트랙이 어떻게 변하는지
 * 한 블록씩 애니메이션으로 보여 준다. 실제 결과(`dayResult`)와 계획 미리보기(`previewDay`)가 같은
 * `DayRecord`를 쓰므로 선택을 바꾸면 영상도 그대로 바뀐다. 표시만 하고 상태는 건드리지 않는다.
 */

interface Props {
  state: GameState;
  rec: DayRecord;
  /** 마감 뒤 트랙(수면 부족·생일 등 마감 보정 포함) */
  endTracks: Tracks;
  /** 미리보기면 약속 성사·기회 카드 경쟁이 빠진 예상이라고 알린다 */
  preview?: boolean;
  /** true면 마운트될 때 자동 재생 */
  autoPlay?: boolean;
  onClose?: () => void;
}

interface Frame {
  label: string;
  sub: string;
  hp: number;
  mp: number;
  tracks: Tracks;
  outcome: BlockOutcome | null;
  /** 떠오르는 변화 표시 */
  pops: { text: string; tone: "good" | "bad" | "info" }[];
  collapse: "exhausted" | "burnout" | null;
}

// 시간대별 하늘(심야 → 새벽 → 아침 → 낮 → 저녁 → 밤)
const SKY = [
  "linear-gradient(180deg,#0b1026,#1e1b4b)",
  "linear-gradient(180deg,#1e1b4b,#4c1d95 70%,#9d174d)",
  "linear-gradient(180deg,#fb923c,#fcd34d 60%,#fde68a)",
  "linear-gradient(180deg,#38bdf8,#7dd3fc 70%,#bae6fd)",
  "linear-gradient(180deg,#0ea5e9,#38bdf8 60%,#a5f3fc)",
  "linear-gradient(180deg,#f59e0b,#fbbf24 60%,#fde68a)",
  "linear-gradient(180deg,#7c3aed,#db2777 65%,#f97316)",
  "linear-gradient(180deg,#0f172a,#312e81)",
];
const SKY_START = "linear-gradient(180deg,#334155,#475569)";
const SKY_END = "linear-gradient(180deg,#111827,#1f2937)";
const NIGHT = new Set([0, 1, 7]);

const MOTION: Record<string, string> = {
  sleep: "glr-sleep 2.4s ease-in-out infinite",
  study: "glr-bob 1.1s ease-in-out infinite",
  exercise: "glr-jump 0.55s ease-in-out infinite",
  work: "glr-type 0.25s linear infinite",
  meet: "glr-sway 1.2s ease-in-out infinite",
  rest: "glr-bob 2.2s ease-in-out infinite",
  temptation: "glr-wobble 0.9s ease-in-out infinite",
  empty: "none",
};

function clampG(n: number) {
  return Math.max(0, Math.min(TUNING.gaugeMax, n));
}

function buildFrames(state: GameState, rec: DayRecord, endTracks: Tracks): Frame[] {
  const start: Tracks = rec.startTracks ? { ...rec.startTracks } : { ...endTracks };
  const frames: Frame[] = [];
  const card = TEMPTATIONS[rec.temptationId];
  // 아침: 유혹 저항 비용 · 즉시형 유혹(블록을 차지하지 않음)
  let hp = rec.startHp;
  let mp = rec.startMp;
  const morning = { ...start };
  const mPops: Frame["pops"] = [];
  if (rec.plan.temptation === "resist") {
    const c = resistCost(state);
    mp = clampG(mp - c);
    mPops.push({ text: `🛡️ 유혹 참기 💗−${c}`, tone: "info" });
  } else if (rec.plan.instant && card) {
    hp = clampG(hp + (card.effect.hp ?? 0));
    mp = clampG(mp + (card.effect.mp ?? 0));
    for (const t of TRACKS) morning[t] = Math.max(0, morning[t] + (card.effect.tracks?.[t] ?? 0));
    mPops.push({ text: `${card.emoji} ${card.name}에 넘어감`, tone: "bad" });
  }
  frames.push({ label: "☀️ 하루 시작", sub: `⚡${rec.startHp} 💗${rec.startMp}로 출발`, hp, mp, tracks: morning, outcome: null, pops: mPops, collapse: null });

  let tracks = morning;
  let prevHp = hp;
  let prevMp = mp;
  rec.outcomes.forEach((o, b) => {
    tracks = { ...tracks };
    for (const t of TRACKS) tracks[t] = Math.max(0, tracks[t] + (o.gains[t] ?? 0));
    const pops: Frame["pops"] = [];
    if (o.kind === "fail") pops.push({ text: "❌ 비용 부족 — 실패", tone: "bad" });
    if (o.kind === "void") pops.push({ text: "🫥 쓰러져서 무효", tone: "bad" });
    if (o.kind === "nap") pops.push({ text: "💤 쓰러져 잠듦", tone: "bad" });
    for (const t of TRACKS) {
      const g = o.gains[t];
      if (g) pops.push({ text: `${TRACK_INFO[t].emoji} ${TRACK_INFO[t].name} ${g > 0 ? "+" : "−"}${Math.abs(g)}`, tone: g > 0 ? "good" : "bad" });
    }
    const dh = o.hp - prevHp;
    const dm = o.mp - prevMp;
    if (dh) pops.push({ text: `⚡ ${dh > 0 ? "+" : "−"}${Math.abs(dh)}`, tone: dh > 0 ? "good" : "bad" });
    if (dm) pops.push({ text: `💗 ${dm > 0 ? "+" : "−"}${Math.abs(dm)}`, tone: dm > 0 ? "good" : "bad" });
    if (o.matched) pops.push({ text: "🤝 약속 성사!", tone: "good" });
    if (o.opp) pops.push({ text: `${OPPORTUNITY_BY_ID[o.opp]?.emoji ?? "🍀"} ${OPPORTUNITY_BY_ID[o.opp]?.name ?? "기회 카드"}`, tone: "good" });
    if (o.noShow) pops.push({ text: "🙇 약속 펑크", tone: "bad" });
    if (o.overtime) pops.push({ text: "🌙 야근", tone: "info" });
    const collapse = o.hp === 0 && prevHp > 0 ? "exhausted" : o.mp === 0 && prevMp > 0 ? "burnout" : null;
    const name = o.cell === "temptation" ? (card ? `${card.emoji} ${card.name}` : "유혹") : `${ACTIVITY_INFO[o.cell].emoji} ${ACTIVITY_INFO[o.cell].name}`;
    frames.push({
      label: `${BLOCK_INFO[b].label} ${BLOCK_INFO[b].time} ${BLOCK_INFO[b].name}`,
      sub: name,
      hp: o.hp,
      mp: o.mp,
      tracks,
      outcome: o,
      pops,
      collapse,
    });
    prevHp = o.hp;
    prevMp = o.mp;
  });

  const ePops: Frame["pops"] = [];
  if (rec.exhausted) ePops.push({ text: "🥵 오늘 탈진 −3점 · 내일 몸살", tone: "bad" });
  if (rec.burnout) ePops.push({ text: "😵 오늘 번아웃 −3점 · 내일 무기력", tone: "bad" });
  const dh = rec.endHp - prevHp;
  const dm = rec.endMp - prevMp;
  if (dh) ePops.push({ text: `마감 보정 ⚡${dh > 0 ? "+" : "−"}${Math.abs(dh)}`, tone: dh > 0 ? "good" : "bad" });
  if (dm) ePops.push({ text: `마감 보정 💗${dm > 0 ? "+" : "−"}${Math.abs(dm)}`, tone: dm > 0 ? "good" : "bad" });
  for (const t of TRACKS) {
    const d = endTracks[t] - tracks[t];
    if (d) ePops.push({ text: `마감 보정 ${TRACK_INFO[t].emoji}${d > 0 ? "+" : "−"}${Math.abs(d)}`, tone: d > 0 ? "good" : "bad" });
  }
  const scoreLine = rec.scoreBefore && rec.scoreAfter ? `🏆 ${rec.scoreBefore.total} → ${rec.scoreAfter.total}점 (${rec.scoreAfter.total - rec.scoreBefore.total >= 0 ? "+" : "−"}${Math.abs(rec.scoreAfter.total - rec.scoreBefore.total)})` : "";
  frames.push({ label: "🌙 마감", sub: scoreLine || `성장 +${rec.growth}`, hp: rec.endHp, mp: rec.endMp, tracks: { ...endTracks }, outcome: null, pops: ePops, collapse: null });
  return frames;
}

function Bar({ value, max, color, flash }: { value: number; max: number; color: string; flash: number }) {
  return (
    <span className="relative block h-2 overflow-hidden rounded-full bg-black/30">
      <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.min(100, (value / max) * 100)}%`, transition: "width 0.55s cubic-bezier(.2,.9,.3,1.2)" }} />
      {flash !== 0 && <span key={`${flash}-${value}`} className={`absolute inset-0 ${flash > 0 ? "bg-white/40" : "bg-rose-500/50"}`} style={{ animation: "glr-flash 0.6s ease-out both" }} />}
    </span>
  );
}

export default function DayReplay({ state, rec, endTracks, preview, autoPlay = true, onClose }: Props) {
  const frames = useMemo(() => buildFrames(state, rec, endTracks), [state, rec, endTracks]);
  const reduced = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const [idx, setIdx] = useState(autoPlay && !reduced ? 0 : frames.length - 1);
  const [playing, setPlaying] = useState(autoPlay && !reduced);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const last = frames.length - 1;

  // 계획이 바뀌면(미리보기) 처음부터 다시
  const sig = useMemo(() => JSON.stringify([rec.plan.cells, rec.plan.temptation, rec.endHp, rec.endMp]), [rec]);
  const [prevSig, setPrevSig] = useState(sig);
  if (prevSig !== sig) {
    setPrevSig(sig);
    setIdx(0);
    setPlaying(!reduced);
  }
  const running = playing && idx < last;

  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setIdx((i) => Math.min(last, i + 1)), (idx === 0 ? 900 : 1150) / speed);
    return () => window.clearTimeout(t);
  }, [running, idx, last, speed]);

  // 효과음: 블록마다 작은 틱, 성사·기회 카드는 딩, 붕괴는 버즈
  const soundIdx = useRef(-1);
  useEffect(() => {
    if (!playing || soundIdx.current === idx) return;
    // 재생 중 지나간 프레임만(마지막 프레임 도착 포함)
    soundIdx.current = idx;
    const f = frames[idx];
    const sound = getSoundEngine();
    if (f.collapse) sound.playWrongBuzz();
    else if (f.outcome?.matched || f.outcome?.opp) sound.playCorrectDing();
    else sound.playUiClickTick();
  }, [idx, playing, frames]);

  const f = frames[idx];
  const prev = frames[Math.max(0, idx - 1)];
  const blockIdx = idx >= 1 && idx <= 8 ? idx - 1 : null;
  const sky = blockIdx !== null ? SKY[blockIdx] : idx === 0 ? SKY_START : SKY_END;
  const cell = f.outcome?.cell ?? null;
  const dim = f.outcome && (f.outcome.kind === "fail" || f.outcome.kind === "void" || f.outcome.kind === "nap");
  const actor = !f.outcome ? (idx === 0 ? "🥱" : "😌") : f.outcome.kind === "nap" ? "💤" : f.outcome.kind === "void" ? "🫥" : f.outcome.kind === "fail" ? "😣" : cell === "temptation" ? (TEMPTATIONS[rec.temptationId]?.emoji ?? "😈") : ACTIVITY_INFO[cell!].emoji;
  const motion = !f.outcome || dim ? "none" : MOTION[cell!];
  const clockPct = blockIdx !== null ? ((blockIdx + 0.5) / 8) * 100 : idx === 0 ? 0 : 100;
  const celestial = blockIdx !== null && !NIGHT.has(blockIdx) ? "☀️" : "🌙";

  function restart() {
    setIdx(0);
    setPlaying(true);
  }

  return (
    <div className="flex flex-col gap-2" data-glr>
      <style>{KEYFRAMES}</style>
      <div
        className="relative overflow-hidden rounded-2xl border border-white/10 text-white light:border-slate-200"
        style={{ background: sky, transition: "background 0.8s ease" }}
      >
        {/* 시계 막대 */}
        <div className="relative mx-3 mt-3 h-6">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-black/25" />
          <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/70" style={{ width: `${clockPct}%`, transition: "width 0.8s ease" }} />
          <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg drop-shadow" style={{ left: `${clockPct}%`, transition: "left 0.8s ease" }}>
            {celestial}
          </span>
        </div>
        <div className="flex justify-between px-3 text-[10px] font-semibold text-white/80 drop-shadow">
          <span>0시</span>
          <span>6시</span>
          <span>12시</span>
          <span>18시</span>
          <span>24시</span>
        </div>

        {/* 무대 */}
        <div key={`stage-${idx}`} className="relative flex h-40 flex-col items-center justify-center sm:h-44" style={f.collapse ? { animation: "glr-shake 0.5s ease both" } : undefined}>
          {f.collapse && <div className="pointer-events-none absolute inset-0 bg-rose-600/40" style={{ animation: "glr-flash 0.9s ease-out both" }} />}
          {cell === "sleep" && !dim && (
            <span className="pointer-events-none absolute left-1/2 top-6 ml-8 text-lg font-bold text-white/90" style={{ animation: "glr-zzz 1.6s ease-out infinite" }}>
              Z
            </span>
          )}
          {cell === "rest" && !dim && (
            <span className="pointer-events-none absolute left-1/2 top-6 ml-6 text-base" style={{ animation: "glr-zzz 1.8s ease-out infinite" }}>
              ♨️
            </span>
          )}
          <span key={`actor-${idx}`} className={`text-6xl drop-shadow-lg sm:text-7xl ${dim ? "opacity-70 grayscale" : ""}`} style={{ animation: `glr-enter 0.45s cubic-bezier(.2,.9,.3,1.3) both${motion !== "none" ? `, ${motion} 0.45s` : ""}` }}>
            {actor}
          </span>
          <p key={`label-${idx}`} className="mt-2 rounded-full bg-black/35 px-3 py-0.5 text-xs font-bold drop-shadow" style={{ animation: "glr-fade 0.35s ease both" }}>
            {f.label} · {f.sub}
          </p>
          {f.collapse && (
            <p className="absolute top-3 rounded-full bg-rose-600 px-3 py-1 text-sm font-black shadow-lg" style={{ animation: "glr-enter 0.4s ease both" }}>
              {f.collapse === "exhausted" ? "🥵 탈진! −3점" : "😵 번아웃! −3점"}
            </p>
          )}
          {/* 떠오르는 변화 */}
          <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap justify-center gap-1">
            {f.pops.map((p, i) => (
              <span
                key={`pop-${idx}-${i}`}
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold shadow ${p.tone === "good" ? "bg-emerald-500/90" : p.tone === "bad" ? "bg-rose-500/90" : "bg-slate-800/80"}`}
                style={{ animation: `glr-pop 0.5s cubic-bezier(.2,.9,.3,1.4) both`, animationDelay: `${120 + i * 110}ms` }}
              >
                {p.text}
              </span>
            ))}
          </div>
        </div>

        {/* 게이지 · 트랙 */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 bg-black/35 px-3 py-2.5 text-[11px] sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <span className="flex justify-between">
              <span>⚡ 체력</span>
              <b className="tabular-nums">{f.hp}</b>
            </span>
            <Bar value={f.hp} max={TUNING.gaugeMax} color={f.hp <= 2 ? "bg-rose-500" : "bg-rose-400"} flash={Math.sign(f.hp - prev.hp) * (idx + 1)} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="flex justify-between">
              <span>💗 멘탈</span>
              <b className="tabular-nums">{f.mp}</b>
            </span>
            <Bar value={f.mp} max={TUNING.gaugeMax} color={f.mp <= 2 ? "bg-rose-500" : "bg-violet-400"} flash={Math.sign(f.mp - prev.mp) * (idx + 1)} />
          </div>
          {TRACKS.map((t: Track) => (
            <div key={t} className="flex flex-col gap-0.5">
              <span className="flex justify-between">
                <span>
                  {TRACK_INFO[t].emoji} {TRACK_INFO[t].name}
                </span>
                <b className="tabular-nums">{f.tracks[t]}</b>
              </span>
              <Bar value={f.tracks[t]} max={TUNING.trackMax} color="bg-emerald-400" flash={Math.sign(f.tracks[t] - prev.tracks[t]) * (idx + 1)} />
            </div>
          ))}
        </div>

        {/* 블록 진행 띠 */}
        <div className="grid grid-cols-8 gap-0.5 bg-black/45 px-2 py-1.5">
          {rec.outcomes.map((o, b) => {
            const shown = idx >= b + 1;
            const now = blockIdx === b;
            const emoji = o.cell === "temptation" ? (TEMPTATIONS[rec.temptationId]?.emoji ?? "😈") : ACTIVITY_INFO[o.cell].emoji;
            return (
              <button
                key={`strip-${b}`}
                onClick={() => {
                  setPlaying(false);
                  setIdx(b + 1);
                }}
                className={`flex flex-col items-center rounded-md py-0.5 text-[10px] transition ${now ? "bg-white/30 ring-1 ring-white" : shown ? "bg-white/10" : "bg-white/[0.03] opacity-50"}`}
                aria-label={`${BLOCK_INFO[b].label} 보기`}
              >
                <span className="text-sm leading-none">{shown ? (o.kind === "fail" ? "❌" : emoji) : "·"}</span>
                <span className="leading-tight text-white/70">{BLOCK_INFO[b].label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 조작 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {running ? (
          <button onClick={() => setPlaying(false)} className={BTN}>
            ⏸ 일시정지
          </button>
        ) : idx >= last ? (
          <button onClick={restart} className={BTN}>
            🔁 다시 보기
          </button>
        ) : (
          <button onClick={() => setPlaying(true)} className={BTN}>
            ▶ 재생
          </button>
        )}
        <button onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))} className={BTN}>
          ⏩ {speed}배속
        </button>
        {idx < last && (
          <button
            onClick={() => {
              setPlaying(false);
              setIdx(last);
            }}
            className={BTN}
          >
            ⏭ 결과로
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className={BTN}>
            ✕ 닫기
          </button>
        )}
        {preview && <span className="text-[11px] text-white/45 light:text-slate-400">미리보기 — 약속 성사·기회 카드 경쟁은 공개 후 결정돼요</span>}
      </div>
    </div>
  );
}

const BTN =
  "rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400";

const KEYFRAMES = `
@keyframes glr-enter{0%{opacity:0;transform:translateY(14px) scale(.6)}100%{opacity:1;transform:none}}
@keyframes glr-fade{0%{opacity:0}100%{opacity:1}}
@keyframes glr-pop{0%{opacity:0;transform:translateY(10px) scale(.7)}100%{opacity:1;transform:none}}
@keyframes glr-flash{0%{opacity:1}100%{opacity:0}}
@keyframes glr-shake{0%,100%{transform:none}20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}
@keyframes glr-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes glr-jump{0%,100%{transform:translateY(0) scaleY(1)}40%{transform:translateY(-16px) scaleY(1.05)}90%{transform:translateY(0) scaleY(.92)}}
@keyframes glr-type{0%,100%{transform:translateX(0)}50%{transform:translateX(2px) rotate(-2deg)}}
@keyframes glr-sway{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}
@keyframes glr-wobble{0%,100%{transform:rotate(0) scale(1)}25%{transform:rotate(-10deg) scale(1.05)}75%{transform:rotate(10deg) scale(1.05)}}
@keyframes glr-sleep{0%,100%{transform:rotate(-4deg) translateY(0)}50%{transform:rotate(4deg) translateY(3px)}}
@keyframes glr-zzz{0%{opacity:0;transform:translate(0,8px) scale(.6)}30%{opacity:1}100%{opacity:0;transform:translate(14px,-26px) scale(1.2)}}
@media (prefers-reduced-motion: reduce){[data-glr] *{animation-duration:0.01ms !important;animation-iteration-count:1 !important}}
`;
