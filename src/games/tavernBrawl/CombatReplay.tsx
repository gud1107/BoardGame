"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { simulateCombat, type Frame, type Snap } from "./combat";
import type { CombatRecord } from "./engine";
import { HERO_BY_ID } from "./units";
import UnitCard from "./UnitCard";
import { getTavernBrawlSound } from "./tavernBrawlBgm";

/**
 * 전투 재생 — 엔진이 이미 결과를 확정했고, 여기선 같은 시드로 `simulateCombat(…, record=true)`를
 * 다시 돌려 프레임을 얻어 애니메이션만 한다(네트워크 전송 없음). 속도·건너뛰기는 이 기기 표시만 바꾼다.
 *
 * 타격감(공격 1번, 1배속 기준 ~1초):
 *   0~25%  예비 동작 — 공격 유닛이 뒤로 젖혔다가 커진다
 *   25~42% 돌진 — 대상 쪽으로 70%까지 날아간다
 *   42%    충돌 — 히트스톱(피해가 클수록 길게), 대상 흰색 번쩍 + 강한 흔들림, 화면 흔들림(피해 비례),
 *          불꽃 파편 + 큰 피해 숫자, 묵직한 효과음, 휴대폰 진동(내 전투만)
 *   이후   제자리로 복귀. 죽음은 부풀었다가 회전하며 산산조각, 소환은 튀어 오르며 등장.
 */

export const STEP_MS: Record<Frame["ev"]["t"], number> = { start: 900, soc: 750, attack: 1050, deaths: 600, end: 1700 };
/** 돌진이 대상에 닿는 시점(공격 프레임 길이 대비) */
export const IMPACT_AT = 0.42;

export function replayDurationMs(c: CombatRecord): number {
  const frames = simulateCombat(c.sideA, c.sideB, c.seed, true).frames;
  return frames.reduce((a, f) => a + STEP_MS[f.ev.t], 0);
}

type Fx =
  | { id: number; kind: "dmg"; x: number; y: number; text: string; size: number; tone: "red" | "gold" | "green" }
  | { id: number; kind: "burst"; x: number; y: number; color: string; parts: { dx: number; dy: number; size: number }[] }
  | { id: number; kind: "ring"; x: number; y: number; color: string }
  | { id: number; kind: "slash"; x: number; y: number; angle: number };

type NoId<T> = T extends unknown ? Omit<T, "id"> : never;
type FxInput = Exclude<NoId<Fx>, { kind: "burst" }> | { kind: "burst"; x: number; y: number; color: string; count: number; spread: number };

let fxSeq = 0;

/** 파편 방향·거리·크기 — 효과를 만들 때 한 번만 정한다(렌더 중 난수 금지). */
function sparks(count: number, spread: number) {
  return Array.from({ length: count }, (_, i) => {
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const dist = spread * (0.6 + Math.random() * 0.6);
    return { dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist, size: 3 + Math.random() * 5 };
  });
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
  /** 공격 프레임에서 충돌이 일어났는지 — 그 전엔 맞기 전 체력을 보여 준다 */
  const [impacted, setImpacted] = useState(false);
  const [fx, setFx] = useState<Fx[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const frame = frames[idx];
  const prev = idx > 0 ? frames[idx - 1] : null;

  // 다음 프레임으로
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

  const el = useCallback((uid: string) => arenaRef.current?.querySelector<HTMLElement>(`[data-uid="${uid}"]`) ?? null, []);
  const center = useCallback((node: HTMLElement) => {
    const r = node.getBoundingClientRect();
    const base = arenaRef.current!.getBoundingClientRect();
    return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 };
  }, []);
  const addFx = useCallback((items: FxInput[], life = 900) => {
    const withIds = items.map(
      (f) =>
        ({
          ...(f.kind === "burst" ? { kind: "burst", x: f.x, y: f.y, color: f.color, parts: sparks(f.count, f.spread) } : f),
          id: ++fxSeq,
        }) as Fx,
    );
    setFx((cur) => [...cur, ...withIds]);
    window.setTimeout(() => setFx((cur) => cur.filter((f) => !withIds.includes(f))), life);
  }, []);
  const shake = useCallback(
    (power: number) => {
      const node = rootRef.current;
      if (!node || typeof node.animate !== "function") return;
      const p = Math.min(16, power);
      node.animate(
        [
          { transform: "translate(0,0)" },
          { transform: `translate(${-p}px,${p * 0.5}px) rotate(${-p * 0.08}deg)` },
          { transform: `translate(${p * 0.8}px,${-p * 0.6}px) rotate(${p * 0.06}deg)` },
          { transform: `translate(${-p * 0.5}px,${p * 0.3}px)` },
          { transform: `translate(${p * 0.25}px,0)` },
          { transform: "translate(0,0)" },
        ],
        { duration: 260 + p * 12, easing: "ease-out" },
      );
    },
    [],
  );

  /** 맞은 유닛들: 번쩍 + 흔들림 + 숫자 + 파편 */
  const hitUnits = useCallback(
    (before: Frame, after: Frame, targets: string[], big: boolean) => {
      const hpBefore = new Map<string, number>();
      for (const side of before.sides) for (const u of side) hpBefore.set(u.uid, u.hp);
      let maxDmg = 0;
      const items: FxInput[] = [];
      for (const side of after.sides) {
        for (const u of side) {
          const was = hpBefore.get(u.uid);
          const dmg = was !== undefined ? was - u.hp : 0;
          const popped = after.popped.includes(u.uid);
          if (dmg <= 0 && !popped && !targets.includes(u.uid)) continue;
          const node = el(u.uid);
          if (!node) continue;
          const c = center(node);
          if (popped) {
            items.push({ kind: "ring", x: c.x, y: c.y, color: "#fde68a" });
            items.push({ kind: "burst", x: c.x, y: c.y, color: "#fde047", count: 12, spread: 70 });
            items.push({ kind: "dmg", x: c.x, y: c.y - 30, text: "막음!", size: 22, tone: "gold" });
          }
          if (dmg > 0) {
            maxDmg = Math.max(maxDmg, dmg);
            const lethal = u.hp <= 0;
            items.push({ kind: "dmg", x: c.x + (Math.random() - 0.5) * 16, y: c.y - 20, text: `-${dmg}`, size: Math.min(54, 26 + dmg * 2.2) * (lethal ? 1.15 : 1), tone: "red" });
            items.push({ kind: "burst", x: c.x, y: c.y, color: lethal ? "#f97316" : "#fca5a5", count: Math.min(18, 7 + dmg), spread: 50 + dmg * 6 });
            if (big) items.push({ kind: "slash", x: c.x, y: c.y, angle: -35 + Math.random() * 70 });
          }
          if (typeof node.animate === "function" && (dmg > 0 || popped)) {
            const a = Math.min(14, 5 + dmg);
            node.animate(
              [
                { filter: "brightness(3.2) saturate(0)", transform: "scale(1.12)" },
                { filter: "brightness(1.6)", transform: `translateX(${-a}px) rotate(-5deg) scale(0.94)` },
                { transform: `translateX(${a}px) rotate(4deg)` },
                { transform: `translateX(${-a * 0.5}px) rotate(-2deg)` },
                { filter: "brightness(1)", transform: "translateX(0) rotate(0) scale(1)" },
              ],
              { duration: 380, easing: "ease-out" },
            );
          }
        }
      }
      if (items.length) addFx(items, 1000);
      return maxDmg;
    },
    [addFx, center, el],
  );

  // 프레임별 연출
  useLayoutEffect(() => {
    if (!frame) return;
    const ev = frame.ev;
    const s = sound ? getTavernBrawlSound() : null;
    const D = STEP_MS.attack / speed;
    const timers: number[] = [];

    if (ev.t === "attack") {
      const a = el(ev.from);
      const t = el(ev.to);
      const willHurt = (() => {
        if (!prev) return 0;
        const hp = new Map(prev.sides.flat().map((u) => [u.uid, u.hp]));
        return Math.max(0, ...frame.sides.flat().map((u) => (hp.get(u.uid) ?? u.hp) - u.hp));
      })();
      const lethal = frame.sides.flat().some((u) => (u.uid === ev.to || ev.splash.includes(u.uid)) && u.hp <= 0);
      const stop = Math.min(0.14, 0.05 + willHurt * 0.008) + (lethal ? 0.05 : 0);
      if (a && t && typeof a.animate === "function") {
        const ac = center(a);
        const tc = center(t);
        const dx = tc.x - ac.x;
        const dy = tc.y - ac.y;
        const tilt = dx >= 0 ? 1 : -1;
        const wrap = a.parentElement as HTMLElement | null;
        if (wrap) wrap.style.zIndex = "30";
        a.animate(
          [
            { transform: "translate(0,0) scale(1) rotate(0)", offset: 0 },
            { transform: `translate(${-dx * 0.1}px,${-dy * 0.1}px) scale(1.16) rotate(${-tilt * 7}deg)`, offset: 0.25, easing: "cubic-bezier(.6,0,.9,.5)" },
            { transform: `translate(${dx * 0.72}px,${dy * 0.72}px) scale(1.2) rotate(${tilt * 5}deg)`, offset: IMPACT_AT },
            { transform: `translate(${dx * 0.66}px,${dy * 0.66}px) scale(1.14) rotate(${tilt * 3}deg)`, offset: Math.min(0.8, IMPACT_AT + stop) },
            { transform: "translate(0,0) scale(1) rotate(0)", offset: 1 },
          ],
          { duration: D * 0.9, easing: "cubic-bezier(.2,.7,.2,1)" },
        );
        timers.push(
          window.setTimeout(() => {
            if (wrap) wrap.style.zIndex = "";
          }, D * 0.9),
        );
      }
      timers.push(window.setTimeout(() => s?.play("swing"), D * 0.2));
      timers.push(
        window.setTimeout(() => {
          setImpacted(true);
          const big = willHurt >= 6 || lethal;
          if (prev) hitUnits(prev, frame, [ev.to, ...ev.splash], big);
          shake(3 + willHurt * 1.1 + (lethal ? 4 : 0));
          if (frame.popped.length) s?.play("shieldPop");
          if (willHurt > 0) s?.play(lethal ? "impactHeavy" : "impact", willHurt);
          if (sound && (big || lethal) && typeof navigator !== "undefined") navigator.vibrate?.(lethal ? [30, 20, 40] : 25);
        }, D * IMPACT_AT),
      );
    } else {
      // 비공격 프레임 연출은 렌더 직후 한 틱 뒤에(이펙트 안에서 바로 setState 하지 않도록)
      timers.push(window.setTimeout(() => runFrameFx(), 0));
    }
    function runFrameFx() {
    if (ev.t === "soc") {
      s?.play("soc");
      if (ev.uid) {
        const src = el(ev.uid);
        if (src && typeof src.animate === "function") {
          src.animate([{ transform: "scale(1)", filter: "brightness(1)" }, { transform: "scale(1.25)", filter: "brightness(2) drop-shadow(0 0 12px #fde047)" }, { transform: "scale(1)", filter: "brightness(1)" }], { duration: 420 });
        }
      }
      if (prev) {
        // 전투 시작 피해(용의 숨결 등)·버프 표시
        const dmg = hitUnits(prev, frame, [], false);
        if (dmg > 0) {
          shake(3 + dmg);
          s?.play("impact", dmg);
        }
        const before = new Map(prev.sides.flat().map((u) => [u.uid, u]));
        const buffs: FxInput[] = [];
        for (const u of frame.sides.flat()) {
          const b = before.get(u.uid);
          if (!b) continue;
          const da = u.atk - b.atk;
          const dh = u.hp - b.hp;
          if (da > 0 || (dh > 0 && da >= 0)) {
            const node = el(u.uid);
            if (!node) continue;
            const c = center(node);
            buffs.push({ kind: "dmg", x: c.x, y: c.y - 34, text: `+${da}/+${Math.max(0, dh)}`, size: 18, tone: "green" });
          }
        }
        if (buffs.length) addFx(buffs, 1000);
      }
    } else if (ev.t === "deaths") {
      if (ev.uids.length) {
        s?.play("death");
        const items: FxInput[] = [];
        for (const uid of ev.uids) {
          const node = el(uid);
          if (!node) continue;
          const c = center(node);
          items.push({ kind: "burst", x: c.x, y: c.y, color: "#a8a29e", count: 16, spread: 90 });
          items.push({ kind: "burst", x: c.x, y: c.y, color: "#ef4444", count: 8, spread: 60 });
          items.push({ kind: "ring", x: c.x, y: c.y, color: "#f87171" });
          if (typeof node.animate === "function") {
            node.animate(
              [
                { transform: "scale(1) rotate(0)", filter: "brightness(1)", opacity: 1 },
                { transform: "scale(1.22) rotate(6deg)", filter: "brightness(2.5) saturate(0)", opacity: 1, offset: 0.25 },
                { transform: "scale(0.15) rotate(-40deg) translateY(30px)", filter: "grayscale(1) brightness(0.4)", opacity: 0 },
              ],
              { duration: (STEP_MS.deaths / speed) * 0.85, easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" },
            );
          }
        }
        if (items.length) addFx(items, 1000);
        shake(4 + ev.uids.length * 2);
      } else if (prev) {
        // 소환·부활: 새로 생긴 유닛이 튀어 오르며 등장
        const old = new Set(prev.sides.flat().map((u) => u.uid));
        const born = frame.sides.flat().filter((u) => !old.has(u.uid));
        if (born.length) s?.play("summon");
        const items: FxInput[] = [];
        for (const u of born) {
          const node = el(u.uid);
          if (!node) continue;
          const c = center(node);
          items.push({ kind: "ring", x: c.x, y: c.y, color: "#a7f3d0" });
          items.push({ kind: "burst", x: c.x, y: c.y + 30, color: "#d6d3d1", count: 10, spread: 50 });
          if (typeof node.animate === "function") {
            node.animate(
              [
                { transform: "translateY(-40px) scale(0.2)", opacity: 0 },
                { transform: "translateY(4px) scale(1.15)", opacity: 1, offset: 0.6 },
                { transform: "translateY(0) scale(1)", opacity: 1 },
              ],
              { duration: 420, easing: "cubic-bezier(.3,1.6,.5,1)" },
            );
          }
        }
        if (items.length) addFx(items, 900);
      }
    } else if (ev.t === "end") {
      s?.play(ev.winner === null ? "draw" : ev.winner === viewSide ? "win" : "lose");
    } else if (ev.t === "start") {
      s?.play("clash");
      shake(5);
    }
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // 프레임이 바뀔 때만 연출한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, frames]);

  if (!frame) return null;
  const ev = frame.ev;
  // 공격 프레임은 충돌 전까지 맞기 전 상태, 죽음 프레임은 죽기 직전 줄(애니메이션으로 사라짐)
  const usePrev = prev !== null && ((ev.t === "attack" && !impacted) || (ev.t === "deaths" && ev.uids.length > 0));
  const shown = usePrev && prev ? prev.sides : frame.sides;

  const row = (side: 0 | 1) => {
    const list: Snap[] = shown[side];
    return (
      <div className="flex min-h-[6.5rem] flex-wrap items-center justify-center gap-x-3 gap-y-3 px-1 py-2 sm:min-h-[7.5rem]">
        {list.length === 0 && <span className="text-xs text-white/40">— 비었음 —</span>}
        {list.map((u) => (
          <div key={u.uid} className="relative">
            <div data-uid={u.uid} className="will-change-transform">
              <UnitCard unit={u} size="md" />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const enemySide = (1 - viewSide) as 0 | 1;
  const heroA = viewSide === 0 ? combat.sideA.hero : combat.sideB.hero;
  const heroB = viewSide === 0 ? combat.sideB.hero : combat.sideA.hero;
  const result = ev.t === "end" ? (ev.winner === null ? "draw" : ev.winner === viewSide ? "win" : "loss") : null;

  return (
    <div
      ref={rootRef}
      className="relative flex flex-col overflow-hidden rounded-2xl border border-amber-900/40 bg-[radial-gradient(ellipse_at_center,rgba(120,53,15,0.35),rgba(28,25,23,0.9))] light:border-amber-300 light:bg-[radial-gradient(ellipse_at_center,#fef3c7,#fde68a)]"
    >
      <div className="flex items-center justify-between px-3 pt-2 text-xs text-amber-100/80 light:text-amber-900">
        <span>
          {heroB ? HERO_BY_ID[heroB].emoji : "👻"} {names[1]}
        </span>
        <span className="text-white/40 light:text-amber-800/60">
          {Math.min(idx + 1, frames.length)} / {frames.length}
        </span>
      </div>
      <div ref={arenaRef} className="relative">
        {row(enemySide)}
        <div className="relative flex h-8 items-center justify-center">
          <div className="absolute inset-x-6 top-1/2 h-px bg-amber-200/20 light:bg-amber-700/30" />
          {ev.t === "soc" && (
            <span key={idx} className="tb-banner relative rounded-full bg-black/70 px-3 py-0.5 text-xs font-semibold text-amber-200">
              ✦ {ev.label}
            </span>
          )}
          {ev.t === "start" && <span className="tb-banner relative rounded-full bg-black/70 px-4 py-1 text-sm font-black tracking-wider text-amber-200">⚔️ 전투 시작!</span>}
        </div>
        {row(viewSide)}
        <div className="pointer-events-none absolute inset-0 z-40 overflow-visible">
          {fx.map((f) => (
            <FxNode key={f.id} f={f} />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between px-3 pb-2 text-xs text-amber-100/80 light:text-amber-900">
        <span>
          {heroA ? HERO_BY_ID[heroA].emoji : "👻"} {names[0]}
        </span>
      </div>
      {result && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/45">
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

function FxNode({ f }: { f: Fx }) {
  if (f.kind === "dmg") {
    const color = f.tone === "red" ? "#ef4444" : f.tone === "gold" ? "#fde047" : "#4ade80";
    return (
      <span
        className="tb-dmg absolute font-black leading-none"
        style={{ left: f.x, top: f.y, fontSize: f.size, color, WebkitTextStroke: "2px #0c0a09", textShadow: `0 0 14px ${color}aa, 0 3px 0 #0c0a09` }}
      >
        {f.text}
      </span>
    );
  }
  if (f.kind === "ring") {
    return <span className="tb-ring absolute rounded-full" style={{ left: f.x, top: f.y, borderColor: f.color, boxShadow: `0 0 18px ${f.color}` }} />;
  }
  if (f.kind === "slash") {
    return <span className="tb-slash absolute" style={{ left: f.x, top: f.y, ["--a" as string]: `${f.angle}deg` }} />;
  }
  return (
    <>
      {f.parts.map((p, i) => (
        <span
          key={i}
          className="tb-spark absolute rounded-full"
          style={{
            left: f.x,
            top: f.y,
            width: p.size,
            height: p.size,
            background: f.color,
            boxShadow: `0 0 8px ${f.color}`,
            ["--dx" as string]: `${p.dx}px`,
            ["--dy" as string]: `${p.dy}px`,
          }}
        />
      ))}
    </>
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
@keyframes tb-dmg {
  0% { opacity:0; transform:translate(-50%,-50%) scale(2.4) rotate(-8deg); }
  14% { opacity:1; transform:translate(-50%,-50%) scale(.9) rotate(3deg); }
  24% { transform:translate(-50%,-55%) scale(1.12) rotate(0); }
  70% { opacity:1; transform:translate(-50%,-90%) scale(1); }
  100% { opacity:0; transform:translate(-50%,-130%) scale(.9); }
}
.tb-dmg { animation: tb-dmg .95s cubic-bezier(.2,.8,.3,1) forwards; white-space:nowrap; }
@keyframes tb-spark { 0% { opacity:1; transform:translate(-50%,-50%) scale(1.4); } 100% { opacity:0; transform:translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(.2); } }
.tb-spark { animation: tb-spark .55s cubic-bezier(.1,.8,.3,1) forwards; }
@keyframes tb-ring { 0% { opacity:.95; width:10px; height:10px; border-width:6px; } 100% { opacity:0; width:150px; height:150px; border-width:1px; } }
.tb-ring { border-style:solid; transform:translate(-50%,-50%); animation: tb-ring .5s ease-out forwards; }
@keyframes tb-slash { 0% { opacity:0; width:0; } 25% { opacity:1; width:150px; } 100% { opacity:0; width:170px; } }
.tb-slash { height:5px; transform:translate(-50%,-50%) rotate(var(--a)); background:linear-gradient(90deg,transparent,#fff 45%,#fde68a 55%,transparent); box-shadow:0 0 16px #fff; border-radius:999px; animation: tb-slash .32s ease-out forwards; }
@keyframes tb-banner { 0% { opacity:0; transform:scale(2.2); letter-spacing:.4em; } 60% { opacity:1; transform:scale(.95); } 100% { transform:scale(1); } }
.tb-banner { animation: tb-banner .4s cubic-bezier(.2,.9,.3,1.2); }
@keyframes tb-slam { 0% { opacity:0; transform:scale(2.6) rotate(-4deg); } 55% { opacity:1; transform:scale(.92) rotate(1deg); } 75% { transform:scale(1.05); } 100% { transform:scale(1); } }
.tb-slam { animation: tb-slam .45s cubic-bezier(.2,.9,.3,1.1); }
`;
