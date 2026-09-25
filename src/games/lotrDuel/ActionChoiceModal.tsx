"use client";

import { useState, type ReactNode } from "react";
import { FortressArt } from "./CardArt";
import { CardFace, describeCard } from "./CardFace";
import { ADJACENCY, CHAIN_INFO, COLOR_INFO, REGIONS, REGION_INFO, TECH_INFO } from "./data";
import {
  calculateCardCost,
  calculateLandmarkCost,
  discardValue,
  fortressOf,
  missingTech,
  otherFaction,
  techCoverage,
  unitsOf,
  type EngineAction,
  type Faction,
  type LandmarkTile,
  type LotrDuelCard,
  type LotrDuelState,
  type PendingStep,
  type RegionId,
} from "./engine";
import { FactionBadges } from "./MiddleEarthMap";

/**
 * Every in-game choice of 반지의 제왕: 가운데땅에서의 대결 as a center floating
 * modal (the alliance-token pick has its own, AllianceTokenSelectModal.tsx):
 *  - `CardChoiceModal` — a pyramid card zoomed in, with "buy & place" vs
 *    "discard for coins";
 *  - `LandmarkConfirmModal` — the fortress tile and its cost breakdown;
 *  - `PendingChoiceModal` — every queued effect: unit placement, moves (from →
 *    to), snipe, fortress / gray-card destruction, free play from the
 *    discard pile, the Ent triple.
 * All share `CenterModal`: dimmed + blurred backdrop, gold rim light, fixed to
 * the viewport centre with `max-h-[85dvh]` inner scroll for phones.
 */

const KEYFRAMES = `
@keyframes lotrc-fade { 0% { opacity: 0 } 100% { opacity: 1 } }
@keyframes lotrc-in { 0% { opacity: 0; transform: translateY(14px) scale(.94) } 100% { opacity: 1; transform: none } }
@keyframes lotrc-rim { 0%,100% { box-shadow: 0 0 30px rgba(245,158,11,.22), inset 0 0 0 1px rgba(251,191,36,.3) } 50% { box-shadow: 0 0 56px rgba(245,158,11,.4), inset 0 0 0 1px rgba(251,191,36,.55) } }
@keyframes lotrc-zoom { 0% { opacity: 0; transform: perspective(800px) rotateY(-25deg) scale(.6) } 100% { opacity: 1; transform: perspective(800px) rotateY(0) scale(1) } }
.lotrc-opt { transition: transform .2s, border-color .2s, box-shadow .2s }
.lotrc-opt:hover:not(:disabled), .lotrc-opt:focus-visible { transform: translateY(-2px); border-color: rgb(251 191 36); box-shadow: 0 0 18px rgba(251,191,36,.3) }
@media (prefers-reduced-motion: reduce) { .lotrc-opt, .lotrc-opt:hover { transition: none; transform: none } }
`;

export function CenterModal({
  icon,
  title,
  subtitle,
  children,
  footer,
  onClose,
  closeLabel = "닫기",
  backdrop = "strong",
}: {
  icon: ReactNode;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  /** "light" keeps the board readable behind the modal (for the card preview highlights). */
  backdrop?: "strong" | "light";
}) {
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 select-none ${backdrop === "light" ? "bg-black/35" : "bg-black/75 backdrop-blur-md"}`}
      style={{ animation: "lotrc-fade .2s ease-out both" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <style>{KEYFRAMES}</style>
      <div
        className="relative flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border-2 border-amber-500/50 bg-neutral-950/95 text-center text-white"
        style={{ animation: "lotrc-in .3s cubic-bezier(.2,.9,.2,1) both, lotrc-rim 2.6s ease-in-out infinite" }}
      >
        <div className="pointer-events-none absolute top-0 left-1/2 h-28 w-72 -translate-x-1/2 bg-amber-500/15 blur-3xl" />
        <div className="relative overflow-y-auto p-5">
          <div className="mb-1 text-3xl">{icon}</div>
          <h3 className="bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-500 bg-clip-text font-serif text-lg font-black tracking-wide text-transparent sm:text-xl">{title}</h3>
          {subtitle && <div className="mx-auto mt-1 mb-4 max-w-sm text-xs text-neutral-400">{subtitle}</div>}
          {children}
          {footer}
          {onClose && (
            <button type="button" onClick={onClose} className="mt-4 text-[11px] text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline">
              {closeLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const optBtn = "lotrc-opt rounded-2xl border-2 border-neutral-700/80 bg-gradient-to-b from-neutral-900 to-neutral-950 p-2.5 disabled:opacity-35";

// ---------------------------------------------------------------------------
// Card: buy & place vs discard
// ---------------------------------------------------------------------------

export function CardChoiceModal({
  state,
  faction,
  card,
  onPlay,
  onDiscard,
  onClose,
  onPreview,
}: {
  state: LotrDuelState;
  faction: Faction;
  card: LotrDuelCard;
  onPlay: () => void;
  onDiscard: () => void;
  onClose: () => void;
  /** Which choice the board should preview (hover/focus on a button); the board defaults to "PLAY". */
  onPreview?: (mode: "PLAY" | "DISCARD") => void;
}) {
  const me = state.players[faction];
  const cost = calculateCardCost(me, card);
  const coverage = techCoverage(me, card.cost.tech);
  const missing = coverage.filter((c) => !c).length;
  const gain = discardValue(state, faction);
  return (
    <CenterModal
      icon="🃏"
      title={card.name}
      subtitle={
        <>
          {COLOR_INFO[card.color].emoji} {COLOR_INFO[card.color].name} 카드 · {state.chapter}챕터
          <span className="mt-0.5 block text-[10px] text-amber-300/80">✨ 보드에서 빛나는 곳이 이 선택으로 바뀝니다</span>
        </>
      }
      onClose={onClose}
      closeLabel="취소하고 다른 카드 보기"
      backdrop="light"
    >
      <div className="mx-auto aspect-[3/4] w-36" style={{ animation: "lotrc-zoom .45s cubic-bezier(.2,.9,.2,1) both" }}>
        <CardFace card={card} available chapter={state.chapter} affordable={cost.canAfford} costInCoins={cost.costInCoins} viaChain={cost.viaChain} coverage={coverage} />
      </div>
      <p className="mt-3 text-sm font-semibold text-neutral-100">{describeCard(card)}</p>
      {/* cost settlement: printed cost → what my techs cover / coins for the rest → final payment */}
      <div className="mx-auto mt-2 max-w-sm space-y-1.5 rounded-2xl border border-neutral-800 bg-neutral-900/90 p-3 text-left text-[11px] text-neutral-300 shadow-inner">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1">
          <span className="text-neutral-400">인쇄 요구 비용</span>
          <span className="flex flex-wrap items-center justify-end gap-1 font-bold text-neutral-100">
            {card.cost.chainSymbol && <span className="rounded bg-amber-500/20 px-1 text-amber-100 ring-1 ring-amber-400/40">🔗 {CHAIN_INFO[card.cost.chainSymbol]} 연계</span>}
            {card.cost.tech?.map((t, i) => (
              <span key={i} className="rounded bg-white/10 px-1">
                {TECH_INFO[t].emoji} {TECH_INFO[t].name}
              </span>
            ))}
            {card.cost.coins ? <span className="rounded bg-amber-500/20 px-1 text-amber-100">🪙 {card.cost.coins}</span> : null}
            {!card.cost.chainSymbol && !card.cost.tech?.length && !card.cost.coins && <span className="text-emerald-300">기본 무료</span>}
          </span>
        </div>
        {!cost.viaChain && (card.cost.tech?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1">
            {card.cost.tech!.map((t, i) =>
              coverage[i] ? (
                <span key={i} className="rounded-md bg-emerald-600/25 px-1.5 py-0.5 font-bold text-emerald-200 ring-1 ring-emerald-400/40">
                  {TECH_INFO[t].emoji} ✓ 보유
                </span>
              ) : (
                <span key={i} className="rounded-md bg-neutral-800 px-1.5 py-0.5 font-bold text-amber-200 ring-1 ring-amber-500/40">
                  {TECH_INFO[t].emoji} ✗ → +🪙1
                </span>
              ),
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-neutral-400">내 최종 지불</span>
          <span className="text-right font-mono font-black">
            {cost.viaChain ? (
              <span className="text-emerald-300">🔗 연계 일치 → 0주화 (전액 무료!)</span>
            ) : cost.costInCoins === 0 ? (
              <span className="text-emerald-300">기술 충족 → 0주화 (무료!)</span>
            ) : (
              <span className={cost.canAfford ? "text-amber-200" : "text-rose-300"}>
                {card.cost.coins ? `🪙${card.cost.coins}` : "🪙0"}
                {missing > 0 ? ` + 부족 ${missing}×🪙1` : ""} = 🪙{cost.costInCoins}
              </span>
            )}
          </span>
        </div>
        <p className={`text-right text-[10px] ${cost.canAfford ? "text-neutral-400" : "font-bold text-rose-300"}`}>
          보유 🪙{me.coins} → {cost.canAfford ? `구매 가능 (남는 주화 ${me.coins - cost.costInCoins})` : `🔴 ${cost.costInCoins - me.coins}주화 부족 — 구매 불가`}
        </p>
        {card.providesChain && <p className="text-[10px] text-neutral-400">이 카드는 다음 챕터용 연계 기호 {CHAIN_INFO[card.providesChain]}를 제공합니다.</p>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!cost.canAfford}
          onClick={onPlay}
          onMouseEnter={() => onPreview?.("PLAY")}
          onFocus={() => onPreview?.("PLAY")}
          className="rounded-xl bg-gradient-to-b from-amber-300 to-amber-600 px-2 py-3 text-sm font-black text-neutral-950 shadow-lg hover:brightness-110 disabled:from-neutral-700 disabled:to-neutral-800 disabled:text-neutral-400"
        >
          📥 {cost.viaChain ? "연계로 무료 내려놓기" : cost.canAfford ? `구매하여 내려놓기 (${cost.costInCoins}주화)` : `주화 부족 (${cost.costInCoins} 필요)`}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          onMouseEnter={() => onPreview?.("DISCARD")}
          onFocus={() => onPreview?.("DISCARD")}
          onMouseLeave={() => onPreview?.("PLAY")}
          className="rounded-xl border border-neutral-600 bg-neutral-800 px-2 py-3 text-sm font-bold text-neutral-100 hover:border-amber-400">
          🪙 버리고 {gain}주화 획득
        </button>
      </div>
    </CenterModal>
  );
}

// ---------------------------------------------------------------------------
// Landmark confirm
// ---------------------------------------------------------------------------

export function LandmarkConfirmModal({ state, faction, tile, onBuild, onClose }: { state: LotrDuelState; faction: Faction; tile: LandmarkTile; onBuild: () => void; onClose: () => void }) {
  const me = state.players[faction];
  const cost = calculateLandmarkCost(state, faction, tile);
  const missing = missingTech(me, tile.baseCost.tech);
  const surcharge = cost.costInCoins - tile.baseCost.coins - missing;
  return (
    <CenterModal icon="🏰" title={`${tile.name} 요새 건설`} subtitle={`${REGION_INFO[tile.targetRegion].name}에 내 요새를 세웁니다`} onClose={onClose} closeLabel="취소">
      <div className="mx-auto h-36 w-36 overflow-hidden rounded-2xl ring-2 ring-amber-300/60" style={{ animation: "lotrc-zoom .45s cubic-bezier(.2,.9,.2,1) both" }}>
        <FortressArt owner={faction} />
      </div>
      <p className="mt-3 text-sm font-semibold text-neutral-100">{tile.description}</p>
      <div className="mx-auto mt-2 max-w-sm rounded-xl border border-white/10 bg-white/[0.03] p-2 text-left text-[11px] text-neutral-300">
        <p>
          인쇄 비용 🪙{tile.baseCost.coins}
          {tile.baseCost.tech?.map((s) => TECH_INFO[s].emoji).join("")} · 부족 기술 {missing}개 × 1주화 · 내 요새 추가분 +{surcharge}
        </p>
        <p>
          합계 <b className={cost.canAfford ? "text-amber-200" : "text-rose-300"}>{cost.costInCoins}주화</b> (보유 {me.coins}) · 요새는 전투로 파괴되지 않습니다.
        </p>
      </div>
      <button
        type="button"
        disabled={!cost.canAfford}
        onClick={onBuild}
        className="mt-4 w-full rounded-xl bg-gradient-to-b from-amber-300 to-amber-600 py-3 text-sm font-black text-neutral-950 shadow-lg hover:brightness-110 disabled:from-neutral-700 disabled:to-neutral-800 disabled:text-neutral-400"
      >
        {cost.canAfford ? `🏰 ${cost.costInCoins}주화로 건설 확정` : `주화 부족 (${cost.costInCoins} 필요)`}
      </button>
    </CenterModal>
  );
}

// ---------------------------------------------------------------------------
// Pending effects
// ---------------------------------------------------------------------------

function RegionOption({ state, region, onPick, note, highlight }: { state: LotrDuelState; region: RegionId; onPick: () => void; note?: string; highlight?: boolean }) {
  return (
    <button type="button" onClick={onPick} className={`${optBtn} flex flex-col items-center gap-1 ${highlight ? "border-amber-400" : ""}`}>
      <span className="font-serif text-sm font-black text-amber-100">{REGION_INFO[region].name}</span>
      <FactionBadges region={state.boardRegions[region]} size="modal" />
      {note && <span className="text-[10px] text-amber-300/80">{note}</span>}
    </button>
  );
}

type ModalStep = Exclude<PendingStep, { kind: "TOKEN" | "TOKEN_RACE" }>;

export function PendingChoiceModal({ state, faction, step, act, onMinimize }: { state: LotrDuelState; faction: Faction; step: ModalStep; act: (a: EngineAction) => void; onMinimize: () => void }) {
  const opp = otherFaction(faction);
  const [moveFrom, setMoveFrom] = useState<RegionId | null>(null);
  const grid = "grid grid-cols-2 gap-2 sm:grid-cols-3";

  let icon: ReactNode = "🎯";
  let title = "";
  let subtitle: ReactNode = null;
  let body: ReactNode = null;

  switch (step.kind) {
    case "PLACE":
      icon = "⚔️";
      title = `유닛 ${step.count}개를 배치할 지역을 선택하십시오`;
      subtitle = step.regions.length === REGIONS.length ? "7개 지역 어디든 가능 — 적 유닛과 만나면 즉시 1:1 교전" : "표시된 지역 중 한 곳 — 적 유닛과 만나면 즉시 1:1 교전";
      body = (
        <div className={grid}>
          {step.regions.map((r) => (
            <RegionOption key={r} state={state} region={r} onPick={() => act({ type: "PLACE", faction, region: r })} note={unitsOf(state.boardRegions[r], opp) > 0 ? "⚔️ 교전 발생" : undefined} />
          ))}
        </div>
      );
      break;
    case "MOVE": {
      icon = "🏃";
      title = moveFrom ? `${REGION_INFO[moveFrom].name}에서 어디로 이동할까요?` : "이동시킬 유닛이 있는 지역을 선택하십시오";
      subtitle = `남은 이동 ${step.remaining}회 · 인접 지역으로 1개씩, 매 이동마다 교전 처리`;
      const froms = REGIONS.filter((r) => unitsOf(state.boardRegions[r], faction) > 0);
      body = moveFrom ? (
        <>
          <div className={grid}>
            {ADJACENCY[moveFrom].map((r) => (
              <RegionOption
                key={r}
                state={state}
                region={r}
                onPick={() => {
                  act({ type: "MOVE", faction, from: moveFrom, to: r });
                  setMoveFrom(null);
                }}
                note={unitsOf(state.boardRegions[r], opp) > 0 ? "⚔️ 교전 발생" : undefined}
              />
            ))}
          </div>
          <button type="button" onClick={() => setMoveFrom(null)} className="mt-3 text-xs text-amber-300 hover:underline">
            ← 출발 지역 다시 고르기
          </button>
        </>
      ) : (
        <div className={grid}>
          {froms.map((r) => (
            <RegionOption key={r} state={state} region={r} onPick={() => setMoveFrom(r)} note={`내 유닛 ${unitsOf(state.boardRegions[r], faction)}개`} />
          ))}
        </div>
      );
      break;
    }
    case "SNIPE":
      icon = "🎯";
      title = "제거할 적 유닛이 있는 지역을 선택하십시오";
      subtitle = `남은 제거 ${step.count}개`;
      body = (
        <div className={grid}>
          {REGIONS.filter((r) => unitsOf(state.boardRegions[r], opp) > 0).map((r) => (
            <RegionOption key={r} state={state} region={r} onPick={() => act({ type: "SNIPE", faction, region: r })} />
          ))}
        </div>
      );
      break;
    case "DESTROY_FORTRESS":
      icon = "💥";
      title = "파괴할 적 요새를 선택하십시오";
      subtitle = "요새는 상대 보급처로 돌아갑니다";
      body = (
        <div className={grid}>
          {REGIONS.filter((r) => fortressOf(state.boardRegions[r], opp)).map((r) => (
            <RegionOption key={r} state={state} region={r} onPick={() => act({ type: "DESTROY_FORTRESS", faction, region: r })} />
          ))}
        </div>
      );
      break;
    case "DESTROY_GRAY":
      icon = "🔥";
      title = "파괴할 상대의 회색(기술) 카드를 선택하십시오";
      body = (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {state.players[opp].tableauCards
            .filter((c) => c.color === "GRAY")
            .map((c) => (
              <div key={c.id} className="aspect-[3/4]">
                <CardFace card={c} available chapter={c.chapter} onClick={() => act({ type: "DESTROY_GRAY", faction, cardId: c.id })} />
              </div>
            ))}
        </div>
      );
      break;
    case "DISCARD_PLAY":
      icon = "♻️";
      title = "버린 카드 1장을 골라 무료로 내려놓으십시오";
      subtitle = `버린 카드 더미 ${state.discardedCards.length}장`;
      body = (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {state.discardedCards.map((c) => (
            <div key={c.id} className="aspect-[3/4]">
              <CardFace card={c} available chapter={c.chapter} costInCoins={0} onClick={() => act({ type: "DISCARD_PLAY", faction, cardId: c.id })} />
            </div>
          ))}
        </div>
      );
      break;
    case "ENT_CHOICE":
      icon = "🌳";
      title = "엔트 행진 — 효과를 고르십시오";
      subtitle = `남은 선택 ${step.remaining}번`;
      body = (
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["SNIPE", "🎯", "적 유닛 1개 제거"],
              ["DRAIN", "🪙", "상대 주화 1개 차감"],
              ["MOVE", "👣", "유닛 이동 1회"],
            ] as const
          ).map(([option, e, label]) => (
            <button key={option} type="button" onClick={() => act({ type: "ENT_PICK", faction, option })} className={`${optBtn} flex flex-col items-center gap-1`}>
              <span className="text-2xl">{e}</span>
              <span className="text-xs font-bold">{label}</span>
            </button>
          ))}
        </div>
      );
      break;
  }

  return (
    <CenterModal
      icon={icon}
      title={title}
      subtitle={
        <>
          <span className="mb-0.5 block text-[10px] text-amber-400/80">{step.source}</span>
          {subtitle}
        </>
      }
      footer={
        step.kind === "MOVE" ? (
          <button type="button" onClick={() => act({ type: "SKIP", faction })} className="mt-4 w-full rounded-xl border border-neutral-600 bg-neutral-800 py-2.5 text-sm font-bold text-neutral-200 hover:border-amber-400">
            이동 종료 (남은 이동 포기)
          </button>
        ) : null
      }
      onClose={onMinimize}
      closeLabel="잠시 보드 보기"
    >
      {body}
    </CenterModal>
  );
}

