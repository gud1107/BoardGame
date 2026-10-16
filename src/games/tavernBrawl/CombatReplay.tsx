"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { simulateCombat, type AbilityNote, type Frame, type Snap } from "./combat";
import { attackStyle, type AttackKind } from "./attackStyle";
import AbilityFeed, { type FeedItem } from "./AbilityFeed";
import { HINT_HOLD_MS, HINT_KIND_COUNT, ReachHintBanner, useReachHint } from "./ReachHint";
import { EmoteBubble, type EmoteSlot } from "./emotes";
import type { CombatRecord } from "./engine";
import { HERO_BY_ID } from "./units";
import UnitCard from "./UnitCard";
import { MANA_RULES, skillOf } from "./skills";
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

export const STEP_MS: Record<Frame["ev"]["t"], number> = { start: 900, soc: 750, ability: 700, skill: 1000, attack: 1050, deaths: 600, end: 3000 };
/** 돌진이 대상에 닿는 시점(공격 프레임 길이 대비) */
export const IMPACT_AT = 0.42;

export function replayDurationMs(c: CombatRecord): number {
  const frames = simulateCombat(c.sideA, c.sideB, c.seed, true).frames;
  // 첫 판 힌트(종류마다 한 전투 1번)가 뜨면 그 프레임이 HINT_HOLD_MS씩 더 머문다 — 최대치를 미리 더해 둔다
  return frames.reduce((a, f) => a + STEP_MS[f.ev.t], 0) + HINT_KIND_COUNT * HINT_HOLD_MS;
}

type Fx =
  | { id: number; kind: "dmg"; x: number; y: number; text: string; size: number; tone: "red" | "gold" | "green" }
  | { id: number; kind: "burst"; x: number; y: number; color: string; parts: { dx: number; dy: number; size: number }[] }
  | { id: number; kind: "ring"; x: number; y: number; color: string }
  | { id: number; kind: "slash"; x: number; y: number; angle: number }
  | { id: number; kind: "glyph"; x: number; y: number; style: AttackKind; color: string; angle: number }
  | { id: number; kind: "proj"; x: number; y: number; tx: number; ty: number; style: AttackKind; color: string; dur: number }
  | { id: number; kind: "aim"; x: number; y: number; tx: number; ty: number; color: string; dur: number };

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
  hp,
  emotes,
  onFinished,
  onEnded,
}: {
  combat: CombatRecord;
  /** 아래쪽(내 쪽)에 보일 편 */
  viewSide: 0 | 1;
  names: [string, string];
  speed: number;
  sound: boolean;
  /** 전투 뒤 체력 [아래(나), 위(상대)] — 유령은 null */
  hp?: [number | null, number | null];
  /** 감정표현 [아래, 위] */
  emotes?: [EmoteSlot | undefined, EmoteSlot | undefined];
  onFinished?: () => void;
  /** 마지막(결과) 프레임에 닿고 잠시 뒤 — 전투 통계를 띄우는 데 쓴다 */
  onEnded?: () => void;
}) {
  const frames = useMemo(() => simulateCombat(combat.sideA, combat.sideB, combat.seed, true).frames, [combat]);
  const [idx, setIdx] = useState(0);
  const reachHint = useReachHint(frames, idx);
  // 힌트가 막 뜬 프레임은 읽을 틈을 주려고 조금 더 머문다(타이머가 다시 걸려도 그 프레임 길이 + 0.5초)
  const holdMs = reachHint && reachHint.at === idx ? HINT_HOLD_MS : 0;
  /** 공격 프레임에서 충돌이 일어났는지 — 그 전엔 맞기 전 체력을 보여 준다 */
  const [impacted, setImpacted] = useState(false);
  const [struck, setStruck] = useState(false);
  const topBadge = useRef<HTMLSpanElement>(null);
  const bottomBadge = useRef<HTMLSpanElement>(null);
  const [fx, setFx] = useState<Fx[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedSeq = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);
  useEffect(() => {
    if (idx < frames.length - 1) return;
    const t = window.setTimeout(() => onEndedRef.current?.(), 1500 / speed);
    return () => window.clearTimeout(t);
  }, [idx, frames, speed]);

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
    }, STEP_MS[frames[idx].ev.t] / speed + holdMs);
    return () => window.clearTimeout(t);
  }, [idx, frames, speed, holdMs]);

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

  // 힌트로 멈춘 0.5초: 공격자 → 대상 노란 조준선을 두 번 깜빡이고 대상에 표적 고리 — "일부러 멈췄다"를 보여 준다
  useEffect(() => {
    if (!reachHint || reachHint.at !== idx) return;
    const ev = frames[idx]?.ev;
    if (ev?.t !== "attack") return;
    const blink = HINT_HOLD_MS / 2;
    const timers = [0, 1].map((k) =>
      window.setTimeout(() => {
        const a = el(ev.from);
        const b = el(ev.to);
        if (!a || !b) return;
        const ac = center(a);
        const tc = center(b);
        addFx([{ kind: "aim", x: ac.x, y: ac.y, tx: tc.x, ty: tc.y, color: "#fde047", dur: blink * 0.85 }, { kind: "ring", x: tc.x, y: tc.y, color: "#fde047" }], blink + 150);
      }, STEP_MS.attack / speed + k * blink),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [reachHint, idx, frames, speed, el, center, addFx]);

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
            const mat = attackStyle(u.defId);
            items.push({ kind: "burst", x: c.x, y: c.y, color: lethal ? "#f97316" : mat.hitColor, count: Math.min(18, 7 + dmg), spread: (mat.material === "metal" ? 80 : 50) + dmg * 6 });
            if (mat.material === "metal") items.push({ kind: "burst", x: c.x, y: c.y, color: "#fff7ed", count: 8, spread: 95 });
            if (big) items.push({ kind: "ring", x: c.x, y: c.y, color: "#fecaca" });
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
      const attacker = [...(prev?.sides.flat() ?? []), ...frame.sides.flat()].find((u) => u.uid === ev.from);
      const style = attackStyle(attacker?.defId ?? "n_kid");
      const defender = [...(prev?.sides.flat() ?? []), ...frame.sides.flat()].find((u) => u.uid === ev.to);
      const attackerBefore = prev?.sides.flat().find((u) => u.uid === ev.from);
      const attackerAfter = frame.sides.flat().find((u) => u.uid === ev.from);
      const countered = !!defender && defender.atk > 0 && !!attackerBefore && !!attackerAfter && (attackerAfter.hp < attackerBefore.hp || frame.popped.includes(ev.from));
      if (a && t) {
        const ac0 = center(a);
        const tc0 = center(t);
        // 공격 예고: 조준선 + 표적 (렌더 직후 한 틱 뒤)
        timers.push(
          window.setTimeout(
            () => addFx([{ kind: "aim", x: ac0.x, y: ac0.y, tx: tc0.x, ty: tc0.y, color: ev.side === viewSide ? "#4ade80" : "#f87171", dur: D * IMPACT_AT }], D * IMPACT_AT),
            0,
          ),
        );
      }
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
        if (style.ranged) {
          // 원거리: 제자리에서 겨누고 반동, 투사체가 날아간다
          a.animate(
            [
              { transform: "translate(0,0) scale(1)", offset: 0 },
              { transform: `translate(${-dx * 0.04}px,${-dy * 0.04}px) scale(1.12)`, offset: 0.25 },
              { transform: `translate(${-dx * 0.1}px,${-dy * 0.1}px) scale(1.05)`, offset: 0.33 },
              { transform: "translate(0,0) scale(1)", offset: 1 },
            ],
            { duration: D * 0.9, easing: "ease-out" },
          );
          timers.push(
            window.setTimeout(() => {
              s?.play(style.kind === "arrow" ? "launch_arrow" : style.kind === "cannon" ? "launch_cannon" : style.kind === "fire" ? "launch_fire" : "launch_magic");
              if (style.kind !== "lightning") addFx([{ kind: "proj", x: ac.x, y: ac.y, tx: tc.x - ac.x, ty: tc.y - ac.y, style: style.kind, color: style.color, dur: D * (IMPACT_AT - 0.25) }], D);
            }, D * 0.25),
          );
        } else
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
      if (!style.ranged) timers.push(window.setTimeout(() => s?.play("swing"), D * 0.2));
      timers.push(
        window.setTimeout(() => {
          setImpacted(true);
          const big = willHurt >= 6 || lethal;
          const glyphs: FxInput[] = [];
          for (const uid of [ev.to, ...ev.splash]) {
            const node = el(uid);
            if (!node) continue;
            const c = center(node);
            const ac = a ? center(a) : c;
            glyphs.push({ kind: "glyph", x: c.x, y: c.y, style: style.kind, color: style.color, angle: (Math.atan2(c.y - ac.y, c.x - ac.x) * 180) / Math.PI });
          }
          if (glyphs.length) addFx(glyphs, 900);
          s?.play(`atk_${style.kind}`);
          if (prev) hitUnits(prev, frame, [ev.to, ...ev.splash], big);
          if (countered && defender && a && t && typeof t.animate === "function") {
            // 반격: 맞은 쪽이 공격자 쪽으로 받아친다
            const ds = attackStyle(defender.defId);
            const ac = center(a);
            const tc = center(t);
            const dx = ac.x - tc.x;
            const dy = ac.y - tc.y;
            t.animate(
              [{ transform: "translate(0,0)" }, { transform: `translate(${dx * 0.22}px,${dy * 0.22}px) scale(1.08)`, offset: 0.4 }, { transform: "translate(0,0)" }],
              { duration: 380, easing: "ease-out", delay: 60 },
            );
            addFx(
              [
                { kind: "glyph", x: ac.x, y: ac.y, style: ds.ranged ? "punch" : ds.kind, color: ds.color, angle: (Math.atan2(dy, dx) * 180) / Math.PI },
                { kind: "dmg", x: tc.x, y: tc.y - 46, text: "반격!", size: 15, tone: "red" },
              ],
              900,
            );
          }
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
    function feedIn(items: AbilityNote[]) {
      if (!items.length) return;
      const add = items.map((it) => ({ ...it, id: ++feedSeq.current, mine: it.side === viewSide }));
      setFeed((cur) => [...cur, ...add].slice(-4));
      timers.push(window.setTimeout(() => setFeed((cur) => cur.filter((x) => !add.includes(x))), 2600 / Math.max(1, speed / 1.5)));
    }
    function runFrameFx() {
    if (ev.t === "ability") {
      s?.play("ability");
      feedIn(ev.items);
      const pops: FxInput[] = [];
      for (const it of ev.items) {
        const node = it.uid ? el(it.uid) : null;
        if (!node) continue;
        const c = center(node);
        node.classList.remove("tb-glow");
        void node.offsetWidth;
        node.classList.add("tb-glow");
        pops.push({ kind: "ring", x: c.x, y: c.y, color: "#fde047" });
        pops.push({ kind: "dmg", x: c.x, y: c.y - 44, text: it.label.replace(/^\S+\s/, ""), size: 15, tone: "gold" });
      }
      if (prev) {
        const before = new Map(prev.sides.flat().map((u) => [u.uid, u]));
        for (const u of frame.sides.flat()) {
          const b = before.get(u.uid);
          const node = b ? el(u.uid) : null;
          if (!b || !node || (u.atk <= b.atk && u.hp <= b.hp)) continue;
          const c = center(node);
          pops.push({ kind: "dmg", x: c.x, y: c.y - 20, text: `+${Math.max(0, u.atk - b.atk)}/+${Math.max(0, u.hp - b.hp)}`, size: 18, tone: "green" });
        }
      }
      if (pops.length) addFx(pops, 1100);
    } else if (ev.t === "skill") {
      s?.play("ability");
      feedIn([{ side: ev.side, uid: ev.uid, label: ev.label, text: ev.text }]);
      const src = el(ev.uid);
      const pops: FxInput[] = [];
      if (src) {
        if (typeof src.animate === "function") {
          src.animate([{ transform: "scale(1)", filter: "brightness(1)" }, { transform: "scale(1.3) translateY(-6px)", filter: "brightness(2.2) drop-shadow(0 0 16px #60a5fa)" }, { transform: "scale(1)", filter: "brightness(1)" }], { duration: 520 });
        }
        const c = center(src);
        pops.push({ kind: "ring", x: c.x, y: c.y, color: "#60a5fa" });
        pops.push({ kind: "dmg", x: c.x, y: c.y - 48, text: ev.label, size: 16, tone: "gold" });
      }
      for (const uid of ev.targets) {
        if (uid === ev.uid) continue;
        const node = el(uid);
        if (!node) continue;
        const c = center(node);
        pops.push({ kind: "ring", x: c.x, y: c.y, color: ev.side === viewSide ? "#93c5fd" : "#fca5a5" });
      }
      if (prev) {
        const dmg = hitUnits(prev, frame, [], false);
        if (dmg > 0) {
          shake(3 + dmg);
          s?.play("impact", dmg);
        }
        const before = new Map(prev.sides.flat().map((u) => [u.uid, u]));
        for (const u of frame.sides.flat()) {
          const b = before.get(u.uid);
          const node = el(u.uid);
          if (!node) continue;
          const c = center(node);
          if (!b) pops.push({ kind: "dmg", x: c.x, y: c.y - 30, text: "등장!", size: 15, tone: "green" });
          else if (u.atk > b.atk || u.hp > b.hp) pops.push({ kind: "dmg", x: c.x, y: c.y - 24, text: `+${Math.max(0, u.atk - b.atk)}/+${Math.max(0, u.hp - b.hp)}`, size: 17, tone: "green" });
          else if (u.atk < b.atk && u.hp === b.hp) pops.push({ kind: "dmg", x: c.x, y: c.y - 24, text: `−${b.atk - u.atk} 공격력`, size: 15, tone: "red" });
        }
      }
      if (pops.length) addFx(pops, 1100);
    } else if (ev.t === "soc") {
      s?.play("soc");
      feedIn([{ side: ev.side, uid: ev.uid, label: `✦ ${ev.label}`, text: ev.uid ? (ev.text ?? "") : "시너지 발동" }]);
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
      // 승리 연출: 이긴 쪽 영웅 배지 → 진 쪽 영웅 배지로 빛 구슬
      const winBottom = ev.winner === viewSide;
      const loserHp = ev.winner === null ? null : winBottom ? hp?.[1] : hp?.[0];
      const from = winBottom ? bottomBadge.current : topBadge.current;
      const to = winBottom ? topBadge.current : bottomBadge.current;
      if (ev.winner !== null && combat.damage > 0 && loserHp != null && from && to) {
        const fc = center(from);
        const tc = center(to);
        const n = Math.max(1, Math.min(12, combat.damage));
        const dur = 1800 / Math.max(1, speed / 1.5);
        const gap = Math.max(60, (dur - 570) / n);
        s?.play("launch_magic");
        for (let i = 0; i < n; i++) {
          timers.push(
            window.setTimeout(() => {
              addFx([{ kind: "proj", x: fc.x, y: fc.y, tx: tc.x - fc.x, ty: tc.y - fc.y, style: "bolt", color: i % 3 === 2 ? "#f472b6" : "#fde047", dur: 420 }], 450);
              timers.push(
                window.setTimeout(() => {
                  s?.play("atk_bolt");
                  addFx([{ kind: "burst", x: tc.x, y: tc.y, color: "#fde047", count: 8, spread: 40 }], 700);
                  if (typeof to.animate === "function") to.animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "none" }], { duration: 160 });
                }, 420),
              );
            }, 120 + i * gap),
          );
        }
        timers.push(
          window.setTimeout(() => {
            setStruck(true);
            s?.play("impactHeavy", combat.damage);
            shake(8);
            addFx([{ kind: "dmg", x: tc.x, y: tc.y - 10, text: `-${combat.damage}`, size: 44, tone: "red" }, { kind: "ring", x: tc.x, y: tc.y, color: "#ef4444" }], 1100);
          }, 120 + (n - 1) * gap + 460),
        );
      }
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

  // 2줄: 위(상대)는 뒷줄 → 앞줄, 아래(나)는 앞줄 → 뒷줄 — 앞줄끼리 가운데에서 마주 본다
  const row = (side: 0 | 1) => {
    const all: Snap[] = shown[side];
    const front = all.filter((u) => !u.back);
    const back = all.filter((u) => u.back);
    const top = side !== viewSide;
    const lines = top ? [back, front] : [front, back];
    return (
      <div className="flex flex-col">
        {all.length === 0 && <span className="py-6 text-center text-xs text-white/40">— 비었음 —</span>}
        {lines.map((list, li) => list.length > 0 && subRow(list, (top ? li === 0 : li === 1) ? "back" : "front", li))}
      </div>
    );
  };
  const subRow = (list: Snap[], kind: "front" | "back", key: number) => {
    return (
      <div key={key} className={`relative flex min-h-[6.5rem] flex-wrap items-center justify-center gap-x-3 gap-y-3 px-1 py-2 sm:min-h-[7.5rem] ${kind === "back" ? "bg-sky-500/[0.04]" : ""}`}>
        <span className="pointer-events-none absolute left-1.5 top-1 text-[9px] font-bold text-white/30">{kind === "back" ? "🏹 뒷줄" : "🛡️ 앞줄"}</span>
        {list.map((u) => (
          <div key={u.uid} className="relative">
            <div data-uid={u.uid} className="will-change-transform">
              <UnitCard unit={u} size="md" />
            </div>
            <ManaPips u={u} />
          </div>
        ))}
      </div>
    );
  };

  const enemySide = (1 - viewSide) as 0 | 1;
  const heroA = viewSide === 0 ? combat.sideA.hero : combat.sideB.hero;
  const heroB = viewSide === 0 ? combat.sideB.hero : combat.sideA.hero;
  const result = ev.t === "end" ? (ev.winner === null ? "draw" : ev.winner === viewSide ? "win" : "loss") : null;
  const loserBottom = combat.winner !== null && combat.winner !== viewSide;
  const shownHp: [number | null, number | null] = [
    hp?.[0] == null ? null : hp[0] + (!struck && loserBottom ? combat.damage : 0),
    hp?.[1] == null ? null : hp[1] + (!struck && combat.winner !== null && !loserBottom ? combat.damage : 0),
  ];

  return (
    <div
      ref={rootRef}
      className="relative flex flex-col overflow-hidden rounded-2xl border border-amber-900/40 bg-[radial-gradient(ellipse_at_center,rgba(120,53,15,0.35),rgba(28,25,23,0.9))] light:border-amber-300 light:bg-[radial-gradient(ellipse_at_center,#fef3c7,#fde68a)]"
    >
      <div className="flex items-center justify-between px-3 pt-2 text-xs text-amber-100/80 light:text-amber-900">
        <span>
          <span ref={topBadge} className="inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5">
            <span className="text-base">{heroB ? HERO_BY_ID[heroB].emoji : "👻"}</span> {names[1]}
            {shownHp[1] !== null && <b className="text-rose-300">❤{shownHp[1]}</b>}
          </span>
          <EmoteBubble slot={emotes?.[1]} className="ml-1" />
        </span>
        <span className="text-white/40 light:text-amber-800/60">
          {Math.min(idx + 1, frames.length)} / {frames.length}
        </span>
      </div>
      <AbilityFeed items={feed} />
      <ReachHintBanner kind={reachHint?.kind ?? null} at="bottom" />
      <div ref={arenaRef} className="relative">
        {row(enemySide)}
        <div className="relative flex h-8 items-center justify-center">
          <div className="absolute inset-x-6 top-1/2 h-px bg-amber-200/20 light:bg-amber-700/30" />
          {ev.t === "soc" && (
            <span key={idx} className="tb-banner relative rounded-full bg-black/70 px-3 py-0.5 text-xs font-semibold text-amber-200">
              ✦ {ev.label}
            </span>
          )}
          {ev.t === "skill" && (
            <span key={idx} className={`tb-banner relative rounded-full px-3 py-0.5 text-xs font-black text-white shadow-[0_0_14px_rgba(96,165,250,0.6)] ${ev.side === viewSide ? "bg-sky-700/90" : "bg-rose-800/90"}`}>
              ⚡ {ev.label} <span className="font-semibold text-white/80">— {ev.text}</span>
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
          <span ref={bottomBadge} className="inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5">
            <span className="text-base">{heroA ? HERO_BY_ID[heroA].emoji : "👻"}</span> {names[0]}
            {shownHp[0] !== null && <b className="text-rose-300">❤{shownHp[0]}</b>}
          </span>
          <EmoteBubble slot={emotes?.[0]} className="ml-1" />
        </span>
      </div>
      {result && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-50 flex -translate-y-1/2 justify-center">
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
  if (f.kind === "proj") {
    const shape =
      f.style === "arrow" ? (
        <span className="block h-[3px] w-7 rounded bg-gradient-to-r from-amber-900 via-amber-700 to-stone-200" style={{ transform: `rotate(${(Math.atan2(f.ty, f.tx) * 180) / Math.PI}deg)` }} />
      ) : f.style === "cannon" ? (
        <span className="block h-4 w-4 rounded-full bg-stone-900 shadow-[0_0_6px_#000]" />
      ) : (
        <span className="block h-4 w-4 rounded-full" style={{ background: `radial-gradient(circle,#fff 0%,${f.color} 55%,transparent 75%)`, boxShadow: `0 0 16px 6px ${f.color}` }} />
      );
    return (
      <span className="tb-proj absolute" style={{ left: f.x, top: f.y, ["--tx" as string]: `${f.tx}px`, ["--ty" as string]: `${f.ty}px`, ["--dur" as string]: `${f.dur}ms` }}>
        {shape}
      </span>
    );
  }
  if (f.kind === "glyph") return <Glyph f={f} />;
  if (f.kind === "aim") {
    const mx = (f.x + f.tx) / 2;
    const my = (f.y + f.ty) / 2 - Math.max(30, Math.abs(f.tx - f.x) * 0.25);
    return (
      <svg className="tb-aim pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" style={{ ["--dur" as string]: `${f.dur}ms` }}>
        <defs>
          <marker id={`ah${f.id}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={f.color} />
          </marker>
        </defs>
        <path d={`M${f.x},${f.y} Q${mx},${my} ${f.tx},${f.ty}`} fill="none" stroke={f.color} strokeWidth="3" strokeDasharray="7 6" strokeLinecap="round" markerEnd={`url(#ah${f.id})`} className="tb-march" style={{ filter: `drop-shadow(0 0 4px ${f.color})` }} />
        <circle cx={f.tx} cy={f.ty} r="30" fill="none" stroke="#ef4444" strokeWidth="3" strokeDasharray="12 7" className="tb-reticle" style={{ transformOrigin: `${f.tx}px ${f.ty}px` }} />
      </svg>
    );
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


/** 2D 타격 그림 — attackStyle의 kind마다 다른 모양 */
function Glyph({ f }: { f: Extract<Fx, { kind: "glyph" }> }) {
  const base = { left: f.x, top: f.y } as const;
  const c = f.color;
  switch (f.style) {
    case "slash":
      return <span className="tb-arc absolute h-24 w-24 rounded-full" style={{ ...base, borderTop: "5px solid #fff", borderRight: `3px solid ${c}`, ["--a" as string]: `${f.angle - 60}deg`, filter: `drop-shadow(0 0 8px ${c})` }} />;
    case "claw":
      return (
        <span className="absolute" style={base}>
          {[-1, 0, 1].map((i) => (
            <span key={i} className="tb-claw absolute h-[4px] w-20 rounded-full bg-gradient-to-r from-transparent via-white to-rose-500" style={{ left: i * 12 - 40, top: i * 12, animationDelay: `${(i + 1) * 40}ms`, boxShadow: "0 0 8px #ef4444" }} />
          ))}
        </span>
      );
    case "bite":
      return (
        <span className="absolute" style={base}>
          <span className="tb-jaw-top absolute -left-9 -top-9 h-16 w-[4.5rem] rounded-b-full border-b-[6px] border-white" />
          <span className="tb-jaw-bot absolute -left-9 top-0 h-16 w-[4.5rem] rounded-t-full border-t-[6px] border-white" />
        </span>
      );
    case "stab":
      return <span className="tb-slash absolute" style={{ ...base, ["--a" as string]: `${f.angle}deg`, background: `linear-gradient(90deg,transparent,#fff 45%,${c} 55%,transparent)` }} />;
    case "lightning":
      return (
        <svg className="tb-bolt pointer-events-none absolute" style={{ left: f.x - 30, top: 0, overflow: "visible" }} width="60" height={f.y}>
          <polyline points={`30,0 14,${f.y * 0.25} 40,${f.y * 0.45} 18,${f.y * 0.7} 36,${f.y * 0.85} 30,${f.y}`} fill="none" stroke="#e0f2fe" strokeWidth="5" style={{ filter: `drop-shadow(0 0 10px ${c})` }} />
        </svg>
      );
    case "wind":
      return <span className="tb-spin absolute h-24 w-24 rounded-full border-4 border-dashed" style={{ ...base, borderColor: c }} />;
    case "holy":
      return (
        <span className="tb-boom absolute flex h-24 w-24 items-center justify-center rounded-full text-5xl font-black text-amber-50" style={{ ...base, background: `radial-gradient(circle,${c}cc 0%,transparent 70%)`, textShadow: "0 0 12px #fde047" }}>
          ✚
        </span>
      );
    case "shadow":
    case "poison":
      return <span className="tb-smoke absolute h-24 w-24 rounded-full blur-md" style={{ ...base, background: `radial-gradient(circle,${f.style === "poison" ? "#4ade80" : c} 0%,${f.style === "poison" ? "#14532d" : "#1e1b4b"} 50%,transparent 72%)` }} />;
    default:
      // 내려찍기·주먹·포탄·불꽃·물·마법·나뭇잎·요정
      return <span className="tb-boom absolute h-24 w-24 rounded-full" style={{ ...base, background: `radial-gradient(circle,#fff 0%,${c} 35%,transparent 70%)`, boxShadow: f.style === "smash" || f.style === "cannon" ? "0 0 0 6px #d6d3d1aa" : undefined }} />;
  }
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
@keyframes tb-arc { 0% { opacity:0; transform:translate(-50%,-50%) rotate(var(--a)) scale(.6); } 25% { opacity:1; } 100% { opacity:0; transform:translate(-50%,-50%) rotate(calc(var(--a) + 140deg)) scale(1.15); } }
.tb-arc { animation: tb-arc .4s ease-out forwards; }
@keyframes tb-claw { 0% { opacity:0; transform:rotate(-40deg) scaleX(0); transform-origin:left; } 30% { opacity:1; transform:rotate(-40deg) scaleX(1); } 100% { opacity:0; transform:rotate(-40deg) scaleX(1); } }
.tb-claw { opacity:0; animation: tb-claw .5s ease-out forwards; }
@keyframes tb-jaw-top { 0% { transform:translateY(-14px); opacity:1; } 40% { transform:translateY(6px); } 100% { transform:translateY(6px); opacity:0; } }
@keyframes tb-jaw-bot { 0% { transform:translateY(14px); opacity:1; } 40% { transform:translateY(-6px); } 100% { transform:translateY(-6px); opacity:0; } }
.tb-jaw-top { animation: tb-jaw-top .45s ease-in forwards; }
.tb-jaw-bot { animation: tb-jaw-bot .45s ease-in forwards; }
@keyframes tb-boom { 0% { opacity:1; transform:translate(-50%,-50%) scale(.2); } 100% { opacity:0; transform:translate(-50%,-50%) scale(1.5); } }
.tb-boom { animation: tb-boom .5s ease-out forwards; }
@keyframes tb-smoke { 0% { opacity:.9; transform:translate(-50%,-50%) scale(.3); } 100% { opacity:0; transform:translate(-50%,-70%) scale(1.6); } }
.tb-smoke { animation: tb-smoke .8s ease-out forwards; }
@keyframes tb-spin { 0% { opacity:1; transform:translate(-50%,-50%) rotate(0) scale(.4); } 100% { opacity:0; transform:translate(-50%,-50%) rotate(540deg) scale(1.2); } }
.tb-spin { animation: tb-spin .6s ease-out forwards; }
@keyframes tb-bolt { 0%,30%,60% { opacity:1; } 15%,45% { opacity:.2; } 100% { opacity:0; } }
.tb-bolt { animation: tb-bolt .45s linear forwards; }
@keyframes tb-march { to { stroke-dashoffset: -26; } }
.tb-march { animation: tb-march .45s linear infinite; }
@keyframes tb-reticle { 0% { transform: scale(1.5) rotate(0); opacity:0; } 30% { opacity:1; } 100% { transform: scale(1) rotate(120deg); opacity:1; } }
.tb-reticle { animation: tb-reticle var(--dur, .45s) ease-out forwards; }
@keyframes tb-aim { 0% { opacity:0; } 15% { opacity:1; } 85% { opacity:1; } 100% { opacity:0; } }
.tb-aim { animation: tb-aim var(--dur) linear forwards; }
@keyframes tb-emote { 0% { opacity:0; transform:translateY(6px) scale(.5); } 12% { opacity:1; transform:translateY(-2px) scale(1.15); } 20% { transform:none; } 85% { opacity:1; } 100% { opacity:0; transform:translateY(-6px); } }
.tb-emote { animation: tb-emote 2.8s ease-out forwards; }
@keyframes tb-goldpulse { 0% { transform:scale(1); box-shadow:0 0 0 rgba(250,204,21,0); } 30% { transform:scale(1.18); box-shadow:0 0 22px 6px rgba(250,204,21,.75); } 100% { transform:scale(1); box-shadow:0 0 0 rgba(250,204,21,0); } }
.tb-goldpulse { animation: tb-goldpulse .6s ease-out; }
@keyframes tb-upglow { 0%,100% { box-shadow:0 0 6px 1px rgba(250,204,21,.45); } 50% { box-shadow:0 0 18px 5px rgba(250,204,21,.9); } }
.tb-upglow { animation: tb-upglow 1.4s ease-in-out infinite; }
@keyframes tb-coinfloat { 0% { opacity:0; transform:translate(-50%,4px) scale(.7); } 20% { opacity:1; transform:translate(-50%,-6px) scale(1.15); } 100% { opacity:0; transform:translate(-50%,-30px) scale(1); } }
.tb-coinfloat { animation: tb-coinfloat 1.1s ease-out forwards; }
@keyframes tb-feed { 0% { opacity:0; transform:translateX(-24px) scale(.9); } 60% { opacity:1; transform:translateX(3px) scale(1.03); } 100% { transform:none; } }
.tb-feed { animation: tb-feed .35s cubic-bezier(.2,.9,.3,1.2); }
@keyframes tb-glow { 0%,100% { box-shadow:0 0 0 rgba(253,224,71,0); } 30% { box-shadow:0 0 22px 6px rgba(253,224,71,.85); } }
.tb-glow { animation: tb-glow .9s ease-out; border-radius:.75rem; }
@keyframes tb-proj { from { transform:translate(-50%,-50%) translate(0,0) scale(.6); } to { transform:translate(-50%,-50%) translate(var(--tx),var(--ty)) scale(1.1); } }
.tb-proj { animation: tb-proj var(--dur) cubic-bezier(.4,0,.8,.6) forwards; }
`;

/** 기력 칸: 직업 스킬까지 남은 기력(가득 차면 빛남). 토큰(직업 없음)은 표시 안 함 */
export function ManaPips({ u }: { u: Snap }) {
  const sk = skillOf(u.defId);
  if (!sk || u.mana === undefined) return null;
  const full = u.mana >= sk.mana;
  if ((u.casts ?? 0) >= MANA_RULES.maxCasts)
    return (
      <div className="mt-1 text-center text-[9px] font-bold text-white/40" title={`이번 전투에서 스킬을 ${MANA_RULES.maxCasts}번 다 썼어요`}>
        ⚡ 스킬 다 씀
      </div>
    );
  return (
    <div className="mt-1 flex justify-center gap-0.5" title={`기력 ${u.mana}/${sk.mana} — 전투 시작 때 ${MANA_RULES.start}칸 채워진 채 시작, 공격할 때·맞고 버틸 때 +1, 뒷줄은 아군이 공격할 때마다 +1. 가득 차면 ${sk.emoji} ${sk.name}(전투당 ${MANA_RULES.maxCasts}번까지)`}>
      {Array.from({ length: sk.mana }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-3 rounded-full transition-colors duration-300 ${i < (u.mana ?? 0) ? (full ? "bg-sky-300 shadow-[0_0_6px_#7dd3fc]" : "bg-sky-500") : "bg-white/15 light:bg-slate-400/40"}`}
        />
      ))}
    </div>
  );
}
