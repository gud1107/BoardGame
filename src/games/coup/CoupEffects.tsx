"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ACTION_NAMES, CHARACTER_NAMES, type ActionKind, type CoupState, type LastEvent, type SeatIndex } from "./engine";

/**
 * Purely cosmetic flourishes — no game logic lives here. Same "diff two
 * consecutive lockstep snapshots, portal a fixed overlay, drive it with a
 * globals.css keyframe" technique as every other `<Game>Effects.tsx` in this
 * project (loveLetter/LoveLetterEffects.tsx, coyote/CoyoteEffects.tsx, ...).
 */

/** Seats newly added to `eliminationOrder` by this state transition (0 in most transitions, 1-2 on a §4-2 Double Kill turn). */
export function detectNewlyEliminated(prev: CoupState, next: CoupState): SeatIndex[] {
  if (prev === next) return [];
  return next.eliminationOrder.slice(prev.eliminationOrder.length);
}

const RESPONSE_WINDOWS = new Set(["actionChallengeWindow", "blockWindow", "blockChallengeWindow"]);

/**
 * Seats that just answered a response window with 패스 (pass has no lastEvent of
 * its own). A challenge/block closes the window without the others passing; a
 * window that closes any other way means everyone still waiting passed.
 */
export function detectPassers(prev: CoupState, next: CoupState): SeatIndex[] {
  if (prev === next || !RESPONSE_WINDOWS.has(prev.phase)) return [];
  const ev = next.lastEvent !== prev.lastEvent ? next.lastEvent : null;
  if (ev && (ev.type === "challengeAction" || ev.type === "challengeBlock" || ev.type === "block")) return [];
  if (!ev && next.phase === prev.phase) return prev.awaitingSeats.filter((s) => !next.awaitingSeats.includes(s));
  return prev.awaitingSeats;
}

export function detectGameJustEnded(prev: CoupState, next: CoupState): boolean {
  return prev !== next && prev.phase !== "gameOver" && next.phase === "gameOver";
}

export function EliminationToast({ names, onDone }: { names: string[]; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[75] flex items-start justify-center pt-20">
      <div
        className="flex flex-col items-center gap-1 rounded-2xl border-2 border-rose-400/70 bg-gradient-to-b from-rose-950/95 to-black/95 px-6 py-4 text-center shadow-[0_0_60px_-10px_rgba(244,63,94,0.6)] light:border-rose-300 light:from-rose-50 light:to-white light:shadow-md"
        style={{ animation: "coup-elim-flash 2.2s ease-out forwards" }}
      >
        <span className="text-3xl">💀</span>
        {names.map((name) => (
          <p key={name} className="text-sm font-bold text-rose-100 light:text-rose-900">
            {name}님이 모든 영향력을 잃고 탈락했습니다
          </p>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function GameOverBanner({ winnerName, onDone }: { winnerName: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0 bg-gradient-to-b from-amber-950/70 via-black/60 to-black/90"
        style={{ animation: "coup-timer-warn 2.4s ease-out forwards" }}
      />
      <div
        className="relative flex flex-col items-center gap-2 rounded-3xl border-4 border-amber-300 bg-gradient-to-b from-amber-950/95 to-black/95 px-10 py-8 text-center shadow-[0_0_90px_-10px_rgba(251,191,36,0.7)] light:border-amber-400 light:from-amber-50 light:to-white light:shadow-lg"
        style={{ animation: "coup-result-burst 2.4s ease-out forwards" }}
      >
        <span className="text-6xl">👑</span>
        <h2 className="text-3xl font-black tracking-wide text-amber-100 light:text-amber-900">최후의 생존자!</h2>
        <p className="text-sm text-white/70 light:text-slate-600">{winnerName}님, 단판 승부에서 승리했습니다!</p>
      </div>
    </div>,
    document.body,
  );
}

/** Wraps a card so it plays a single 3D flip the moment it's revealed (challenge resolution, elimination) — same technique as coyote/loveLetter's `CardFlipWrapper`. */
export function CardFlipWrapper({ flipKey, revealed, children }: { flipKey: string; revealed: boolean; children: React.ReactNode }) {
  return (
    <div key={flipKey} style={revealed ? { animation: "coup-card-flip 0.6s ease-out" } : undefined} className="[transform-style:preserve-3d]">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action burst — one short centre-screen cinematic per public event
// ---------------------------------------------------------------------------

export interface BurstSpec {
  emoji: string;
  title: string;
  sub?: string;
  /** "r,g,b" — drives the flash, rings and headline glow. */
  rgb: string;
  sparks: string[];
  slash?: boolean;
  shake?: boolean;
}

const ACTION_FX: Record<ActionKind, { emoji: string; rgb: string; sparks: string[]; slash?: boolean }> = {
  income: { emoji: "💰", rgb: "251,191,36", sparks: ["🪙"] },
  foreignAid: { emoji: "💸", rgb: "52,211,153", sparks: ["🪙", "💵"] },
  coup: { emoji: "⚔️", rgb: "239,68,68", sparks: ["💥", "🔥"], slash: true },
  tax: { emoji: "👑", rgb: "232,121,249", sparks: ["🪙", "✨", "💰"] },
  assassinate: { emoji: "🗡️", rgb: "190,18,60", sparks: ["🩸", "✦"], slash: true },
  steal: { emoji: "⚓", rgb: "56,189,248", sparks: ["🪙", "💨"] },
  exchange: { emoji: "🕊️", rgb: "253,224,71", sparks: ["🃏", "🕊️", "✨"] },
};

/** Maps the engine's lastEvent to a burst — null for events that don't deserve one (exchange start/finish, card refills). */
export function burstOf(e: LastEvent | null, names: Record<SeatIndex, string>): BurstSpec | null {
  if (!e) return null;
  const who = (s: SeatIndex) => names[s] ?? "상대";
  switch (e.type) {
    case "declare": {
      const fx = ACTION_FX[e.action];
      return {
        emoji: fx.emoji,
        title: `${ACTION_NAMES[e.action]}!`,
        sub: e.targetSeat !== null ? `${who(e.seat)} → ${who(e.targetSeat)}` : who(e.seat),
        rgb: fx.rgb,
        sparks: fx.sparks,
        slash: fx.slash,
      };
    }
    case "block":
      return { emoji: "🛡️", title: "방어!", sub: `${who(e.blockerSeat)} · ${CHARACTER_NAMES[e.character]}`, rgb: "96,165,250", sparks: ["🛡️", "✨", "💠"] };
    case "challengeAction":
    case "challengeBlock": {
      const accused = e.type === "challengeAction" ? e.actorSeat : e.blockerSeat;
      const hadCard = e.type === "challengeAction" ? e.actorHadCard : e.blockerHadCard;
      return hadCard
        ? { emoji: "😎", title: "진짜였다!", sub: `${who(accused)}의 ${CHARACTER_NAMES[e.character]} 증명 — ${who(e.challengerSeat)} 의심 실패`, rgb: "52,211,153", sparks: ["✅", "✨", "🃏"] }
        : { emoji: "🧐", title: "들켰다!", sub: `${who(e.challengerSeat)}의 의심 적중 — ${who(accused)} 블러프`, rgb: "249,115,22", sparks: ["❗", "💢", "❓"], shake: true };
    }
    case "actionResolved": {
      if (e.blocked) return { emoji: "🚫", title: "무효!", sub: `${ACTION_NAMES[e.action]}이(가) 막혔습니다`, rgb: "148,163,184", sparks: ["💨"], shake: true };
      const fx = ACTION_FX[e.action];
      const coins = e.action === "income" ? 1 : e.action === "foreignAid" ? 2 : e.action === "tax" ? 3 : e.action === "steal" ? (e.amount ?? 0) : 0;
      if (coins > 0) return { emoji: "🪙", title: `+${coins}`, sub: `${who(e.actorSeat)} ${ACTION_NAMES[e.action]} 성공`, rgb: fx.rgb, sparks: ["🪙", "✨"] };
      if ((e.action === "assassinate" || e.action === "coup") && e.targetSeat !== null)
        return { emoji: "💥", title: "적중!", sub: `${who(e.targetSeat)}의 영향력 하나가 무너집니다`, rgb: fx.rgb, sparks: ["💥", "🔥", "✦"], slash: true, shake: true };
      return null;
    }
    case "influenceLost":
      return { emoji: "💔", title: `${CHARACTER_NAMES[e.character]} 상실`, sub: who(e.seat), rgb: "244,63,94", sparks: ["💔", "🃏"] };
    default:
      return null;
  }
}

const BURST_MS = 1500;
const SPARK_COUNT = 14;

export function ActionBurst({ spec, onDone }: { spec: BurstSpec; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, BURST_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only (remounted per event via key)
  }, []);

  if (typeof document === "undefined") return null;

  const c = (a: number) => `rgba(${spec.rgb},${a})`;
  const anim = (name: string, ms = BURST_MS, delay = 0) => `${name} ${ms}ms cubic-bezier(.2,.8,.2,1) ${delay}ms both`;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(circle at 50% 45%, ${c(0.45)} 0%, ${c(0.12)} 35%, transparent 70%)`, animation: anim("coup-fx-flash") }}
      />
      <div className="coup-fx-motion absolute top-1/2 left-1/2 h-0 w-0">
        {[0, 160].map((delay) => (
          <span
            key={delay}
            className="absolute -top-20 -left-20 h-40 w-40 rounded-full border-4"
            style={{ borderColor: c(0.85), boxShadow: `0 0 30px ${c(0.7)}, inset 0 0 24px ${c(0.5)}`, animation: anim("coup-fx-ring", 900, delay) }}
          />
        ))}
        {spec.slash && (
          <span
            className="absolute top-0 left-0 h-2 w-[min(90vw,520px)] rounded-full"
            style={{ background: `linear-gradient(90deg, transparent, #fff 45%, ${c(1)} 55%, transparent)`, boxShadow: `0 0 24px ${c(0.9)}`, animation: anim("coup-fx-slash", 700) }}
          />
        )}
        {Array.from({ length: SPARK_COUNT }, (_, i) => {
          const angle = (i / SPARK_COUNT) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
          const dist = 120 + (i % 3) * 55;
          return (
            <span
              key={i}
              className="absolute top-0 left-0 text-2xl sm:text-3xl"
              style={
                {
                  "--dx": `${Math.round(Math.cos(angle) * dist)}px`,
                  "--dy": `${Math.round(Math.sin(angle) * dist)}px`,
                  "--rot": `${(i % 2 ? 1 : -1) * (90 + i * 20)}deg`,
                  animation: anim("coup-fx-spark", 1100, 60 + (i % 4) * 40),
                } as React.CSSProperties
              }
            >
              {spec.sparks[i % spec.sparks.length]}
            </span>
          );
        })}
      </div>
      <div className="relative flex flex-col items-center gap-1 px-4 text-center" style={{ animation: anim("coup-fx-pop") }}>
        <span className="text-7xl sm:text-8xl" style={{ filter: `drop-shadow(0 0 22px ${c(0.9)})` }}>
          {spec.emoji}
        </span>
        <span
          className="text-4xl font-black tracking-wide text-white sm:text-5xl"
          style={{ textShadow: `0 0 18px ${c(1)}, 0 0 42px ${c(0.7)}, 0 3px 0 rgba(0,0,0,0.65)`, animation: spec.shake ? "coup-fx-shake 420ms ease-in-out 200ms" : undefined }}
        >
          {spec.title}
        </span>
        {spec.sub && (
          <span className="mt-1 max-w-[90vw] rounded-full border bg-black/70 px-3 py-1 text-xs font-semibold text-white/90 sm:text-sm" style={{ borderColor: c(0.6) }}>
            {spec.sub}
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
}
