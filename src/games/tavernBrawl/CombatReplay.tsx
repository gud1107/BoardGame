"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { simulateCombat, type Frame, type Snap } from "./combat";
import type { CombatRecord } from "./engine";
import { HERO_BY_ID } from "./units";
import UnitCard from "./UnitCard";
import { getTavernBrawlSound } from "./tavernBrawlBgm";

/**
 * 전투 재생 — 엔진이 이미 결과를 확정했고, 여기선 같은 시드로 `simulateCombat(…, record=true)`를
 * 다시 돌려 프레임을 얻어 애니메이션만 한다(네트워크 전송 없음). 속도·건너뛰기는 이 기기 표시만 바꾼다.
 */

const STEP_MS: Record<Frame["ev"]["t"], number> = { start: 900, soc: 650, attack: 750, deaths: 450, end: 1600 };

export function replayDurationMs(c: CombatRecord): number {
  const frames = simulateCombat(c.sideA, c.sideB, c.seed, true).frames;
  return frames.reduce((a, f) => a + STEP_MS[f.ev.t], 0);
}

export default function CombatReplay({
  combat,
  viewSide,
  names,
  speed,
  sound,
  onFinished,
}: {
  combat: CombatRecord;
  /** 아래쪽(내 쪽)에 보일 편 */
  viewSide: 0 | 1;
  names: [string, string];
  speed: number;
  sound: boolean;
  onFinished?: () => void;
}) {
  const frames = useMemo(() => simulateCombat(combat.sideA, combat.sideB, combat.seed, true).frames, [combat]);
  const [idx, setIdx] = useState(0);
  const finishedRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    if (idx >= frames.length - 1) {
      if (!finishedRef.current) {
        finishedRef.current = true;
        const t = window.setTimeout(() => onFinishedRef.current?.(), STEP_MS.end / speed);
        return () => window.clearTimeout(t);
      }
      return;
    }
    const t = window.setTimeout(() => setIdx((i) => Math.min(frames.length - 1, i + 1)), STEP_MS[frames[idx].ev.t] / speed);
    return () => window.clearTimeout(t);
  }, [idx, frames, speed]);

  const frame = frames[idx];
  const prev = idx > 0 ? frames[idx - 1] : null;

  // 효과음
  useEffect(() => {
    if (!sound || !frame) return;
    const s = getTavernBrawlSound();
    const ev = frame.ev;
    if (ev.t === "attack") s.play("attack");
    else if (ev.t === "soc") s.play("soc");
    else if (ev.t === "deaths") s.play(ev.uids.length ? "death" : "summon");
    else if (ev.t === "end") s.play(ev.winner === null ? "draw" : ev.winner === viewSide ? "win" : "lose");
    if (frame.popped.length) s.play("shieldPop");
  }, [frame, sound, viewSide]);

  if (!frame) return null;
  const ev = frame.ev;
  // 죽음 프레임은 죽기 직전 줄을 보여 주고 죽은 유닛에 💥
  const shown = ev.t === "deaths" && ev.uids.length && prev ? prev.sides : frame.sides;
  const dead = new Set(ev.t === "deaths" ? ev.uids : []);
  const prevHp = new Map<string, number>();
  if (prev) for (const side of prev.sides) for (const u of side) prevHp.set(u.uid, u.hp);

  const row = (side: 0 | 1, top: boolean) => {
    const list: Snap[] = shown[side];
    return (
      <div className="flex min-h-[7rem] flex-wrap items-center justify-center gap-2 px-1 py-2">
        {list.length === 0 && <span className="text-xs text-white/40">— 비었음 —</span>}
        {list.map((u) => {
          const before = prevHp.get(u.uid);
          const hurt = ev.t === "attack" || ev.t === "soc" ? (before !== undefined && before > u.hp ? before - u.hp : 0) : 0;
          const isAttacker = ev.t === "attack" && ev.from === u.uid;
          const isTarget = ev.t === "attack" && (ev.to === u.uid || ev.splash.includes(u.uid));
          return (
            <UnitCard
              key={u.uid}
              unit={u}
              size="md"
              lift={isAttacker ? (top ? "down" : "up") : null}
              flash={dead.has(u.uid) ? "dead" : frame.popped.includes(u.uid) ? "pop" : isTarget || hurt ? "hit" : null}
              float={hurt ? `-${hurt}` : null}
            />
          );
        })}
      </div>
    );
  };

  const enemySide = (1 - viewSide) as 0 | 1;
  const heroA = viewSide === 0 ? combat.sideA.hero : combat.sideB.hero;
  const heroB = viewSide === 0 ? combat.sideB.hero : combat.sideA.hero;
  const result = ev.t === "end" ? (ev.winner === null ? "draw" : ev.winner === viewSide ? "win" : "loss") : null;

  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-amber-900/40 bg-[radial-gradient(ellipse_at_center,rgba(120,53,15,0.35),rgba(28,25,23,0.9))] light:border-amber-300 light:bg-[radial-gradient(ellipse_at_center,#fef3c7,#fde68a)]">
      <div className="flex items-center justify-between px-3 pt-2 text-xs text-amber-100/80 light:text-amber-900">
        <span>
          {heroB ? HERO_BY_ID[heroB].emoji : "👻"} {names[1]}
        </span>
        <span className="text-white/40 light:text-amber-800/60">
          {Math.min(idx + 1, frames.length)} / {frames.length}
        </span>
      </div>
      {row(enemySide, true)}
      <div className="relative flex h-8 items-center justify-center">
        <div className="absolute inset-x-6 top-1/2 h-px bg-amber-200/20 light:bg-amber-700/30" />
        {ev.t === "soc" && <span className="relative rounded-full bg-black/60 px-3 py-0.5 text-xs font-semibold text-amber-200">✦ {ev.label}</span>}
        {ev.t === "start" && <span className="relative rounded-full bg-black/60 px-3 py-0.5 text-xs font-semibold text-amber-200">⚔️ 전투 시작!</span>}
      </div>
      {row(viewSide, false)}
      <div className="flex items-center justify-between px-3 pb-2 text-xs text-amber-100/80 light:text-amber-900">
        <span>
          {heroA ? HERO_BY_ID[heroA].emoji : "👻"} {names[0]}
        </span>
      </div>
      {result && (
        <div className="tb-pop absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="rounded-2xl border border-white/20 bg-black/80 px-6 py-4 text-center">
            <p className={`text-2xl font-black ${result === "win" ? "text-yellow-300" : result === "loss" ? "text-rose-400" : "text-white/80"}`}>
              {result === "win" ? "🏆 승리!" : result === "loss" ? "💔 패배" : "🤝 무승부"}
            </p>
            {combat.damage > 0 && result !== "draw" && (
              <p className="mt-1 text-sm text-white/80">
                {result === "win" ? `상대에게 ❤️ -${combat.damage}` : `내 체력 ❤️ -${combat.damage}`}
                {combat.b === -1 && result === "win" ? " (유령은 피해를 받지 않아요)" : ""}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 전투에서 이 좌석이 어느 편인지 */
export function sideOfSeat(c: CombatRecord, seat: number): 0 | 1 {
  return c.b === seat ? 1 : 0;
}

export const COMBAT_CSS = `
@keyframes tb-shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-5px)} 40%{transform:translateX(5px)} 60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }
.tb-shake { animation: tb-shake .35s ease-in-out; }
@keyframes tb-float { 0%{opacity:0; transform:translate(-50%,6px) scale(.8)} 25%{opacity:1; transform:translate(-50%,-6px) scale(1.15)} 100%{opacity:0; transform:translate(-50%,-26px) scale(1)} }
.tb-float { animation: tb-float .9s ease-out forwards; }
@keyframes tb-golden { 0%{background-position:-120% 0} 100%{background-position:220% 0} }
.tb-golden { background: linear-gradient(110deg, transparent 30%, rgba(255,240,150,.45) 50%, transparent 70%); background-size: 200% 100%; animation: tb-golden 2.4s linear infinite; }
@keyframes tb-pop { 0%{opacity:0; transform:scale(.85)} 100%{opacity:1; transform:scale(1)} }
.tb-pop { animation: tb-pop .3s ease-out; }
`;
