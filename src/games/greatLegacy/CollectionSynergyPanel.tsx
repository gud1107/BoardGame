"use client";

import { ASSET_DEFS, COLLECTION_BONUS, MARKETS, SECTORS } from "./constants";
import { computeCollectionBonus } from "./engine";
import { isDiscardKind, projectWin } from "./synergy";
import type { AuctionCardDef, Market, OwnedAsset, Sector, SpecialKind } from "./types";

const MARKET_EMOJI: Record<Market, string> = { 미장: "🇺🇸", 국장: "🇰🇷", 코인: "🪙" };
const SECTOR_EMOJI: Record<Sector, string> = { "빅테크&AI": "🤖", 블루칩: "🏆", "밈&테마주": "🎢" };
const ASSET_NAME = new Map(ASSET_DEFS.map((a) => [a.id, a.name]));

type CollectionKey = { kind: "market"; market: Market } | { kind: "sector"; sector: Sector };

function collectionId(c: CollectionKey) {
  return c.kind === "market" ? `m:${c.market}` : `s:${c.sector}`;
}
function collectionLabel(c: CollectionKey) {
  return c.kind === "market" ? `${MARKET_EMOJI[c.market]} ${c.market} 영끌 올인` : `${SECTOR_EMOJI[c.sector]} ${c.sector} 분산투자`;
}
/** Row label — the group heading already says 영끌 올인 / 분산투자. */
function collectionShortLabel(c: CollectionKey) {
  return c.kind === "market" ? `${MARKET_EMOJI[c.market]} ${c.market}` : `${SECTOR_EMOJI[c.sector]} ${c.sector}`;
}
function isDone(assets: OwnedAsset[], c: CollectionKey) {
  const { markets, sectors } = computeCollectionBonus(assets);
  return c.kind === "market" ? markets.includes(c.market) : sectors.includes(c.sector);
}

/**
 * Left-sidebar "컬렉션 시너지" tracker: the viewer's progress on all six
 * +3 collections (3 market "영끌 올인" + 3 sector "분산투자"), and — while a
 * lot is on the block — which of them this lot feeds and what winning it
 * would do (complete one, add progress, or break one via 상장폐지/강제반대매매).
 */
export default function CollectionSynergyPanel({
  assets,
  pendingSpecials,
  auctionCard,
}: {
  assets: OwnedAsset[];
  pendingSpecials: SpecialKind[];
  auctionCard: AuctionCardDef | null;
}) {
  const current = computeCollectionBonus(assets);
  const projected = auctionCard ? projectWin(assets, pendingSpecials, auctionCard) : null;
  const projectedBonus = projected ? computeCollectionBonus(projected).bonus : current.bonus;
  const lot = auctionCard?.kind === "asset" ? auctionCard.asset : null;
  const pendingDiscard = lot !== null && pendingSpecials[0] !== undefined && isDiscardKind(pendingSpecials[0]);

  const groups: { title: string; rows: CollectionKey[] }[] = [
    { title: "영끌 올인 · 한 시장의 3대 섹터", rows: MARKETS.map((market) => ({ kind: "market", market })) },
    { title: "테마 분산투자 · 한 섹터를 3대 시장", rows: SECTORS.map((sector) => ({ kind: "sector", sector })) },
  ];

  // Collections a special lot would break (상장폐지/강제반대매매 on the viewer's last asset).
  const broken =
    auctionCard?.kind === "special" && projected
      ? groups.flatMap((g) => g.rows).filter((c) => isDone(assets, c) && !isDone(projected, c))
      : [];
  const lastAsset = assets.at(-1);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#c9a24a]/30 bg-gradient-to-b from-[#1b140c]/80 to-white/[0.02] p-3 light:border-amber-300 light:from-amber-50 light:to-white">
      <style>{`
        @keyframes glSynergyPop { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes glSynergyPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(251,191,36,.55); } 50% { box-shadow: 0 0 0 4px rgba(251,191,36,0); } }
        .gl-synergy-pop { animation: glSynergyPop .5s cubic-bezier(.2,.9,.3,1.3) both; }
        .gl-synergy-pulse { animation: glSynergyPulse 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .gl-synergy-pop, .gl-synergy-pulse { animation: none; } }
      `}</style>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-[#e9c874] light:text-amber-800">✨ 내 컬렉션 시너지</h3>
        <span className="font-serif text-xs font-bold text-[#f2c94c] light:text-amber-700">+{current.bonus}점</span>
      </div>

      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className="text-[10px] text-white/40 light:text-slate-500">{group.title}</p>
          {group.rows.map((c) => {
            const done = isDone(assets, c);
            // The 3 slots of this collection: sectors of a market, or markets of a sector.
            const slots = (c.kind === "market" ? SECTORS : MARKETS).map((other) => {
              const market = c.kind === "market" ? c.market : (other as Market);
              const sector = c.kind === "market" ? (other as Sector) : c.sector;
              return {
                key: other,
                emoji: c.kind === "market" ? SECTOR_EMOJI[sector] : MARKET_EMOJI[market],
                owned: assets.some((a) => !a.discarded && a.market === market && a.sector === sector),
                isLot: lot !== null && lot.market === market && lot.sector === sector,
              };
            });
            const owned = slots.filter((s) => s.owned).length;
            const lotSlot = slots.find((s) => s.isLot);
            const wouldComplete = lotSlot !== undefined && !done && projected !== null && isDone(projected, c);
            const willBreak = broken.some((b) => collectionId(b) === collectionId(c));

            return (
              <div
                key={collectionId(c)}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] ring-1 transition ${
                  done
                    ? "bg-amber-400/15 ring-amber-300/60 light:bg-amber-100 light:ring-amber-400"
                    : lotSlot
                      ? "bg-sky-400/10 ring-sky-300/50 light:bg-sky-50 light:ring-sky-300"
                      : "bg-black/20 ring-white/5 light:bg-slate-50 light:ring-slate-200"
                } ${willBreak ? "ring-rose-400/80 light:ring-rose-400" : ""}`}
              >
                <span className={`min-w-0 flex-1 truncate ${done ? "font-semibold text-amber-100 light:text-amber-900" : "text-white/70 light:text-slate-600"}`} title={collectionLabel(c)}>
                  {collectionShortLabel(c)}
                </span>
                <span className="flex shrink-0 gap-0.5">
                  {slots.map((s) => (
                    <span
                      key={s.key}
                      title={s.owned ? "보유" : s.isLot ? "지금 경매 중인 매물" : "미보유"}
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                        s.owned
                          ? "bg-amber-300/30 ring-1 ring-amber-300/70 light:bg-amber-200"
                          : s.isLot
                            ? "gl-synergy-pulse bg-sky-400/20 ring-1 ring-sky-300 light:bg-sky-100"
                            : "bg-white/5 opacity-40 grayscale light:bg-slate-200"
                      }`}
                    >
                      {s.emoji}
                    </span>
                  ))}
                </span>
                <span
                  key={done ? "done" : "open"}
                  className={`w-9 shrink-0 text-right font-serif font-bold ${done ? "gl-synergy-pop text-[#f2c94c] light:text-amber-700" : "text-white/40 light:text-slate-400"}`}
                >
                  {done ? `+${COLLECTION_BONUS}` : `${owned}/3`}
                </span>
                {lotSlot && !lotSlot.owned && !done && !pendingDiscard && (
                  <span
                    title={wouldComplete ? "낙찰 시 이 시너지 완성" : "낙찰 시 한 칸 진행"}
                    className={`shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold ${wouldComplete ? "bg-amber-400 text-black" : "bg-sky-400/30 text-sky-100 light:bg-sky-200 light:text-sky-900"}`}
                  >
                    {wouldComplete ? "완성!" : "+1"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {auctionCard && (
        <div className="rounded-lg border border-sky-300/30 bg-sky-400/10 px-2.5 py-2 text-[11px] leading-relaxed text-sky-100 light:border-sky-300 light:bg-sky-50 light:text-sky-900">
          <p className="mb-0.5 font-semibold">🔨 이 매물을 낙찰받으면</p>
          {lot ? (
            pendingDiscard ? (
              <p>대기 중인 {pendingSpecials[0]} 효과로 이 매물({lot.name})이 바로 폐기돼 시너지에 반영되지 않아요.</p>
            ) : projectedBonus > current.bonus ? (
              <p>
                <b className="text-amber-200 light:text-amber-700">시너지 완성! +{projectedBonus - current.bonus}점</b> ({MARKET_EMOJI[lot.market]} {lot.market} · {SECTOR_EMOJI[lot.sector]} {lot.sector} 칸 채움)
              </p>
            ) : ownsSlot(assets, lot.market, lot.sector) ? (
              <p>이미 {lot.market} · {lot.sector} 칸을 갖고 있어 시너지 변화는 없어요 (자산 점수만 +{lot.baseScore}).</p>
            ) : (
              <p>
                {MARKET_EMOJI[lot.market]} {lot.market} 영끌 올인 · {SECTOR_EMOJI[lot.sector]} {lot.sector} 분산투자 칸이 하나씩 채워져요.
              </p>
            )
          ) : auctionCard.kind === "special" && isDiscardKind(auctionCard.special) ? (
            lastAsset ? (
              broken.length > 0 ? (
                <p className="text-rose-200 light:text-rose-700">
                  직전 자산({ASSET_NAME.get(lastAsset.assetId) ?? lastAsset.assetId})이 폐기돼 <b>{broken.map(collectionLabel).join(", ")}</b> 시너지가 깨져요 (−
                  {current.bonus - projectedBonus}점).
                </p>
              ) : (
                <p>직전 자산({ASSET_NAME.get(lastAsset.assetId) ?? lastAsset.assetId})이 폐기되지만 완성된 시너지는 그대로예요.</p>
              )
            ) : (
              <p>보유 자산이 없어 다음에 낙찰받는 자산이 폐기돼요.</p>
            )
          ) : (
            <p>자산 점수만 바뀌고 컬렉션 시너지는 그대로예요.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ownsSlot(assets: OwnedAsset[], market: Market, sector: Sector) {
  return assets.some((a) => !a.discarded && a.market === market && a.sector === sector);
}
