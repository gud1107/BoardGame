"use client";

/**
 * Cinematic FX layer for MafiaBoard.tsx (2026-09-20 "전 액션 시네마틱 FX" 요청).
 * Same diff-driven reveal-event pattern as avalon/AvalonEffects.tsx and
 * perudo/PerudoActionFX.tsx: `useMafiaReveals` compares consecutive
 * `MafiaState` snapshots (every client computes the identical diff since
 * every client holds the same lockstep state) and queues one-shot events;
 * `MafiaRevealOverlay` renders + plays sound for whichever event is at the
 * front of the queue, then calls `onDone`.
 *
 * Scope decision (see HANDOFF.md): every event renders as a centered
 * banner/panel rather than being spatially anchored to the exact seat card
 * in the grid — this project's boards don't otherwise track per-seat DOM
 * positions (SeatGrid is a plain CSS grid, not Avalon's measured oval), and
 * adding ref-based position tracking just for this would be a much larger
 * change than the FX themselves. The affected seat's NAME is always named
 * in the banner text instead.
 *
 * The `police-result` investigation event is PRIVATE — every client detects
 * the identical diff, but `MafiaRevealOverlay` only ever renders it when
 * `viewerSeat` matches the seat that earned the information (checked by the
 * caller, MafiaBoard.tsx, before rendering this component at all for that
 * event type). `morning-peaceful`/`morning-tragic` (2026-09-20 2차 요청,
 * replacing the old separate `heal-success`/`heal-miss` events) are public —
 * they only restate what `dayAnnounce`'s own text already announces to
 * everyone, so no gating is needed.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import Avatar from "@/components/common/Avatar";
import type { DeathRecord, MafiaState, SeatIndex } from "./engine";

/** A single blood/glass shard's randomized flight path — precomputed once when the event is detected (see `randomShards` below), never inside a component's render, since React's purity rules forbid calling `Math.random()` during render. */
export interface ShardSpec {
  dx: string;
  dy: string;
  rot: string;
  delay: number;
}

function randomShards(count: number): ShardSpec[] {
  return Array.from({ length: count }, () => ({
    dx: `${(Math.random() - 0.5) * 220}px`,
    dy: `${(Math.random() - 0.9) * 180}px`,
    rot: `${(Math.random() - 0.5) * 540}deg`,
    delay: Math.random() * 0.08,
  }));
}

/** 아침 브리핑(밤→dayAnnounce 전환) 전용 배너 — "PEACEFUL DAWN"/"TRAGIC DAWN" 통합 연출(2026-09-20 2차 요청). 밤0(상견례)은 애초에 공격 자체가 없어 대상에서 제외(engine.ts의 `resolveNight`가 night 0을 별도 분기로 처리). */
export type MorningPeacefulReason = "doctor" | "soldier" | "no-attack";

export type MafiaRevealEvent =
  | { id: number; type: "nomination-lock"; suspectSeat: SeatIndex }
  | { id: number; type: "execution-result"; suspectSeat: SeatIndex; executed: boolean; blockedByPolitician: boolean; shards: ShardSpec[] }
  | { id: number; type: "death"; seat: SeatIndex; cause: DeathRecord["cause"]; shards: ShardSpec[] }
  | { id: number; type: "morning-peaceful"; reason: MorningPeacefulReason }
  | { id: number; type: "morning-tragic"; victimSeat: SeatIndex; shards: ShardSpec[] }
  | { id: number; type: "police-result"; policeSeat: SeatIndex; targetSeat: SeatIndex; isMafia: boolean }
  | { id: number; type: "skip-triggered" };

function detectMafiaRevealEvents(prev: MafiaState, next: MafiaState, nextId: () => number): MafiaRevealEvent[] {
  const events: MafiaRevealEvent[] = [];

  if (prev.phase !== "defense" && next.phase === "defense" && next.suspect !== null) {
    events.push({ id: nextId(), type: "nomination-lock", suspectSeat: next.suspect });
  }

  if (prev.phase === "finalVote" && next.phase !== "finalVote" && next.lastExecution) {
    events.push({
      id: nextId(),
      type: "execution-result",
      suspectSeat: next.lastExecution.suspect,
      executed: next.lastExecution.executed,
      blockedByPolitician: next.lastExecution.blockedByPolitician,
      shards: randomShards(10),
    });
  }

  if (next.deaths.length > prev.deaths.length) {
    // mafiaKill 사망은 아래 "morning-tragic" 통합 배너가 대신 담당 — 같은
    // 전환에 두 배너가 겹쳐 뜨는 걸 막는다(execution/terroristRevenge는 그대로 유지).
    for (const d of next.deaths.slice(prev.deaths.length)) {
      if (d.cause === "mafiaKill") continue;
      events.push({ id: nextId(), type: "death", seat: d.seat, cause: d.cause, shards: randomShards(10) });
    }
  }

  if (prev.phase === "night" && next.phase === "dayAnnounce" && next.lastNightOutcome && next.lastNightOutcome !== prev.lastNightOutcome && next.lastNightOutcome.night > 0) {
    const outcome = next.lastNightOutcome;
    if (outcome.victim !== null) {
      events.push({ id: nextId(), type: "morning-tragic", victimSeat: outcome.victim, shards: randomShards(14) });
    } else {
      const reason: MorningPeacefulReason = outcome.savedByDoctor ? "doctor" : outcome.savedByArmor ? "soldier" : "no-attack";
      events.push({ id: nextId(), type: "morning-peaceful", reason });
    }
  }

  if (prev.phase === "night" && next.phase === "night" && prev.nightActions.policeResult === undefined && next.nightActions.policeResult !== undefined) {
    const policeSeat = next.players.find((p) => p.role === "police")?.seat;
    if (policeSeat !== undefined) {
      events.push({
        id: nextId(),
        type: "police-result",
        policeSeat,
        targetSeat: next.nightActions.policeResult.target,
        isMafia: next.nightActions.policeResult.isMafia,
      });
    }
  }

  // "시간초 과반수 스킵" 배너: 밤/낮토론 종료 시점에 직전 상태의 스킵 투표가
  // 이미 과반수였다면 스킵으로 종료된 것으로 판단 — 자연 타임아웃과 결과
  // 상태가 동일해서 별도 필드 없이도 이 방식으로 구분 가능.
  if ((prev.phase === "night" || prev.phase === "dayDiscuss") && next.phase !== prev.phase) {
    const aliveCount = prev.players.filter((p) => p.alive).length;
    const yes = Object.values(prev.skipVotes).filter(Boolean).length;
    if (yes > Math.floor(aliveCount / 2)) events.push({ id: nextId(), type: "skip-triggered" });
  }

  return events;
}

export function useMafiaReveals(state: MafiaState) {
  const lastDiffedRef = useRef(state);
  const idRef = useRef(0);
  const [queue, setQueue] = useState<MafiaRevealEvent[]>([]);

  useEffect(() => {
    const prev = lastDiffedRef.current;
    if (prev !== state) {
      const events = detectMafiaRevealEvents(prev, state, () => ++idRef.current);
      if (events.length > 0) setQueue((q) => [...q, ...events]);
      lastDiffedRef.current = state;
    }
  }, [state]);

  const current = queue[0] ?? null;
  function dismissCurrent() {
    setQueue((q) => q.slice(1));
  }
  return { current, dismissCurrent };
}

/** Board-root screen-shake style — apply to the panel's `style` prop; clears itself after the animation finishes. */
export function useBoardShake(triggerId: number | null): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  const prevRef = useRef(triggerId);
  useEffect(() => {
    if (triggerId !== null && prevRef.current !== triggerId) {
      prevRef.current = triggerId;
      setStyle({ animation: "mafia-shake 0.5s ease-in-out" });
      const t = setTimeout(() => setStyle({}), 520);
      return () => clearTimeout(t);
    }
  }, [triggerId]);
  return style;
}

/** Purely presentational — `shards` is precomputed once by `randomShards` at event-detection time (inside `useMafiaReveals`'s effect), never here, since React's purity rules forbid calling `Math.random()` during render. */
function ShardBurst({ color, shards }: { color: string; shards: ShardSpec[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {shards.map((s, i) => (
        <span
          key={i}
          className="absolute h-2.5 w-2.5 rounded-sm"
          style={{
            backgroundColor: color,
            animation: `mafia-shard-burst 0.65s ease-out ${s.delay}s forwards`,
            ["--dx" as string]: s.dx,
            ["--dy" as string]: s.dy,
            ["--rot" as string]: s.rot,
          }}
        />
      ))}
    </div>
  );
}

interface FeatherSpec {
  left: string;
  delay: number;
  duration: number;
  drift: string;
  size: string;
  emoji: string;
}

function randomFeathers(count: number): FeatherSpec[] {
  const emojis = ["🕊️", "✨", "🍃"];
  return Array.from({ length: count }, () => ({
    left: `${5 + Math.random() * 90}%`,
    delay: Math.random() * 1.2,
    duration: 2 + Math.random() * 1.5,
    drift: `${(Math.random() - 0.5) * 80}px`,
    size: `${16 + Math.random() * 14}px`,
    emoji: emojis[Math.floor(Math.random() * emojis.length)],
  }));
}

/** "평화로운 아침" 배경 파티클 — `useMemo`로 마운트당 한 번만 랜덤 위치를 계산해 React 순수성 규칙을 지킨다(ShardBurst의 사전계산 방식과 동일 원칙). */
function FeatherDrift() {
  const feathers = useMemo(() => randomFeathers(14), []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {feathers.map((f, i) => (
        <span
          key={i}
          className="absolute bottom-0"
          style={{
            left: f.left,
            fontSize: f.size,
            animation: `mafia-feather-float ${f.duration}s ease-in ${f.delay}s forwards`,
            ["--feather-drift" as string]: f.drift,
          }}
        >
          {f.emoji}
        </span>
      ))}
    </div>
  );
}

function ShieldPulse({ color }: { color: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {[0, 0.25, 0.5].map((delay) => (
        <span
          key={delay}
          className="absolute h-24 w-24 rounded-full"
          style={{
            border: `2px solid ${color}`,
            animation: `mafia-shield-pulse 1s ease-out ${delay}s forwards`,
            ["--shield-color" as string]: color,
          }}
        />
      ))}
    </div>
  );
}

const BANNER_BASE = "pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-4";
const PANEL_BASE = "relative flex flex-col items-center gap-2 rounded-2xl border-2 px-8 py-6 text-center shadow-2xl backdrop-blur-sm";

export function MafiaRevealOverlay({
  event,
  names,
  onDone,
}: {
  event: MafiaRevealEvent;
  names: Record<SeatIndex, string>;
  onDone: () => void;
}) {
  useEffect(() => {
    const engine = getSoundEngine();
    switch (event.type) {
      case "nomination-lock":
        engine.playMafiaNominationStamp();
        break;
      case "execution-result":
        if (event.blockedByPolitician || !event.executed) engine.playMafiaInnocentChime();
        else engine.playMafiaGuiltyChainSlam();
        break;
      case "death":
        engine.playMafiaExecutionImpact();
        break;
      case "morning-peaceful":
        engine.playMafiaMorningPeaceful();
        break;
      case "morning-tragic":
        engine.playMafiaMorningTragic();
        break;
      case "police-result":
        if (event.isMafia) engine.playMafiaSirenAlert();
        else engine.playMafiaCleanScan();
        break;
      case "skip-triggered":
        engine.playMafiaSkipBanner();
        break;
    }
    const duration =
      event.type === "skip-triggered" ? 1600 : event.type === "nomination-lock" ? 1200 : event.type === "morning-peaceful" ? 3500 : event.type === "morning-tragic" ? 4000 : 1900;
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire exactly once per event.id, `onDone` is stable enough for this one-shot timer
  }, [event.id]);

  switch (event.type) {
    case "nomination-lock":
      return (
        <div className={BANNER_BASE}>
          <div
            className={`${PANEL_BASE} border-amber-400/70 bg-black/70`}
            style={{ animation: "mafia-lock-reticle 0.4s ease-out" }}
          >
            <span className="text-4xl">🎯</span>
            <p className="text-lg font-black tracking-wide text-amber-300">{names[event.suspectSeat]}님 지목 확정!</p>
          </div>
        </div>
      );

    case "execution-result": {
      const spared = !event.executed;
      return (
        <div className={BANNER_BASE}>
          <div
            className={`${PANEL_BASE} ${spared ? "border-sky-300/70 bg-black/70" : "border-rose-500/70 bg-black/80"}`}
            style={{ animation: "mafia-stamp-drop 0.55s cubic-bezier(0.34,1.56,0.64,1)" }}
          >
            {!spared && <ShardBurst color="rgba(244,63,94,0.7)" shards={event.shards} />}
            <span className="text-5xl">{spared ? "👼" : "⛓️"}</span>
            <p className={`text-xl font-black tracking-widest ${spared ? "text-sky-300" : "text-rose-400"}`}>
              {spared ? "INNOCENT" : "GUILTY"}
            </p>
            <p className="text-sm text-white/80">
              {event.blockedByPolitician
                ? `${names[event.suspectSeat]}님은 정치인이라 처형되지 않았습니다.`
                : spared
                  ? `${names[event.suspectSeat]}님이 구원받았습니다.`
                  : `${names[event.suspectSeat]}님이 처형되었습니다.`}
            </p>
          </div>
        </div>
      );
    }

    case "death":
      return (
        <div className={BANNER_BASE}>
          <div className={`${PANEL_BASE} border-rose-600/70 bg-black/85`} style={{ animation: "mafia-stamp-drop 0.5s ease-out" }}>
            <ShardBurst color="rgba(190,18,60,0.85)" shards={event.shards} />
            <span className="text-5xl">💀</span>
            <p className="text-lg font-black text-rose-400">{names[event.seat]}님 사망</p>
          </div>
        </div>
      );

    case "morning-peaceful": {
      const sub =
        event.reason === "doctor"
          ? "의사의 헌신적인 치료로 어젯밤 아무도 희생되지 않았습니다!"
          : event.reason === "soldier"
            ? "군인의 방탄조끼가 마피아의 습격을 막아냈습니다!"
            : "어젯밤 마을은 평화로웠습니다 — 사망자가 없습니다.";
      return (
        <div className={`${BANNER_BASE} overflow-hidden`}>
          <div className="absolute inset-0" style={{ background: "radial-gradient(circle, rgba(52,211,153,0.22) 0%, rgba(0,0,0,0) 65%)", animation: "mafia-god-glow 3.5s ease-out forwards" }} />
          <FeatherDrift />
          <div
            className="relative flex flex-col items-center gap-2 px-8 py-6 text-center"
            style={{ animation: "mafia-glow-in-out 0.8s cubic-bezier(0.34,1.56,0.64,1)" }}
          >
            <ShieldPulse color="rgba(52,211,153,0.6)" />
            <span className="text-6xl drop-shadow-[0_0_25px_rgba(52,211,153,0.8)]">🕊️✨</span>
            <h2 className="bg-gradient-to-r from-emerald-200 via-teal-300 to-amber-200 bg-clip-text text-3xl font-black tracking-widest text-transparent italic drop-shadow-2xl sm:text-4xl">
              PEACEFUL DAWN
            </h2>
            <p className="max-w-xs font-serif text-sm font-bold text-emerald-200">{sub}</p>
          </div>
        </div>
      );
    }

    case "morning-tragic":
      return (
        <div className={BANNER_BASE}>
          <div
            className={`${PANEL_BASE} border-rose-600/70 bg-black/85`}
            style={{ animation: "mafia-stamp-drop 0.5s ease-out" }}
          >
            <ShardBurst color="rgba(190,18,60,0.85)" shards={event.shards} />
            <h2 className="text-3xl font-black tracking-widest text-rose-500 italic drop-shadow-[0_0_25px_rgba(239,68,68,0.8)] sm:text-4xl">
              TRAGIC DAWN
            </h2>
            <div
              className="relative my-1 h-20 w-20 overflow-hidden rounded-full border-2 border-rose-500 shadow-[0_0_25px_rgba(244,63,94,0.7)]"
              style={{ animation: "mafia-avatar-zoom 0.5s cubic-bezier(0.34,1.56,0.64,1)" }}
            >
              <Avatar size={80} className="grayscale" />
              <div className="absolute inset-0 flex items-center justify-center bg-red-950/50 text-2xl">💥</div>
            </div>
            <p className="max-w-xs font-mono text-sm font-bold text-white/90">
              탕! 어젯밤 마피아의 습격으로 <span className="text-lg text-rose-400">{names[event.victimSeat]}</span>님이 싸늘한 주검으로 발견되었습니다.
            </p>
            <span className="text-xs text-white/40">사망자는 이제 유령(Ghost) 관전 모드로 전환됩니다.</span>
          </div>
        </div>
      );

    case "police-result":
      return (
        <div className={BANNER_BASE}>
          {event.isMafia ? (
            <div className={`${PANEL_BASE} border-rose-500/70 bg-rose-950/70`} style={{ animation: "mafia-flash-pulse 1.2s ease-in-out" }}>
              <span className="text-4xl">🚨</span>
              <p className="text-lg font-black tracking-wide text-rose-300">MAFIA DETECTED!</p>
              <p className="text-sm text-rose-100/80">🔒 {names[event.targetSeat]}님은 마피아입니다.</p>
            </div>
          ) : (
            <div className={`${PANEL_BASE} border-cyan-400/70 bg-cyan-950/60`} style={{ animation: "mafia-glow-in-out 0.6s ease-out" }}>
              <ShieldPulse color="rgba(6,182,212,0.7)" />
              <span className="text-4xl">🛡️</span>
              <p className="text-lg font-black tracking-wide text-cyan-300">CLEAN CITIZEN</p>
              <p className="text-sm text-cyan-100/80">{names[event.targetSeat]}님은 시민입니다.</p>
            </div>
          )}
        </div>
      );

    case "skip-triggered":
      return (
        <div className="pointer-events-none fixed top-6 left-1/2 z-[70] -translate-x-1/2">
          <div
            className="flex items-center gap-2 rounded-full border-2 border-amber-300 bg-amber-500/90 px-5 py-2.5 text-sm font-black text-black shadow-[0_0_24px_rgba(245,158,11,0.7)]"
            style={{ animation: "mafia-banner-drop 1.6s ease-in-out forwards" }}
          >
            ⚡ 과반수 찬성으로 시간을 건너뜁니다!
          </div>
        </div>
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 턴 알림 시네마틱 FX (2026-09-20 요청) — `useMafiaReveals`의 결과-발표
// 이벤트와는 별개로, "지금 당신 차례입니다" 라는 페이즈 진입 콜아웃이다.
// 대상은 항상 뷰어 자신뿐이라(다른 사람의 턴 여부는 표시하지 않음)
// `useMafiaReveals`처럼 모든 클라이언트가 같은 이벤트 큐를 공유할 필요가
// 없다 — 이 훅은 `viewerSeat`을 직접 받아 그 시점에 필요한지 자체 판단한다.
// ---------------------------------------------------------------------------

export interface MafiaTurnCue {
  id: number;
  type: "night" | "vote" | "judgment";
  title: string;
  subText: string;
}

/** 밤에 실제로 할 일이 있는 역할인지 — 시민/군인/정치인/테러리스트는 밤에 능동 액션이 없고, 영매는 사망자가 아직 없으면 조사할 대상이 없다. */
function hasNightAction(state: MafiaState, viewerSeat: SeatIndex): boolean {
  const viewer = state.players[viewerSeat];
  if (!viewer.alive || state.nightNumber === 0) return false;
  if (viewer.role === "mafia" || viewer.role === "doctor" || viewer.role === "police" || viewer.role === "spy") return true;
  if (viewer.role === "medium") return state.players.some((p) => !p.alive);
  return false;
}

export function useMafiaTurnCue(state: MafiaState, viewerSeat: SeatIndex): { cue: MafiaTurnCue | null; dismiss: () => void } {
  const idRef = useRef(0);
  const prevRef = useRef<{ phase: MafiaState["phase"]; seat: SeatIndex }>({ phase: state.phase, seat: viewerSeat });
  const [cue, setCue] = useState<MafiaTurnCue | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev.phase === state.phase && prev.seat === viewerSeat) return;
    prevRef.current = { phase: state.phase, seat: viewerSeat };

    const viewer = state.players[viewerSeat];
    if (!viewer.alive) return;

    if (state.phase === "night" && hasNightAction(state, viewerSeat)) {
      setCue({ id: ++idRef.current, type: "night", title: "NIGHT ACTION", subText: "어둠 속에서 비밀 행동을 수행하십시오" });
    } else if (state.phase === "nomination") {
      setCue({ id: ++idRef.current, type: "vote", title: "SUSPECT VOTE", subText: "처형대에 올릴 용의자를 지목하십시오" });
    } else if (state.phase === "finalVote") {
      setCue({ id: ++idRef.current, type: "judgment", title: "FINAL VERDICT", subText: "찬성(처형) 또는 반대(구원)를 결정하십시오" });
    }
  }, [state, viewerSeat]);

  return { cue, dismiss: () => setCue(null) };
}

const TURN_CUE_RING: Record<MafiaTurnCue["type"], string> = {
  night: "border-purple-500/60 shadow-[inset_0_0_60px_rgba(168,85,247,0.35)]",
  vote: "border-amber-400/60 shadow-[inset_0_0_60px_rgba(251,191,36,0.35)]",
  judgment: "border-rose-500/60 shadow-[inset_0_0_60px_rgba(244,63,94,0.35)]",
};

const TURN_CUE_ICON: Record<MafiaTurnCue["type"], string> = { night: "🌙", vote: "🗳️", judgment: "⚖️" };

export function MafiaTurnCueOverlay({ cue, onDone }: { cue: MafiaTurnCue; onDone: () => void }) {
  useEffect(() => {
    const engine = getSoundEngine();
    switch (cue.type) {
      case "night":
        engine.playMafiaNightActionCue();
        break;
      case "vote":
        engine.playMafiaVoteGavelCue();
        break;
      case "judgment":
        engine.playMafiaFinalVerdictCue();
        break;
    }
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire exactly once per cue.id
  }, [cue.id]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[65] flex flex-col items-center justify-center" style={{ animation: "mafia-turncue-fade 2.2s ease-out forwards" }}>
      <div className={`absolute inset-0 border-4 ${TURN_CUE_RING[cue.type]}`} style={{ animation: "mafia-turncue-breathe 1.4s ease-in-out infinite" }} />
      <div
        className="relative flex flex-col items-center gap-1 rounded-3xl border border-amber-500/40 bg-black/85 px-6 py-4 text-center shadow-2xl backdrop-blur-md"
        style={{ animation: "mafia-stamp-drop 0.5s cubic-bezier(0.34,1.56,0.64,1)" }}
      >
        <span className="text-3xl">{TURN_CUE_ICON[cue.type]}</span>
        <h2 className="bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-500 bg-clip-text text-2xl font-black tracking-widest text-transparent sm:text-3xl">{cue.title}</h2>
        <p className="text-xs font-semibold text-white/70 sm:text-sm">{cue.subText}</p>
      </div>
    </div>
  );
}
