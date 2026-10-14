"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { simulateCombat, type AbilityNote, type Frame } from "../combat";
import type { CombatRecord } from "../engine";
import { HERO_BY_ID, unitDef } from "../units";
import { IMPACT_AT, STEP_MS } from "../CombatReplay";
import { attackStyle } from "../attackStyle";
import { getTavernBrawlSound } from "../tavernBrawlBgm";
import Arena3D, { type ArenaApi, type ArenaUnit } from "./Arena3D";
import AbilityFeed, { type FeedItem } from "../AbilityFeed";
import type { EmoteSlot } from "../emotes";

/**
 * 3D 전투 재생 — 2D `CombatReplay`와 같은 프레임 타이밍(STEP_MS)으로 진행하고, 연출은 Arena3D에 명령으로 보낸다.
 * 캐릭터마다 attackStyle(무기·몸)에 맞춰: 근접은 도약해서 베기/할퀴기/물기/찌르기/내려찍기,
 * 원거리는 제자리에서 화살·마법탄·불덩이·물대포·번개를 날린다. 맞은 쪽은 몸 재질(금속·뼈·식물·정령·살)에 맞는 파편.
 * 능력 발동(죽음의 메아리·부활·전투 시작…)은 그 유닛을 빛내고 화면 위 피드에 이름·효과를 띄운다.
 */
/** 같은 프레임이면 같은 배열(→ 3D 토큰·캐릭터가 다시 그려지지 않음) */
function buildUnits(sides: Frame["sides"], viewSide: 0 | 1): ArenaUnit[] {
  return [...sides[viewSide].map((u) => ({ ...u, side: 0 as const })), ...sides[1 - viewSide].map((u) => ({ ...u, side: 1 as const }))];
}

export default function Combat3D({
  combat,
  viewSide,
  names,
  speed,
  sound,
  quality,
  hp,
  emotes,
  controllable,
  onFinished,
  onEnded,
}: {
  combat: CombatRecord;
  viewSide: 0 | 1;
  names: [string, string];
  speed: number;
  sound: boolean;
  quality: "high" | "low";
  /** 전투 뒤 체력 [아래(나), 위(상대)] — 유령은 null */
  hp?: [number | null, number | null];
  /** 감정표현 [아래, 위] */
  emotes?: [EmoteSlot | undefined, EmoteSlot | undefined];
  /** 내 아바타를 움직일 수 있는지(내 전투) */
  controllable?: boolean;
  onFinished?: () => void;
  /** 마지막(결과) 프레임에 닿고 잠시 뒤 — 전투 통계를 띄우는 데 쓴다 */
  onEnded?: () => void;
}) {
  const frames = useMemo(() => simulateCombat(combat.sideA, combat.sideB, combat.seed, true).frames, [combat]);
  const [idx, setIdx] = useState(0);
  const [impacted, setImpacted] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  /** 승리 연출이 끝났는지 — 끝나기 전엔 진 쪽 체력을 피해 전 값으로 보여 준다 */
  const [struck, setStruck] = useState(false);
  /** 3D 캔버스 준비(셰이더 컴파일) 뒤에 재생을 시작 — 첫 장면이 멈칫하지 않게 */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 2000); // 준비 신호가 안 오면 2초 뒤 그냥 시작
    return () => window.clearTimeout(t);
  }, []);
  const api = useRef<ArenaApi | null>(null);
  const finishedRef = useRef(false);
  const feedSeq = useRef(0);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);
  useEffect(() => {
    if (!ready || idx < frames.length - 1) return;
    const t = window.setTimeout(() => onEndedRef.current?.(), 1500 / speed);
    return () => window.clearTimeout(t);
  }, [idx, frames, speed, ready]);

  useEffect(() => {
    if (!ready) return;
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
  }, [idx, frames, speed, ready]);

  const frame = frames[idx];
  const prev = idx > 0 ? frames[idx - 1] : null;

  useLayoutEffect(() => {
    if (!frame || !ready) return;
    const ev = frame.ev;
    const s = sound ? getTavernBrawlSound() : null;
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const a = () => api.current;
    const hpBefore = new Map<string, number>((prev?.sides.flat() ?? []).map((u) => [u.uid, u.hp]));
    const pushFeed = (items: AbilityNote[]) => {
      if (!items.length) return;
      const add = items.map((it) => ({ ...it, id: ++feedSeq.current, mine: it.side === viewSide }));
      setFeed((cur) => [...cur, ...add].slice(-4));
      later(2600 / Math.max(1, speed / 1.5), () => setFeed((cur) => cur.filter((x) => !add.includes(x))));
    };
    const highlight = (items: AbilityNote[]) => {
      for (const it of items) {
        if (!it.uid) continue;
        a()?.glow(it.uid);
        a()?.ring(it.uid, "#fde047", 1.3);
        a()?.popup(it.uid, it.label.replace(/^\S+\s/, ""), "#fde047", 0.65);
      }
      if (items.length) s?.play("ability");
    };
    /** 맞은 유닛: 피해 숫자 + 몸 재질에 맞는 파편 */
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
          const mat = attackStyle(u.defId);
          a()?.hit(u.uid, dmg, from(u.uid));
          a()?.popup(u.uid, `-${dmg}`, "#ef4444", Math.min(2.1, 0.95 + dmg * 0.09) * (lethal ? 1.15 : 1));
          const size = mat.material === "bone" ? 1.5 : mat.material === "metal" ? 0.6 : mat.material === "plant" ? 1.1 : 1;
          const spread = mat.material === "metal" ? 2.4 : mat.material === "spirit" ? 0.9 : 1.4 + dmg * 0.12;
          a()?.burst(u.uid, mat.hitColor, 10 + dmg * 2, spread, size * (lethal ? 1.3 : 1));
          if (mat.material === "metal") a()?.burst(u.uid, "#fff7ed", 8, 3, 0.4);
          if (dmg >= 6 || lethal) a()?.ring(u.uid, lethal ? "#f97316" : "#fecaca", 1 + dmg * 0.05);
        }
      }
      return max;
    };

    if (ev.t === "attack") {
      const D = STEP_MS.attack / speed;
      const attacker = [...(prev?.sides.flat() ?? []), ...frame.sides.flat()].find((u) => u.uid === ev.from);
      const style = attackStyle(attacker?.defId ?? "n_kid");
      const dmgOf = frame.sides.flat().reduce((m, u) => Math.max(m, (hpBefore.get(u.uid) ?? u.hp) - u.hp), 0);
      const lethal = frame.sides.flat().some((u) => (u.uid === ev.to || ev.splash.includes(u.uid)) && u.hp <= 0);
      const hold = Math.min(0.16, 0.05 + dmgOf * 0.009) + (lethal ? 0.05 : 0);
      a()?.attack(ev.from, ev.to, D * 0.92, IMPACT_AT, hold, style.ranged);
      // 공격 예고: 내 공격은 초록, 상대 공격은 빨강 조준선
      a()?.aim(ev.from, ev.to, D * IMPACT_AT, ev.side === viewSide ? "#4ade80" : "#f87171", style.ranged);
      const defender = [...(prev?.sides.flat() ?? []), ...frame.sides.flat()].find((u) => u.uid === ev.to);
      const attackerBefore = prev?.sides.flat().find((u) => u.uid === ev.from);
      const attackerAfter = frame.sides.flat().find((u) => u.uid === ev.from);
      const countered = !!defender && defender.atk > 0 && !!attackerBefore && !!attackerAfter && (attackerAfter.hp < attackerBefore.hp || frame.popped.includes(ev.from));
      if (style.ranged) {
        const launchAt = D * 0.25;
        later(launchAt, () => {
          s?.play(style.kind === "arrow" ? "launch_arrow" : style.kind === "cannon" ? "launch_cannon" : style.kind === "fire" ? "launch_fire" : "launch_magic");
          if (style.kind !== "lightning") a()?.projectile(style.kind, style.color, ev.from, ev.to, D * IMPACT_AT - launchAt);
        });
      } else {
        later(D * 0.22, () => s?.play("swing"));
      }
      later(D * IMPACT_AT, () => {
        setImpacted(true);
        const big = dmgOf >= 6 || lethal;
        a()?.impactFx(style.kind, style.color, ev.to, ev.from, big);
        for (const sp of ev.splash) a()?.impactFx(style.kind, style.color, sp, ev.from, false);
        hits(frame, (uid) => (uid === ev.from ? ev.to : ev.from));
        if (countered && defender) {
          // 반격: 맞은 쪽도 받아친다 — 그 캐릭터의 타격 그림을 공격자에게
          const ds = attackStyle(defender.defId);
          a()?.counter(ev.to, ev.from);
          later(70, () => {
            a()?.impactFx(ds.ranged ? "punch" : ds.kind, ds.color, ev.from, ev.to, false);
            a()?.popup(ev.to, "반격!", "#fca5a5", 0.6);
          });
        }
        const heavy = style.kind === "smash" || style.kind === "cannon" || style.kind === "lightning";
        a()?.shake(3 + dmgOf * 1.2 + (lethal ? 5 : 0) + (heavy ? 4 : 0));
        s?.play(`atk_${style.kind}`);
        if (frame.popped.length) s?.play("shieldPop");
        if (dmgOf > 0) s?.play(lethal ? "impactHeavy" : "impact", dmgOf);
        if (sound && (dmgOf >= 6 || lethal)) navigator.vibrate?.(lethal ? [30, 20, 40] : 25);
      });
    } else if (ev.t === "skill") {
      // 기력 가득 → 직업 스킬: 시전자가 푸르게 빛나며 이름을 외치고, 적에겐 그 캐릭터 공격 스타일로 날아간다
      s?.play("ability");
      a()?.glow(ev.uid);
      a()?.ring(ev.uid, "#60a5fa", 1.6);
      a()?.burst(ev.uid, "#93c5fd", 26, 2, 0.8);
      a()?.popup(ev.uid, ev.label, "#7dd3fc", 0.85);
      later(0, () => pushFeed([{ side: ev.side, uid: ev.uid, label: ev.label, text: ev.text }]));
      const src = frame.sides.flat().find((u) => u.uid === ev.uid) ?? prev?.sides.flat().find((u) => u.uid === ev.uid);
      const st = src ? attackStyle(src.defId) : null;
      const enemyIds = new Set((prev?.sides[1 - ev.side] ?? frame.sides[1 - ev.side]).map((u) => u.uid));
      const hitEnemy = ev.targets.filter((uid) => enemyIds.has(uid));
      const D = STEP_MS.skill / speed;
      if (st) for (const uid of hitEnemy) a()?.projectile(st.kind, st.color, ev.uid, uid, D * 0.35);
      later(hitEnemy.length && st ? D * 0.35 : 0, () => {
        if (st) for (const uid of hitEnemy) a()?.impactFx(st.kind, st.color, uid, ev.uid, true);
        const max = hits(frame, () => ev.uid);
        if (max > 0) {
          a()?.shake(3 + max);
          s?.play("impact", max);
        }
        const before = new Map((prev?.sides.flat() ?? []).map((u) => [u.uid, u]));
        for (const u of frame.sides.flat()) {
          const b = before.get(u.uid);
          if (!b) {
            a()?.ring(u.uid, "#c084fc", 1.3);
            continue;
          }
          const da = u.atk - b.atk;
          const dh = u.hp - b.hp;
          if (da > 0 || dh > 0) a()?.popup(u.uid, `+${Math.max(0, da)}/+${Math.max(0, dh)}`, "#4ade80", 0.75);
          else if (da < 0) a()?.popup(u.uid, `공격력 ${da}`, "#f87171", 0.75);
        }
      });
    } else if (ev.t === "soc") {
      s?.play("soc");
      if (ev.uid) {
        a()?.glow(ev.uid);
        a()?.ring(ev.uid, "#fde047", 1.3);
        const src = frame.sides.flat().find((u) => u.uid === ev.uid);
        if (src) {
          const st = attackStyle(src.defId);
          // 전투 시작 피해 능력은 그 캐릭터의 공격 스타일로 날아간다
          for (const u of frame.sides[1 - ev.side]) {
            const was = hpBefore.get(u.uid);
            if (was !== undefined && was > u.hp) a()?.impactFx(st.kind, st.color, u.uid, ev.uid, false);
          }
        }
        later(0, () => pushFeed([{ side: ev.side, uid: ev.uid, label: `✦ ${ev.label}`, text: ev.text ?? "" }]));
      } else {
        later(0, () => pushFeed([{ side: ev.side, uid: null, label: `✦ ${ev.label}`, text: "시너지 발동" }]));
      }
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
    } else if (ev.t === "ability") {
      highlight(ev.items);
      later(0, () => pushFeed(ev.items));
      const before = new Map((prev?.sides.flat() ?? []).map((u) => [u.uid, u]));
      for (const u of frame.sides.flat()) {
        const b = before.get(u.uid);
        if (!b) continue;
        const da = u.atk - b.atk;
        const dh = u.hp - b.hp;
        if (da > 0 || dh > 0) a()?.popup(u.uid, `+${Math.max(0, da)}/+${Math.max(0, dh)}`, "#4ade80", 0.75);
      }
    } else if (ev.t === "deaths") {
      if (ev.uids.length) {
        s?.play("death");
        for (const uid of ev.uids) {
          a()?.die(uid, (STEP_MS.deaths / speed) * 0.9);
          const dead = prev?.sides.flat().find((u) => u.uid === uid);
          const mat = attackStyle(dead?.defId ?? "n_kid");
          later((STEP_MS.deaths / speed) * 0.25, () => {
            a()?.burst(uid, mat.material === "flesh" ? "#a8a29e" : mat.hitColor, 30, 2.6, 1.9);
            a()?.burst(uid, mat.material === "metal" ? "#fde047" : "#ef4444", 14, 2, 1.2);
            a()?.ring(uid, "#f87171", 1.4);
          });
        }
        later((STEP_MS.deaths / speed) * 0.25, () => a()?.shake(5 + ev.uids.length * 2));
      } else if (prev) {
        const old = new Set(prev.sides.flat().map((u) => u.uid));
        const born = frame.sides.flat().filter((u) => !old.has(u.uid));
        if (born.length) s?.play("summon");
        for (const u of born) {
          a()?.spawn(u.uid);
          later(300, () => {
            a()?.ring(u.uid, "#a7f3d0", 1);
            a()?.burst(u.uid, "#d6d3d1", 12, 1.2, 0.8);
          });
        }
      }
    } else if (ev.t === "end") {
      s?.play(ev.winner === null ? "draw" : ev.winner === viewSide ? "win" : "lose");
      // 롤토체스처럼: 이긴 쪽 아바타가 진 쪽 아바타에게 빛 구슬을 퍼붓는다
      const winKey = ev.winner === null ? null : ev.winner === viewSide ? "bottom" : "top";
      const loseKey = winKey === "bottom" ? "top" : "bottom";
      const loserHp = loseKey === "bottom" ? hp?.[0] : hp?.[1];
      if (winKey && combat.damage > 0 && loserHp !== null && loserHp !== undefined) {
        const dur = 1800 / Math.max(1, speed / 1.5);
        later(250, () => {
          a()?.avatarStrike(winKey, loseKey, combat.damage, dur);
          s?.play("launch_magic");
        });
        const n = Math.max(1, Math.min(12, combat.damage));
        for (let i = 0; i < n; i++) later(250 + 120 + i * Math.max(60, (dur - 570) / n) + 420, () => s?.play("atk_bolt"));
        later(250 + dur, () => {
          setStruck(true);
          s?.play("impactHeavy", combat.damage);
        });
      } else if (winKey) {
        later(300, () => a()?.avatarDance(winKey));
      } else {
        later(300, () => {
          a()?.avatarDance("bottom");
          a()?.avatarDance("top");
        });
      }
    } else if (ev.t === "start") {
      s?.play("clash");
      later(120, () => a()?.shake(6));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // 프레임이 바뀔 때만 연출한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, frames, ready]);

  // 훅은 조기 반환보다 먼저(같은 프레임이면 같은 배열)
  const evNow = frame?.ev;
  const usePrev = !!frame && prev !== null && ((evNow?.t === "attack" && !impacted) || (evNow?.t === "deaths" && evNow.uids.length > 0));
  const sides = frame ? (usePrev && prev ? prev.sides : frame.sides) : null;
  const units = useMemo(() => (sides ? buildUnits(sides, viewSide) : []), [sides, viewSide]);
  if (!frame) return null;
  const ev = frame.ev;
  const heroA = viewSide === 0 ? combat.sideA.hero : combat.sideB.hero;
  const heroB = viewSide === 0 ? combat.sideB.hero : combat.sideA.hero;
  const result = ev.t === "end" ? (ev.winner === null ? "draw" : ev.winner === viewSide ? "win" : "loss") : null;
  // 진 쪽 체력은 구슬이 다 맞을 때까지 피해 전 값
  const loserBottom = combat.winner !== null && combat.winner !== viewSide;
  const shownHp: [number | null, number | null] = [
    hp?.[0] == null ? null : hp[0] + (!struck && loserBottom && combat.winner !== null ? combat.damage : 0),
    hp?.[1] == null ? null : hp[1] + (!struck && !loserBottom && combat.winner !== null ? combat.damage : 0),
  ];
  const avatars = [
    { key: "bottom", hero: heroA, name: names[0], side: 0 as const, hp: shownHp[0], controllable: !!controllable, emote: emotes?.[0] },
    { key: "top", hero: heroB, name: names[1], side: 1 as const, hp: shownHp[1], emote: emotes?.[1] },
  ];
  const attackerName =
    ev.t === "attack" ? (() => {
      const u = [...(prev?.sides.flat() ?? []), ...frame.sides.flat()].find((x) => x.uid === ev.from);
      const t = [...(prev?.sides.flat() ?? []), ...frame.sides.flat()].find((x) => x.uid === ev.to);
      return u ? `${unitDef(u.defId).emoji} ${unitDef(u.defId).name} — ${attackStyle(u.defId).verb}${t ? ` → ${unitDef(t.defId).emoji} ${unitDef(t.defId).name}` : ""}` : null;
    })() : ev.t === "skill" ? (() => {
      const u = [...(prev?.sides.flat() ?? []), ...frame.sides.flat()].find((x) => x.uid === ev.uid);
      return u ? `⚡ ${unitDef(u.defId).emoji} ${unitDef(u.defId).name}의 ${ev.label} — ${ev.text}` : null;
    })() : null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-900/50 bg-stone-950">
      <Arena3D units={units} mode="combat" apiRef={api} quality={quality} avatars={avatars} onReady={() => setReady(true)} className="h-[30rem] w-full sm:h-[32rem]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2 text-xs text-amber-100">
        <span>
          {heroB ? HERO_BY_ID[heroB].emoji : "👻"} {names[1]}
        </span>
        <span className="text-white/50">
          {Math.min(idx + 1, frames.length)} / {frames.length}
        </span>
      </div>
      <AbilityFeed items={feed} />
      {attackerName && (
        <div className="pointer-events-none absolute bottom-9 left-1/2 -translate-x-1/2">
          <span key={idx} className={`tb-banner whitespace-nowrap rounded-full px-3 py-0.5 text-[11px] font-semibold text-white ${ev.t === "skill" ? (ev.side === viewSide ? "bg-sky-700/90" : "bg-fuchsia-900/85") : ev.t === "attack" && ev.side === viewSide ? "bg-emerald-900/80" : "bg-rose-900/80"}`}>
            {attackerName}
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 text-xs text-amber-100">
        {heroA ? HERO_BY_ID[heroA].emoji : "👻"} {names[0]}
      </div>
      {ev.t === "start" && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
          <span key={idx} className="tb-banner rounded-full bg-black/75 px-4 py-1 text-sm font-black tracking-wide text-amber-200 shadow-lg">
            ⚔️ 전투 시작!
          </span>
        </div>
      )}
      {result && (
        <div className="pointer-events-none absolute inset-x-0 top-9 flex justify-center">
          <div className="tb-slam rounded-2xl border border-white/20 bg-black/80 px-6 py-3 text-center shadow-2xl">
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
