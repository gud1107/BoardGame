"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { simulateCombat, type Frame } from "../combat";
import type { CombatRecord } from "../engine";
import { HERO_BY_ID } from "../units";
import { IMPACT_AT, STEP_MS } from "../CombatReplay";
import { getTavernBrawlSound } from "../tavernBrawlBgm";
import Arena3D, { type ArenaApi, type ArenaUnit } from "./Arena3D";

/**
 * 3D 전투 재생 — 2D `CombatReplay`와 같은 프레임 타이밍(STEP_MS)으로 진행하고, 연출은 Arena3D에 명령으로 보낸다.
 * 공격 = 뒤로 젖힘 → 포물선 도약 → 충돌(히트스톱, 번쩍, 넉백, 파편, 큰 숫자, 화면 흔들림) → 복귀.
 */
export default function Combat3D({
  combat,
  viewSide,
  names,
  speed,
  sound,
  quality,
  onFinished,
}: {
  combat: CombatRecord;
  viewSide: 0 | 1;
  names: [string, string];
  speed: number;
  sound: boolean;
  quality: "high" | "low";
  onFinished?: () => void;
}) {
  const frames = useMemo(() => simulateCombat(combat.sideA, combat.sideB, combat.seed, true).frames, [combat]);
  const [idx, setIdx] = useState(0);
  const [impacted, setImpacted] = useState(false);
  const api = useRef<ArenaApi | null>(null);
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
    const t = window.setTimeout(() => {
      setImpacted(false);
      setIdx((i) => Math.min(frames.length - 1, i + 1));
    }, STEP_MS[frames[idx].ev.t] / speed);
    return () => window.clearTimeout(t);
  }, [idx, frames, speed]);

  const frame = frames[idx];
  const prev = idx > 0 ? frames[idx - 1] : null;

  useLayoutEffect(() => {
    if (!frame) return;
    const ev = frame.ev;
    const s = sound ? getTavernBrawlSound() : null;
    const timers: number[] = [];
    const a = () => api.current;
    const hpBefore = new Map<string, number>((prev?.sides.flat() ?? []).map((u) => [u.uid, u.hp]));
    /** 맞은 유닛 연출. from = 때린 쪽(넉백 방향) */
    const hits = (f: Frame, from: (uid: string) => string | undefined) => {
      let max = 0;
      for (const u of f.sides.flat()) {
        const was = hpBefore.get(u.uid);
        const dmg = was !== undefined ? was - u.hp : 0;
        const popped = f.popped.includes(u.uid);
        if (popped) {
          a()?.hit(u.uid, 3, from(u.uid));
          a()?.ring(u.uid, "#fde68a", 1.2);
          a()?.burst(u.uid, "#fde047", 22, 2.2, 0.8);
          a()?.popup(u.uid, "막음!", "#fde047", 0.9);
        }
        if (dmg > 0) {
          max = Math.max(max, dmg);
          const lethal = u.hp <= 0;
          a()?.hit(u.uid, dmg, from(u.uid));
          a()?.popup(u.uid, `-${dmg}`, "#ef4444", Math.min(2.1, 0.95 + dmg * 0.09) * (lethal ? 1.15 : 1));
          a()?.burst(u.uid, lethal ? "#fb923c" : "#fca5a5", 10 + dmg * 2, 1.4 + dmg * 0.12, lethal ? 1.3 : 1);
          if (dmg >= 6 || lethal) a()?.ring(u.uid, lethal ? "#f97316" : "#fecaca", 1 + dmg * 0.05);
        }
      }
      return max;
    };

    if (ev.t === "attack") {
      const D = STEP_MS.attack / speed;
      const dmgOf = frame.sides.flat().reduce((m, u) => Math.max(m, (hpBefore.get(u.uid) ?? u.hp) - u.hp), 0);
      const lethal = frame.sides.flat().some((u) => (u.uid === ev.to || ev.splash.includes(u.uid)) && u.hp <= 0);
      const hold = Math.min(0.16, 0.05 + dmgOf * 0.009) + (lethal ? 0.05 : 0);
      a()?.attack(ev.from, ev.to, D * 0.92, IMPACT_AT, hold);
      timers.push(window.setTimeout(() => s?.play("swing"), D * 0.22));
      timers.push(
        window.setTimeout(() => {
          setImpacted(true);
          hits(frame, (uid) => (uid === ev.from ? ev.to : ev.from));
          a()?.shake(3 + dmgOf * 1.2 + (lethal ? 5 : 0));
          if (frame.popped.length) s?.play("shieldPop");
          if (dmgOf > 0) s?.play(lethal ? "impactHeavy" : "impact", dmgOf);
          if (sound && (dmgOf >= 6 || lethal)) navigator.vibrate?.(lethal ? [30, 20, 40] : 25);
        }, D * IMPACT_AT),
      );
    } else if (ev.t === "soc") {
      s?.play("soc");
      if (ev.uid) a()?.glow(ev.uid);
      const max = hits(frame, () => ev.uid ?? undefined);
      if (max > 0) {
        a()?.shake(3 + max);
        s?.play("impact", max);
      }
      const before = new Map((prev?.sides.flat() ?? []).map((u) => [u.uid, u]));
      for (const u of frame.sides.flat()) {
        const b = before.get(u.uid);
        if (!b) continue;
        const da = u.atk - b.atk;
        const dh = u.hp - b.hp;
        if (da > 0 || (dh > 0 && da >= 0)) a()?.popup(u.uid, `+${da}/+${Math.max(0, dh)}`, "#4ade80", 0.75);
      }
    } else if (ev.t === "deaths") {
      if (ev.uids.length) {
        s?.play("death");
        for (const uid of ev.uids) {
          a()?.die(uid, (STEP_MS.deaths / speed) * 0.9);
          timers.push(
            window.setTimeout(() => {
              a()?.burst(uid, "#a8a29e", 30, 2.6, 1.9);
              a()?.burst(uid, "#ef4444", 14, 2, 1.2);
              a()?.ring(uid, "#f87171", 1.4);
            }, (STEP_MS.deaths / speed) * 0.25),
          );
        }
        timers.push(window.setTimeout(() => a()?.shake(5 + ev.uids.length * 2), (STEP_MS.deaths / speed) * 0.25));
      } else if (prev) {
        const old = new Set(prev.sides.flat().map((u) => u.uid));
        const born = frame.sides.flat().filter((u) => !old.has(u.uid));
        if (born.length) s?.play("summon");
        for (const u of born) {
          a()?.spawn(u.uid);
          timers.push(
            window.setTimeout(() => {
              a()?.ring(u.uid, "#a7f3d0", 1);
              a()?.burst(u.uid, "#d6d3d1", 12, 1.2, 0.8);
            }, 300),
          );
        }
      }
    } else if (ev.t === "end") {
      s?.play(ev.winner === null ? "draw" : ev.winner === viewSide ? "win" : "lose");
    } else if (ev.t === "start") {
      s?.play("clash");
      timers.push(window.setTimeout(() => a()?.shake(6), 120));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // 프레임이 바뀔 때만 연출한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, frames]);

  if (!frame) return null;
  const ev = frame.ev;
  const usePrev = prev !== null && ((ev.t === "attack" && !impacted) || (ev.t === "deaths" && ev.uids.length > 0));
  const sides = usePrev && prev ? prev.sides : frame.sides;
  const units: ArenaUnit[] = [...sides[viewSide].map((u) => ({ ...u, side: 0 as const })), ...sides[1 - viewSide].map((u) => ({ ...u, side: 1 as const }))];
  const heroA = viewSide === 0 ? combat.sideA.hero : combat.sideB.hero;
  const heroB = viewSide === 0 ? combat.sideB.hero : combat.sideA.hero;
  const result = ev.t === "end" ? (ev.winner === null ? "draw" : ev.winner === viewSide ? "win" : "loss") : null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-900/50 bg-stone-950">
      <Arena3D units={units} mode="combat" apiRef={api} quality={quality} className="h-[30rem] w-full sm:h-[32rem]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2 text-xs text-amber-100">
        <span>
          {heroB ? HERO_BY_ID[heroB].emoji : "👻"} {names[1]}
        </span>
        <span className="text-white/50">
          {Math.min(idx + 1, frames.length)} / {frames.length}
        </span>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 text-xs text-amber-100">
        {heroA ? HERO_BY_ID[heroA].emoji : "👻"} {names[0]}
      </div>
      {(ev.t === "soc" || ev.t === "start") && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
          <span key={idx} className="tb-banner rounded-full bg-black/75 px-4 py-1 text-sm font-black tracking-wide text-amber-200 shadow-lg">
            {ev.t === "start" ? "⚔️ 전투 시작!" : `✦ ${ev.label}`}
          </span>
        </div>
      )}
      {result && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="tb-slam rounded-2xl border border-white/20 bg-black/85 px-7 py-5 text-center shadow-2xl">
            <p className={`text-3xl font-black ${result === "win" ? "text-yellow-300" : result === "loss" ? "text-rose-400" : "text-white/80"}`}>
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
