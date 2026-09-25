"use client";

import { useEffect, type ReactNode } from "react";
import { CardFace, CostChips, describeCard } from "./CardFace";
import { CARD_BY_ID, CHAIN_INFO, COLOR_INFO, FACTION_EMOJI, FACTION_LABEL, RACE_INFO, REGION_INFO, TECH_INFO } from "./data";
import type { LogEntry } from "./types";

/**
 * History card inspector — opened from a card entry in the history log.
 * Shows the card as the big art-deco face, how it was used (bought for N
 * coins / via chain / discarded for N / played free / destroyed), its full
 * spec (chapter, colour, printed cost, chains, what it produces) and what the
 * card set off that turn (the following log entries of the same player —
 * placement region, ring-track move, token picks, clashes…).
 *
 * Center of the viewport with `max-h-[90dvh]` inner scroll; closes on ✕, a
 * backdrop tap or Escape. z-[60] so it also sits above the mobile log drawer.
 */

const KEYFRAMES = `
@keyframes lotri-fade { 0% { opacity: 0 } 100% { opacity: 1 } }
@keyframes lotri-in { 0% { opacity: 0; transform: translateY(12px) scale(.95) } 100% { opacity: 1; transform: none } }
@keyframes lotri-card { 0% { opacity: 0; transform: perspective(900px) rotateY(-35deg) rotateX(8deg) scale(.55) } 100% { opacity: 1; transform: perspective(900px) rotateY(0) rotateX(0) scale(1) } }
.lotri-tilt { transition: transform .35s cubic-bezier(.2,.8,.2,1) }
.lotri-tilt:hover { transform: perspective(900px) rotateY(-8deg) rotateX(4deg) scale(1.03) }
@media (prefers-reduced-motion: reduce) { .lotri-tilt, .lotri-tilt:hover { transition: none; transform: none } }
`;

const AFTERMATH_KINDS = new Set(["UNIT", "TRACK", "COIN", "TOKEN", "COMBAT", "MOVE", "TACTIC"]);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-1 last:border-0">
      <span className="shrink-0 text-neutral-400">{label}</span>
      <span className="text-right font-semibold text-neutral-100">{children}</span>
    </div>
  );
}

export default function CardDetailModal({ entry, log, onClose }: { entry: LogEntry; log: LogEntry[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = entry.card!;
  const card = CARD_BY_ID[meta.id];
  if (!card) return null;

  const actor = entry.faction;
  const useText =
    meta.use === "PLAY"
      ? meta.viaChain
        ? "연계 기호로 무료 구매"
        : meta.coins > 0
          ? `${meta.coins}주화를 내고 구매`
          : "무료로 구매"
      : meta.use === "DISCARD"
        ? `버리고 ${meta.coins}주화 획득`
        : meta.use === "FREE"
          ? "버린 카드 더미에서 무료로 획득"
          : "상대 효과로 파괴됨";

  // What the card set off: this player's following entries on the same turn, up to the next card/landmark action.
  const after: LogEntry[] = [];
  if (meta.use === "PLAY" || meta.use === "FREE") {
    for (const e of log) {
      if (e.no <= entry.no) continue;
      if (e.turn !== entry.turn || e.card || e.kind === "LANDMARK" || e.kind === "SYSTEM") break;
      if (AFTERMATH_KINDS.has(e.kind)) after.push(e);
    }
  }

  const produces: string[] = [];
  if (card.providesTech) produces.push(`영구 기술: ${card.providesTech.map((t) => `${TECH_INFO[t].emoji} ${TECH_INFO[t].name}`).join(", ")} (매 턴)`);
  if (card.selectTechChoice) produces.push(`선택 기술: ${card.selectTechChoice.map((t) => `${TECH_INFO[t].emoji} ${TECH_INFO[t].name}`).join(" 또는 ")} (매 턴 택1)`);
  if (card.race) produces.push(`종족 기호: ${RACE_INFO[card.race].emoji} ${RACE_INFO[card.race].name}`);
  if (card.militaryUnits) produces.push(`유닛 ${card.militaryUnits.count}개 → ${card.militaryUnits.allowedRegions.map((r) => REGION_INFO[r].name).join(" 또는 ")}`);
  if (card.ringAdvance) produces.push(`원정 트랙 ${card.ringAdvance}칸 전진 (지나간 칸 보상 포함)`);
  if (card.coinsReward) produces.push(`즉시 ${card.coinsReward}주화`);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md select-none"
      style={{ animation: "lotri-fade .2s ease-out both" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${card.name} 카드 상세`}
    >
      <style>{KEYFRAMES}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[90dvh] w-full max-w-md flex-col overflow-y-auto rounded-3xl border-2 border-amber-500/60 bg-neutral-950/95 p-5 text-center text-white shadow-[0_0_50px_rgba(245,158,11,.3)]"
        style={{ animation: "lotri-in .3s cubic-bezier(.2,.9,.2,1) both" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-sm text-neutral-400 hover:text-white"
        >
          ✕
        </button>
        <p className="font-mono text-[10px] font-bold tracking-widest text-amber-400">CARD INSPECTOR · 카드 상세</p>

        <div className="lotri-tilt mx-auto mt-3 aspect-[3/4] w-44 sm:w-48" style={{ animation: "lotri-card .55s cubic-bezier(.2,.9,.2,1) both" }}>
          <CardFace card={card} available chapter={card.chapter} affordable costInCoins={meta.use === "PLAY" ? meta.coins : undefined} viaChain={meta.viaChain} />
        </div>

        <h3 className="mt-3 font-serif text-xl font-black text-amber-100">{card.name}</h3>
        {actor && (
          <p className={`mx-auto mt-1 inline-block rounded-full border px-3 py-0.5 text-[11px] font-bold ${actor === "FELLOWSHIP" ? "border-amber-400/60 bg-amber-500/15 text-amber-200" : "border-rose-500/60 bg-rose-500/15 text-rose-200"}`}>
            {FACTION_EMOJI[actor]} {FACTION_LABEL[actor]} · {entry.turn}턴 · {useText}
          </p>
        )}
        <p className="mt-2 text-sm font-semibold text-neutral-100">{describeCard(card)}</p>

        <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/90 p-3 text-left text-xs">
          <Row label="챕터">제 {card.chapter} 챕터</Row>
          <Row label="분류">
            {COLOR_INFO[card.color].emoji} {COLOR_INFO[card.color].name} 카드
          </Row>
          <Row label="인쇄 비용">
            <CostChips card={card} />
          </Row>
          {meta.use === "PLAY" && <Row label="실제 지불">{meta.viaChain ? "🔗 연계로 0주화" : meta.coins === 0 ? "무료 (0주화)" : `🪙 ${meta.coins}주화 (없는 기술 1개당 1주화 포함)`}</Row>}
          <Row label="필요 연계">{card.cost.chainSymbol ? `🔗 ${CHAIN_INFO[card.cost.chainSymbol]} — 이 기호를 가진 카드가 있으면 무료` : "없음"}</Row>
          <Row label="제공 연계">{card.providesChain ? `🔗 ${CHAIN_INFO[card.providesChain]} — 다음 챕터 카드를 무료로` : "없음"}</Row>
          {produces.map((p) => (
            <Row key={p} label="효과">
              {p}
            </Row>
          ))}
        </div>

        {after.length > 0 && (
          <div className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-3 text-left">
            <p className="mb-1 text-[11px] font-bold text-amber-300">⚡ 이 카드로 일어난 일</p>
            <ul className="space-y-0.5 text-[11px] text-neutral-200">
              {after.map((e) => (
                <li key={e.no} className="break-keep">
                  • {e.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-amber-500 py-2.5 text-xs font-black text-neutral-950 shadow-lg hover:bg-amber-400">
          확인 완료 (닫기)
        </button>
        <p className="mt-1.5 text-[10px] text-neutral-500">바깥을 누르거나 ESC로도 닫을 수 있습니다</p>
      </div>
    </div>
  );
}
