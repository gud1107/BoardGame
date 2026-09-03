"use client";

import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { cardCaption, cardEmoji, cardLabel, cardTierBg } from "./CardArt";
import type { Card, PlayerState, Resolution, SeatIndex, CoyoteState } from "./engine";

/**
 * Purely cosmetic flourishes — no game logic lives here. Task brief §2
 * "'코요테!' 외침 애니메이션": a desert/Indian-themed wolf-howl overlay the
 * instant the showdown triggers, plus a per-card 3D flip so every forehead
 * card visibly turns face-up together. Both play identically for every
 * connected client off the shared lockstep state transition (not a local
 * click) — same "diff two consecutive snapshots, portal a fixed overlay,
 * drive it with a globals.css keyframe" technique as every other
 * `<Game>Effects.tsx` in this project (dalmuti/DalmutiEffects.tsx,
 * five-cucumbers/CardEffects.tsx, lasVegas/DiceEffects.tsx, ...).
 *
 * 2026-09-03 세션 추가분 — "?" 카드 치환 연출 + 판정 패널 3초 유지/스킵 규격
 * (CoyoteBoard.tsx가 이 파일의 스테이지 상수/컴포넌트를 가지고 직접 스테이지를
 * 오케스트레이션한다).
 *
 * 같은 날 후속 세션 — "?" 대체 카드 중앙 대형 임팩트 팝업, MAX→0 최대값 슬래시
 * 제거 연출, 하단 계산식 바 + "실제 총합 vs 외친 숫자" 하이라이트를 추가.
 * `AskUserQuestion`으로 확인된 결정:
 * ①"?" 연출은 기존의 "좌석 제자리 플립(중앙 전용 영역 없음)"을 완전히
 *   대체 — 이번부터 `QuestionRevealPopup`이 화면 중앙에 대형으로 뜬다
 *   (구 `QuestionCardFlyGhost`는 제거됨).
 * ②전체 시퀀스가 카드공개→"?"팝업→MAX슬래시→계산식 4단계로 늘어나도
 *   `REVEAL_HOLD_MS`(최소 3초 유지) 값 자체는 그대로 두고, 각 단계 길이만
 *   압축해서 그 안에 들어가도록 조정.
 * ③계산식 바의 특수카드 항은 "원래값 취소선 + 라벨"로 표기(예:
 *   `~~20~~→0(MAX제거)`, `20(?)`, `0(밤)`).
 * MAX→0 카드는 36장 덱에 정확히 1장뿐이라(engine.ts의 `NUMBER_CARD_SPEC` +
 * 특수카드 4종) "여러 장" 케이스는 존재하지 않고, 동률 처리는 이미
 * `resolveCoyoteCall`(module doc assumption #4)이 좌석 인덱스 기준으로
 * 확정해 `resolution.maxZeroTarget`에 담아준다 — 연출은 그 결과만 그린다.
 */

/** True exactly the render where the showdown just fired (phase left "playing" for "reveal"/"gameOver"). */
export function detectCoyoteCallEvent(prev: CoyoteState, next: CoyoteState): boolean {
  return prev !== next && prev.phase === "playing" && next.phase !== "playing";
}

/**
 * 보드게임허브 공통 규격 — 판정 패널(하울 배너+카드 공개+"?" 팝업+MAX 슬래시+
 * 계산식 포함 전체)의 최소 유지시간. 직하단 스킵 버튼을 누르면 이 시간을
 * 기다리지 않고 즉시 최종 화면(계산식+하이라이트 대조)으로 넘어간다
 * (CoyoteBoard.tsx의 `handleSkipReveal`).
 */
export const REVEAL_HOLD_MS = 3000;
/** "?" 연출 1단계(대상 좌석 시선 집중 펄스)의 길이 — 지나면 2단계(중앙 팝업)로 넘어간다. */
export const QUESTION_PULSE_MS = 400;
/** "?" 연출 2단계(중앙 대형 임팩트 팝업: 흔들림→3D 플립→확대/플래시)의 길이. */
export const QUESTION_POPUP_MS = 900;
/** MAX→0 최대값 슬래시/디졸브 연출의 길이. */
export const MAXZERO_SLASH_MS = 650;

/**
 * 이번 판정에서 "?" 카드를 이마에 달고 있던 좌석(있다면). 물리 덱에는 "?"가
 * 정확히 1장뿐이라(engine.ts 모듈 doc 가정 #1) 항상 0또는 1개 좌석만
 * 해당된다 — 있다면 그 좌석의 카드가 `res.extraDrawnCards`의 마지막 카드로
 * 치환되는 중앙 팝업 연출의 대상이 된다.
 */
export function questionCardSeat(res: Resolution): SeatIndex | null {
  const entry = Object.entries(res.tableCards).find(([, c]) => c.kind === "question");
  return entry ? Number(entry[0]) : null;
}

export function CoyoteHowlBanner({
  callerName,
  onDone,
  durationMs = 2000,
}: {
  callerName: string;
  onDone: () => void;
  /** 2026-09-03: 코요테 판정 패널 전체가 하나의 3초 유지+스킵 시퀀스로 통합되면서, 이 배너는 그 시퀀스 맨 앞의 짧은 "플래시"로만 쓰인다 — CoyoteBoard.tsx가 REVEAL_HOLD_MS보다 짧은 값을 넘긴다. */
  durationMs?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, durationMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see DalmutiEffects.tsx's RevolutionBanner for the same pattern
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0 bg-gradient-to-b from-orange-950/70 via-black/60 to-black/90"
        style={{ animation: `coyote-desert-flash ${durationMs}ms ease-out forwards` }}
      />
      <div
        className="relative flex flex-col items-center gap-2 rounded-3xl border-4 border-orange-300 bg-gradient-to-b from-orange-950/95 to-black/95 px-10 py-8 text-center shadow-[0_0_90px_-10px_rgba(251,146,60,0.7)]"
        style={{ animation: `coyote-howl-burst ${durationMs}ms ease-out forwards` }}
      >
        <span className="text-6xl">🐺</span>
        <h2 className="break-keep text-3xl font-black tracking-wide text-orange-200">코요테!!!</h2>
        <p className="break-keep text-sm text-white/70">{callerName}님이 울부짖었습니다 — 모두의 이마 카드가 공개됩니다!</p>
      </div>
    </div>,
    document.body,
  );
}

/** Stage-1 "시선 집중" 펄스용 클래스 — `renderSeat`가 "?" 좌석에 조건부로 덧씌운다. */
export const QUESTION_PULSE_CLASS = "coyote-question-pulse";

/**
 * "?" 연출 2단계 — 화면 중앙 대형 임팩트 팝업. 보라색 미스터리 아우라와 함께
 * 흔들리다가(shake) 3D로 뒤집히며 실제로 뽑힌 카드(`card`)가 화면을 압도하는
 * 크기로 확대/플래시 등장한다. `durationMs`는 CoyoteBoard.tsx의 스테이지
 * 타이머(`QUESTION_POPUP_MS`)와 같은 값을 공유해야 다음 스테이지 전환과
 * 시각적으로 맞아떨어진다.
 */
export function QuestionRevealPopup({ card, durationMs = QUESTION_POPUP_MS }: { card: Card; durationMs?: number }) {
  useEffect(() => {
    getSoundEngine().playCardDrawWhoosh();
    const flipAt = Math.round(durationMs * 0.4);
    const t = window.setTimeout(() => getSoundEngine().playCardFlick(), flipAt);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, plays once per popup
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0 bg-gradient-to-b from-violet-950/75 via-black/55 to-black/85"
        style={{ animation: `coyote-desert-flash ${durationMs}ms ease-out forwards` }}
      />
      <div className="relative flex flex-col items-center gap-3" style={{ animation: `coyote-mystery-shake ${Math.round(durationMs * 0.4)}ms ease-in-out` }}>
        <span className="break-keep rounded-full border border-violet-300/70 bg-violet-500/20 px-3 py-1 text-[11px] font-bold text-violet-200 shadow-[0_0_18px_-2px_rgba(192,132,252,0.85)]">
          🎁 대체 카드 등장!
        </span>
        <div
          className="relative flex h-40 w-28 flex-col items-center justify-center gap-1.5 rounded-2xl border-4 p-3 sm:h-48 sm:w-32"
          style={{
            background: cardTierBg(card),
            borderColor: "rgba(192,132,252,0.9)",
            boxShadow: "0 0 70px -6px rgba(192,132,252,0.9)",
            animation: `coyote-mystery-reveal ${durationMs}ms cubic-bezier(0.22,0.9,0.3,1.2) forwards`,
          }}
        >
          <span className="text-4xl leading-none sm:text-5xl">{cardEmoji(card)}</span>
          <span className="text-5xl leading-none font-black text-white [text-shadow:0_0_20px_rgba(192,132,252,0.95)] sm:text-6xl">{cardLabel(card)}</span>
          <span className="max-w-full truncate break-keep text-center text-[10px] text-white/70">{cardCaption(card)}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * MAX→0 연출 — 필드에서 가장 높은 숫자였던 카드(=`resolution.maxZeroTarget`)
 * 위에 붉은 사선 타격(Slash)이 그어지며 0으로 무력화됨을 보여준다. 좌석
 * 카드 자체 위에 겹쳐 그리는 인라인 오버레이(포탈 아님) — CoyoteBoard.tsx의
 * `renderSeat`가 대상 좌석의 `CardFace` 래퍼 안에 조건부로 얹는다.
 * `stage === "slashing"`인 렌더에서만 사선이 그어지는 애니메이션이 재생되고,
 * `"done"`부터는 최종 정지 상태(사선 유지 + 카드 자체는 grayscale/저채도
 * 처리를 호출부가 클래스로 얹는다)로 남는다.
 */
export function MaxZeroSlashOverlay({ stage }: { stage: "slashing" | "done" }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden rounded-lg">
      <span
        key={stage}
        className="absolute h-[3px] w-[145%] rounded-full bg-rose-500"
        style={{
          boxShadow: "0 0 10px 2px rgba(244,63,94,0.9)",
          transform: "rotate(-40deg)",
          animation: stage === "slashing" ? "coyote-maxzero-slash 0.45s ease-out forwards" : undefined,
        }}
      />
      {stage === "done" && (
        <span className="absolute rounded-full border border-rose-300/70 bg-black/60 px-1 text-[9px] font-black text-rose-200">0</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2026-09-03 세션(후속) — 탈락(하트 0) 데스 이펙트: 타격(화면 흔들림) → 카드
// 파괴(파편 산산조각) → 해골 각인(거대 스탬프) 3단계. `AskUserQuestion`으로
// 확인된 결정: ①대상 좌석은 관전 전용(채팅 읽기만) — 이건 채팅 컴포넌트 쪽
// 변경이라 이 파일과 무관, CoyoteGame.tsx/ChatPanel.tsx 참고. ②전체 재생
// 시간은 기존 REVEAL_HOLD_MS(3초) 판정 패널 틀 안에 압축 — "?" 팝업이 있다면
// 그게 끝나는 시점(QUESTION_PULSE_MS+QUESTION_POPUP_MS 이후)에 시작해서
// DEATH_SHAKE_MS+DEATH_SHATTER_MS+DEATH_SKULL_MS(총 1.5초) 안에 끝나므로
// 최악의 경우(1.4초 시작+1.5초)도 2.9초로 3초 예산을 넘지 않는다
// (CoyoteBoard.tsx의 스테이지 타이머가 실제 시작 시점을 계산한다). 한 라운드에
// 하트가 0이 되는 좌석은 항상 정확히 1명뿐(`resolveCoyoteCall`의 `loserSeat`
// 하나) — 동시 탈락 케이스는 이 엔진에 존재하지 않는다.
// ---------------------------------------------------------------------------

/** 1단계(타격/화면 흔들림) 길이. */
export const DEATH_SHAKE_MS = 350;
/** 2단계(카드 파괴/파편) 길이. */
export const DEATH_SHATTER_MS = 450;
/** 3단계(해골 각인 스탬프) 길이 — `DeathStampOverlay`가 떠 있는 시간과 동일해야 한다. */
export const DEATH_SKULL_MS = 700;

/** 보드 루트 컨테이너에 얹는 전체 화면 흔들림 클래스 — CoyoteBoard.tsx가 `deathStage === "shake"`일 때만 조건부로 붙인다. */
export const DEATH_SHAKE_CLASS = "coyote-death-shake";

/**
 * 이번 정산(`res`)으로 하트가 정확히 0이 된 좌석(있다면) — 평범한(치명적이지
 * 않은) 하트 손실이면 `null`. `players`는 반드시 `resolveCoyoteCall`의 하트
 * 차감이 이미 반영된 **정산 이후** 상태(`state.players`)여야 한다 — `Resolution`
 * 자체엔 `loserSeat`만 기록돼 있고 그 결과 하트가 몇이 됐는지는 없기 때문.
 */
export function justEliminatedSeat(res: Resolution, players: PlayerState[]): SeatIndex | null {
  const loser = players.find((p) => p.seat === res.loserSeat);
  return loser && loser.hearts <= 0 ? res.loserSeat : null;
}

/** 2단계 파편 6조각의 방향(`--dx`/`--dy`/`--rot`) + 순차 지연 — destinyWar39 `HiddenRevealCell`의 동일 기법을 코요테 전용 색상으로 재사용. */
const CARD_SHATTER_FRAGMENTS: { dx: number; dy: number; rot: number; delayMs: number }[] = [
  { dx: 0, dy: -26, rot: 45, delayMs: 0 },
  { dx: 22, dy: -14, rot: -55, delayMs: 20 },
  { dx: 23, dy: 12, rot: 75, delayMs: 40 },
  { dx: 0, dy: 26, rot: -35, delayMs: 10 },
  { dx: -23, dy: 12, rot: 65, delayMs: 30 },
  { dx: -22, dy: -14, rot: -75, delayMs: 50 },
];

/**
 * 2단계 — 탈락 대상 좌석의 `CardFace` 위에 겹쳐 그리는 인라인 파쇄 오버레이
 * (포탈 아님, `MaxZeroSlashOverlay`와 같은 배치). 카드가 유리처럼 산산조각
 * 나는 느낌을 붉은 플래시 글로우 + 6조각 파편 비산으로 표현한다.
 */
export function CardShatterOverlay() {
  useEffect(() => {
    getSoundEngine().playCardShatter();
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-visible">
      <span
        aria-hidden
        className="absolute inset-0 rounded-lg bg-rose-500/60 blur-sm"
        style={{ animation: "coyote-death-shatter-flash 0.4s ease-out" }}
      />
      {CARD_SHATTER_FRAGMENTS.map((f, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute top-1/2 left-1/2 text-[10px] text-rose-200"
          style={
            {
              "--dx": `${f.dx}px`,
              "--dy": `${f.dy}px`,
              "--rot": `${f.rot}deg`,
              animation: `coyote-death-shatter-fragment 0.5s ease-out ${f.delayMs}ms both`,
            } as CSSProperties
          }
        >
          ▪
        </span>
      ))}
    </div>
  );
}

/**
 * 3단계 — 화면 전체를 덮는 거대 해골(💀) 각인 스탬프. `QuestionRevealPopup`과
 * 같은 `createPortal` + fixed-inset 기법. 어두운 붉은 안개가 짙어지며 거대한
 * 해골 엠블럼이 오버슈트-바운스로 쿵 내려앉는다 — SMTC `DeathVignette`와 같은
 * "탈락 = 붉은 안개 + 거대 해골" 비주얼 언어를 코요테 전용 키프레임으로 재구성
 * (SMTC는 매치 종료용, 이건 라운드 중간에도 반복 재생되므로 별도 네임스페이스).
 */
export function DeathStampOverlay({ name, durationMs = DEATH_SKULL_MS }: { name: string; durationMs?: number }) {
  useEffect(() => {
    getSoundEngine().playEliminationSlam();
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, transparent 25%, rgba(120,0,20,0.55) 72%, rgba(0,0,0,0.88) 100%)",
          animation: `coyote-death-fog-in ${durationMs}ms ease-out forwards`,
        }}
      />
      <div
        className="relative flex flex-col items-center gap-2"
        style={{ animation: `coyote-skull-slam ${Math.round(durationMs * 0.75)}ms cubic-bezier(0.34,1.56,0.64,1) both` }}
      >
        <span className="text-7xl drop-shadow-[0_0_28px_rgba(244,63,94,0.9)] sm:text-8xl">💀</span>
        <p className="break-keep text-center text-base font-black tracking-wide text-rose-200 sm:text-lg">
          [ 💀 탈락 ] {name}님이 마지막 하트를 잃었습니다
        </p>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Wraps a forehead `CardFace` so it plays a single 3D flip the moment it
 * becomes visible (round moves to "reveal"/"gameOver"). `flipKey` should
 * change once per new reveal (e.g. `${seat}-${roundNumber}-${phase}`) so the
 * remount — and therefore the animation — fires exactly once per showdown,
 * never replaying on every unrelated re-render.
 */
export function CardFlipWrapper({ flipKey, revealed, children }: { flipKey: string; revealed: boolean; children: React.ReactNode }) {
  return (
    <div key={flipKey} style={revealed ? { animation: "coyote-card-flip 0.6s ease-out" } : undefined} className="[transform-style:preserve-3d]">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 하단 계산식 바 — 필드에 놓였던 모든 카드의 연산 과정을 수식 형태로 나열하고,
// "실제 총합 vs 외친 숫자"를 대조하는 하이라이트 텍스트를 출력한다.
// ---------------------------------------------------------------------------

export interface FormulaTerm {
  key: string;
  seat: SeatIndex | null;
  /** 실제로 합산에 기여하는 카드 — "?" 좌석이면 이미 치환된 실제 카드(원래의 "?" 카드 자체가 아님). */
  card: Card;
  /** true면 이 항이 "?" 치환으로 얻어진 값이라는 뜻(라벨에 "(?)" 표시). */
  wasQuestion: boolean;
  /** true면 MAX→0으로 무효화된 항(원래 값에 취소선 + "→0(MAX제거)" 표시). */
  zeroed: boolean;
}

/**
 * `resolution`을 계산식 바에 표기할 항 목록으로 변환한다. "?" 카드를 달고
 * 있던 좌석은 원래의 "?" 카드(값은 항상 0) 대신 `extraDrawnCards`의 마지막
 * 카드로 대체해서 한 항으로 보여준다 — 물리 덱에 "?"가 1장뿐이라 체인이
 * 길어질 일이 없으므로(engine.ts 모듈 doc 가정 #1) 그 좌석 하나만 이렇게
 * 치환하면 §3 계산 순서와 값이 정확히 일치한다.
 */
export function buildFormulaTerms(res: Resolution): FormulaTerm[] {
  const seats = Object.keys(res.tableCards)
    .map(Number)
    .sort((a, b) => a - b);
  return seats.map((seat) => {
    const original = res.tableCards[seat];
    const resolved = original.kind === "question" && res.extraDrawnCards.length > 0 ? res.extraDrawnCards[res.extraDrawnCards.length - 1] : original;
    return {
      key: `seat-${seat}`,
      seat,
      card: resolved,
      wasQuestion: resolved !== original,
      zeroed: res.maxZeroTarget.card === resolved,
    };
  });
}

/** Text color for a term's numeric value, by kind/sign — mirrors CardArt.tsx's per-kind palette. */
function termValueClass(card: Card): string {
  if (card.kind === "night") return "text-indigo-300";
  if (card.kind === "double") return "text-emerald-300";
  if (card.kind === "maxZero") return "text-rose-300";
  if (card.value < 0) return "text-red-300";
  if (card.value === 0) return "text-white/50";
  return "text-amber-200";
}

function FormulaTermChip({ term }: { term: FormulaTerm }) {
  const { card, wasQuestion, zeroed } = term;
  if (zeroed) {
    return (
      <span className="whitespace-nowrap">
        <s className="text-white/35">{cardLabel(card)}</s>
        <span className="text-rose-300">→0</span>
        <span className="ml-0.5 text-[9px] text-rose-300/80">(MAX제거)</span>
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap">
      <span className={`font-bold ${termValueClass(card)}`}>{cardLabel(card)}</span>
      {wasQuestion && <span className="ml-0.5 text-[9px] text-violet-300/80">(?)</span>}
      {!wasQuestion && card.kind === "night" && <span className="ml-0.5 text-[9px] text-indigo-300/80">(밤)</span>}
      {!wasQuestion && card.kind === "maxZero" && <span className="ml-0.5 text-[9px] text-rose-300/80">(MAX카드)</span>}
      {!wasQuestion && card.kind === "double" && <span className="ml-0.5 text-[9px] text-emerald-300/80">(2배카드)</span>}
    </span>
  );
}

/**
 * 하단 계산식 바 + "실제 총합 vs 외친 숫자" 네온 하이라이트. `revealedTotal`은
 * 카운트업 중인 표시값(CoyoteBoard.tsx의 `displayedTotal`)을 그대로 받아서,
 * 이 컴포넌트가 뜨는 순간에도 숫자가 최종값까지 마저 올라가는 흐름이
 * 이어지도록 한다 — 승패 뱃지 판정 자체는 항상 확정된 `res.loserWasBidder`
 * 기준이라 카운트업 중간값과 무관하게 정확하다.
 */
export function FormulaBar({
  terms,
  doubled,
  finalTotal,
  revealedTotal,
  bidNumber,
  callerWon,
}: {
  terms: FormulaTerm[];
  doubled: boolean;
  finalTotal: number;
  revealedTotal: number;
  bidNumber: number;
  /** true = "코요테!"를 외친 사람의 승리(직전 선언자가 오버 배팅), false = 외친 사람의 패배(직전 선언이 안전 배팅이었음). */
  callerWon: boolean;
}) {
  const preDoubleSum = doubled ? finalTotal / 2 : finalTotal;
  return (
    <div className="animate-[coyote-desert-flash_0.4s_ease-out] rounded-xl border border-white/10 bg-black/40 p-3">
      <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 overflow-x-auto text-[11px] break-keep">
        {terms.map((term, i) => (
          <span key={term.key} className="flex items-center gap-1">
            {i > 0 && <span className="text-white/30">+</span>}
            <FormulaTermChip term={term} />
          </span>
        ))}
        <span className="text-white/30">=</span>
        <span className="font-bold text-white">{preDoubleSum}</span>
        {doubled && (
          <>
            <span className="text-emerald-300">× 2</span>
            <span className="text-white/30">=</span>
            <span className="font-black text-emerald-300">{finalTotal}</span>
          </>
        )}
      </div>
      <div className="mt-2.5 flex flex-col items-center gap-1.5">
        <p className="break-keep text-center text-sm font-black tracking-wide sm:text-base">
          <span className="text-emerald-300 [text-shadow:0_0_14px_rgba(52,211,153,0.85)]">실제 총합 [ {revealedTotal} ]</span>
          <span className="mx-1.5 text-white/40">vs</span>
          <span className="text-amber-300 [text-shadow:0_0_14px_rgba(251,191,36,0.85)]">외친 숫자 [ {bidNumber} ]</span>
        </p>
        <span
          className={`break-keep rounded-full border px-3 py-1 text-xs font-black tracking-wide ${
            callerWon ? "border-emerald-300/60 bg-emerald-400/15 text-emerald-200" : "border-rose-300/60 bg-rose-500/15 text-rose-200"
          }`}
        >
          {callerWon ? "🐺 코요테 성공!" : "🙅 코요테 실패!"}
        </span>
      </div>
    </div>
  );
}
