"use client";

import { CardBack, DuelCardView } from "./CardMarket";
import { DuelToken, GEM_PALETTE } from "./DuelToken";
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

/** Held tokens + per-color bonus/points table. */
export function TokenShelf({ player, compact = false }: { player: PlayerState; compact?: boolean }) {
  const bonus = bonusCounts(player);
  const pts = colorPoints(player);
  return (
    <div className="flex items-end gap-1">
      {TOKEN_ORDER.map((c) => {
        const n = player.tokens[c] ?? 0;
        const isGem = c !== "pearl" && c !== "gold";
        return (
          <div key={c} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
            {isGem && !compact && (
              <span className="rounded px-1 font-mono text-[9px] font-bold" style={{ background: GEM_PALETTE[c].base, color: GEM_PALETTE[c].ink }} title="카드 보너스(할인)">
                +{bonus[c]}
              </span>
            )}
            <div className={`relative ${n === 0 ? "opacity-30" : ""}`}>
              <DuelToken color={c} className={compact ? "h-5 w-5" : "h-6 w-6 md:h-7 md:w-7"} />
              <span className="absolute -right-1 -bottom-1 rounded-full bg-black/80 px-1 font-mono text-[10px] font-bold text-white">{n}</span>
            </div>
            {isGem && !compact && pts[c] > 0 && <span className="font-mono text-[9px] text-amber-200/80">★{pts[c]}</span>}
          </div>
        );
      })}
    </div>
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
        <div className="min-w-0 flex-1">
          <TokenShelf player={player} compact={compact && !isMe} />
        </div>
        <div className="flex shrink-0 gap-1" style={{ width: compact ? (isMe ? 84 : 60) : 108 }}>
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
