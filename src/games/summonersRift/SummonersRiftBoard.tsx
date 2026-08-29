"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Avatar from "@/components/common/Avatar";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RulebookModal from "./RulebookModal";
import SummonersRiftLastRoundModal from "./SummonersRiftLastRoundModal";
import SummonersRiftGuideSidebar from "./SummonersRiftGuideSidebar";
import { CardPileStack, HeroCard, ItemSlot, MonsterFace, RemovedItemsRow } from "./CardArt";
import { detectRiftPushEvent, FlyingRiftCard, NamedMonsterDim, type RiftPushEvent } from "./SummonersRiftEffects";
import {
  computeRankings,
  computeTotalHp,
  getMonsterDef,
  ITEM_CATALOG,
  MONSTER_CATALOG,
  SUCCESS_TOKENS_TO_WIN,
  FAILURE_TOKENS_TO_ELIMINATE,
  type CombatLogEntry,
  type EngineAction,
  type ItemId,
  type RoundResult,
  type SeatIndex,
  type SummonersRiftState,
} from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (including the exact
 * identity of `pendingDraw` and every card in the deck/Rift pile) per this
 * project's lockstep trust model, but a card's identity is meant to stay
 * secret from *opponents* by the physical rules — enforced here only: only
 * `pendingDraw.seat === viewerSeat` ever reveals the drawn monster's face,
 * and the Rift pile always renders as `DeckBack`s (see engine.ts's module
 * doc, and bang!/avalon/five-cucumbers for the same UI-only-hiding pattern).
 */
export interface SummonersRiftBoardProps {
  state: SummonersRiftState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

/** Exported so `SummonersRiftLastRoundModal.tsx` can render the exact same kill/damage badge for a completed round's `combatLog` entries. */
export function combatBadge(entry: RoundResult["combatLog"][number]) {
  return entry.killedBy ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200">
      ✅ 처치
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/50 bg-rose-400/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-200">
      🩸 -{entry.damageTaken}
    </span>
  );
}

/**
 * A single `combatLog` entry mid-animation, plus the HP it resolved *from* —
 * `entry.hpAfter` alone can't reconstruct that once later entries have moved
 * on. Drives both `HpBanner`'s transition text and which `ItemSlot`/turn-panel
 * button locks for the duration (task brief §2/§4 "전투 연출 템포").
 *
 * 2026-08-30 마지막 카드 홀드 세션: `totalHp` is snapshotted here (not read live
 * off `state.totalHp`) because the *round- or game-ending* reveal is the one
 * case where the engine resets/moves on `totalHp`/`combatLog` in the very
 * same lockstep action that produced this flash (`dealRound` nulls `totalHp`
 * for the next round's bidding phase; `finishRound`→`gameOver` just leaves it
 * be, but by then the component can no longer trust "current phase" to tell
 * it which fields are still live) — so every renderer of a flash reads
 * entirely from this object instead of cross-referencing `state`. `key` is a
 * monotonic counter (see `nextFlashKeyRef` in the board component) used to
 * force-remount the flip/shake animations on every new flash — `state.combatLog.length`
 * used to serve this purpose but collides with itself once `dealRound` resets
 * that array back to 0 for the next round, so this pairs the round number
 * (monotonic for the whole game) with the in-round entry index instead —
 * globally unique with no ref/counter needed (a plain incrementing ref can't
 * be touched during render, and this render-time diff block is exactly that).
 */
interface CombatFlashState {
  entry: CombatLogEntry;
  hpBefore: number;
  totalHp: number;
  key: string;
}

/**
 * 2026-08-30 던전 몬스터 등장 연출 세션 (AskUserQuestion "5초 타이머 구조" — 기존
 * 사후 연출 잠금 확장안 채택) — `revealNextMonster`는 여전히 등장과 전투 판정이
 * 한 액션에서 동시에 일어나는 순수 리듀서 그대로이고(엔진 미변경), 이 상수는
 * 그 판정 *이후* 결과 화면(대형 HP바 + 등장 기록)을 화면에 붙잡아두는 시간이다.
 * 예전엔 이 값 자체가 1700ms였고 그 시간이 지나면 곧장 "다음 몬스터 공개"가
 * 풀렸는데, 그게 사용자가 말한 "너무 빨리 넘어가는" 원인이었다 — 이제 5000ms로
 * 늘리고 [⏩ 스킵]으로 조기 종료할 수 있게 한다. 모든 클라이언트가 동일한
 * `combatLog` 증가를 보고 동시에 이 타이머를 로컬에서 각자 시작하므로(락스텝
 * state diff 기반, 서버 타임스탬프 없음) 여전히 같은 트리거 지점에서 함께
 * 시작되지만, 스킵은 로컬(뷰어 개인)에만 적용된다 — 다른 클라이언트의 타이머는
 * 그대로 흐른다(AskUserQuestion "스킵 범위" — 로컬 스킵안 채택, 엔진 액션 불필요).
 */
const ENCOUNTER_HOLD_MS = 5000;
/** HP 배너의 피격 흔들림/플래시와 격투 게임 스타일 데미지 트레일 게이지가 따라잡는 데 걸리는 시간(AskUserQuestion "트레일 길이" — 요청 예시 범위 400ms 채택) — `ENCOUNTER_HOLD_MS`와 분리해 두어, 5초 동안 화면은 붙잡아두되 흔들림 자체는 느려지지 않고 처음 400ms에만 짧고 경쾌하게 재생된다. */
const HIT_FLASH_MS = 400;
/** 패스 선언 시 스탬프 슬램/로우 쉐이크/글로우 플래시(`rift-pass-badge-slam`/`rift-pass-row-shake`/`rift-pass-glow-flash`, 전부 globals.css)가 재생되는 시간 — 이 시간이 지나면 `passFlash`를 지워 1회성 임팩트 연출을 종료한다. 패스 자체의 지속 배지/딤 처리는 `p.passed`가 살아있는 한(다음 라운드 `dealRound`가 리셋할 때까지) 별도로 계속 남는다. */
const PASS_FLASH_MS = 650;

/**
 * 5초 유지 창(`ENCOUNTER_HOLD_MS`) 동안 채워진 채로 시작해 선형으로 0%까지
 * 줄어드는 얇은 진행 바 — "5초 후 시작 텍스트 안내 병행"(작업 지시 §1)을 위한
 * 시각 보조. `key={durationMs}` 방식 대신 부모(`HpBanner`)가 `combatLog.length`로
 * 매 조우마다 이 컴포넌트를 새로 마운트시키므로, 매번 100%에서 다시 시작한다 —
 * FlyingRiftCard와 동일한 "즉시 전이 없음 상태로 시작값 고정 → reflow 강제 →
 * transition 재활성화" 기법.
 */
function EncounterProgressBar({ durationMs }: { durationMs: number }) {
  const barRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.width = "100%";
    void el.offsetHeight;
    el.style.transition = `width ${durationMs}ms linear`;
    const raf = requestAnimationFrame(() => {
      const live = barRef.current;
      if (live) live.style.width = "0%";
    });
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div ref={barRef} className="h-full rounded-full" style={{ background: "linear-gradient(90deg,#f0d48a,#c8933e)" }} />
    </div>
  );
}

/** 위 진행 바와 짝을 이루는 "N초 후 자동으로..." 숫자 안내 — `setInterval`로 200ms마다 남은 초를 재계산한다(경과 시각은 마운트 시각 기준 `Date.now()` 차로 계산해 탭 비활성 등으로 인한 틱 밀림에도 어긋나지 않음). 부모가 매 조우마다 새로 마운트시키므로 항상 `durationMs`초에서 다시 시작한다. */
function EncounterCountdown({ durationMs }: { durationMs: number }) {
  const [remaining, setRemaining] = useState(Math.ceil(durationMs / 1000));
  // `Date.now()` is an impure call, so it can't sit in the render body (or a
  // bare `useRef(Date.now())` initializer, which runs during render too) —
  // it's read for the first time inside the effect below instead, which only
  // ever runs after render has committed.
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    startRef.current = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - (startRef.current ?? Date.now());
      setRemaining(Math.max(0, Math.ceil((durationMs - elapsed) / 1000)));
    }, 200);
    return () => clearInterval(id);
  }, [durationMs]);
  return <>{remaining}</>;
}

/**
 * Task brief §2 "용사의 현재 체력(HP)을 중앙에 크게" — a large, always-visible HP
 * readout for the dungeon-combat phases. 2026-08-30 세션(AskUserQuestion "HP 바
 * 대상" — 챔피언 공유 체력에만 적용 채택)에서 텍스트 전용 배너를 두껍고 큼직한
 * 게이지 바(`h-6 sm:h-8, rounded-full`)로 확장하고, 격투 게임 스타일 데미지
 * 트레일(즉시 반응하는 앞쪽 게이지 + `HIT_FLASH_MS` 동안 뒤늦게 따라 줄어드는
 * 붉은/노란 잔상 게이지)과 5초 유지 카운트다운 + [⏩ 스킵] 버튼을 추가했다.
 * `flash`가 살아있는 동안(=`ENCOUNTER_HOLD_MS` 전체) 계속 렌더링되지만, 흔들림/
 * 플래시 애니메이션 자체는 `key={flashKey}` 리마운트 덕에 `HIT_FLASH_MS` 동안만
 * 짧게 재생되고 그 뒤엔 정적인 결과 표시로 5초를 채운다. 몬스터 자체의 HP 풀은
 * 규칙상 존재하지 않으므로(1회성 고정 데미지 판정) 몬스터용 게이지는 만들지
 * 않는다 — `MonsterFace` 쪽은 기존 등장/처치 카드 연출만 그대로 유지.
 */
function HpBanner({
  state,
  flash,
  onSkip,
}: {
  state: SummonersRiftState;
  flash: CombatFlashState | null;
  onSkip: () => void;
}) {
  // 2026-08-30 마지막 카드 홀드 세션: `flash`가 살아있는 동안엔 그 자신의 스냅샷
  // (`flash.totalHp`/`flash.entry.hpAfter`)을 우선한다 — 라운드/게임을 끝낸
  // 마지막 조우일 경우 이 시점엔 이미 `state.totalHp`/`currentHp`가 `null`로
  // 리셋돼 있을 수 있어(다음 라운드 `dealRound`가 같은 액션에서 동시에 실행됨),
  // 예전처럼 `state`만 보고 얼리 리턴하면 정작 가장 붙잡아둬야 할 마지막 조우의
  // 배너가 통째로 사라져버린다.
  const maxHp = flash ? flash.totalHp : state.totalHp;
  const curHp = flash ? Math.max(0, flash.entry.hpAfter) : state.currentHp !== null ? Math.max(0, state.currentHp) : null;
  if (maxHp === null || curHp === null) return null;
  const pct = maxHp > 0 ? Math.min(100, (curHp / maxHp) * 100) : 0;
  const isDamageFlash = flash !== null && !flash.entry.killedBy;
  const flashKey = flash?.key ?? "";

  return (
    <section
      className="flex flex-col items-center gap-2 rounded-2xl border p-3"
      style={{ borderColor: "rgba(200,170,110,0.3)", background: "linear-gradient(160deg,#241418 0%,#160c0e 55%,#0a0506 100%)" }}
    >
      <span className="text-[10px] font-semibold tracking-wide uppercase" style={{ color: "#c8aa6e" }}>
        ❤️ 용사 체력
      </span>

      {/* 결과 숫자 — 처치 시엔 "처치! HP 유지", 피격 시엔 "이전 ➔ 이후 (-데미지)"를 5초 내내 정적으로 표시. 흔들림/펄스 애니메이션만 key로 재마운트해 HIT_FLASH_MS 동안 재생. */}
      {flash ? (
        flash.entry.killedBy ? (
          <div key={flashKey} className="flex items-center gap-2" style={{ animation: `rift-hp-kill-pulse ${HIT_FLASH_MS}ms ease-out` }}>
            <span className="text-2xl font-black text-emerald-300">⚔️ 처치!</span>
            <span className="text-lg font-bold text-white/70">HP {flash.hpBefore} 유지</span>
          </div>
        ) : (
          <div key={flashKey} className="flex items-center gap-2 text-3xl font-black text-white" style={{ animation: `rift-hp-damage-flash ${HIT_FLASH_MS}ms ease-out` }}>
            <span>{flash.hpBefore}</span>
            <span className="text-xl text-white/40">➔</span>
            <span className="text-rose-300">{flash.entry.hpAfter}</span>
            <span className="text-base font-semibold text-rose-300/80">(-{flash.entry.damageTaken})</span>
          </div>
        )
      ) : (
        <span className="text-3xl font-black text-white">
          {state.currentHp} <span className="text-lg font-semibold text-white/40">/ {state.totalHp}</span>
        </span>
      )}

      {/* 대형 게이지 바 — 작업 지시 §2 "h-6 sm:h-8, rounded-full" + 중앙 굵은 텍스트. 피격 시 좌우로 흔들리고(rift-hp-hit-shake) 붉게 번쩍인다(brightness/saturate). */}
      <div
        key={`bar-${flashKey}`}
        className="relative h-6 w-full max-w-xs overflow-hidden rounded-full border sm:h-8"
        style={{
          borderColor: "rgba(220,60,60,0.4)",
          background: "rgba(0,0,0,0.45)",
          animation: isDamageFlash ? `rift-hp-hit-shake ${HIT_FLASH_MS}ms ease-out` : undefined,
        }}
      >
        {/* 잔상(트레일) 게이지 — 앞쪽 게이지와 같은 최종 목표치(pct)로 향하지만 전이 시간이 훨씬 길어(HIT_FLASH_MS), 앞쪽이 먼저 줄어든 뒤 이 노란/붉은 잔상이 뒤늦게 따라 줄어드는 것처럼 보인다. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: "linear-gradient(90deg,#f0b94a,#e0533f)", transition: `width ${HIT_FLASH_MS}ms ease-out` }}
        />
        {/* 앞쪽 게이지 — 즉시(빠르게) 반응해 현재 HP%로 스냅. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: "linear-gradient(90deg,#8fe3c0,#2fae86)", transition: "width 120ms ease-out" }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-xs font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] sm:text-sm">
          {curHp.toLocaleString()} / {maxHp.toLocaleString()} HP
        </div>
      </div>

      {/* 5초 유지 카운트다운 + 스킵 — 작업 지시 §1. flash가 살아있는 동안(ENCOUNTER_HOLD_MS 전체)만 렌더링. */}
      {flash && (
        <div key={`skip-${flashKey}`} className="flex w-full max-w-xs flex-col items-center gap-1.5">
          <EncounterProgressBar durationMs={ENCOUNTER_HOLD_MS} />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/45">
              <EncounterCountdown durationMs={ENCOUNTER_HOLD_MS} />초 후 자동으로 다음 몬스터 공개
            </span>
            <button
              onClick={onSkip}
              className="rounded-full px-4 py-1.5 text-[11px] font-black text-black shadow-[0_0_16px_rgba(90,240,200,0.55)] transition hover:brightness-110 active:scale-95"
              style={{ background: "linear-gradient(135deg,#7dfcd0,#12b892)" }}
            >
              ⏩ 스킵
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Task brief §3 "좌측 던전 출현 몬스터 누적 나열 패널" — every monster revealed so far
 * *this dungeon run*, oldest first, each badged with its outcome. Rendered as the
 * leftmost of three columns on wide screens and the topmost block on narrow ones
 * (see the root layout in `SummonersRiftBoard`'s default export) — only while
 * there's an active challenge (`declaringSpatula`/`resolvingRift`), matching
 * `HpBanner`'s same live-HP window. Auto-scrolls to the newest entry so a long
 * dungeon run never needs a manual scroll to see what just happened.
 *
 * `entries` is passed in rather than derived from `state.combatLog` here
 * (2026-08-30 마지막 카드 홀드 세션) because the round/game-ending reveal is held
 * on screen *after* `state.phase` has already moved past `resolvingRift` and
 * `state.combatLog` has already been reset by the same action — the caller
 * resolves the correct source (`state.combatLog` live, or the just-finished
 * `state.lastRoundResult.combatLog` during that terminal hold) once.
 */
function MonsterHistoryPanel({ state, entries }: { state: SummonersRiftState; entries: CombatLogEntry[] }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <aside
      className="flex w-full shrink-0 flex-col gap-2 rounded-[24px] border p-3 text-xs lg:w-56"
      style={{ borderColor: "rgba(200,170,110,0.25)", background: "linear-gradient(160deg,#151b28 0%,#0d121c 45%,#06090f 100%)" }}
    >
      <h3 className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: "#c8aa6e" }}>
        📜 등장 몬스터 기록
      </h3>
      {entries.length === 0 ? (
        <p className="px-1 py-4 text-center text-[10px] leading-relaxed text-white/35">
          {state.phase === "declaringSpatula" ? "황금 뒤집개 지정 후 몬스터가 공개되면 여기 기록됩니다." : "아직 공개된 몬스터가 없습니다."}
        </p>
      ) : (
        <div ref={listRef} className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-0.5 lg:max-h-[65vh]">
          {entries.map((entry, i) => (
            <div
              key={entry.monster.id}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-1.5"
            >
              <span className="w-4 shrink-0 text-center text-[9px] font-bold text-white/30">{i + 1}</span>
              <MonsterFace threat={entry.monster.threat} size="sm" />
              <div className="flex flex-1 flex-col items-start gap-1">
                {combatBadge(entry)}
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

export default function SummonersRiftBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: SummonersRiftBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [lastRoundOpen, setLastRoundOpen] = useState(false);

  // Diff consecutive lockstep snapshots to notice a freshly-resolved round
  // (flash banner) and freshly-pushed Rift cards (fly-in FX) — same pattern
  // as every other `<Game>Board.tsx` here (see FiveCucumbersBoard.tsx).
  const [trackedState, setTrackedState] = useState(state);
  const [roundFlash, setRoundFlash] = useState<RoundResult | null>(null);
  const [pushEvents, setPushEvents] = useState<RiftPushEvent[]>([]);
  const [combatFlash, setCombatFlash] = useState<CombatFlashState | null>(null);
  /** 방금 패스를 선언한 좌석 — 스탬프 슬램/쉐이크/글로우 1회성 연출(`PASS_FLASH_MS` 뒤 자동 해제)만 담당한다. 지속 배지/딤 처리는 `state.players[seat].passed`를 직접 읽어 렌더하므로 이 값과 무관하게 라운드 끝까지 남는다. */
  const [passFlash, setPassFlash] = useState<{ seat: SeatIndex } | null>(null);
  if (trackedState !== state) {
    const newRound = state.lastRoundResult !== trackedState.lastRoundResult ? state.lastRoundResult : null;
    const push = detectRiftPushEvent(trackedState, state);
    // 방금 false -> true로 뒤집힌 좌석의 `passed` 찾기 — 락스텝 state가 모든
    // 클라이언트에 동일하게 동기화되므로, 패스를 누른 당사자뿐 아니라 다른
    // 모든 플레이어의 화면에서도 이 렌더에서 동시에 감지되어 요청서의 "다른
    // 플레이어들이 명확히 인지" 요구를 만족한다(combatFlash/pushEvents와 같은
    // state-diff 트리거 패턴).
    const justPassed = state.players.find((p) => {
      const prev = trackedState.players.find((pp) => pp.seat === p.seat);
      return p.passed && prev && !prev.passed;
    });
    // Captured before `trackedState` is replaced below, so it's "how many
    // entries this dungeon run had last render" — `combatLog` resets to `[]`
    // at both `enterDungeon` and the next `dealRound`, so comparing against
    // this (rather than a persistent counter) already restarts at 0 for
    // every fresh challenge with no separate reset step needed (task brief
    // §2/§4 "전투 연출 템포": flash exactly the newest live entry once).
    const priorCombatLogLength = trackedState.combatLog.length;
    setTrackedState(state);
    if (newRound) setRoundFlash(newRound);
    if (push) setPushEvents((prev) => [...prev, { ...push, id: (prev.at(-1)?.id ?? 0) + 1 }]);
    if (justPassed) {
      setPassFlash({ seat: justPassed.seat });
      getSoundEngine().playPassSeal();
    }

    if (state.phase === "resolvingRift" && state.combatLog.length > priorCombatLogLength) {
      // Ordinary mid-run reveal — `phase` hasn't moved on, so the new entry
      // is still live at `state.combatLog[index]`.
      const index = priorCombatLogLength;
      const hpBefore = index === 0 ? state.totalHp! : state.combatLog[index - 1].hpAfter;
      setCombatFlash({ entry: state.combatLog[index], hpBefore, totalHp: state.totalHp!, key: `${trackedState.roundNumber}-${index}` });
    } else if (newRound && newRound.combatLog.length > priorCombatLogLength) {
      // 2026-08-30 마지막 카드 홀드 버그 수정 — 라운드(또는 게임)를 끝내는 "마지막"
      // 몬스터 공개는 `revealNextMonster` 한 액션 안에서 `finishRound`(→ 다음
      // 라운드로 넘어가면 `dealRound`가 `combatLog`/`totalHp`까지 동시에 리셋,
      // 게임이 끝나면 `phase: "gameOver"`로 즉시 전환)까지 함께 실행된다. 그
      // 결과 위 분기가 이 렌더를 볼 때는 이미 `state.phase !== "resolvingRift"`
      // 이고 `state.combatLog`도 비워진 뒤라, 정작 가장 오래 붙잡아둬야 할
      // "라운드/매치의 마지막 카드"만 조우 유지 플래시가 걸리지 않고 화면이
      // 곧장 다음 라운드(bidding)나 트로피 화면(gameOver)으로 전환돼버렸다 —
      // 이번 세션에서 신고된 버그의 근본 원인. `finishRound`는 리셋되기
      // *이전*의 전체 `combatLog`를 `lastRoundResult.combatLog`에 그대로 복사해
      // 두므로, 거기서 놓친 마지막 엔트리를 복구한다.
      const index = priorCombatLogLength;
      const hpBefore = index === 0 ? newRound.totalHp : newRound.combatLog[index - 1].hpAfter;
      setCombatFlash({ entry: newRound.combatLog[index], hpBefore, totalHp: newRound.totalHp, key: `${newRound.roundNumber}-${index}` });
    }
  }
  useEffect(() => {
    if (!roundFlash) return;
    const t = setTimeout(() => setRoundFlash(null), 5200);
    return () => clearTimeout(t);
  }, [roundFlash]);
  useEffect(() => {
    if (!passFlash) return;
    const t = setTimeout(() => setPassFlash(null), PASS_FLASH_MS);
    return () => clearTimeout(t);
  }, [passFlash]);
  // 조우 유지 타이머 — combatFlash가 새로 생길 때마다 ENCOUNTER_HOLD_MS 뒤에
  // 자동으로 잠금 해제한다. 타임아웃 id를 ref에 보관해두는 이유는 [⏩ 스킵]이
  // 눌렸을 때 이 자동 타이머를 즉시 취소하고 바로 잠금을 풀기 위해서 — 스킵은
  // 로컬(이 뷰어) 한정이라 다른 클라이언트의 동일 useEffect는 그대로 5초를 채운다.
  const encounterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!combatFlash) return;
    const t = setTimeout(() => setCombatFlash(null), ENCOUNTER_HOLD_MS);
    encounterTimeoutRef.current = t;
    return () => {
      clearTimeout(t);
      encounterTimeoutRef.current = null;
    };
  }, [combatFlash]);
  const handleSkipEncounter = useCallback(() => {
    if (encounterTimeoutRef.current) clearTimeout(encounterTimeoutRef.current);
    setCombatFlash(null);
  }, []);
  const handlePushDone = useCallback((id: number) => {
    setPushEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const seatRowRefs = useRef(new Map<SeatIndex, HTMLElement>());
  const riftStackRef = useRef<HTMLDivElement | null>(null);
  function setSeatRowRef(seat: SeatIndex) {
    return (el: HTMLElement | null) => {
      if (el) seatRowRefs.current.set(seat, el);
      else seatRowRefs.current.delete(seat);
    };
  }

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 소환사의 협곡 룰북
    </button>
  );
  // Task brief §1 — "운명전쟁 스타일 직전 라운드 요약 UI": header toggle button,
  // disabled until a round has actually finished, opening the combined
  // summary+breakdown modal. Same pattern as destinyWar39's historyButton.
  const lastRoundButton = (
    <button
      onClick={() => setLastRoundOpen(true)}
      disabled={!state.lastRoundResult}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
    >
      🕓 직전 라운드 결과
    </button>
  );
  const lastRoundModal = lastRoundOpen && <SummonersRiftLastRoundModal state={state} names={names} onClose={() => setLastRoundOpen(false)} />;

  // 2026-08-30 마지막 카드 홀드 세션 — `combatFlash`가 살아있는데 `state.phase`가
  // 이미 "resolvingRift"를 벗어나 있다면(= 위 diff 블록의 두 번째 분기가 방금
  // 돌았다는 뜻), 이건 라운드나 게임을 끝낸 "마지막 카드"의 조우 유지 창이다.
  // 이 플래그가 true인 동안은 아래 gameOver 얼리 리턴과 `TurnPanel`이 곧장
  // 다음 화면(트로피/다음 라운드 입력)으로 넘어가지 않고 이 조우를 계속
  // 붙잡아 보여준다 — 자동 5초 경과 또는 [⏩ 스킵]으로 `combatFlash`가 다시
  // `null`이 되면 자연히 풀린다.
  const isHoldingFinalReveal = combatFlash !== null && state.phase !== "resolvingRift";

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver" && !isHoldingFinalReveal) {
    const rankings = computeRankings(state);
    const winner = rankings.find((r) => r.rank === 1)!;
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ borderColor: "rgba(200,170,110,0.4)", background: "linear-gradient(160deg,#1b1408 0%,#120d05 55%,#080502 100%)" }}
      >
        <span className="text-5xl">🏆</span>
        <h2 className="text-2xl font-bold" style={{ color: "#e8c77a" }}>
          {names[winner.seat]}님, 협곡의 최종 승자!
        </h2>
        <p className="max-w-sm text-xs text-white/50">
          {winner.successTokens >= SUCCESS_TOKENS_TO_WIN
            ? `성공 토큰 ${SUCCESS_TOKENS_TO_WIN}개를 가장 먼저 모아 승리했습니다.`
            : "다른 모든 소환사가 탈락해 최후의 생존자로 승리했습니다."}
        </p>
        <div className="flex justify-center">{lastRoundButton}</div>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">소환사</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">성공</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">실패</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank, successTokens, failureTokens, eliminated }) => (
                <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold" style={{ color: rank === 1 ? "#e8c77a" : undefined }}>
                    {rank === 1 ? "🏆 1" : rank}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                    <span className="flex items-center gap-1.5">
                      <Avatar size={20} />
                      {names[seat]}
                      {seat === viewerSeat && <span style={{ color: "#e8c77a" }}>(나)</span>}
                      {eliminated && <span className="text-rose-300">💀</span>}
                    </span>
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-emerald-200">
                    {"🏆".repeat(successTokens) || "—"}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-rose-200">{"💀".repeat(failureTokens) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          onClick={onGameEnd}
          className="rounded-full px-8 py-3 font-medium text-black transition hover:brightness-110"
          style={{ background: "linear-gradient(135deg,#f0d48a,#c8933e)" }}
        >
          결과 확정하고 계속하기
        </button>
        {lastRoundModal}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => i);
  const isChallenger = state.challengerSeat === viewerSeat;
  const liveTotalHp = state.phase === "bidding" ? computeTotalHp(state.equippedItemIds) : state.totalHp;
  // Task brief §2 "보유 장비 효과 발동 이펙트" — while a kill flash is playing, highlight the specific equipped item (or the golden spatula, id 5) that neutralized the monster, reusing `ItemSlot`'s already-present-but-previously-unused `highlighted` prop.
  const flashKillerItemId =
    combatFlash?.entry.killedBy && ("itemId" in combatFlash.entry.killedBy ? combatFlash.entry.killedBy.itemId : 5);

  // `isHoldingFinalReveal`을 포함시켜 라운드/게임을 끝낸 마지막 조우가 화면에
  // 붙잡혀 있는 동안(=`state.phase`가 이미 "bidding"/"gameOver"로 넘어간 뒤에도)
  // 몬스터 기록 패널이 사라지지 않고 그대로 남아있게 한다.
  const dungeonPhaseActive = state.phase === "declaringSpatula" || state.phase === "resolvingRift" || isHoldingFinalReveal;
  // 위와 같은 이유로, "이번 던전 런의 몬스터 기록" 소스도 살아있는 `state.combatLog`
  // 대신 `lastRoundResult.combatLog`(리셋되기 전 전체 로그의 스냅샷)로 폴백한다.
  const monsterHistoryEntries =
    state.phase === "resolvingRift" ? state.combatLog : isHoldingFinalReveal ? (state.lastRoundResult?.combatLog ?? []) : [];
  // 2026-08-30 세션(AskUserQuestion "보스 구분" — copies===1 몬스터를 '네임드'로
  // 취급 채택): MONSTER_CATALOG에 별도 isBoss 필드가 없어, 13장 중 1장뿐인
  // 희귀 몬스터(카서스/모데카이저/장로드래곤, 위협도 6/7/9)를 네임드 기준으로
  // 삼는다. 방금 해결된 몬스터가 이 기준에 걸리면 조우 유지창(5초) 동안
  // 백드롭 딤 + 살짝 확대(줌인) 포커싱을 얹는다.
  const namedFlashActive = combatFlash !== null && getMonsterDef(combatFlash.entry.monster.threat).copies === 1;

  return (
    // Three columns wide, narrowing to a single stack: the monster history
    // panel (task brief §3, dungeon-phase only) leftmost/topmost, the board
    // in the middle, and the always-visible player-aid sidebar (task brief
    // §4) rightmost/bottom-most — the `[gameId]` page widens its container
    // specifically for this game id so all three have room on wide screens.
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
      {dungeonPhaseActive && <MonsterHistoryPanel state={state} entries={monsterHistoryEntries} />}
      <div
        className="flex min-w-0 flex-1 flex-col gap-3 rounded-[28px] border p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
        style={{ borderColor: "rgba(200,170,110,0.3)", background: "linear-gradient(160deg,#151b28 0%,#0d121c 45%,#06090f 100%)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs" style={{ color: "#c8aa6e" }}>
          <span className="flex items-center gap-1.5">
            {state.playerCount}인 · 라운드 {state.roundNumber}
            <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50">
              🃏 덱 {state.deck.length}장
            </span>
            <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50">
              🗡️ 협곡 더미 {state.riftPile.length}장
            </span>
          </span>
          <div className="flex gap-1.5">
            {lastRoundButton}
            {rulebookButton}
          </div>
        </div>

        {roundFlash && (
          <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "rgba(200,170,110,0.4)", background: "rgba(200,170,110,0.08)" }}>
            <p className={`text-center font-semibold ${roundFlash.outcome === "success" ? "text-emerald-200" : "text-rose-200"}`}>
              {roundFlash.outcome === "success"
                ? `✅ ${names[roundFlash.challengerSeat]}님이 협곡 공략 성공! (총 HP ${roundFlash.totalHp})`
                : `💀 ${names[roundFlash.challengerSeat]}님이 협곡 공략 실패...${roundFlash.newlyEliminated ? " (탈락!)" : ""}`}
            </p>
            {roundFlash.combatLog.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                {roundFlash.combatLog.map((entry, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-black/25 px-1.5 py-0.5 text-[10px] text-white/70">
                    {entry.monster.threat}
                    {combatBadge(entry)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Shared champion + item HUD */}
        <section
          className="flex flex-col gap-2 rounded-2xl border p-2.5 sm:p-3"
          style={{ borderColor: "rgba(200,170,110,0.25)", background: "linear-gradient(160deg,#1c2434 0%,#131a26 55%,#0a0e15 100%)" }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: "#c8aa6e" }}>
              ⚔️ 공유 챔피언
            </h3>
            {/* Combat phases now own the live HP readout via the large `HpBanner` below — this small badge is only the bidding-phase equip preview, so the two never show conflicting numbers side by side (also suppressed while a prior round's final reveal is still being held on screen). */}
            {state.phase === "bidding" && !isHoldingFinalReveal && liveTotalHp !== null && (
              <span className="flex items-center gap-1 text-xs font-bold text-white">❤️ {liveTotalHp}</span>
            )}
          </div>
          {/* Task brief §3: the base HP-3 champion tile, physically-set-up-style — the hero card centered above the items equipped onto it. */}
          <div className="flex justify-center">
            <HeroCard />
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {ITEM_CATALOG.map((item) => (
              <ItemSlot
                key={item.id}
                itemId={item.id}
                equipped={state.equippedItemIds.includes(item.id)}
                highlighted={flashKillerItemId === item.id}
              />
            ))}
          </div>
        </section>

        {/* 네임드 몬스터 조우 시 백드롭 딤(전체 화면 포털) — namedFlashActive일 때만 마운트. */}
        {namedFlashActive && <NamedMonsterDim />}

        {/* HP 배너 + 카드더미 묶음 — 네임드 조우 중엔 이 블록 전체를 딤 배경 위로 끌어올리고(z-index) 살짝 확대해 "카메라 줌인" 포커싱을 흉내낸다(작업 지시 §2 "카메라 줌인 또는 백드롭 딤"). */}
        <div className={`relative flex flex-col gap-3 transition-transform duration-300 ${namedFlashActive ? "z-50 scale-[1.03] sm:scale-105" : ""}`}>
          {namedFlashActive && (
            <span
              className="self-center rounded-full border px-3 py-1 text-[11px] font-black tracking-wide"
              style={{ borderColor: "rgba(230,120,255,0.5)", background: "rgba(120,40,180,0.25)", color: "#e8b8ff", animation: "rift-named-dim-in 0.35s ease-out" }}
            >
              👑 네임드 몬스터 등장!
            </span>
          )}

          {/* Task brief §2: a large, central live HP readout for the dungeon-combat phases, with the per-monster kill/damage flash baked in. */}
          <HpBanner state={state} flash={combatFlash} onSkip={handleSkipEncounter} />

          {/* Card piles: the monster draw deck (task brief §1) beside the Rift accumulation pile — both face-down, remaining count badged on top. */}
          <section className="flex flex-wrap items-start justify-center gap-4 rounded-2xl border border-white/10 bg-black/25 p-3">
            <div className="flex flex-col items-center gap-2">
              <h3 className="text-[11px] font-semibold tracking-wide text-white/50 uppercase">🃏 던전 입장 카드더미</h3>
              <CardPileStack count={state.deck.length} emptyHint="덱 소진" />
            </div>
            <div ref={riftStackRef} className="flex flex-col items-center gap-2">
              <h3 className="text-[11px] font-semibold tracking-wide text-white/50 uppercase">🗡️ 협곡 더미</h3>
              {state.riftPile.length === 0 && state.phase === "bidding" ? (
                <div className="flex h-16 w-12 items-center justify-center">
                  <p className="text-center text-[9px] leading-tight text-white/30">아직 없음</p>
                </div>
              ) : (
                <CardPileStack count={state.riftPile.length} />
              )}

              {/*
                Dungeon phase: current reveal slot — keyed remount replays the flip/resolve
                animation each new flash (task brief §2 "카드 제거 애니메이션"). combatBadge는
                애니메이션 래퍼 *밖*에 렌더링한다 — rift-monster-slay/strike가 `forwards`로
                몬스터 카드를 투명하게 마무리해도(2026-08-30 세션 전까지는 배지까지 같이
                사라졌음) 처치/피격 결과 배지는 조우 유지 5초 내내 계속 보이도록.

                2026-08-30 마지막 카드 홀드 세션: 렌더 소스를 `state.combatLog.at(-1)`에서
                `combatFlash.entry`로 바꿨다 — 라운드/게임을 끝낸 마지막 조우일 때는 이
                렌더 시점에 `state.combatLog`가 이미 다음 라운드용으로 리셋돼 있을 수 있어
                (`isHoldingFinalReveal`), `state`가 아니라 `combatFlash` 자신의 스냅샷만
                신뢰할 수 있다. 그 마지막 카드에는 사라짐 애니메이션(slay/strike의
                `forwards`)도 걸지 않고 뒤집기만 재생한 뒤 정지시켜 3초 이상 카드 자체가
                안정적으로 화면에 남아있게 하고, 사용자가 요청한 골드 글로우 테두리를
                덧붙인다 — 일반 조우는 다음 카드가 바로 이어지므로 기존처럼 살짝 페이드돼도
                무방하지만, "마지막 카드"는 정확히 그 페이드 때문에 카드가 사라지는 것처럼
                보인다는 게 이번 신고의 핵심이었다.
              */}
              {combatFlash && (
                <div key={combatFlash.key} className="flex flex-col items-center gap-1">
                  <div
                    className={isHoldingFinalReveal ? "rounded-xl drop-shadow-[0_0_16px_rgba(232,199,122,0.75)]" : undefined}
                    style={{
                      animation: isHoldingFinalReveal
                        ? "rift-monster-flip 0.4s ease-out forwards"
                        : combatFlash.entry.killedBy
                          ? "rift-monster-flip 0.4s ease-out, rift-monster-slay 0.5s ease-in 1.1s forwards"
                          : "rift-monster-flip 0.4s ease-out, rift-monster-strike 0.6s ease-in 1.1s forwards",
                    }}
                  >
                    <MonsterFace threat={combatFlash.entry.monster.threat} size="md" />
                  </div>
                  {combatBadge(combatFlash.entry)}
                </div>
              )}
            </div>
          </section>
        </div>

        <TurnPanel
          state={state}
          viewerSeat={viewerSeat}
          me={me}
          isChallenger={isChallenger}
          onAction={onAction}
          revealLocked={combatFlash !== null}
          holdingFinalReveal={isHoldingFinalReveal}
        />

        {/* Scoreboard */}
        <section className="flex flex-col gap-1.5">
          {seatOrder.map((seat) => {
            const p = state.players.find((pl) => pl.seat === seat)!;
            const isActive = state.activeSeat === seat && !p.eliminated;
            const isSelf = seat === viewerSeat;
            // 패스 지속 배지/딤 — `p.passed`가 소스: bidding에서 declaringSpatula/
            // resolvingRift로 phase가 넘어가도 켜진 채 남고, 다음 라운드
            // `dealRound`가 모든 좌석의 `passed`를 일괄 리셋할 때만 꺼진다(engine.ts
            // "Deals a fresh round" 참고) — 즉 요청서의 "해당 라운드가 끝날 때까지
            // 유지" 요구가 기존 엔진 상태만으로 이미 충족된다. 탈락한 좌석은 이미
            // 자체 딤/배지(💀 탈락)가 있으므로 패스 배지는 그 위에 겹치지 않게 제외.
            const isPassed = p.passed && !p.eliminated;
            // 방금 패스를 누른 그 순간의 1회성 스탬프 슬램/쉐이크/글로우 — PASS_FLASH_MS 뒤 자동으로 꺼지고, 이후에도 `isPassed`가 살아있는 동안은 위 지속 배지가 그대로 남는다.
            const isFlashing = passFlash !== null && passFlash.seat === seat;
            return (
              // Task brief §1: the row itself stays a single line (name/turn/tokens), with removed items relocated to their own dedicated strip right below it instead of stacked on top of a face-down card — see `RemovedItemsRow`.
              <div key={seat} className="flex flex-col gap-1">
                <div
                  ref={setSeatRowRef(seat)}
                  className={`relative flex flex-wrap items-center justify-between gap-2 overflow-hidden rounded-xl border p-2 text-xs transition ${
                    p.eliminated
                      ? "border-white/5 bg-black/10 opacity-50"
                      : isPassed
                        ? "border-red-500/40 bg-black/20 opacity-75"
                        : isActive
                          ? "bg-amber-400/10"
                          : "border-white/10 bg-black/20"
                  }`}
                  style={{
                    ...(isActive && !isPassed ? { borderColor: "rgba(200,170,110,0.6)" } : {}),
                    ...(isFlashing ? { animation: "rift-pass-row-shake 0.5s ease-in-out, rift-pass-glow-flash 0.6s ease-out" } : {}),
                  }}
                >
                  {/* 패스 딤 오버레이 — 텍스트/토큰은 아래에서 별도로 z-10을 줘 그 위에 계속 읽히게 남긴다. */}
                  {isPassed && <div className="pointer-events-none absolute inset-0 rounded-xl bg-black/50 backdrop-blur-[1px]" />}
                  <span className="relative z-10 flex items-center gap-1.5 font-semibold text-white/90">
                    <Avatar size={20} />
                    <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                    {isActive && <span title="차례">👉</span>}
                    {state.challengerSeat === seat && (state.phase === "declaringSpatula" || state.phase === "resolvingRift") && <span title="도전자">🛡️</span>}
                    {names[seat]}
                    {isSelf && <span style={{ color: "#e8c77a" }}>(나)</span>}
                    {p.eliminated && <span className="text-rose-300">💀 탈락</span>}
                  </span>
                  <div className="relative z-10 flex items-center gap-2 text-white/70">
                    <span title={`성공 ${p.successTokens}/${SUCCESS_TOKENS_TO_WIN}`}>{"🏆".repeat(p.successTokens)}{"·".repeat(Math.max(0, SUCCESS_TOKENS_TO_WIN - p.successTokens))}</span>
                    <span title={`실패 ${p.failureTokens}/${FAILURE_TOKENS_TO_ELIMINATE}`}>{"💀".repeat(p.failureTokens)}{"·".repeat(Math.max(0, FAILURE_TOKENS_TO_ELIMINATE - p.failureTokens))}</span>
                    {isPassed && (
                      <span
                        className="animate-pulse rounded border border-red-500 bg-red-950/80 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-red-400"
                        style={isFlashing ? { animation: "rift-pass-badge-slam 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards" } : undefined}
                      >
                        ⛔ PASS
                      </span>
                    )}
                  </div>
                </div>
                <RemovedItemsRow removedItemIds={p.removedItemIds} />
              </div>
            );
          })}
        </section>

        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
        {lastRoundModal}

        {/* Rift-pile accumulation FX (task brief §2): pushing seat's row -> the pile stack. */}
        {pushEvents.map((event) => (
          <FlyingRiftCard
            key={event.id}
            event={event}
            getSourceEl={() => seatRowRefs.current.get(event.seat) ?? null}
            getTargetEl={() => riftStackRef.current}
            onDone={handlePushDone}
          />
        ))}
      </div>

      <SummonersRiftGuideSidebar />
    </div>
  );
}

/** The current-turn action panel — what it shows/allows depends entirely on `state.phase` + whether the viewer is the active/challenger seat. */
function TurnPanel({
  state,
  viewerSeat,
  me,
  isChallenger,
  onAction,
  revealLocked,
  holdingFinalReveal,
}: {
  state: SummonersRiftState;
  viewerSeat: SeatIndex;
  me: SummonersRiftState["players"][number];
  isChallenger: boolean;
  onAction: (action: EngineAction) => void;
  /** Task brief §4 "전투 연출 템포" — true while the last-revealed monster's kill/damage flash is still playing (see `HpBanner`), so the challenger can't reveal the next one until every connected client has finished watching this one resolve. */
  revealLocked: boolean;
  /**
   * 2026-08-30 마지막 카드 홀드 세션 — true while the round- or game-ending
   * reveal's hold window is still open (`isHoldingFinalReveal` in the parent).
   * `state.phase` has already moved on to `"bidding"` (next round) or
   * `"gameOver"` by this point, but the viewer is still looking at the
   * *previous* round's frozen last card — so every turn action (draw/pass for
   * whoever the next round's `activeSeat` happens to be, or acknowledging the
   * game's end) stays locked out until this clears, same spirit as
   * `revealLocked` for the challenger's own "다음 몬스터 공개" button.
   */
  holdingFinalReveal: boolean;
}) {
  const panelStyle = { borderColor: "rgba(200,170,110,0.25)", background: "linear-gradient(160deg,#20180a 0%,#150f06 55%,#0a0603 100%)" };

  if (state.phase === "gameOver") {
    return (
      <section className="rounded-2xl border p-3 text-center" style={panelStyle}>
        <p className="text-xs font-medium" style={{ color: "#e8c77a" }}>
          🏁 게임이 종료되었습니다 — 곧 최종 결과가 표시됩니다...
        </p>
      </section>
    );
  }
  if (holdingFinalReveal) {
    return (
      <section className="rounded-2xl border p-3 text-center" style={panelStyle}>
        <p className="text-xs text-white/60">⏳ 직전 라운드의 마지막 몬스터 결과를 확인하는 중입니다 — 잠시 후 다음 라운드가 시작됩니다.</p>
      </section>
    );
  }

  if (state.phase === "bidding") {
    const isMyTurn = state.activeSeat === viewerSeat && !me.eliminated;
    if (state.pendingDraw && state.pendingDraw.seat === viewerSeat) {
      const card = state.pendingDraw.card;
      return (
        <section className="flex flex-col items-center gap-3 rounded-2xl border p-3" style={panelStyle}>
          <p className="text-xs font-medium" style={{ color: "#e8c77a" }}>
            🫵 방금 뽑은 몬스터입니다 — 나만 볼 수 있어요. 협곡에 넣거나, 아이템 하나를 해제해 숨기세요.
          </p>
          <MonsterFace threat={card.threat} size="lg" />
          <div className="flex flex-wrap justify-center gap-1.5">
            <button
              onClick={() => onAction({ type: "pushToRift", seat: viewerSeat })}
              className="rounded-full px-4 py-2 text-xs font-semibold text-black transition hover:brightness-110"
              style={{ background: "linear-gradient(135deg,#e05a5a,#a12f2f)" }}
            >
              🗡️ 협곡에 집어넣기
            </button>
          </div>
          <p className="text-[10px] text-white/40">또는 아래 아이템 중 하나를 눌러 해제하고 이 카드를 숨기세요:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {ITEM_CATALOG.filter((i) => state.equippedItemIds.includes(i.id)).map((item) => (
              <button key={item.id} onClick={() => onAction({ type: "removeItem", seat: viewerSeat, itemId: item.id as ItemId })}>
                <ItemSlot itemId={item.id} equipped size="sm" />
              </button>
            ))}
          </div>
        </section>
      );
    }
    if (state.pendingDraw) {
      return (
        <section className="rounded-2xl border p-3 text-center" style={panelStyle}>
          <p className="text-xs text-white/60">{`${state.pendingDraw.seat + 1}번 소환사가 방금 뽑은 카드를 확인하는 중...`}</p>
        </section>
      );
    }
    if (isMyTurn) {
      return (
        <section className="flex flex-col items-center gap-2 rounded-2xl border p-3" style={panelStyle}>
          <p className="text-xs font-medium" style={{ color: "#e8c77a" }}>
            🫵 당신 차례입니다!
          </p>
          <div className="flex gap-2">
            <button
              disabled={state.deck.length === 0}
              onClick={() => onAction({ type: "drawCard", seat: viewerSeat })}
              className="rounded-full px-5 py-2.5 text-xs font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
              style={{ background: "linear-gradient(135deg,#f0d48a,#c8933e)" }}
            >
              🃏 카드 뽑기
            </button>
            <button
              onClick={() => onAction({ type: "pass", seat: viewerSeat })}
              className="rounded-full border border-white/20 px-5 py-2.5 text-xs font-semibold text-white/80 transition hover:border-white/40"
            >
              🏳️ 패스
            </button>
          </div>
          {state.deck.length === 0 && <p className="text-[10px] text-rose-300">몬스터 덱이 모두 떨어져 패스만 할 수 있습니다.</p>}
        </section>
      );
    }
    return (
      <section className="rounded-2xl border p-3 text-center" style={panelStyle}>
        <p className="text-xs text-white/50">
          {me.eliminated ? "탈락했습니다 — 이번 게임을 구경하는 중..." : me.passed ? "이번 라운드는 패스했습니다 — 결과를 기다리는 중..." : `소환사 차례를 기다리는 중...`}
        </p>
      </section>
    );
  }

  if (state.phase === "declaringSpatula") {
    if (!isChallenger) {
      return (
        <section className="rounded-2xl border p-3 text-center" style={panelStyle}>
          <p className="text-xs text-white/60">🛡️ 도전자가 황금 뒤집개로 지정할 몬스터를 고르는 중...</p>
        </section>
      );
    }
    return (
      <section className="flex flex-col items-center gap-2 rounded-2xl border p-3" style={panelStyle}>
        <p className="text-xs font-medium" style={{ color: "#e8c77a" }}>
          🥄 황금 뒤집개로 협곡 진입 전 무력화할 몬스터 1종류를 지정하세요.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {MONSTER_CATALOG.map((m) => (
            <button key={m.threat} onClick={() => onAction({ type: "declareSpatula", seat: viewerSeat, monsterThreat: m.threat })}>
              <MonsterFace threat={m.threat} size="sm" />
            </button>
          ))}
        </div>
      </section>
    );
  }

  // resolvingRift
  if (!isChallenger) {
    return (
      <section className="rounded-2xl border p-3 text-center" style={panelStyle}>
        <p className="text-xs text-white/60">🛡️ {`도전자가 협곡을 공략하는 중... (남은 몬스터 ${state.riftPile.length}마리)`}</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col items-center gap-2 rounded-2xl border p-3" style={panelStyle}>
      <p className="text-xs font-medium" style={{ color: "#e8c77a" }}>
        🛡️ 당신이 협곡 최종 도전자입니다! 남은 몬스터 {state.riftPile.length}마리
      </p>
      {state.spatulaDeclaredThreat !== null && (
        <p className="text-[10px] text-white/40">🥄 지정한 몬스터: 위협도 {state.spatulaDeclaredThreat}</p>
      )}
      <button
        disabled={revealLocked}
        onClick={() => onAction({ type: "revealNextMonster", seat: viewerSeat })}
        className="rounded-full px-6 py-2.5 text-xs font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: "linear-gradient(135deg,#e05a5a,#a12f2f)" }}
      >
        {revealLocked ? "⏳ 전투 연출 재생 중..." : "⚔️ 다음 몬스터 공개"}
      </button>
    </section>
  );
}
