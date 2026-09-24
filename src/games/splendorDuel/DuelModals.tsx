"use client";

import { useState } from "react";
import { ABILITY_META, DuelCardView, RoyalCardView } from "./CardMarket";
import { DuelToken, TOKEN_LABEL } from "./DuelToken";
import {
  autoPayment,
  GEM_ORDER,
  otherSeat,
  prestigeOf,
  crownsOf,
  RESERVE_LIMIT,
  TOKEN_LIMIT,
  TOKEN_ORDER,
  tokenTotal,
  type DuelCard,
  type EngineAction,
  type GemColor,
  type PlayerState,
  type Seat,
  type SplendorDuelState,
  type TokenBundle,
  type TokenColor,
  type WinReason,
} from "./engine";

function Sheet({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-3xl border border-amber-400/30 bg-gradient-to-b from-stone-900 to-black p-4 text-white shadow-2xl light:border-amber-500/40 light:from-white light:to-amber-50 light:text-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** Tap a market/reserved card → buy or reserve it. */
export function CardActionSheet({
  card,
  player,
  fromReserved,
  canReserve,
  goldLeft,
  onBuy,
  onReserve,
  onClose,
}: {
  card: DuelCard;
  player: PlayerState;
  fromReserved: boolean;
  canReserve: boolean;
  /** Gold still on the stand — 0 means reserving gives the card only. */
  goldLeft: number;
  onBuy: () => void;
  onReserve: () => void;
  onClose: () => void;
}) {
  const payment = autoPayment(card, player);
  return (
    <Sheet onClose={onClose}>
      <div className="flex gap-3">
        <div className="w-24 shrink-0">
          <DuelCardView card={card} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs">
          <p className="font-serif text-sm font-bold text-amber-200 light:text-amber-700">
            {card.level}레벨 카드 · {card.color ? TOKEN_LABEL[card.color] : "무색"}
          </p>
          <p className="text-white/70 light:text-slate-600">
            ⭐ {card.points}점 · 👑 {card.crowns} · 보너스 {card.bonus}
          </p>
          {card.ability && (
            <p className="rounded-lg bg-amber-500/10 px-2 py-1 text-amber-100 light:text-amber-800">
              {ABILITY_META[card.ability].icon} <b>{ABILITY_META[card.ability].label}</b> — {ABILITY_META[card.ability].desc}
            </p>
          )}
          <div className="mt-1">
            <p className="text-[10px] text-white/50 light:text-slate-500">실제 지불 (보너스 할인 적용)</p>
            {payment ? (
              <div className="mt-0.5 flex flex-wrap gap-1.5">
                {Object.keys(payment).length === 0 && <span className="text-emerald-300">무료!</span>}
                {(Object.entries(payment) as [TokenColor, number][]).map(([c, n]) => (
                  <span key={c} className="inline-flex items-center gap-0.5 font-mono font-bold">
                    <DuelToken color={c} className="h-4 w-4" />×{n}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-rose-300">토큰이 부족합니다</p>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={onBuy}
          disabled={!payment}
          className="rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 py-2.5 text-sm font-bold text-black disabled:opacity-30"
        >
          💰 구매
        </button>
        {!fromReserved ? (
          <button onClick={onReserve} disabled={!canReserve} className="rounded-xl border border-amber-400/40 py-2.5 text-sm font-bold text-amber-200 disabled:opacity-30 light:text-amber-700">
            {goldLeft > 0 ? "📥 예약 (+황금)" : "📥 카드만 예약"}
          </button>
        ) : (
          <button onClick={onClose} className="rounded-xl border border-white/15 py-2.5 text-sm text-white/70 light:text-slate-600">
            닫기
          </button>
        )}
      </div>
      {!fromReserved && !canReserve && <p className="mt-1.5 text-center text-[10px] text-white/40">예약은 최대 {RESERVE_LIMIT}장까지</p>}
      {!fromReserved && canReserve && goldLeft === 0 && (
        <p className="mt-1.5 text-center text-[11px] font-bold text-amber-300 light:text-amber-700">보드 상단에 황금 토큰이 소진되어 카드만 예약합니다.</p>
      )}
    </Sheet>
  );
}

/** The active player's follow-up decision (ability choice / royal / discard). */
export function PendingPanel({
  state,
  seat,
  onAction,
}: {
  state: SplendorDuelState;
  seat: Seat;
  onAction: (a: EngineAction) => void;
}) {
  const step = state.pending[0];
  const me = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  const [discard, setDiscard] = useState<TokenBundle>({});
  if (!step) return null;

  if (step.kind === "chooseRoyal") {
    return (
      <Sheet>
        <p className="text-center font-serif text-lg font-black text-amber-200 light:text-amber-700">👑 왕관 {crownsOf(me)}개 달성!</p>
        <p className="mb-3 text-center text-xs text-white/60 light:text-slate-500">왕실 카드 1장을 골라 가져오세요</p>
        <div className="grid grid-cols-4 gap-2">
          {state.royals.map((r) => (
            <div key={r.id} className="flex flex-col gap-1">
              <RoyalCardView royal={r} onClick={() => onAction({ type: "chooseRoyal", seat, royalId: r.id })} />
              <p className="text-center text-[9px] leading-tight text-white/60 light:text-slate-500">
                {r.points}점 · {r.ability ? ABILITY_META[r.ability].label : "능력 없음"}
              </p>
            </div>
          ))}
        </div>
      </Sheet>
    );
  }

  if (step.kind === "copyBonus") {
    const colors = GEM_ORDER.filter((c) => me.cards.some((card) => card.id !== step.cardId && card.boundColor === c));
    return (
      <Sheet>
        <p className="text-center font-serif text-base font-black text-amber-200 light:text-amber-700">? 보너스 복사</p>
        <p className="mb-3 text-center text-xs text-white/60 light:text-slate-500">복사할 내 보석 카드 색을 고르세요</p>
        <div className="flex justify-center gap-3">
          {colors.map((c) => (
            <button key={c} onClick={() => onAction({ type: "resolveCopy", seat, color: c })} className="flex flex-col items-center gap-1 rounded-xl p-2 hover:bg-white/10">
              <DuelToken color={c} className="h-10 w-10" />
              <span className="text-[10px]">{TOKEN_LABEL[c]}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  if (step.kind === "stealToken") {
    const colors = ([...GEM_ORDER, "pearl"] as (GemColor | "pearl")[]).filter((c) => (opp.tokens[c] ?? 0) > 0);
    return (
      <Sheet>
        <p className="text-center font-serif text-base font-black text-rose-300">✋ 토큰 강탈</p>
        <p className="mb-3 text-center text-xs text-white/60 light:text-slate-500">상대에게서 빼앗을 토큰을 고르세요 (황금 제외)</p>
        <div className="flex flex-wrap justify-center gap-3">
          {colors.map((c) => (
            <button key={c} onClick={() => onAction({ type: "resolveSteal", seat, color: c })} className="flex flex-col items-center gap-1 rounded-xl p-2 hover:bg-white/10">
              <DuelToken color={c} className="h-10 w-10" />
              <span className="text-[10px]">
                {TOKEN_LABEL[c]} ×{opp.tokens[c]}
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  if (step.kind === "discard") {
    const over = tokenTotal(me.tokens) - TOKEN_LIMIT;
    const chosen = tokenTotal(discard);
    return (
      <Sheet>
        <p className="text-center font-serif text-base font-black text-amber-200 light:text-amber-700">토큰 {TOKEN_LIMIT}개 초과</p>
        <p className="mb-3 text-center text-xs text-white/60 light:text-slate-500">
          버릴 토큰 {over}개를 고르세요 ({chosen}/{over})
        </p>
        <div className="grid grid-cols-7 gap-1">
          {TOKEN_ORDER.map((c) => {
            const have = me.tokens[c] ?? 0;
            const d = discard[c] ?? 0;
            return (
              <div key={c} className={`flex flex-col items-center gap-1 ${have === 0 ? "opacity-25" : ""}`}>
                <button
                  disabled={have === 0 || d >= have || chosen >= over}
                  onClick={() => setDiscard({ ...discard, [c]: d + 1 })}
                  className="rounded-full disabled:cursor-not-allowed"
                >
                  <DuelToken color={c} className="h-8 w-8" />
                </button>
                <span className="font-mono text-[10px]">
                  {have - d}
                  {d > 0 && <span className="text-rose-300">(-{d})</span>}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => setDiscard({})} className="rounded-xl border border-white/15 py-2 text-sm text-white/70 light:text-slate-600">
            초기화
          </button>
          <button
            disabled={chosen !== over}
            onClick={() => {
              onAction({ type: "discardTokens", seat, discard });
              setDiscard({});
            }}
            className="rounded-xl bg-amber-400 py-2 text-sm font-bold text-black disabled:opacity-30"
          >
            반납하기
          </button>
        </div>
      </Sheet>
    );
  }

  // takeToken is resolved by tapping a highlighted cell on the board itself.
  return null;
}

const REASON_TEXT: Record<WinReason, string> = {
  prestige: "위신 점수 20점 달성",
  crowns: "왕관 10개 달성",
  singleColor: "단일 색상 위신 10점 달성",
};

export function VictoryModal({
  state,
  viewerSeat,
  names,
  onRematch,
  onLeave,
  onClose,
}: {
  state: SplendorDuelState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  onRematch: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const winner = state.winner!;
  const won = winner === viewerSeat;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="sd-victory-pop relative w-full max-w-sm overflow-hidden rounded-3xl border border-amber-300/50 bg-gradient-to-b from-stone-900 via-black to-black p-6 text-center text-white shadow-[0_0_60px_rgba(251,191,36,0.3)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(251,191,36,0.35),transparent_60%)]" />
        <p className="relative text-5xl">{won ? "💎" : "🥀"}</p>
        <p className="relative mt-2 font-serif text-2xl font-black text-amber-200">{won ? "승리!" : "패배"}</p>
        <p className="relative mt-1 text-sm text-white/80">
          <b>{names[winner]}</b> — {REASON_TEXT[state.winReason!]}
        </p>
        <div className="relative mt-4 grid grid-cols-2 gap-2 text-xs">
          {(["p1", "p2"] as Seat[]).map((s) => (
            <div key={s} className={`rounded-xl border p-2 ${s === winner ? "border-amber-300/60 bg-amber-400/10" : "border-white/10"}`}>
              <p className="truncate font-bold">{names[s]}</p>
              <p className="mt-1 font-mono text-white/70">
                ⭐{prestigeOf(state.players[s])} 👑{crownsOf(state.players[s])}
              </p>
            </div>
          ))}
        </div>
        <div className="relative mt-5 flex flex-col gap-2">
          <button onClick={onRematch} className="rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 py-2.5 text-sm font-bold text-black">
            🔁 다시 하기
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onClose} className="rounded-xl border border-white/15 py-2 text-xs text-white/70">
              보드 보기
            </button>
            <button onClick={onLeave} className="rounded-xl border border-white/15 py-2 text-xs text-white/70">
              나가기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

