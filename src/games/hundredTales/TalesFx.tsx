"use client";

import { memo, type ReactNode } from "react";
import { GHOST_EMOJI, RELIGHT, type TaleEvent } from "./engine";

/**
 * Screen-space FX for every action (rulebook §13) — one CSS-only overlay over
 * whichever view (2D strip or 3D table) is showing, so it costs no WebGL work.
 * Each event is keyed by its `turn`, so a new event replays its animation and
 * an old one never does. `prefers-reduced-motion` keeps the text, drops the
 * shake/zoom.
 */

const CSS = `
@keyframes talesFloat { 0% { opacity: 0; transform: translate(-50%, 10px) scale(.8) } 15% { opacity: 1; transform: translate(-50%, 0) scale(1.05) } 70% { opacity: 1 } 100% { opacity: 0; transform: translate(-50%, -46px) scale(1) } }
@keyframes talesPop { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.3) rotate(-8deg) } 25% { opacity: 1; transform: translate(-50%, -50%) scale(1.25) rotate(3deg) } 60% { opacity: 1; transform: translate(-50%, -50%) scale(1) } 100% { opacity: 0; transform: translate(-50%, -60%) scale(1.1) } }
@keyframes talesFlash { 0% { opacity: 0 } 15% { opacity: 1 } 100% { opacity: 0 } }
@keyframes talesShake { 0%,100% { transform: translate(0,0) } 15% { transform: translate(-7px, 3px) } 30% { transform: translate(6px, -4px) } 45% { transform: translate(-5px, 2px) } 60% { transform: translate(4px, 3px) } 80% { transform: translate(-2px, -1px) } }
@keyframes talesShake2 { 0%,100% { transform: translate(0,0) } 15% { transform: translate(7px, -3px) } 30% { transform: translate(-6px, 4px) } 45% { transform: translate(5px, -2px) } 60% { transform: translate(-4px, -3px) } 80% { transform: translate(2px, 1px) } }
@keyframes talesRays { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.2) rotate(0) } 30% { opacity: .9 } 100% { opacity: 0; transform: translate(-50%, -50%) scale(1.6) rotate(40deg) } }
@keyframes talesRipple { 0% { opacity: .8; transform: translate(-50%, -50%) scale(.2) } 100% { opacity: 0; transform: translate(-50%, -50%) scale(2.4) } }
@keyframes talesSweep { 0% { transform: translateX(-120%) } 100% { transform: translateX(120%) } }
@keyframes talesSmoke { 0% { opacity: 0; transform: translate(0, 0) scale(.6) } 25% { opacity: .7 } 100% { opacity: 0; transform: translate(var(--dx), -60px) scale(1.6) } }
@keyframes talesPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(244,63,94,.0) } 50% { box-shadow: 0 0 0 4px rgba(244,63,94,.55) } }
@keyframes talesGlow { 0% { box-shadow: 0 0 0 0 rgba(251,191,36,.8) } 100% { box-shadow: 0 0 0 14px rgba(251,191,36,0) } }
@keyframes talesNum { 0% { opacity: 0; transform: translateY(4px) } 20% { opacity: 1; transform: translateY(0) } 75% { opacity: 1 } 100% { opacity: 0; transform: translateY(-14px) } }
.tales-shake-0 { animation: talesShake .55s ease-out }
.tales-shake-1 { animation: talesShake2 .55s ease-out }
.tales-danger { animation: talesPulse 1.1s ease-in-out infinite }
.tales-myturn { animation: talesGlow 1s ease-out 2 }
.tales-num { animation: talesNum 1.6s ease-out forwards; pointer-events: none }
@media (prefers-reduced-motion: reduce) {
  .tales-shake-0, .tales-shake-1, .tales-danger, .tales-myturn { animation: none }
  .tales-fx-move { animation-name: talesFlash !important }
}
`;

/** Injected once by the board. */
export function TalesFxStyles() {
  return <style>{CSS}</style>;
}

function Float({ text, cls, x = 50, y = 38, delay = 0 }: { text: string; cls: string; x?: number; y?: number; delay?: number }) {
  return (
    <span className={`tales-fx-move absolute whitespace-nowrap font-black drop-shadow-[0_2px_4px_rgba(0,0,0,.9)] ${cls}`} style={{ left: `${x}%`, top: `${y}%`, opacity: 0, animation: `talesFloat 1.6s ease-out ${delay}s forwards` }}>
      {text}
    </span>
  );
}

function Big({ text, cls = "", dur = 1.6 }: { text: string; cls?: string; dur?: number }) {
  return (
    <span className={`tales-fx-move absolute left-1/2 top-1/2 font-black drop-shadow-[0_4px_10px_rgba(0,0,0,.9)] ${cls}`} style={{ opacity: 0, animation: `talesPop ${dur}s ease-out forwards` }}>
      {text}
    </span>
  );
}

function Flash({ color, dur = 0.9 }: { color: string; dur?: number }) {
  return <span className="absolute inset-0" style={{ background: color, opacity: 0, animation: `talesFlash ${dur}s ease-out forwards` }} />;
}

function Ring({ color, size = 160 }: { color: string; size?: number }) {
  return <span className="tales-fx-move absolute left-1/2 top-1/2 rounded-full border-4" style={{ width: size, height: size, borderColor: color, opacity: 0, animation: "talesRipple 1.1s ease-out forwards" }} />;
}

/** Wisps of smoke — one per snuffed candle (max 6). */
function Smoke({ n }: { n: number }) {
  const k = Math.max(1, Math.min(6, n));
  return (
    <>
      {Array.from({ length: k }, (_, i) => (
        <span
          key={i}
          className="tales-fx-move absolute h-6 w-6 rounded-full bg-stone-300/40 blur-[6px]"
          style={{ left: `${44 + i * 2.5}%`, top: "52%", opacity: 0, ["--dx" as string]: `${(i - k / 2) * 9}px`, animation: `talesSmoke 1.3s ease-out ${0.15 + i * 0.08}s forwards` }}
        />
      ))}
    </>
  );
}

function fxFor(ev: TaleEvent): ReactNode {
  if (ev.act === "stop") {
    return (
      <>
        <Ring color="rgba(251,191,36,.8)" />
        <Big text={ev.auto ? "⏰ 시간 초과" : "🛑 여기까지"} cls="text-2xl text-amber-100 sm:text-3xl" dur={1.3} />
        {ev.gained > 0 && <Float text={`+${ev.gained}점 저장`} cls="text-lg text-amber-200" y={60} delay={0.2} />}
      </>
    );
  }
  const c = ev.card;
  const smoke = c.fear > 0 ? <Smoke n={c.fear} /> : null;
  const snuff = c.fear > 0 ? <Float text={`−${c.fear} 🕯️`} cls="text-sm text-stone-200" x={68} y={30} delay={0.1} /> : null;
  if (ev.act === "bust") {
    return (
      <>
        <Flash color="radial-gradient(circle, rgba(225,29,72,.15), rgba(136,19,55,.75))" dur={1.2} />
        {smoke}
        <Big text={GHOST_EMOJI[c.kind]} cls="text-7xl sm:text-8xl" dur={1.8} />
        <Float text={`😱 씌었다! −${ev.lost}`} cls="text-xl text-rose-200 sm:text-2xl" y={70} delay={0.35} />
      </>
    );
  }
  if (ev.act === "curse") {
    return (
      <>
        <Flash color="rgba(0,0,0,.92)" dur={2.2} />
        <Big text="💀" cls="text-8xl" dur={2.2} />
        <Float text="백 번째 이야기의 저주" cls="text-xl text-rose-300" y={72} delay={0.5} />
      </>
    );
  }
  if (ev.act === "perfect") {
    return (
      <>
        <span className="tales-fx-move absolute left-1/2 top-1/2 h-72 w-72 rounded-full" style={{ background: "repeating-conic-gradient(rgba(253,224,71,.55) 0 8deg, transparent 8deg 24deg)", opacity: 0, animation: "talesRays 1.8s ease-out forwards" }} />
        <Flash color="rgba(253,224,71,.25)" />
        <Big text="👻👹🦊💀🥚" cls="text-3xl sm:text-4xl" dur={1.8} />
        <Float text={`다섯 귀신! +${ev.gained}`} cls="text-xl text-amber-200" y={66} delay={0.3} />
      </>
    );
  }
  // draw
  if (c.kind === "salt") {
    return (
      <>
        <Big text="🧂" cls="text-5xl" />
        <Float text="+부적 1" cls="text-base text-sky-100" y={64} delay={0.2} />
      </>
    );
  }
  if (c.kind === "candle") {
    return (
      <>
        <Flash color="radial-gradient(circle, rgba(251,191,36,.45), transparent 70%)" dur={1.2} />
        <Big text="🕯️" cls="text-5xl" />
        <Float text={`+${RELIGHT} 🕯️ 다시 켜짐`} cls="text-base text-amber-200" y={64} delay={0.2} />
      </>
    );
  }
  if (c.kind === "mirror") {
    return (
      <>
        <span className="absolute inset-0 overflow-hidden">
          <span className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-sky-200/40 to-transparent" style={{ animation: "talesSweep .9s ease-out forwards" }} />
        </span>
        <Big text="🪞" cls="text-5xl" />
        <Float text="다음 이야기가 비친다" cls="text-base text-sky-100" y={64} delay={0.2} />
      </>
    );
  }
  if (ev.salted) {
    return (
      <>
        <Flash color="rgba(255,255,255,.35)" dur={0.7} />
        <Ring color="rgba(186,230,253,.9)" size={200} />
        {smoke}
        <Big text="🧂🛡️" cls="text-5xl" />
        <Float text="부적이 막았다!" cls="text-lg text-sky-100" y={66} delay={0.25} />
      </>
    );
  }
  return (
    <>
      {smoke}
      {snuff}
      <Big text={GHOST_EMOJI[c.kind]} cls={c.fear >= 3 ? "text-6xl" : "text-5xl"} dur={1.2} />
      <Float text={`+${c.fear}`} cls={`text-xl ${c.fear >= 3 ? "text-rose-200" : "text-amber-100"}`} y={64} delay={0.15} />
    </>
  );
}

/** The overlay itself; `ev` changes → the keyed layer remounts and replays. */
export const TalesFxLayer = memo(function TalesFxLayer({ ev }: { ev: TaleEvent | null }) {
  if (!ev) return null;
  return (
    <div key={`${ev.act}-${ev.turn}`} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      {fxFor(ev)}
    </div>
  );
});

/** Class that shakes the stage on a possession / the curse. */
export const shakeFor = (ev: TaleEvent | null) => (ev && (ev.act === "bust" || ev.act === "curse") ? `tales-shake-${ev.turn % 2}` : "");
