"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ABILITY_META, CardBack, DuelCardView, RoyalCardView } from "./CardMarket";
import { DuelToken, GEM_PALETTE, TOKEN_LABEL } from "./DuelToken";
import {
  bonusCounts,
  colorPoints,
  crownsOf,
  GEM_ORDER,
  prestigeOf,
  TOKEN_LIMIT,
  TOKEN_ORDER,
  tokenTotal,
  WIN_CROWNS,
  WIN_PRESTIGE,
  WIN_SINGLE_COLOR,
  type DuelCard,
  type GemColor,
  type PlayerState,
} from "./engine";

function Progress({ label, value, goal, tone }: { label: string; value: number; goal: number; tone: string }) {
  const pct = Math.min(100, (value / goal) * 100);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex justify-between text-[9px] font-bold text-white/60 light:text-slate-500">
        <span className="truncate">{label}</span>
        <span className="font-mono text-white/90 light:text-slate-800">
          {value}/{goal}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
        <div className={`h-full rounded-full ${tone} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Three victory-condition gauges (rulebook §2). */
export function VictoryGauges({ player }: { player: PlayerState }) {
  const pts = colorPoints(player);
  const bestColor = GEM_ORDER.reduce((a, b) => (pts[b] > pts[a] ? b : a));
  return (
    <div className="flex gap-2">
      <Progress label="⭐ 위신" value={prestigeOf(player)} goal={WIN_PRESTIGE} tone="bg-amber-400" />
      <Progress label="👑 왕관" value={crownsOf(player)} goal={WIN_CROWNS} tone="bg-yellow-200" />
      <Progress label="🎨 단일색" value={pts[bestColor]} goal={WIN_SINGLE_COLOR} tone="bg-fuchsia-400" />
    </div>
  );
}

/**
 * Purchased cards and held tokens are shown as two visually different
 * things (2026-09-25 요청 "카드와 토큰이 분리된 상태로"): cards as
 * rectangular card-shaped tiles (one per color: permanent bonus count, ★ that
 * color's points), tokens as round chips sitting in a felt tray. They used to
 * share one column (a "+N" label stacked on each token chip), which read as
 * one mixed pile.
 */
function CardTile({ color, bonus, points, compact }: { color: GemColor; bonus: number; points: number; compact: boolean }) {
  const p = GEM_PALETTE[color];
  return (
    <div
      className={`relative flex shrink-0 flex-col items-center justify-between rounded-[5px] border-[1.5px] shadow-[0_2px_4px_rgba(0,0,0,0.5)] ${
        compact ? "h-6 w-[18px] py-px" : "h-9 w-7 py-0.5 md:h-10 md:w-8"
      } ${bonus === 0 ? "opacity-30 saturate-50" : ""}`}
      style={{ borderColor: p.base, background: `linear-gradient(165deg, ${p.base}66 0%, #111018 55%, #07070b 100%)` }}
      title={`${TOKEN_LABEL[color]} 카드 보너스 ${bonus} (영구 할인)${points > 0 ? ` · 점수 ${points}` : ""}`}
    >
      <span className={`font-serif leading-none font-black text-white drop-shadow ${compact ? "text-[10px]" : "text-sm"}`}>{bonus}</span>
      <DuelToken color={color} className={compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} />
      {!compact && <span className={`font-mono text-[8px] leading-none ${points > 0 ? "text-amber-200" : "text-transparent"}`}>★{points}</span>}
    </div>
  );
}

/** Card-shaped bonus tiles, one per gem color (a colorless card only counts once it's bound by "보너스 복사"). */
export function CardBonusRow({ player, compact }: { player: PlayerState; compact: boolean }) {
  const bonus = bonusCounts(player);
  const pts = colorPoints(player);
  return (
    <div className={`flex items-center rounded-lg border border-white/10 bg-white/[0.04] light:border-slate-200 light:bg-slate-50 ${compact ? "gap-0.5 px-0.5 py-0.5" : "gap-1 px-1.5 py-1"}`}>
      {GEM_ORDER.map((c) => (
        <CardTile key={c} color={c} bonus={bonus[c]} points={pts[c]} compact={compact} />
      ))}
    </div>
  );
}

/** Round token chips on a felt tray, with counts. */
export function TokenTray({ player, compact }: { player: PlayerState; compact: boolean }) {
  return (
    <div
      className={`flex items-center rounded-full border border-emerald-900/60 shadow-[inset_0_2px_6px_rgba(0,0,0,0.7)] light:border-emerald-700/30 ${compact ? "gap-0.5 px-1 py-0.5" : "gap-1 px-2 py-1"}`}
      style={{ background: "radial-gradient(ellipse at 50% 30%, #1d3b2e 0%, #0f231b 70%, #0a1712 100%)" }}
    >
      {TOKEN_ORDER.map((c) => {
        const n = player.tokens[c] ?? 0;
        return (
          <div key={c} className={`relative shrink-0 ${n === 0 ? "opacity-25" : ""}`} title={`${TOKEN_LABEL[c]} 토큰 ${n}개`}>
            <DuelToken color={c} className={compact ? "h-[18px] w-[18px]" : "h-6 w-6 md:h-7 md:w-7"} />
            <span className={`absolute -right-1 -bottom-1 rounded-full bg-black/85 px-[3px] font-mono leading-tight font-bold text-white ${compact ? "text-[9px]" : "text-[10px]"}`}>{n}</span>
          </div>
        );
      })}
    </div>
  );
}

function RowLabel({ children, vertical }: { children: string; vertical: boolean }) {
  return vertical ? (
    <span className="shrink-0 text-[8px] leading-none font-black tracking-wider text-white/45 [writing-mode:vertical-rl] light:text-slate-400">{children}</span>
  ) : (
    <span className="w-[78px] shrink-0 text-[10px] font-black whitespace-nowrap text-white/55 light:text-slate-500">{children}</span>
  );
}

/**
 * "How many of my 10 tokens am I holding" (rulebook §4-2: max 10 incl. gold
 * at turn end) — count + a 10-segment meter in the dock header. Amber from 8
 * so the limit is visible before it bites, red above 10 (discard pending).
 */
export function TokenLimitBadge({ total }: { total: number }) {
  const tone = total > TOKEN_LIMIT ? "text-rose-300 border-rose-400/60 bg-rose-500/15" : total >= 8 ? "text-amber-200 border-amber-400/60 bg-amber-500/10" : "text-white/80 border-white/15 bg-white/5 light:text-slate-700 light:border-slate-300";
  const seg = total > TOKEN_LIMIT ? "bg-rose-400" : total >= 8 ? "bg-amber-300" : "bg-emerald-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[10px] font-black ${tone}`} title={`보유 토큰 ${total}개 / 최대 ${TOKEN_LIMIT}개 (황금 포함)`}>
      🎒 토큰 {total}/{TOKEN_LIMIT}
      <span className="hidden gap-px sm:inline-flex" aria-hidden="true">
        {Array.from({ length: TOKEN_LIMIT }, (_, i) => (
          <span key={i} className={`h-2 w-1 rounded-sm ${i < total ? seg : "bg-white/15 light:bg-slate-200"}`} />
        ))}
      </span>
    </span>
  );
}

export function ScrollPips({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`특권 스크롤 ${count}개`}>
      {Array.from({ length: 3 }, (_, i) => (
        <span key={i} className={`text-sm ${i < count ? "" : "opacity-15 grayscale"}`}>
          📜
        </span>
      ))}
    </span>
  );
}

const SHINE_CSS = `@keyframes sd-owned-shine{0%{transform:translateX(-120%) skewX(-20deg)}55%,100%{transform:translateX(220%) skewX(-20deg)}}
@keyframes sd-owned-burst{0%{transform:scale(1);box-shadow:0 0 0 0 rgba(253,224,71,0)}18%{transform:scale(1.35);box-shadow:0 0 18px 6px rgba(253,224,71,.95);background:rgba(251,191,36,.75);color:#1c1917}45%{transform:scale(1.1);box-shadow:0 0 12px 4px rgba(253,224,71,.7)}70%{transform:scale(1.22);box-shadow:0 0 16px 5px rgba(253,224,71,.9);background:rgba(251,191,36,.6);color:#1c1917}100%{transform:scale(1);box-shadow:0 0 8px rgba(251,191,36,.45)}}
@keyframes sd-owned-plus{0%{opacity:0;transform:translate(-50%,4px) scale(.6)}20%{opacity:1;transform:translate(-50%,-6px) scale(1.15)}75%{opacity:1;transform:translate(-50%,-12px) scale(1)}100%{opacity:0;transform:translate(-50%,-18px) scale(.9)}}
@keyframes sd-royal-burst{0%{transform:scale(1) rotate(0)}12%{transform:scale(1.6) rotate(-10deg);box-shadow:0 0 26px 10px rgba(232,121,249,.95),0 0 10px 3px rgba(253,224,71,1);background:linear-gradient(90deg,#c026d3,#f59e0b);color:#fff}30%{transform:scale(1.25) rotate(8deg)}48%{transform:scale(1.5) rotate(-6deg);box-shadow:0 0 22px 8px rgba(253,224,71,.95);background:linear-gradient(90deg,#f59e0b,#c026d3);color:#fff}70%{transform:scale(1.2) rotate(4deg);box-shadow:0 0 18px 6px rgba(232,121,249,.85)}100%{transform:scale(1) rotate(0);box-shadow:0 0 8px rgba(251,191,36,.45)}}
@keyframes sd-royal-ring{0%{opacity:.9;transform:translate(-50%,-50%) scale(.6)}100%{opacity:0;transform:translate(-50%,-50%) scale(3.2)}}
.sd-owned-burst{animation:sd-owned-burst 1.1s ease-out 2}
.sd-royal-burst{animation:sd-royal-burst 1.3s ease-out 3}
.sd-royal-ring{animation:sd-royal-ring 1.3s ease-out 3}
.sd-owned-plus{animation:sd-owned-plus 2.2s ease-out forwards}
@media (prefers-reduced-motion:reduce){.sd-owned-burst,.sd-royal-burst,.sd-owned-plus{animation:none}.sd-owned-plus,.sd-royal-ring{display:none}}`;

/**
 * "카드 N" / "👑×N" in the dock header — glints while there is something to look at, opens the owned-cards sheet.
 * Right after a gain (count went up) it flares twice with a floating "+N"; the burst ends on animationend.
 * Stays mounted at 0 (just hidden when `hideAtZero`) so the very first gain still bursts.
 */
function OwnedCardsButton({
  count,
  onClick,
  label,
  plusIcon = "",
  title = "가지고 있는 카드 보기",
  hideAtZero = false,
  royal = false,
}: {
  count: number;
  onClick: () => void;
  label: (count: number) => string;
  plusIcon?: string;
  title?: string;
  hideAtZero?: boolean;
  /** Royal cards: a bigger, longer magenta-gold flare with expanding rings (vs the card-purchase glint). */
  royal?: boolean;
}) {
  // Count the player has already "seen" — mounting at N never bursts, only later increases do.
  const [seen, setSeen] = useState(count);
  // A rematch can reset the count below `seen` — resync during render so the next purchase bursts again.
  if (count < seen) setSeen(count);
  const gained = count - seen;
  const burst = gained > 0;
  return (
    <span className={`relative ${hideAtZero && count === 0 ? "hidden" : "inline-flex"}`}>
      {count > 0 && <style>{SHINE_CSS}</style>}
      <button
        type="button"
        onClick={onClick}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) setSeen(count);
        }}
        title={title}
        className={`relative z-10 overflow-hidden rounded-full border px-1.5 text-[10px] leading-tight font-bold transition hover:brightness-125 ${
          count > 0
            ? "border-amber-300/70 bg-amber-500/20 text-amber-100 shadow-[0_0_8px_rgba(251,191,36,0.45)] light:text-amber-800"
            : "border-white/15 text-white/50 light:text-slate-500"
        } ${burst ? (royal ? "sd-royal-burst" : "sd-owned-burst") : ""}`}
      >
        {count > 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent motion-reduce:hidden"
            style={{ animation: `sd-owned-shine ${burst ? "0.55s" : "2.4s"} ease-in-out infinite` }}
          />
        )}
        <span className="relative">{label(count)}</span>
      </button>
      {burst && royal && (
        <span
          aria-hidden="true"
          className="sd-royal-ring pointer-events-none absolute top-1/2 left-1/2 z-0 h-6 w-6 rounded-full border-2 border-fuchsia-300"
        />
      )}
      {burst && (
        <span
          key={count}
          aria-hidden="true"
          className="sd-owned-plus pointer-events-none absolute -top-3 left-1/2 z-20 rounded-full bg-amber-300 px-1 text-[10px] leading-tight font-black whitespace-nowrap text-stone-900 shadow-[0_0_10px_rgba(253,224,71,0.9)]"
        >
          +{plusIcon}
          {gained}
        </span>
      )}
    </span>
  );
}

/** Every card the player has bought, grouped by the color it counts as, plus claimed royal cards. */
function OwnedCardsModal({
  player,
  name,
  isMe,
  royalsFirst,
  onClose,
}: {
  player: PlayerState;
  name: string;
  isMe: boolean;
  /** Opened from the "👑×N" badge — the royal cards section comes first. */
  royalsFirst: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const pts = colorPoints(player);
  const groups = [...GEM_ORDER, null].map((color) => ({ color, cards: player.cards.filter((c) => c.boundColor === color) })).filter((g) => g.cards.length > 0);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-3xl border border-amber-400/30 bg-gradient-to-b from-stone-900 to-black p-4 text-white shadow-2xl light:border-amber-500/40 light:from-white light:to-amber-50 light:text-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="font-serif text-base font-black text-amber-200 light:text-amber-700">
            🃏 {isMe ? "내가 가진 카드" : `${name}의 카드`} <span className="text-sm text-white/60 light:text-slate-500">{player.cards.length}장</span>
          </h3>
          <button type="button" onClick={onClose} className="rounded-full px-2 py-0.5 text-lg leading-none text-white/60 hover:bg-white/10 light:text-slate-500" aria-label="닫기">
            ✕
          </button>
        </div>
        <p className="mb-2 font-mono text-[11px] text-white/60 light:text-slate-500">
          ⭐ 위신 {prestigeOf(player)}/{WIN_PRESTIGE} · 👑 왕관 {crownsOf(player)}/{WIN_CROWNS}
        </p>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          {groups.length === 0 && player.royals.length === 0 && <p className="py-6 text-center text-sm text-white/50 light:text-slate-500">아직 산 카드가 없어요.</p>}
          {groups.map(({ color, cards }) => (
            <section key={color ?? "none"}>
              <div className="mb-1 flex items-center gap-1.5 text-xs font-bold">
                {color ? <DuelToken color={color} className="h-4 w-4" /> : <span>⚪</span>}
                <span>{color ? TOKEN_LABEL[color] : "보너스 없음"}</span>
                <span className="text-white/50 light:text-slate-500">
                  {cards.length}장{color && ` · 할인 ${bonusCounts(player)[color]} · ★${pts[color]}`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                {cards.map((c) => (
                  <DuelCardView key={c.id} card={c} boundColor={c.boundColor} compact />
                ))}
              </div>
            </section>
          ))}
          {player.royals.length > 0 && (
            <section className={royalsFirst ? "order-first rounded-2xl border border-fuchsia-400/40 bg-fuchsia-500/10 p-2" : ""}>
              <div className="mb-1 text-xs font-bold">👑 왕실 카드 {player.royals.length}장</div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                {player.royals.map((r) => (
                  <RoyalCardView key={r.id} royal={r} compact />
                ))}
              </div>
              <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-white/70 light:text-slate-600">
                {player.royals.map((r) => (
                  <li key={r.id}>
                    <b className="text-amber-200 light:text-amber-700">{r.name}</b> · {r.points}점
                    {r.ability ? ` · ${ABILITY_META[r.ability].icon} ${ABILITY_META[r.ability].label}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function PlayerDock({
  player,
  name,
  isMe,
  isActive,
  compact,
  canBuyReserved,
  crownsToRoyal = 0,
  onReservedClick,
}: {
  player: PlayerState;
  name: string;
  isMe: boolean;
  isActive: boolean;
  compact: boolean;
  canBuyReserved?: (card: DuelCard) => boolean;
  /** Crowns this (viewing) player still needs for the next royal card — tags reserved cards that would get there. */
  crownsToRoyal?: number;
  onReservedClick?: (card: DuelCard) => void;
}) {
  const [showOwned, setShowOwned] = useState<null | "cards" | "royals">(null);
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-2xl border p-2 transition ${
        isActive ? "border-amber-400/60 bg-amber-500/[0.06] shadow-[0_0_18px_rgba(251,191,36,0.15)]" : "border-white/10 bg-white/[0.03]"
      } light:border-slate-200 light:bg-white`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {isActive && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-300" />}
          <span className="truncate font-serif text-sm font-bold text-white light:text-slate-900">
            {name}
            {isMe && <span className="ml-1 text-[10px] text-amber-300">(나)</span>}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <TokenLimitBadge total={tokenTotal(player.tokens)} />
          <ScrollPips count={player.scrolls} />
          <OwnedCardsButton
            count={player.royals.length}
            onClick={() => setShowOwned("royals")}
            label={(n) => `👑×${n}`}
            royal
            plusIcon="👑"
            title="받은 왕실 카드 보기"
            hideAtZero
          />
          <OwnedCardsButton count={player.cards.length} onClick={() => setShowOwned("cards")} label={(n) => `🃏 카드 ${n}`} />
        </span>
      </div>
      {compact && !isMe ? (
        <p className="-mt-1 font-mono text-[10px] text-white/60 light:text-slate-500">
          ⭐{prestigeOf(player)}/{WIN_PRESTIGE} · 👑{crownsOf(player)}/{WIN_CROWNS} · 🎨{Math.max(...Object.values(colorPoints(player)))}/{WIN_SINGLE_COLOR}
        </p>
      ) : (
        <VictoryGauges player={player} />
      )}
      <div className="flex items-end gap-2">
        {compact ? (
          // Phones: cards | tokens side by side on one row (zero vertical slack on this layout).
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <RowLabel vertical>카드</RowLabel>
            <CardBonusRow player={player} compact />
            <span className="h-6 w-px shrink-0 bg-white/15" aria-hidden="true" />
            <RowLabel vertical>토큰</RowLabel>
            <TokenTray player={player} compact />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <RowLabel vertical={false}>🃏 카드 보너스</RowLabel>
              <CardBonusRow player={player} compact={false} />
            </div>
            <div className="flex items-center gap-1.5">
              <RowLabel vertical={false}>🪙 보유 토큰</RowLabel>
              <TokenTray player={player} compact={false} />
            </div>
          </div>
        )}
        <div className="flex shrink-0 gap-1" style={{ width: compact ? 54 : 108 }}>
          {Array.from({ length: 3 }, (_, i) => {
            const card = player.reserved[i];
            if (!card) return <div key={i} className="aspect-[5/7] flex-1 rounded-md border border-dashed border-white/10" title="예약 칸" />;
            return (
              <div key={card.id} className="flex-1">
                {isMe ? (
                  <DuelCardView card={card} compact viewer={player} crownsToRoyal={crownsToRoyal} affordable={canBuyReserved?.(card)} onClick={onReservedClick ? () => onReservedClick(card) : undefined} />
                ) : (
                  <CardBack level={card.level} compact />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {showOwned && <OwnedCardsModal player={player} name={name} isMe={isMe} royalsFirst={showOwned === "royals"} onClose={() => setShowOwned(null)} />}
    </div>
  );
}
