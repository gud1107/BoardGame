"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { preferLowDetail, webglAvailable } from "@/games/shared/three/viewPref";
import {
  aliveChance,
  attackRange,
  BANDAGE_COST,
  canBandage,
  computeRankings,
  costOf,
  coverLimitOf,
  DMG,
  hasAug,
  intelValid,
  isLegal,
  lieLimitOf,
  lootTakeOf,
  maxAmmoOf,
  nextMedkitRound,
  reloadGain,
  REVIVE_CHANCE,
  START_HP,
  surgeAt,
  SURGE_ROUND,
  takenRange,
  type GameState,
  type Move,
  type MoveKind,
  type Seat,
  type SeatState,
} from "./engine";
import { buildFx, chantAt, describeEvents, fightersAt, MOVE_LABEL, SHOW } from "./show";
import { SEAT_COLORS } from "./three/PlayDeadArena3D";
import HowToPlay from "./HowToPlay";
import AugmentPicker, { AugChips, nextAugRound } from "./AugmentPicker";
import type { AugId } from "./augments";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { getPlayDeadSound, playDeadIntensity, playDeadSoundCues } from "./playDeadSound";

const PlayDeadArena3D = dynamic(() => import("./three/PlayDeadArena3D"), { ssr: false });

/**
 * 죽은척 대작전 보드 — 3D 전장 + 행동 카드 + 참가자 표 + 라운드 기록.
 * 화면은 공개 정보와 내 정보만 쓴다(남의 목숨·진짜 사망 여부는 결과 공개 전까지 안 보임).
 */

export interface PlayDeadBoardProps {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  deadlineMs: number | null;
  phaseMs: number;
  nowMs: number;
  /** 이번 라운드에 내가 이미 확정한 행동 */
  committedMove: Move | null;
  onCommit: (move: Move) => void;
  onReady: () => void;
  onAugPick: (id: AugId) => void;
  onAugReroll: () => void;
  onGameEnd: () => void;
}

const rg = (r: readonly [number, number]) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}~${r[1]}`);

/** 행동 카드 설명 — 내 증강(비용·피해·한도)을 반영한다 */
function cardHelp(me: SeatState, k: MoveKind): string {
  switch (k) {
    case "reload":
      return `탄약 +${reloadGain(me)}발 (최대 ${maxAmmoOf(me)}발). 일어나 장전하는 동안은 무방비예요`;
    case "cover":
      return `사격·연사를 피해요. 수류탄은 1만 들어와요. ${coverLimitOf(me) > 1 ? `${coverLimitOf(me)}라운드까지 연속 가능` : "두 라운드 연속은 못 써요"}`;
    case "shot":
      return `탄약 ${costOf(me, "shot")}발 · 피해 ${rg(attackRange(me, "shot"))}`;
    case "burst":
      return `탄약 ${costOf(me, "burst")}발 · 피해 ${rg(attackRange(me, "burst"))}${hasAug(me, "apRounds") ? " · 엄폐해도 1" : ""}`;
    case "grenade":
      return `탄약 ${costOf(me, "grenade")}발 · 피해 ${rg(attackRange(me, "grenade"))} · 엄폐해도 1이 들어가요`;
    case "loot":
      return `쓰러진 몸에서 탄약 ${lootTakeOf(me)}발을 챙겨요. 살아 있던 상대가 기습하면 ${rg(DMG.ambushLooter)}+ 피해!`;
    case "finish":
      return `탄약 ${costOf(me, "finish")}발 · 죽은 척이면 ${rg(DMG.finish)} 피해+정체 폭로, 진짜 시체면 사망 확인`;
    case "hold":
      return `계속 누워 있어요. 누운 사람은 사격·연사·수류탄의 표적이 안 돼요 (최대 ${lieLimitOf(me)}라운드)`;
    case "rise":
      return "털고 일어나요. 살아 있다는 게 드러나요";
    case "ambush":
      return `일어나며 ${rg(attackRange(me, "ambush"))} 피해. 나를 털러 온 사람이면 ${rg(attackRange(me, "ambushLooter"))}!`;
    case "bandage":
      return me.dead
        ? `탄약 ${BANDAGE_COST}발 · ${Math.round(REVIVE_CHANCE * 100)}% 확률로 숨이 돌아와요(목숨 1). 누운 채라 남들은 결과를 몰라요`
        : `탄약 ${BANDAGE_COST}발 · 누운 채 목숨 +1 (최대 ${START_HP}). 붕대 감은 건 모두가 봐요`;
  }
}

const STANDING_KINDS: MoveKind[] = ["reload", "cover", "shot", "burst", "grenade", "loot", "finish"];
const DOWN_KINDS: MoveKind[] = ["hold", "rise", "ambush", "bandage"];
const needsTarget = (k: MoveKind) => k === "shot" || k === "burst" || k === "grenade" || k === "loot" || k === "finish" || k === "ambush";

function disabledReason(state: GameState, seat: Seat, kind: MoveKind): string | null {
  const me = state.seats[seat];
  if (kind === "bandage") return me.ammo < BANDAGE_COST ? `탄약 ${BANDAGE_COST}발 필요` : canBandage(me) ? null : "숨이 차서 못 감아요";
  const cost = costOf(me, kind);
  if (cost > 0 && me.ammo < cost) return `탄약 ${cost}발 필요`;
  if (kind === "cover" && me.coverStreak >= coverLimitOf(me)) return "연속 엄폐 불가";
  if (needsTarget(kind) && !state.seats.some((_, t) => t !== seat && isLegal(state, seat, { kind, target: t }))) return kind === "loot" || kind === "finish" ? "쓰러진 사람 없음" : "대상 없음";
  return null;
}

function hearts(n: number) {
  return "❤️".repeat(Math.max(0, n)) + "🖤".repeat(Math.max(0, START_HP - n));
}

export default function PlayDeadBoard(props: PlayDeadBoardProps) {
  const { state, viewerSeat: me, names, onCommit } = props;
  const mine = state.seats[me];
  const [lowDetail] = useState(preferLowDetail);
  useSoundCues(state, getPlayDeadSound, playDeadSoundCues);
  useSuiteBgm(getPlayDeadSound, state.phase !== "ended", playDeadIntensity(state));
  const [gl] = useState(() => webglAvailable());

  // --- 판정 연출 타임라인 -------------------------------------------------
  // 판정 직전의 자리 상태 — 판정 화면에서 "원래 서 있던/누워 있던" 자세로 시작하려고 보관
  const showing = state.phase === "resolved" || state.phase === "ended";
  const [snap, setSnap] = useState<{ stage: number; seats: SeatState[] } | null>(null);
  if (!showing && (snap === null || snap.seats !== state.seats)) setSnap({ stage: state.stage, seats: state.seats });
  const prev = showing && snap && snap.stage < state.stage ? snap.seats : null;
  const [clock, setClock] = useState<{ stage: number; start: number; e: number } | null>(null);
  useEffect(() => {
    if (!showing) return;
    const stage = state.stage;
    const start = performance.now();
    let raf = 0;
    let last = -1;
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      // ~12 updates a second is plenty: the fighters blend their own poses every frame
      if (t - last >= 0.08) {
        last = t;
        setClock({ stage, start, e: t });
      }
      if (t < SHOW.end + 0.3) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showing, state.stage]);
  const live = clock && clock.stage === state.stage ? clock : null;
  const e = prev ? (live?.e ?? 0) : SHOW.end + 1;

  const committedFlags = useMemo(() => state.commits.map((c) => c !== null && c !== "x"), [state.commits]);
  const fighters = useMemo(() => fightersAt(state, prev, me, names, e, committedFlags), [state, prev, me, names, e, committedFlags]);
  const fx = useMemo(() => (prev ? buildFx(state, me) : []), [state, prev, me]);
  const chant = prev ? chantAt(e) : null;

  // --- 내 선택 -------------------------------------------------------------
  const [kind, setKind] = useState<MoveKind | null>(null);
  const [target, setTarget] = useState<Seat | null>(null);
  const [roundSeen, setRoundSeen] = useState(state.round);
  if (roundSeen !== state.round) {
    setRoundSeen(state.round);
    setKind(null);
    setTarget(null);
  }
  const choosing = state.phase === "choosing" && !mine.confirmed && !props.committedMove && state.commits[me] === null;
  const kinds = mine.down ? DOWN_KINDS : STANDING_KINDS;
  const targetsFor = (k: MoveKind) => state.seats.map((_, t) => t).filter((t) => t !== me && isLegal(state, me, { kind: k, target: t }));
  const pickable = choosing && kind && needsTarget(kind) ? targetsFor(kind) : [];
  const ready = kind !== null && (!needsTarget(kind) || (target !== null && pickable.includes(target)));
  function pickKind(k: MoveKind) {
    setKind(k);
    const ts = needsTarget(k) ? targetsFor(k) : [];
    setTarget(ts.length === 1 ? ts[0] : null);
  }
  function submit() {
    if (!kind || !ready) return;
    onCommit(needsTarget(kind) ? { kind, target: target! } : { kind });
  }

  // 시간 초과 직전 자동 확정: 고른 게 있으면 그걸로
  const { deadlineMs, nowMs } = props;
  const autoRef = useRef<number | null>(null);
  useEffect(() => {
    if (!choosing || !deadlineMs || autoRef.current === state.round) return;
    if (deadlineMs - nowMs < 600 && kind && ready) {
      autoRef.current = state.round;
      submit();
    }
  });

  const secsLeft = deadlineMs ? Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000)) : null;
  // 증강 카드: PC 1·2·3 키 · 효과음(카드가 뜰 때 / 내가 고를 때 / 다시 뽑기)
  const { onAugPick: sendAugPick, onAugReroll: sendAugReroll } = props;
  const onAugPick = useCallback(
    (id: AugId) => {
      getPlayDeadSound().play("augPick");
      sendAugPick(id);
    },
    [sendAugPick],
  );
  const onAugReroll = useCallback(() => {
    getPlayDeadSound().play("augReroll");
    sendAugReroll();
  }, [sendAugReroll]);
  const offerKey = state.phase === "augment" && state.aug && !mine.confirmed ? `${state.seed}:${state.round}:${state.aug.tier}` : null;
  useEffect(() => {
    if (!offerKey) return;
    getPlayDeadSound().play("augOffer", Number(offerKey.split(":")[2]));
  }, [offerKey]);
  const augOffer = state.phase === "augment" && state.aug && !state.aug.done[me] ? state.aug.offers[me] : null;
  useEffect(() => {
    if (!augOffer?.length) return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const i = Number(ev.key) - 1;
      if (i >= 0 && i < augOffer.length) onAugPick(augOffer[i]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [augOffer, onAugPick]);
  const augOn = !!state.options.augments;
  const nextAug = augOn ? nextAugRound(state.round) : null;
  const surge = surgeAt(state.round);
  const log = useMemo(() => (showing ? describeEvents(state, names, me) : []), [showing, state, names, me]);
  // don't spoil the reveal: the log and table switch to the new round once bodies have hit the floor
  const revealed = !prev || e >= SHOW.fall;
  const tableState = revealed ? state : { ...state, seats: prev };
  const rankings = useMemo(() => (state.phase === "ended" ? computeRankings(state) : []), [state]);
  const nm = (s: Seat) => (s === me ? "나" : (names[s] ?? `${s + 1}번`));

  // --- 내 생사 연출 (내 화면에만 — 남들은 끝까지 모른다) ----------------------
  const healMe = prev ? state.events.find((ev) => ev.t === "heal" && ev.seat === me) : undefined;
  const healResult = healMe?.t === "heal" ? healMe.result : null;
  const diedNow = !!prev && !prev[me].dead && (mine.dead || healResult === "revived" || healResult === "failed");
  const revivedNow = healResult === "revived";
  const REVIVE_AT = SHOW.fall + 1.4;
  const deathKey = diedNow && e >= SHOW.fall ? `d${state.stage}` : null;
  const reviveKey = revivedNow && e >= REVIVE_AT ? `r${state.stage}` : null;
  const [overlay, setOverlay] = useState<{ kind: "death" | "revive"; key: string } | null>(null);
  const seenOverlay = useRef(new Set<string>());
  useEffect(() => {
    const key = reviveKey ?? deathKey;
    if (!key || seenOverlay.current.has(key)) return;
    seenOverlay.current.add(key);
    const kind = key.startsWith("r") ? "revive" : "death";
    setOverlay({ kind, key });
    getPlayDeadSound().play(kind === "death" ? "myDeath" : "myRevive");
    // 일부러 정리하지 않는다: 다음 라운드로 넘어가도 이 타이머가 닫아 줘야 한다
    window.setTimeout(() => setOverlay((o) => (o?.key === key ? null : o)), kind === "death" ? 7000 : 3800);
  }, [deathKey, reviveKey]);
  /** 지금 화면에 보이는 내 생사(판정 연출이 몸이 쓰러지는 순간까지는 직전 상태) */
  const deadShown = prev && e < SHOW.fall ? prev[me].dead : revivedNow && e < REVIVE_AT ? true : mine.dead;
  const deadVeil = deadShown && !mine.confirmed && state.phase !== "ended";
  const medkitNext = nextMedkitRound(state.phase === "choosing" || state.phase === "augment" ? state.round : state.round + 1);
  const medkitLeft = medkitNext <= state.options.maxRounds ? medkitNext : null;

  return (
    <div onPointerDownCapture={() => getPlayDeadSound().unlock()} className={`flex flex-col gap-3 ${overlay?.kind === "death" ? "animate-[pdShake_0.55s_ease-out]" : ""}`}>
      {overlay && (
        <DeathOverlay
          key={overlay.key}
          kind={overlay.kind}
          ammo={mine.ammo}
          medkitRound={medkitLeft}
          onClose={() => setOverlay(null)}
        />
      )}
      {/* 상단 바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 light:border-slate-200 light:bg-white">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono font-semibold text-amber-300 light:text-amber-600">
            라운드 {state.round} / {state.options.maxRounds}
          </span>
          {surge > 0 ? (
            <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-200 light:bg-rose-100 light:text-rose-700">🔥 총공세 · 모든 피해 +{surge}</span>
          ) : (
            <span className="text-xs text-white/40 light:text-slate-400">{SURGE_ROUND}라운드부터 🔥 총공세</span>
          )}
          {nextAug !== null && state.phase !== "augment" && <span className="text-xs text-fuchsia-200/70 light:text-fuchsia-700">🧬 {nextAug}라운드 전 증강</span>}
          {medkitLeft !== null && state.phase !== "ended" && (
            <span className="text-xs text-emerald-200/80 light:text-emerald-700" title="그 라운드 끝에 쓰러진 몸 하나(무작위)에 떨어져요 — 시체면 50% 소생, 살아 있으면 목숨 +1">
              🎁 {medkitLeft}라운드 구급상자
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <SuiteSoundHud suite={getPlayDeadSound} icon="🪖" label="No Man's Land" preview="surge" />
          {state.phase === "augment" && <span className="rounded-full bg-fuchsia-400 px-2.5 py-1 font-semibold text-slate-900">🧬 증강</span>}
          {(["choosing", "resolved"] as const).map((ph, i) => (
            <span
              key={ph}
              className={`rounded-full px-2.5 py-1 ${
                (ph === "choosing" ? state.phase === "choosing" || state.phase === "revealing" : showing)
                  ? "bg-white text-slate-900 font-semibold light:bg-slate-900 light:text-white"
                  : "border border-white/15 text-white/50 light:border-slate-300 light:text-slate-400"
              }`}
            >
              {i === 0 ? "① 몰래 고르기" : "② 동시 공개"}
            </span>
          ))}
          {secsLeft !== null && state.phase === "choosing" && (
            <span className={`ml-1 w-10 text-right font-mono font-bold ${secsLeft <= 3 ? "text-rose-400" : "text-white/80 light:text-slate-700"}`}>{secsLeft}s</span>
          )}
        </div>
      </div>

      <HowToPlay startOpen={state.round === 1} augments={augOn} />

      {state.phase === "augment" && <AugmentPicker state={state} me={me} secsLeft={secsLeft} onPick={onAugPick} onReroll={onAugReroll} />}

      {/* 전장 */}
      <div className={`relative h-[clamp(300px,58vw,500px)] overflow-hidden rounded-2xl border bg-[#15111f] transition-[filter,border-color] duration-700 ${deadVeil ? "border-rose-700/70 [filter:grayscale(0.65)_brightness(0.85)]" : "border-white/10"}`}>
        {gl ? (
          <PlayDeadArena3D
            seatCount={state.seatCount}
            viewerSeat={me}
            fighters={fighters}
            fx={fx}
            fxStart={live?.start ?? 0}
            pickable={pickable}
            picked={choosing ? target : null}
            onPick={(s) => setTarget(s)}
            lowDetail={lowDetail}
          />
        ) : (
          <div className="grid h-full grid-cols-2 gap-2 p-3 sm:grid-cols-3">
            {fighters.map((f) => (
              <button
                key={f.seat}
                type="button"
                disabled={!pickable.includes(f.seat)}
                onClick={() => setTarget(f.seat)}
                className={`rounded-xl border p-2 text-left text-sm text-white ${target === f.seat ? "border-amber-400" : "border-white/15"}`}
              >
                <div className="font-semibold">{nm(f.seat)}</div>
                <div className="text-xs text-white/60">
                  {f.status ?? "서 있음"} · 탄약 {f.ammo}
                </div>
              </button>
            ))}
          </div>
        )}
        {chant && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span key={chant + Math.floor(e * 2)} className="animate-[pdChant_0.5s_ease-out] font-black text-7xl text-amber-300 drop-shadow-[0_4px_0_rgba(0,0,0,0.6)] sm:text-8xl">
              {chant}
            </span>
          </div>
        )}
        {deadVeil && (
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(120,0,10,0.55)_100%)]">
            <span className="absolute left-2 top-2 rounded-full border border-rose-400/60 bg-black/70 px-2.5 py-1 text-xs font-bold text-rose-200">☠ 사망 상태 · 나만 보여요</span>
          </div>
        )}
        <style>{`@keyframes pdChant { from { transform: scale(1.8); opacity: 0 } 40% { opacity: 1 } to { transform: scale(1); opacity: 1 } }
@keyframes pdShake { 0%,100% { transform: translate(0,0) } 15% { transform: translate(-9px,4px) } 30% { transform: translate(8px,-5px) } 45% { transform: translate(-6px,3px) } 60% { transform: translate(5px,-2px) } 80% { transform: translate(-2px,1px) } }`}</style>
      </div>

      {/* 내 상태 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span>
          내 목숨 <span className="tracking-widest">{hearts(mine.hp)}</span> <span className="rounded border border-dashed border-white/20 px-1.5 text-[11px] text-white/50 light:border-slate-300 light:text-slate-400">🔒 나만 보임</span>
        </span>
        <span>
          내 탄약 <span className="font-mono font-bold text-amber-300 light:text-amber-600">{"●".repeat(mine.ammo)}</span>
          <span className="font-mono text-white/25 light:text-slate-300">{"○".repeat(Math.max(0, maxAmmoOf(mine) - mine.ammo))}</span>
        </span>
        {mine.shield > 0 && <span className="text-xs text-sky-200 light:text-sky-700">🦺 방탄 {mine.shield}회</span>}
        <AugChips seat={mine} />
        {mine.down && !mine.confirmed && (
          <span className="text-xs text-white/60 light:text-slate-500">
            {deadShown
              ? `☠ 죽었어요 — 남들은 몰라요. 🩹 붕대(탄약 ${BANDAGE_COST}발)${medkitLeft !== null ? `나 🎁 ${medkitLeft}라운드 구급상자` : ""}로 ${Math.round(REVIVE_CHANCE * 100)}% 소생할 수 있어요!`
              : `🤫 죽은 척 중 · 누운 지 ${mine.lie}/${lieLimitOf(mine)}`}
          </span>
        )}
      </div>

      {/* 행동 고르기 */}
      {state.phase === "choosing" && !mine.confirmed && (
        <div className="flex flex-col gap-2">
          {choosing ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {kinds.map((k) => {
                  const reason = disabledReason(state, me, k);
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={!!reason}
                      onClick={() => pickKind(k)}
                      className={`flex flex-col gap-0.5 rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        kind === k
                          ? "border-amber-400 bg-amber-400/15 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.8)]"
                          : "border-white/15 bg-white/[0.03] hover:border-white/35 light:border-slate-300 light:bg-white"
                      }`}
                    >
                      <span className="text-sm font-bold text-white light:text-slate-900">
                        {MOVE_LABEL[k].icon} {MOVE_LABEL[k].label}
                      </span>
                      <span className="break-keep text-[11.5px] leading-snug text-white/55 light:text-slate-500">{reason ?? cardHelp(mine, k)}</span>
                    </button>
                  );
                })}
              </div>
              {kind && needsTarget(kind) && (
                <div className="flex flex-wrap items-center gap-1.5 text-sm text-white/70 light:text-slate-600">
                  대상:
                  {pickable.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTarget(t)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                        target === t ? "border-amber-400 bg-amber-400 text-slate-900" : "border-white/20 text-white/80 hover:border-white/40 light:border-slate-300 light:text-slate-700"
                      }`}
                      style={target === t ? undefined : { boxShadow: `inset 3px 0 0 ${SEAT_COLORS[t % SEAT_COLORS.length]}` }}
                    >
                      {nm(t)}
                    </button>
                  ))}
                  <span className="text-xs text-white/40 light:text-slate-400">(3D 무대에서 금색 고리가 생긴 사람을 눌러도 돼요)</span>
                </div>
              )}
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 light:border-slate-200 light:bg-white">
                <span className="flex-1 text-sm text-white/80 light:text-slate-700">
                  {!kind
                    ? "행동 카드를 하나 고르세요."
                    : `${MOVE_LABEL[kind].icon} ${MOVE_LABEL[kind].label}${needsTarget(kind) ? (target !== null ? ` → ${nm(target)}` : " — 대상을 고르세요") : ""}`}
                </span>
                <button type="button" disabled={!ready} onClick={submit} className="rounded-xl bg-amber-400 px-5 py-2 text-sm font-bold text-slate-900 disabled:opacity-40">
                  결정!
                </button>
              </div>
            </>
          ) : (
            <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100 light:text-emerald-700">
              ✅ {props.committedMove ? `${MOVE_LABEL[props.committedMove.kind].icon} ${MOVE_LABEL[props.committedMove.kind].label}${props.committedMove.target !== undefined ? ` → ${nm(props.committedMove.target)}` : ""}` : "결정"} — 다른 사람을 기다리는 중…
            </p>
          )}
        </div>
      )}
      {state.phase === "revealing" && <p className="text-center text-sm text-white/60 light:text-slate-500">모두 결정! 공개하는 중…</p>}
      {mine.confirmed && state.phase !== "ended" && <p className="text-center text-sm text-white/60 light:text-slate-500">☠ 사망이 확인됐어요. 남은 사람들의 연기를 지켜보세요.</p>}

      {/* 라운드 결과 */}
      {showing && revealed && (
        <div className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm light:border-slate-200 light:bg-white">
          {log.map((l, i) => (
            <p key={i} className={`break-keep ${l.mine ? "text-amber-200 light:text-amber-700" : "text-white/80 light:text-slate-700"}`}>
              {l.text}
            </p>
          ))}
          {log.length === 0 && <p className="text-white/50">조용한 라운드…</p>}
          {state.phase === "resolved" && !mine.confirmed && (
            <button type="button" disabled={state.ready[me]} onClick={props.onReady} className="mt-1 self-end rounded-full border border-white/20 px-4 py-1.5 text-xs text-white/80 disabled:opacity-40 light:border-slate-300 light:text-slate-600">
              {state.ready[me] ? "다음 라운드 기다리는 중…" : "다음 라운드 ▶"}
            </button>
          )}
        </div>
      )}

      {/* 참가자 표 (공개 정보 + 추리 보조) */}
      <div className="overflow-x-auto rounded-2xl border border-white/10 light:border-slate-200">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="text-xs text-white/50 light:text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-normal">이름</th>
              <th className="px-2 py-2 text-left font-normal">탄약</th>
              <th className="px-2 py-2 text-left font-normal">상태</th>
              <th className="px-2 py-2 text-left font-normal">맞은 피해</th>
              <th className="px-2 py-2 text-left font-normal">살아 있을 확률</th>
            </tr>
          </thead>
          <tbody>
            {tableState.seats.map((s, seat) => {
              const [lo, hi] = takenRange(s);
              const p = aliveChance(tableState, seat, me);
              const lim = lieLimitOf(s);
              const known = seat !== me && intelValid(tableState.seats[me], seat, s);
              return (
                <tr key={seat} className="border-t border-white/5 text-white/80 light:border-slate-100 light:text-slate-700">
                  <td className="px-3 py-1.5">
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: SEAT_COLORS[seat % SEAT_COLORS.length] }} />
                    {nm(seat)}
                    {s.augs?.length > 0 && (
                      <div className="mt-0.5">
                        <AugChips seat={s} small />
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-amber-300 light:text-amber-600">{s.ammo}</td>
                  <td className="px-2 py-1.5">{s.confirmed ? "☠ 사망 확인" : s.down ? (s.lie >= lim ? "💀 미동도 없음" : `💀 쓰러짐 (${s.lie}/${lim})`) : "🧍 서 있음"}</td>
                  <td className="px-2 py-1.5 font-mono">
                    {seat === me ? `${START_HP - s.hp}` : s.hits.length === 0 ? "0" : lo === hi ? `${lo}` : `${lo}~${hi}`}
                    {(s.heals?.length ?? 0) > 0 && (
                      <span className="ml-1 text-[11px] text-emerald-300 light:text-emerald-700" title="치료 시도(붕대·구급상자) 횟수 — 살아 있을 확률에 반영돼요">
                        🩹{s.heals!.length}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {seat === me ? "—" : s.confirmed ? "0%" : !s.down ? "서 있음" : known ? <span className="font-semibold text-sky-200 light:text-sky-700">🩺 {p > 0 ? "살아 있음" : "진짜 시체"}</span> : `${Math.round(p * 100)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 결과 공개 */}
      {state.phase === "ended" && (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 light:bg-amber-50">
          <h3 className="text-base font-bold text-white light:text-slate-900">🎭 정체 공개!</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {rankings.map((r) => {
              const s = state.seats[r.seat];
              return (
                <li key={r.seat} className={r.rank === 1 ? "font-bold text-amber-200 light:text-amber-700" : "text-white/80 light:text-slate-700"}>
                  {r.rank}위 {nm(r.seat)} — {s.dead ? `☠ ${s.diedRound}라운드에 사망` : s.down ? "😏 사실 살아 있었다 (죽은 척 중)" : "🧍 생존"} · 남은 목숨 {s.hp}
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={props.onGameEnd} className="self-end rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-slate-900">
            결과 확인
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * ☠ 내가 진짜로 죽은 순간 / 💓 소생한 순간 — 내 화면에만 뜬다(남의 화면엔 같은 "털썩"만).
 * 붉은 섬광·화면 흔들림·심전도가 일자로 멈추는 연출 뒤, 살아날 방법을 바로 알려 준다.
 */
function DeathOverlay({ kind, ammo, medkitRound, onClose }: { kind: "death" | "revive"; ammo: number; medkitRound: number | null; onClose: () => void }) {
  const death = kind === "death";
  // 화면 흔들림(transform)이 걸린 보드 밖으로 — 안에 두면 fixed가 보드 기준으로 붙는다
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center px-4" role="alert" aria-live="assertive">
      <style>{`
@keyframes pdFlash { 0% { opacity: 0 } 6% { opacity: 1 } 30% { opacity: .75 } 100% { opacity: .55 } }
@keyframes pdSlam { 0% { transform: scale(2.6); opacity: 0; letter-spacing: .4em } 18% { transform: scale(.92); opacity: 1 } 26% { transform: scale(1.04) } 34%,100% { transform: scale(1); letter-spacing: .02em } }
@keyframes pdDrip { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes pdEkg { from { stroke-dashoffset: 620 } to { stroke-dashoffset: 0 } }
@keyframes pdRise { from { transform: translateY(16px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes pdBeat { 0%,100% { transform: scale(1) } 12% { transform: scale(1.18) } 24% { transform: scale(1) } 36% { transform: scale(1.12) } }
@keyframes pdGlow { 0% { opacity: 0 } 15% { opacity: .9 } 100% { opacity: .35 } }`}</style>
      {death ? (
        <>
          <div className="absolute inset-0 animate-[pdFlash_1.4s_ease-out_forwards] bg-[radial-gradient(ellipse_at_center,rgba(80,0,8,0.55)_0%,rgba(40,0,4,0.88)_65%,rgba(0,0,0,0.95)_100%)]" />
          {/* 화면 위에서 흘러내리는 핏줄기 */}
          <div className="absolute inset-x-0 top-0 flex justify-around">
            {[38, 62, 28, 74, 46, 56, 33].map((h, i) => (
              <span key={i} className="w-[clamp(6px,1.6vw,14px)] origin-top animate-[pdDrip_1.6s_cubic-bezier(.3,.6,.4,1)_forwards] rounded-b-full bg-gradient-to-b from-[#7a0710] to-[#b3121c]" style={{ height: `${h}vh`, animationDelay: `${0.1 + i * 0.12}s`, transform: "scaleY(0)" }} />
            ))}
          </div>
        </>
      ) : (
        <div className="absolute inset-0 animate-[pdGlow_1.2s_ease-out_forwards] bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.35)_0%,rgba(5,46,22,0.7)_70%)]" />
      )}
      <div className="relative flex w-full max-w-md flex-col items-center gap-3 text-center">
        <p
          className={`animate-[pdSlam_0.9s_cubic-bezier(.2,.9,.3,1)_forwards] font-black leading-none ${death ? "text-[clamp(44px,13vw,84px)] text-[#ff2a36] [text-shadow:0_0_24px_rgba(255,0,20,0.75),0_5px_0_#3b0005]" : "animate-[pdBeat_1.1s_ease-in-out_2] text-[clamp(40px,12vw,76px)] text-emerald-300 [text-shadow:0_0_24px_rgba(74,222,128,0.8)]"}`}
        >
          {death ? "☠ 사망" : "💓 소생!"}
        </p>
        <svg viewBox="0 0 300 60" className="h-12 w-[min(90vw,340px)]" aria-hidden>
          <path
            d={death ? "M0 30 H60 L70 12 L80 48 L90 30 H130 L138 18 L146 42 L152 30 H300" : "M0 30 H40 L48 30 H80 L90 8 L100 52 L110 30 H160 L170 8 L180 52 L190 30 H240 L250 8 L260 52 L270 30 H300"}
            fill="none"
            stroke={death ? "#ff3b47" : "#4ade80"}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeDasharray="620"
            className="animate-[pdEkg_1.6s_linear_forwards]"
            style={{ filter: `drop-shadow(0 0 6px ${death ? "#ff0018" : "#22c55e"})` }}
          />
        </svg>
        <p className="animate-[pdRise_0.5s_ease-out_0.7s_both] break-keep text-base font-bold text-white sm:text-lg">
          {death ? "당신은 진짜로 죽었습니다 — 목숨 0" : "기적처럼 숨이 돌아왔어요 — 목숨 1"}
        </p>
        <p className="animate-[pdRise_0.5s_ease-out_0.9s_both] break-keep text-sm text-white/75">
          {death ? "🔒 다른 사람들은 아직 몰라요. 숨죽인 채 끝까지 연기하세요!" : "겉으론 여전히 쓰러져 있어서 남들은 몰라요. 기회를 노리세요!"}
        </p>
        {death && (
          <div className="pointer-events-auto mt-1 w-full animate-[pdRise_0.5s_ease-out_1.5s_both] rounded-2xl border border-emerald-400/40 bg-black/75 p-3 text-left text-[13px] text-white/85">
            <p className="mb-1.5 font-bold text-emerald-300">💓 아직 끝이 아니에요 — 살아날 수 있는 방법</p>
            <ul className="flex flex-col gap-1">
              <li className="break-keep">
                🩹 <b>붕대 감기</b> — 쓰러진 채 탄약 {BANDAGE_COST}발, {Math.round(REVIVE_CHANCE * 100)}% 소생{" "}
                <span className={ammo >= BANDAGE_COST ? "text-emerald-300" : "text-rose-300"}>(지금 탄약 {ammo}발{ammo >= BANDAGE_COST ? " ✓" : " — 부족해요"})</span>
              </li>
              <li className="break-keep">
                🎁 <b>구급상자 낙하</b> — {medkitRound !== null ? `${medkitRound}라운드 끝, 쓰러진 몸 중 하나에 떨어져요` : "이번 판엔 더 안 떨어져요"} ({Math.round(REVIVE_CHANCE * 100)}% 소생)
              </li>
              <li className="break-keep text-white/60">🔪 단, 그 전에 확인사살을 당하면 그대로 끝 · 숨 참기 한도가 지나면 붕대도 못 감아요</li>
            </ul>
            <button type="button" onClick={onClose} className="mt-2 w-full rounded-xl bg-white/10 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
              알겠어요
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
