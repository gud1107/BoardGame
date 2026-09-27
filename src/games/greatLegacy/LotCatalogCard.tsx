"use client";

import type { AuctionCardDef, AuctionKind, SpecialKind } from "./types";

const MARKET_LABEL: Record<string, string> = { 미장: "🇺🇸 미국 증시", 국장: "🇰🇷 한국 증시", 코인: "🪙 가상자산" };
const SECTOR_LABEL: Record<string, string> = { "빅테크&AI": "🤖 빅테크 & AI", 블루칩: "🏆 블루칩", "밈&테마주": "🎢 밈 & 테마주" };

const SPECIAL_INFO: Record<SpecialKind, { file: string; title: string; subtitle: string; effect: string }> = {
  초대형호재: { file: "special-boom", title: "초대형 호재", subtitle: "Mega Bull Run", effect: "낙찰자의 직전 획득 자산 점수를 5점으로 끌어올립니다." },
  악재어닝쇼크: { file: "special-shock", title: "악재 / 어닝쇼크", subtitle: "Earnings Shock", effect: "떠안은 사람의 직전 획득 자산 점수가 1점으로 떨어집니다." },
  상장폐지: { file: "special-delist", title: "상장폐지", subtitle: "Delisting Notice", effect: "떠안은 사람의 직전 획득 자산이 영구 폐기됩니다." },
  강제반대매매: { file: "special-margin-call", title: "강제 반대매매", subtitle: "Margin Call", effect: "떠안은 사람의 직전 획득 자산이 영구 폐기됩니다." },
};

/** Public path of the catalog "lot photo" for any auction card (art in public/images/great-legacy/, original motifs — no real logos). */
export function lotImageSrc(card: AuctionCardDef): string {
  return `/images/great-legacy/${card.kind === "asset" ? card.asset.id : SPECIAL_INFO[card.special].file}.svg`;
}

/**
 * The lot currently on the block, rendered like a page from a luxury
 * auction-house catalog: spotlit "lot photo" in a gilded frame, LOT number,
 * serif title, provenance (market · sector) and the appraised score.
 * Dark velvet in dark mode, ivory catalog paper in light mode.
 */
export default function LotCatalogCard({
  card,
  auctionKind,
  lotNumber,
  totalLots,
  children,
}: {
  card: AuctionCardDef;
  auctionKind: AuctionKind;
  lotNumber: number;
  totalLots: number;
  /** Live bidding status line, rendered at the bottom of the catalog entry. */
  children?: React.ReactNode;
}) {
  const special = card.kind === "special" ? SPECIAL_INFO[card.special] : null;
  const title = card.kind === "asset" ? card.asset.name : special!.title;
  const lotLabel = `LOT ${String(lotNumber).padStart(2, "0")}`;

  return (
    <div
      className="gl-lot-reveal relative overflow-hidden rounded-2xl border border-[#c9a24a]/60 bg-gradient-to-br from-[#1b140c] via-[#0f0b07] to-[#060403] p-[3px] shadow-[0_18px_50px_-18px_rgba(201,162,74,0.55)] light:border-[#b8923a] light:from-[#fffaf0] light:via-[#fbf3e1] light:to-[#f3e7cc]"
    >
      <style>{`
        @keyframes glLotReveal { from { opacity: 0; transform: translateY(8px) scale(0.985); } to { opacity: 1; transform: none; } }
        @keyframes glLotSheen { from { transform: translateX(-120%) skewX(-18deg); } to { transform: translateX(320%) skewX(-18deg); } }
        .gl-lot-reveal { animation: glLotReveal 0.55s cubic-bezier(.2,.8,.2,1) both; }
        .gl-lot-sheen { animation: glLotSheen 1.6s 0.35s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .gl-lot-reveal, .gl-lot-sheen { animation: none; } }
      `}</style>
      <div className="flex flex-row items-start gap-3 rounded-[14px] border border-[#c9a24a]/25 p-2.5 sm:items-stretch sm:gap-4 sm:p-3 light:border-[#b8923a]/40">
        {/* Lot photo in a gilded double frame */}
        <div className="relative w-32 shrink-0 min-[400px]:w-36 sm:w-56 lg:w-64">
          <div className="rounded-lg bg-gradient-to-br from-[#f7e3a1] via-[#b8862b] to-[#6e4a12] p-[3px] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.8)]">
            <div className="relative overflow-hidden rounded-[5px] border border-black/60">
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG art, no optimisation needed */}
              <img src={lotImageSrc(card)} alt={`${title} 경매품 이미지`} width={400} height={300} className="block aspect-[4/3] w-full select-none" draggable={false} />
              <span aria-hidden className="gl-lot-sheen pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
            </div>
          </div>
          <span className="absolute -top-2 left-2 rounded-sm bg-[#0b0806] px-2 py-0.5 font-serif text-[10px] font-bold tracking-[0.2em] text-[#e9c874] ring-1 ring-[#c9a24a]/70 light:bg-[#fffaf0] light:text-[#8a6418]">
            {lotLabel}
          </span>
        </div>

        {/* Catalog entry */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:gap-2">
          <div className="hidden items-center justify-between gap-2 border-b border-[#c9a24a]/25 pb-1.5 sm:flex light:border-[#b8923a]/40">
            <span className="font-serif text-[10px] tracking-[0.25em] text-[#c9a24a] uppercase light:text-[#8a6418]">
              Great Investment · Evening Sale
            </span>
            <span className="shrink-0 font-serif text-[10px] tracking-wider text-[#c9a24a]/70 light:text-[#8a6418]/80">
              {lotNumber} / {totalLots}
            </span>
          </div>

          <div>
            <p className="font-serif text-[11px] tracking-[0.2em] text-[#e9c874]/80 light:text-[#8a6418]">{lotLabel}</p>
            <h3 className="font-serif text-xl leading-tight font-bold break-keep text-[#fbf1d6] sm:text-3xl light:text-[#2a1d08]">{title}</h3>
            {special && <p className="font-serif text-xs text-[#fbf1d6]/50 italic light:text-[#5c4515]/70">{special.subtitle}</p>}
          </div>

          {card.kind === "asset" ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-[#c9a24a]/80 light:text-[#8a6418]">출품 시장</dt>
              <dd className="text-[#fbf1d6]/85 light:text-[#3a2a0c]">{MARKET_LABEL[card.asset.market] ?? card.asset.market}</dd>
              <dt className="text-[#c9a24a]/80 light:text-[#8a6418]">섹터</dt>
              <dd className="text-[#fbf1d6]/85 light:text-[#3a2a0c]">{SECTOR_LABEL[card.asset.sector] ?? card.asset.sector}</dd>
              <dt className="text-[#c9a24a]/80 light:text-[#8a6418]">감정 평가</dt>
              <dd className="flex items-center gap-1.5 text-[#fbf1d6] light:text-[#2a1d08]">
                <span aria-hidden className="tracking-tight text-[#f2c94c] light:text-[#b8862b]">
                  {"★".repeat(card.asset.baseScore)}
                  <span className="text-[#f2c94c]/20 light:text-[#b8862b]/25">{"★".repeat(Math.max(0, 5 - card.asset.baseScore))}</span>
                </span>
                <b className="font-serif">{card.asset.baseScore}점</b>
              </dd>
            </dl>
          ) : (
            <p className="rounded-md border border-[#c9a24a]/20 bg-black/25 px-2.5 py-1.5 text-xs leading-relaxed text-[#fbf1d6]/80 light:border-[#b8923a]/30 light:bg-white/60 light:text-[#3a2a0c]">
              {special!.effect}
            </p>
          )}

          <span
            className={`self-start rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              auctionKind === "reverse"
                ? "bg-rose-400/20 text-rose-200 light:bg-rose-100 light:text-rose-700"
                : "bg-emerald-400/20 text-emerald-200 light:bg-emerald-100 light:text-emerald-700"
            }`}
          >
            {auctionKind === "reverse" ? "역경매 — 먼저 포기하면 낙찰" : "일반 경매"}
          </span>

          {children && <div className="mt-auto border-t border-[#c9a24a]/25 pt-2 text-xs light:border-[#b8923a]/40">{children}</div>}
        </div>
      </div>
    </div>
  );
}
