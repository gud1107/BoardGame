"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import {
  AIM_LIMIT,
  AIM_TIMEOUT_MS,
  computeRankings,
  currentSide,
  currentThrower,
  isLastStone,
  RUN_GRACE_MS,
  SCORE_PAUSE_MS,
  stonesLeft,
  stonesPerSide,
  type CurlingState,
  type EngineAction,
  type Seat,
  type ShotKey,
} from "./engine";
import SheetCanvas, { CALL_TAGS, PARTY_EMOJI, SIDE_COLORS, SIDE_NAMES_FFA, SIDE_NAMES_TEAM, SIDE_SYMBOLS, type AimView, type CallMark } from "./SheetCanvas";
import { predictionHit, stoneStayedIn, type Prediction, type PredictionBoard } from "./spectate";
import RulebookModal from "./RulebookModal";
import { curlingCues, getCurlingSound } from "./curlingSound";
import type { LiveEvent, LiveView } from "./live";
import { BACK_Y, HOG_Y, HOUSE_R, RELEASE_Y, STONE_R, weightForTravel, type PartyKind } from "./physics";

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const PRIMARY = "rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-500 disabled:opacity-40";
const AI_CALLS_KEY = "curling-ai-calls";
const CHIP = "rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600";

/* ── 공유 타입 ───────────────────────────────────────────────── */

export interface LiveInfo {
  turn: number;
  seat: number;
  side: number;
  passedTee: boolean;
  own: number;
  opp: number;
  who: number[];
}

export type ReactionKind = "clap" | "fire" | "gasp" | "lol" | "pray";
export const REACTIONS: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: "clap", emoji: "👏", label: "나이스" },
  { kind: "fire", emoji: "🔥", label: "가즈아" },
  { kind: "gasp", emoji: "😱", label: "헉" },
  { kind: "lol", emoji: "😂", label: "ㅋㅋ" },
  { kind: "pray", emoji: "🙏", label: "제발" },
];
export const REACTION_EMOJI: Record<ReactionKind, string> = Object.fromEntries(REACTIONS.map((r) => [r.kind, r.emoji])) as Record<ReactionKind, string>;
export const REACTION_TTL_MS = 2400;
export const REACT_COOLDOWN_MS = 2000;
export interface Reaction {
  id: string;
  seat: number;
  kind: ReactionKind;
  at: number;
}

export const PARTY_INFO: Record<PartyKind, { name: string; desc: string }> = {
  bomb: { name: "폭탄", desc: "멈추면 펑! 반경 1.25 m 스톤을 날리고 사라져요" },
  heavy: { name: "묵직이", desc: "무게 2배 — 세게 밀어내고 잘 안 밀려요" },
  sticky: { name: "끈끈이", desc: "처음 닿은 스톤과 그 자리에 철썩 붙어요" },
  swirl: { name: "회오리", desc: "2.4배로 크게 휘어요" },
  ghost: { name: "유령", desc: "하우스 전까지 다른 스톤을 통과해요" },
  magnet: { name: "자석", desc: "하우스 안에서 버튼 쪽으로 끌려가요" },
};

const CALLS: Record<ShotKey, { t: string; lines: string[] }> = {
  button: { t: "🎯 버튼!", lines: ["정중앙! 자로 잰 듯한 드로우!", "이게 바로 컬링이죠!", "핀 하이! 완벽해요!"] },
  freeze: { t: "🧊 프리즈!", lines: ["딱 붙었어요! 쳐내기 어렵겠는데요", "얼음처럼 붙여 놨어요"] },
  shot: { t: "👑 샷 스톤!", lines: ["지금 1번 스톤이에요!", "가장 가까운 자리를 차지했어요"] },
  house: { t: "🏠 하우스 안착", lines: ["하우스에 들어왔어요", "일단 점수권!"] },
  guard: { t: "🛡️ 가드", lines: ["앞을 막아 섰어요", "하우스 앞 자리 잡기"] },
  takeout: { t: "💥 테이크아웃!", lines: ["깔끔하게 쳐냈어요!", "탁! 나가세요~"] },
  hitStay: { t: "🎯 히트 앤 스테이!", lines: ["쳐내고 그 자리에 딱!", "교과서 같은 샷!"] },
  double: { t: "🔥 더블 테이크아웃!", lines: ["한 번에 두 개!", "관중석 난리 났습니다!"] },
  triple: { t: "🌪️ 트리플 테이크아웃!!", lines: ["세 개를 한 번에?!", "전설의 샷!"] },
  raise: { t: "⬆️ 레이즈!", lines: ["우리 스톤을 밀어 넣었어요!", "당구 같은 한 수!"] },
  ownGoal: { t: "😱 아군 오사!", lines: ["앗, 우리 편을…", "팀킬은 반칙… 아닙니다"] },
  stick: { t: "🍯 철썩!", lines: ["딱 달라붙었어요!", "끈적끈적~"] },
  bomb: { t: "💣 펑!", lines: ["폭탄 스톤 작렬!", "하우스가 쑥대밭!"] },
  through: { t: "💨 스루", lines: ["너무 셌어요!", "하우스를 그냥 지나갔어요"] },
  hog: { t: "🚫 호그 라인 미달", lines: ["조금만 더 셌으면…", "힘이 모자랐어요"] },
  side: { t: "↔️ 사이드 아웃", lines: ["벽에 닿았어요", "너무 휘었어요"] },
  nudge: { t: "🤏 톡", lines: ["살짝 건드리고 지나갔어요"] },
  fgz: { t: "🛡️ 프리 가드 존 위반", lines: ["원위치! 던진 스톤만 빠져요"] },
};

/** Weight boundaries for the gauge zones (straight line, no sweep). */
const W_HOG = weightForTravel(RELEASE_Y - HOG_Y + STONE_R);
const W_HOUSE = weightForTravel(RELEASE_Y - HOUSE_R - STONE_R);
const W_BACK = weightForTravel(RELEASE_Y - BACK_Y);

export function sideLabel(state: CurlingState, side: number, names: Record<Seat, string>): string {
  if (state.options.mode === "team") return `${SIDE_SYMBOLS[side]} ${SIDE_NAMES_TEAM[side]}`;
  return `${SIDE_SYMBOLS[side]} ${names[state.members[side][0]] ?? SIDE_NAMES_FFA[side]}`;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

/* ── 점수판 (중계 스타일) ─────────────────────────────────────── */

function Linescore({ state, names, viewerSeat }: { state: CurlingState; names: Record<Seat, string>; viewerSeat: Seat }) {
  const cols = Math.max(state.options.ends, state.history.length, state.end + 1);
  const mySide = viewerSeat >= 0 ? state.sideOf[viewerSeat] : -1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-center text-xs tabular-nums">
        <thead>
          <tr className="text-[10px] text-white/45 light:text-slate-400">
            <th className="px-1 py-0.5 text-left font-semibold">엔드</th>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i} className={`w-6 px-0.5 font-semibold ${i === state.end && state.phase !== "ended" ? "text-sky-300 light:text-sky-700" : ""}`}>
                {i >= state.options.ends ? "연" : i + 1}
              </th>
            ))}
            <th className="w-8 px-1 font-black">합</th>
          </tr>
        </thead>
        <tbody>
          {state.scores.map((total, side) => (
            <tr key={side} className={side === mySide ? "bg-sky-500/10" : ""}>
              <td className="max-w-[9rem] truncate px-1 py-0.5 text-left">
                <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: SIDE_COLORS[side] }} />
                <span className="font-bold text-white/85 light:text-slate-700">{sideLabel(state, side, names)}</span>
                {state.hammer === side && state.phase !== "ended" && <span title="해머 — 이 엔드의 마지막 스톤"> 🔨</span>}
              </td>
              {Array.from({ length: cols }, (_, i) => {
                const rec = state.history[i];
                const v = rec ? (rec.scorer === side ? rec.points : rec.scorer === null ? "·" : 0) : "";
                return (
                  <td key={i} className={`px-0.5 ${rec?.scorer === side ? "font-black text-amber-200 light:text-amber-700" : "text-white/45 light:text-slate-400"}`}>
                    {v}
                  </td>
                );
              })}
              <td className="px-1 text-sm font-black text-white light:text-slate-900">{total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 조준 패널 ──────────────────────────────────────────────── */

function PowerGauge({ charge }: { charge: number | null }) {
  const zones = [
    { from: 0, to: W_HOG, label: "미달", cls: "bg-slate-500/50" },
    { from: W_HOG, to: W_HOUSE, label: "가드", cls: "bg-sky-500/60" },
    { from: W_HOUSE, to: W_BACK, label: "하우스", cls: "bg-rose-500/70" },
    { from: W_BACK, to: 1, label: "테이크아웃", cls: "bg-amber-500/60" },
  ];
  return (
    <div className="relative h-7 overflow-hidden rounded-lg border border-white/15 light:border-slate-300">
      {zones.map((z) => (
        <div key={z.label} className={`absolute inset-y-0 flex items-center justify-center text-[10px] font-bold text-white ${z.cls}`} style={{ left: `${z.from * 100}%`, width: `${(z.to - z.from) * 100}%` }}>
          <span className="truncate px-0.5 drop-shadow">{z.label}</span>
        </div>
      ))}
      {charge !== null && <div className="absolute inset-y-0 w-1 -translate-x-1/2 bg-white shadow-[0_0_8px_2px_rgba(255,255,255,0.8)]" style={{ left: `${charge * 100}%` }} />}
    </div>
  );
}

function AimPanel({
  state,
  aimX,
  spin,
  useCard,
  charge,
  onAim,
  onSpin,
  onCard,
  onChargeStart,
  onChargeEnd,
}: {
  state: CurlingState;
  aimX: number;
  spin: 1 | -1;
  useCard: boolean;
  charge: number | null;
  onAim: (x: number) => void;
  onSpin: (s: 1 | -1) => void;
  onCard: (v: boolean) => void;
  onChargeStart: () => void;
  onChargeEnd: (cancel: boolean) => void;
}) {
  const side = currentSide(state);
  const card = state.options.party ? state.cards[side] : null;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onAim(Math.max(-AIM_LIMIT, Math.round((aimX - 0.05) * 100) / 100))} className="h-10 w-10 shrink-0 rounded-xl border border-white/15 text-lg text-white/80 light:border-slate-300 light:text-slate-700" aria-label="브룸 왼쪽으로">
          ◀
        </button>
        <div className="min-w-0 flex-1 text-center text-xs text-white/60 light:text-slate-500">
          브룸 <b className="text-white light:text-slate-900">{aimX === 0 ? "가운데" : `${aimX < 0 ? "왼쪽" : "오른쪽"} ${Math.abs(aimX).toFixed(2)} m`}</b>
          <span className="block text-[10px] text-white/40 light:text-slate-400">시트를 좌우로 끌어도 돼요</span>
        </div>
        <button type="button" onClick={() => onAim(Math.min(AIM_LIMIT, Math.round((aimX + 0.05) * 100) / 100))} className="h-10 w-10 shrink-0 rounded-xl border border-white/15 text-lg text-white/80 light:border-slate-300 light:text-slate-700" aria-label="브룸 오른쪽으로">
          ▶
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {([-1, 1] as const).map((sp) => (
          <button
            key={sp}
            type="button"
            onClick={() => onSpin(sp)}
            className={`rounded-xl border px-2 py-2 text-xs font-bold transition ${spin === sp ? "border-sky-400 bg-sky-500/20 text-sky-100 light:text-sky-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
          >
            {sp === -1 ? "↺ 반시계 · 왼쪽으로 휨" : "↻ 시계 · 오른쪽으로 휨"}
          </button>
        ))}
      </div>
      {card && (
        <button
          type="button"
          onClick={() => onCard(!useCard)}
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition ${useCard ? "border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100 light:text-fuchsia-800" : "border-white/15 text-white/70 light:border-slate-300 light:text-slate-600"}`}
        >
          <span className="text-2xl">{PARTY_EMOJI[card]}</span>
          <span className="min-w-0 flex-1">
            <b className="block text-sm">
              파티 스톤: {PARTY_INFO[card].name} {useCard ? "— 이번에 사용!" : "(누르면 이번 투구에 사용)"}
            </b>
            {PARTY_INFO[card].desc}
          </span>
        </button>
      )}
      <PowerGauge charge={charge} />
      <button
        type="button"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onChargeStart();
        }}
        onPointerUp={() => onChargeEnd(false)}
        onPointerCancel={() => onChargeEnd(true)}
        onContextMenu={(e) => e.preventDefault()}
        className={`min-h-16 touch-none rounded-2xl text-base font-black text-white shadow-lg transition select-none ${charge !== null ? "scale-[0.98] bg-rose-600" : "bg-sky-600 hover:bg-sky-500"}`}
      >
        {charge !== null ? `놓으면 투구! ${Math.round(charge * 100)}%` : "🥌 꾹 눌러 힘 모으기 → 떼면 투구"}
      </button>
    </div>
  );
}

/* ── 쓸기 패널 ──────────────────────────────────────────────── */

function SweepPad({ allowed, lockedReason, mine, ownTeam, opp, onSweep, title }: { allowed: boolean; lockedReason: string; mine: number; ownTeam: number; opp: number; onSweep: () => void; title: string }) {
  const [flash, setFlash] = useState(0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs text-white/70 light:text-slate-600">
        <b className="text-white light:text-slate-900">{title}</b>
        <span className="flex items-center gap-2">
          <span>던진 편 {Math.round(ownTeam * 100)}%</span>
          <span>상대 {Math.round(opp * 100)}%</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
        <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-200 transition-[width] duration-150" style={{ width: `${Math.round(mine * 100)}%` }} />
      </div>
      <button
        type="button"
        disabled={!allowed}
        onPointerDown={() => {
          if (!allowed) return;
          setFlash((f) => f + 1);
          onSweep();
        }}
        onContextMenu={(e) => e.preventDefault()}
        className="relative min-h-20 touch-manipulation overflow-hidden rounded-2xl bg-gradient-to-b from-cyan-500 to-sky-700 text-xl font-black text-white shadow-lg transition select-none active:scale-[0.97] disabled:from-slate-600 disabled:to-slate-700 disabled:text-white/50"
      >
        <span key={flash} className="inline-block animate-[curl-wiggle_0.18s_ease-out]">
          {allowed ? "🧹 쓸어! 쓸어! (연타)" : `🔒 ${lockedReason}`}
        </span>
      </button>
      <style>{`@keyframes curl-wiggle{0%{transform:rotate(-8deg) scale(1.08)}100%{transform:rotate(0) scale(1)}}`}</style>
    </div>
  );
}

/* ── 리액션 ─────────────────────────────────────────────────── */

function ReactionBar({ onReact }: { onReact: (k: ReactionKind) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {REACTIONS.map((r) => (
        <button
          key={r.kind}
          type="button"
          onClick={() => onReact(r.kind)}
          aria-label={r.label}
          title={r.label}
          className="flex h-10 min-w-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-2.5 text-lg transition hover:scale-110 active:scale-95 light:border-slate-300 light:bg-white"
        >
          {r.emoji}
        </button>
      ))}
    </div>
  );
}

function ReactionLayer({ reactions, names, playerCount, viewerSeat, nowMs }: { reactions: Reaction[]; names: Record<Seat, string>; playerCount: number; viewerSeat: Seat; nowMs: number }) {
  const shown = reactions.filter((r) => nowMs - r.at < REACTION_TTL_MS);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <style>{`@keyframes curl-float{0%{transform:translate(-50%,0) scale(.6);opacity:0}12%{transform:translate(-50%,-14px) scale(1.15);opacity:1}75%{opacity:1}100%{transform:translate(-50%,-150px) scale(1);opacity:0}}`}</style>
      {shown.map((r) => {
        const x = 10 + (playerCount > 1 ? r.seat / (playerCount - 1) : 0.5) * 75;
        return (
          <div key={r.id} className="absolute bottom-6 flex flex-col items-center" style={{ left: `${x}%`, animation: `curl-float ${REACTION_TTL_MS}ms ease-out forwards` }}>
            <span className="text-4xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">{REACTION_EMOJI[r.kind]}</span>
            <span className="max-w-24 truncate rounded-full bg-black/60 px-2 text-[10px] font-bold text-white">{r.seat === viewerSeat ? "나" : (names[r.seat] ?? "")}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── 남의 차례 (§17) ────────────────────────────────────────── */

function SpectatorPanel({
  teammate,
  throwerName,
  throwerColor,
  callTag,
  onCallTag,
  predictions,
  predictLocked,
  viewerSeat,
  onPredict,
  onReact,
}: {
  teammate: boolean;
  throwerName: string;
  throwerColor: string;
  callTag: CallMark["tag"];
  onCallTag: (t: CallMark["tag"]) => void;
  predictions: PredictionBoard;
  predictLocked: boolean;
  viewerSeat: Seat;
  onPredict: (p: Prediction) => void;
  onReact: (k: ReactionKind) => void;
}) {
  const mine = predictions.picks[viewerSeat];
  const counts = { in: 0, out: 0 };
  for (const p of Object.values(predictions.picks)) counts[p] += 1;
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-center text-sm text-white/70 light:text-slate-600">
        <b style={{ color: throwerColor }}>{throwerName}</b>님이 조준 중이에요.
      </p>
      {teammate && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-bold text-white/80 light:text-slate-700">📣 스킵 콜 — 고르고 시트를 탭하면 우리 팀에게 보여요</p>
          <div className="grid grid-cols-3 gap-1.5">
            {(Object.keys(CALL_TAGS) as CallMark["tag"][]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onCallTag(t)}
                className={`rounded-xl border px-1 py-2 text-xs font-bold transition ${callTag === t ? "border-sky-400 bg-sky-500/20 text-sky-100 light:text-sky-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
              >
                {CALL_TAGS[t].emoji} {CALL_TAGS[t].label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-bold text-white/80 light:text-slate-700">
          🔮 예측 — 이 스톤, 하우스에 남을까? {predictLocked && <span className="font-normal text-white/50 light:text-slate-400">(마감)</span>}
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {(["in", "out"] as const).map((p) => (
            <button
              key={p}
              type="button"
              disabled={predictLocked}
              onClick={() => onPredict(p)}
              className={`rounded-xl border px-2 py-2 text-xs font-bold transition disabled:opacity-60 ${mine === p ? "border-violet-400 bg-violet-500/25 text-violet-100 light:text-violet-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              {p === "in" ? "🏠 남는다" : "💨 못 남는다"} <span className="font-normal opacity-70">({counts[p]})</span>
            </button>
          ))}
        </div>
      </div>
      <ReactionBar onReact={onReact} />
    </div>
  );
}

/* ── 보드 ─────────────────────────────────────────────────── */

interface Props {
  state: CurlingState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  botSeats: Set<Seat>;
  canDrive: boolean;
  deadlineMs: number | null;
  nowMs: number;
  live: MutableRefObject<LiveView | null>;
  liveInfo: LiveInfo | null;
  aim: MutableRefObject<AimView | null>;
  myIntensity: number;
  onThrow: (p: { aim: number; weight: number; spin: 1 | -1; useCard: boolean }) => void;
  onAimLive: (a: AimView | null) => void;
  onSweep: () => void;
  onAction: (a: EngineAction) => void;
  onGameEnd: () => void;
  reactions: Reaction[];
  onReact: (k: ReactionKind) => void;
  onEvent: (e: LiveEvent) => void;
  calls: CallMark[];
  onCall: (x: number, y: number, tag: CallMark["tag"]) => void;
  predictions: PredictionBoard;
  predictLocked: boolean;
  onPredict: (p: Prediction) => void;
  seer: Record<number, number>;
}

export default function CurlingBoard({ state, viewerSeat, names, connectedSeats, botSeats, canDrive, deadlineMs, nowMs, live, liveInfo, aim, myIntensity, onThrow, onAimLive, onSweep, onAction, onGameEnd, reactions, onReact, onEvent, calls, onCall, predictions, predictLocked, onPredict, seer }: Props) {
  const [rules, setRules] = useState(false);
  const [callTag, setCallTag] = useState<CallMark["tag"]>("draw");
  const thrower = currentThrower(state);
  const side = currentSide(state);
  const myTurn = thrower === viewerSeat && state.phase === "aim";
  const liveNow = liveInfo && liveInfo.turn === state.turn ? liveInfo : null;
  const aiming = myTurn && !liveNow;
  const mySide = viewerSeat >= 0 ? state.sideOf[viewerSeat] : -1;

  const [spin, setSpin] = useState<1 | -1>(1);
  const [aimX, setAimX] = useState(-1.05);
  const [useCard, setUseCard] = useState(false);
  const [charge, setCharge] = useState<number | null>(null);
  const chargeRef = useRef<{ start: number; raf: number } | null>(null);
  const lastTickRef = useRef(0);
  const [aimTurn, setAimTurn] = useState(-1);

  // fresh defaults each time it becomes my throw
  if (aiming && aimTurn !== state.turn) {
    setAimTurn(state.turn);
    setAimX(-1.05 * spin);
    setUseCard(false);
    setCharge(null);
  }

  // publish my aim to the canvas + the room (and withdraw it when my aiming ends)
  const wasAimingRef = useRef(false);
  useEffect(() => {
    if (!aiming) {
      if (wasAimingRef.current) onAimLive(null);
      wasAimingRef.current = false;
      return;
    }
    wasAimingRef.current = true;
    onAimLive({ aim: aimX, spin, charge, side, kind: useCard ? state.cards[side] : null, interactive: charge === null });
  }, [aiming, aimX, spin, charge, side, useCard, state.cards, state.turn, onAimLive]);

  const intensity = (state.phase === "aim" && isLastStone(state)) || state.end >= state.options.ends - 1 ? 1 : 0;
  useSuiteBgm(getCurlingSound, state.phase !== "ended", intensity);
  const classify = useMemo(() => curlingCues(mySide >= 0 ? mySide : null, viewerSeat), [mySide, viewerSeat]);
  useSoundCues(state, getCurlingSound, classify);

  // 🤖 AI skip calls can be hidden per device for players who'd rather read the house themselves (§17)
  const [hideAiCalls, setHideAiCalls] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(AI_CALLS_KEY) === "off";
    } catch {
      return false;
    }
  });
  const toggleAiCalls = () => {
    const next = !hideAiCalls;
    setHideAiCalls(next);
    try {
      window.localStorage.setItem(AI_CALLS_KEY, next ? "off" : "on");
    } catch {
      /* ignore */
    }
  };
  const teamCalls = calls.filter((c) => c.side === mySide && !(hideAiCalls && c.bot));
  const hasAiCall = calls.some((c) => c.side === mySide && c.bot);

  const startCharge = useCallback(() => {
    if (!aiming || chargeRef.current) return;
    getCurlingSound().unlock();
    const start = performance.now();
    lastTickRef.current = 0;
    const loop = () => {
      const t = (performance.now() - start) / 1300;
      const ph = t % 2;
      const c = ph < 1 ? ph : 2 - ph;
      setCharge(c);
      const step = Math.floor(c * 10);
      if (step !== lastTickRef.current) {
        lastTickRef.current = step;
        getCurlingSound().play("charge", c);
      }
      if (chargeRef.current) chargeRef.current.raf = requestAnimationFrame(loop);
    };
    chargeRef.current = { start, raf: requestAnimationFrame(loop) };
    setCharge(0);
  }, [aiming]);

  const endCharge = useCallback(
    (cancel: boolean) => {
      const c = chargeRef.current;
      if (!c) return;
      cancelAnimationFrame(c.raf);
      chargeRef.current = null;
      const t = (performance.now() - c.start) / 1300;
      const ph = t % 2;
      const weight = ph < 1 ? ph : 2 - ph;
      setCharge(null);
      if (cancel || !aiming) return;
      onAimLive(null);
      onThrow({ aim: aimX, weight, spin, useCard });
    },
    [aiming, aimX, spin, useCard, onThrow, onAimLive],
  );
  useEffect(() => () => {
    if (chargeRef.current) cancelAnimationFrame(chargeRef.current.raf);
  }, []);

  // sweeping rights (§6)
  const sweepAllowed = !!liveNow && viewerSeat >= 0 && (mySide === liveNow.side || liveNow.passedTee);
  const sweepLocked = !liveNow ? "" : mySide === liveNow.side ? "" : "티 라인을 넘으면 상대도 쓸 수 있어요";

  // keyboard (§16)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat) {
        if (e.code === "Space" && !isTyping(e)) e.preventDefault();
        return;
      }
      if (aiming) {
        if (e.code === "ArrowLeft") setAimX((x) => Math.max(-AIM_LIMIT, Math.round((x - 0.05) * 100) / 100));
        else if (e.code === "ArrowRight") setAimX((x) => Math.min(AIM_LIMIT, Math.round((x + 0.05) * 100) / 100));
        else if (e.code === "KeyQ") setSpin(-1);
        else if (e.code === "KeyE") setSpin(1);
        else if (e.code === "Space") {
          e.preventDefault();
          startCharge();
        }
      } else if (e.code === "Space" && sweepAllowed) {
        e.preventDefault();
        onSweep();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && chargeRef.current) {
        e.preventDefault();
        endCharge(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [aiming, sweepAllowed, startCharge, endCharge, onSweep]);

  // shot call banner
  const lt = state.lastThrow;
  const [callShownAt, setCallShownAt] = useState<{ turn: number; at: number } | null>(null);
  if (lt && callShownAt?.turn !== lt.turn) setCallShownAt({ turn: lt.turn, at: nowMs });
  const canCall = state.phase === "aim" && !myTurn && !liveNow && viewerSeat >= 0 && mySide === side && state.options.mode === "team";
  // 🔮 my call on the throw that just landed
  const myPick = lt && predictions.turn === lt.turn ? predictions.picks[viewerSeat] : undefined;
  const myPickHit = myPick && lt ? predictionHit(myPick, stoneStayedIn(state, lt)) : false;
  const showCall = lt && callShownAt && callShownAt.turn === lt.turn && nowMs - callShownAt.at < 3200 && !liveNow;

  // auto next end (driver only)
  useEffect(() => {
    if (!canDrive || state.phase !== "scored") return;
    const id = window.setTimeout(() => onAction({ type: "next", turn: state.turn }), SCORE_PAUSE_MS);
    return () => window.clearTimeout(id);
  }, [canDrive, state.phase, state.turn, onAction]);

  const lastSlide = useRef(0);
  const onSlide = useCallback((speed: number) => {
    const now = performance.now();
    if (now - lastSlide.current < 480 || speed < 0.05) return;
    lastSlide.current = now;
    getCurlingSound().play("slide", speed);
  }, []);

  const remaining = deadlineMs === null ? null : Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  const limit = liveNow ? RUN_GRACE_MS : AIM_TIMEOUT_MS;
  const throwerName = thrower !== null ? (names[thrower] ?? `${thrower + 1}번`) : "";
  const rec = state.phase !== "aim" ? state.history[state.history.length - 1] : null;
  const measureView = state.phase === "scored" && rec ? { scorer: rec.scorer, counting: rec.counting } : null;
  const left = stonesLeft(state);
  const per = stonesPerSide(state);
  const isExtra = state.end >= state.options.ends;

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/80 light:bg-slate-100 light:text-slate-700">
          {isExtra ? "🔥 연장 엔드" : `${state.end + 1} / ${state.options.ends} 엔드`} · {state.options.mode === "team" ? "팀전" : "개인전"}
          {state.phase === "aim" && ` · ${state.throwIndex + 1}/${state.order.length}번째 스톤`}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <SuiteSoundHud suite={getCurlingSound} icon="🥌" label="Ice Party" preview="hit" />
          <button onClick={() => setRules(true)} className={CHIP}>
            📖 룰북
          </button>
        </span>
      </div>

      <div className={PANEL}>
        <Linescore state={state} names={names} viewerSeat={viewerSeat} />
        {state.phase === "aim" && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/55 light:text-slate-500">
            {left.map((n, sd) => (
              <span key={sd}>
                <span style={{ color: SIDE_COLORS[sd] }}>{SIDE_SYMBOLS[sd]}</span> 남은 스톤 {n}/{per}
                {state.options.party && state.cards[sd] && <span title={PARTY_INFO[state.cards[sd]!].name}> {PARTY_EMOJI[state.cards[sd]!]}</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 무대 */}
      <div className="relative h-[54vh] max-h-[660px] min-h-[320px] overflow-hidden rounded-2xl border border-white/10 light:border-slate-300">
        <SheetCanvas
          stones={state.stones}
          live={live}
          aim={aim}
          measure={measureView}
          onAim={aiming && charge === null ? setAimX : undefined}
          onTap={canCall ? (x, y) => onCall(x, y, callTag) : undefined}
          calls={state.phase === "aim" && !liveNow ? teamCalls : []}
          onSlide={onSlide}
          onEvent={onEvent}
        />
        <ReactionLayer reactions={reactions} names={names} playerCount={state.playerCount} viewerSeat={viewerSeat} nowMs={nowMs} />
        {state.phase === "aim" && (
          <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SIDE_COLORS[side] }} />
            <span className="truncate">{myTurn ? "🫵 내 차례" : `${thrower !== null && botSeats.has(thrower) ? "🤖 " : ""}${throwerName}`}</span>
            <span className="shrink-0 font-normal text-white/70">{liveNow ? "스톤이 가는 중!" : myTurn ? "조준하고 꾹 눌러 투구" : "조준 중"}</span>
            {remaining !== null && <span className={`shrink-0 tabular-nums ${remaining <= 10 ? "text-rose-300" : "text-white/60"}`}>{remaining}s</span>}
          </div>
        )}
        {isLastStone(state) && state.phase === "aim" && !liveNow && (
          <span className="pointer-events-none absolute top-10 left-2 rounded-full bg-amber-500/90 px-2.5 py-0.5 text-[11px] font-black text-slate-900">🔨 해머 — 이 엔드 마지막 스톤</span>
        )}
        {liveNow && (liveNow.own > 0 || liveNow.opp > 0) && (
          <span className="pointer-events-none absolute right-6 bottom-3 rounded-full bg-cyan-500/90 px-3 py-1 text-xs font-black text-slate-900">🧹 {liveNow.who.map((s) => (s === viewerSeat ? "나" : names[s])).join(" · ") || "쓸는 중"}</span>
        )}
        {showCall && lt && (
          <div className="pointer-events-none absolute inset-x-0 top-[30%] flex flex-col items-center gap-1 text-center">
            <span className="animate-bounce rounded-2xl bg-black/70 px-5 py-2 text-2xl font-black text-white shadow-xl">
              {CALLS[lt.call.key].t}
              {lt.call.key === "bomb" && lt.call.removedOpp + lt.call.removedOwn > 0 ? ` ${lt.call.removedOpp + lt.call.removedOwn}개 날림` : ""}
            </span>
            <span className="rounded-full bg-black/55 px-3 py-0.5 text-xs text-white/85">
              {lt.auto ? "⏱️ 얼어붙은 손 — 자동 투구" : CALLS[lt.call.key].lines[lt.turn % CALLS[lt.call.key].lines.length]}
              {lt.params.kind ? ` · ${PARTY_EMOJI[lt.params.kind]} ${PARTY_INFO[lt.params.kind].name}` : ""}
            </span>
          </div>
        )}
        {showCall && myPick && (
          <span className={`pointer-events-none absolute top-10 right-6 rounded-full px-3 py-1 text-xs font-black ${myPickHit ? "bg-violet-500/90 text-white" : "bg-black/60 text-white/70"}`}>
            🔮 {myPickHit ? "예측 적중 +1" : "예측 빗나감"}
          </span>
        )}
        {state.phase === "scored" && rec && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[12%] flex flex-col items-center gap-1 text-center">
            <span className="rounded-2xl bg-black/70 px-5 py-2 text-xl font-black text-white shadow-xl">
              {rec.scorer === null ? "😶 블랭크 엔드" : (
                <>
                  <span style={{ color: SIDE_COLORS[rec.scorer] }}>{sideLabel(state, rec.scorer, names)}</span> {rec.points}점!
                </>
              )}
            </span>
            {rec.scorer !== null && state.options.mode === "team" && rec.scorer !== rec.hammer && <span className="rounded-full bg-rose-500/90 px-3 py-0.5 text-xs font-black text-white">🕵️ 스틸! 해머 없이 득점</span>}
            {rec.scorer === null && state.options.mode === "team" && <span className="rounded-full bg-black/55 px-3 py-0.5 text-xs text-white/80">해머는 그대로 {sideLabel(state, rec.hammer, names)}</span>}
          </div>
        )}
      </div>

      {remaining !== null && state.phase === "aim" && (
        <div className="-mt-1 h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
          <div className={`h-full rounded-full transition-[width] duration-300 ${remaining <= 10 ? "bg-rose-500" : "bg-sky-400"}`} style={{ width: `${Math.min(100, ((remaining * 1000) / limit) * 100)}%` }} />
        </div>
      )}

      {/* 조작 */}
      {aiming && (
        <div className={PANEL}>
          {(teamCalls.length > 0 || hasAiCall) && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {teamCalls.map((c) => (
                <span key={c.seat} className="rounded-full bg-sky-500/20 px-2.5 py-1 text-xs font-bold text-sky-100 light:text-sky-800">
                  📣 {c.name}: {CALL_TAGS[c.tag].emoji} {CALL_TAGS[c.tag].label}
                </span>
              ))}
              {hasAiCall && (
                <button type="button" onClick={toggleAiCalls} className={`${CHIP} ml-auto`}>
                  {hideAiCalls ? "🤖 AI 콜 보기" : "🙈 AI 콜 숨기기"}
                </button>
              )}
            </div>
          )}
          <AimPanel state={state} aimX={aimX} spin={spin} useCard={useCard} charge={charge} onAim={setAimX} onSpin={(s) => {
            setSpin(s);
            setAimX((x) => (Math.sign(x) === s ? -x : x));
            getCurlingSound().play("spin");
          }} onCard={setUseCard} onChargeStart={startCharge} onChargeEnd={endCharge} />
        </div>
      )}
      {liveNow && viewerSeat >= 0 && (
        <div className={PANEL}>
          <SweepPad
            allowed={sweepAllowed}
            lockedReason={sweepLocked}
            mine={myIntensity}
            ownTeam={liveNow.own}
            opp={liveNow.opp}
            onSweep={onSweep}
            title={mySide === liveNow.side ? (liveNow.seat === viewerSeat ? "내 스톤 — 쓸면 더 멀리·더 곧게!" : "우리 편 스톤 — 같이 쓸어요!") : liveNow.passedTee ? "상대 스톤 — 쓸어서 하우스 밖으로!" : "상대 스톤이 오는 중…"}
          />
        </div>
      )}
      {state.phase === "aim" && !myTurn && !liveNow && viewerSeat >= 0 && (
        <div className={PANEL}>
          <SpectatorPanel
            teammate={canCall}
            throwerName={throwerName}
            throwerColor={SIDE_COLORS[side]}
            callTag={callTag}
            onCallTag={setCallTag}
            predictions={predictions}
            predictLocked={predictLocked}
            viewerSeat={viewerSeat}
            onPredict={onPredict}
            onReact={onReact}
          />
        </div>
      )}
      {liveNow && <ReactionBar onReact={onReact} />}
      {state.phase === "scored" && (
        <div className={`${PANEL} flex flex-col gap-2`}>
          <div className="flex items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600">
            <span>{state.end + 1 >= state.options.ends && !(state.scores.filter((s) => s === Math.max(...state.scores)).length > 1 && state.extraEnds < 1) ? "곧 최종 결과가 나와요" : "곧 다음 엔드를 시작해요"}</span>
            <button type="button" onClick={() => onAction({ type: "next", turn: state.turn })} className={PRIMARY}>
              다음 ▶
            </button>
          </div>
          <ReactionBar onReact={onReact} />
        </div>
      )}
      {state.phase === "ended" && <FinalPanel state={state} viewerSeat={viewerSeat} names={names} seer={seer} onGameEnd={onGameEnd} />}

      {state.phase !== "ended" && (
        <div className={`${PANEL} grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4`}>
          {Array.from({ length: state.playerCount }, (_, s) => s).map((s) => (
            <div key={s} className={`flex min-w-0 items-center gap-1.5 text-xs ${s === thrower ? "rounded-md bg-sky-500/15 px-1" : "px-1"}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${connectedSeats.has(s) ? "bg-emerald-400" : "bg-white/20"}`} />
              <span className="shrink-0" style={{ color: SIDE_COLORS[state.sideOf[s]] }}>
                {SIDE_SYMBOLS[state.sideOf[s]]}
              </span>
              <span className={`min-w-0 flex-1 truncate ${s === viewerSeat ? "font-black text-sky-200 light:text-sky-700" : "text-white/80 light:text-slate-700"}`}>
                {botSeats.has(s) ? "🤖 " : ""}
                {names[s] ?? `${s + 1}번`}
                {s === viewerSeat ? " (나)" : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function FinalPanel({ state, viewerSeat, names, seer, onGameEnd }: { state: CurlingState; viewerSeat: Seat; names: Record<Seat, string>; seer: Record<number, number>; onGameEnd: () => void }) {
  const topSeer = Object.entries(seer).sort((a, b) => b[1] - a[1])[0];
  const rankings = computeRankings(state);
  const tally = state.statTally ?? {};
  const best = (key: string) => {
    let top: { seat: number; v: number } | null = null;
    for (let s = 0; s < state.playerCount; s++) {
      const v = tally[s]?.[key] ?? 0;
      if (v > 0 && (!top || v > top.v)) top = { seat: s, v };
    }
    return top;
  };
  const awards = [
    { key: "buttons", label: "🎯 버튼 장인", unit: "번" },
    { key: "takeouts", label: "💥 테이크아웃 왕", unit: "개" },
    { key: "freezes", label: "🧊 프리즈 마스터", unit: "번" },
    { key: "partyStones", label: "🎉 파티 피플", unit: "번" },
  ]
    .map((a) => ({ ...a, top: best(a.key) }))
    .filter((a) => a.top);
  const winners = state.scores.map((s, side) => ({ s, side })).filter((x) => x.s === Math.max(...state.scores));
  return (
    <div className={`${PANEL} flex flex-col gap-3`}>
      <h3 className="text-center text-lg font-black text-white light:text-slate-900">🥌 최종 결과</h3>
      <p className="text-center text-sm text-white/80 light:text-slate-700">
        {winners.length > 1 ? "🤝 공동 1위!" : (
          <>
            🏆 <b style={{ color: SIDE_COLORS[winners[0].side] }}>{sideLabel(state, winners[0].side, names)}</b> 승리!
          </>
        )}
      </p>
      <Linescore state={state} names={names} viewerSeat={viewerSeat} />
      <ol className="flex flex-col gap-1.5">
        {rankings.map((r) => (
          <li key={r.seat} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${r.seat === viewerSeat ? "bg-sky-500/15" : "bg-white/[0.03] light:bg-slate-50"}`}>
            <span className="w-8 font-black text-amber-200 light:text-amber-700">{r.rank === 1 ? "👑" : `${r.rank}위`}</span>
            <span style={{ color: SIDE_COLORS[state.sideOf[r.seat]] }}>{SIDE_SYMBOLS[state.sideOf[r.seat]]}</span>
            <span className="min-w-0 flex-1 truncate text-white/85 light:text-slate-700">{names[r.seat] ?? `${r.seat + 1}번`}</span>
            <span className="text-xs text-white/50 light:text-slate-500">
              🎯{tally[r.seat]?.buttons ?? 0} · 💥{tally[r.seat]?.takeouts ?? 0}
            </span>
          </li>
        ))}
      </ol>
      {topSeer && topSeer[1] > 0 && (
        <p className="text-center text-sm text-violet-200 light:text-violet-700">
          🔮 예언왕 <b>{Number(topSeer[0]) === viewerSeat ? "나" : names[Number(topSeer[0])]}</b> ({topSeer[1]}번 적중)
        </p>
      )}
      {awards.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {awards.map((a) => (
            <span key={a.key} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/80 light:bg-slate-100 light:text-slate-700">
              {a.label} <b>{a.top!.seat === viewerSeat ? "나" : names[a.top!.seat]}</b> {a.top!.v}
              {a.unit}
            </span>
          ))}
        </div>
      )}
      <button onClick={onGameEnd} className={`${PRIMARY} self-center px-6`}>
        결과 확인
      </button>
    </div>
  );
}
