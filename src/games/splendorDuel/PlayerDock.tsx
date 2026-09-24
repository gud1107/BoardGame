"use client";

import { CardBack, DuelCardView } from "./CardMarket";
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

export default function PlayerDock({
  player,
  name,
  isMe,
  isActive,
  compact,
  canBuyReserved,
  onReservedClick,
}: {
  player: PlayerState;
  name: string;
  isMe: boolean;
  isActive: boolean;
  compact: boolean;
  canBuyReserved?: (card: DuelCard) => boolean;
  onReservedClick?: (card: DuelCard) => void;
}) {
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
          {player.royals.length > 0 && <span className="text-[10px] text-amber-200">👑×{player.royals.length}</span>}
          <span className="text-[10px] text-white/50 light:text-slate-500">카드 {player.cards.length}</span>
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
                  <DuelCardView card={card} compact affordable={canBuyReserved?.(card)} onClick={onReservedClick ? () => onReservedClick(card) : undefined} />
                ) : (
                  <CardBack level={card.level} compact />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
