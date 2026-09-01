"use client";

import { useState } from "react";
import { CardChip, ROLE_BADGE } from "./CardArt";
import type { ExchangeHistoryEntry } from "./DalmutiEffects";
import type { SeatIndex } from "./engine";

/**
 * Always-visible "📜 세금 교환 기록" companion panel (2026-09-02 세션) — same
 * desktop-column / mobile-edge-tab-drawer split as
 * `avalon/AvalonRoleGuideSidebar.tsx` (confirmed via AskUserQuestion: this
 * project's only precedent for an always-visible desktop sidebar; every
 * other side panel here — `ChatDrawer`, `RoomBettingPanel` — is a
 * floating-toggle drawer on every screen size instead). `src/app/games/
 * [gameId]/page.tsx` widens 달무티's page container the same way it already
 * does for avalon/summoners-rift, so this column has room beside the board
 * on `lg+` without squeezing it.
 *
 * Privacy model (AskUserQuestion, task brief "본인이 직접 주고받은 카드
 * 내역만... 프라이빗 로그"): every entry in `entries` is shown to every
 * viewer (it's a log of the whole game, not just "my" exchanges), but the
 * *detail level* per row depends on whether `viewerSeat` was actually a
 * party to it — a party sees the real `CardChip`s via `PartyRow`; anyone
 * else sees only `ThirdPartyRow`'s masked "◯◯ ↔ ◯◯ 교환 완료 (N장)" line,
 * no card numbers. This mirrors `DalmutiEffects.tsx`'s existing
 * `isExchangeParticipant` masking scope for `FlyingExchangeCard` — same
 * UI-layer-only trust model (docs/architecture.md §2: every client already
 * holds every seat's real hand locally, there is no server-authoritative
 * engine to enforce this at the network level).
 */

function titleEmoji(title: string): string {
  return ROLE_BADGE[title]?.emoji ?? "❔";
}

function isParty(entry: ExchangeHistoryEntry, viewerSeat: SeatIndex): boolean {
  if (entry.kind === "commoner") return viewerSeat === entry.seatA || viewerSeat === entry.seatB;
  return viewerSeat === entry.recipientSeat || viewerSeat === entry.giverSeat;
}

/** Card count this entry's masked third-party summary quotes — the defining tribute size (2 for 왕↔노예, 1 for 귀족↔거지), or 1 for a commoner swap (always one card each way). */
function entryCardCount(entry: ExchangeHistoryEntry): number {
  return entry.kind === "commoner" ? 1 : entry.givenCards.length;
}

function ThirdPartyRow({ entry, titleFor }: { entry: ExchangeHistoryEntry; titleFor: (seat: SeatIndex) => string }) {
  const [seatA, seatB] = entry.kind === "commoner" ? [entry.seatA, entry.seatB] : [entry.giverSeat, entry.recipientSeat];
  const titleA = titleFor(seatA);
  const titleB = titleFor(seatB);
  const kindLabel = entry.kind === "commoner" ? "자유 교환" : "세금 교환";
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px] break-keep text-white/50">
      [ {titleEmoji(titleA)} {titleA} ↔ {titleEmoji(titleB)} {titleB} {kindLabel} 완료 ({entryCardCount(entry)}장) ]
    </div>
  );
}

/** Which cards *this viewer* gave vs received, and the two-way korean label pair — differs by kind and which side of the entry `viewerSeat` sits on. */
function partyDirections(entry: ExchangeHistoryEntry, viewerSeat: SeatIndex) {
  if (entry.kind === "commoner") {
    const iAmA = viewerSeat === entry.seatA;
    const otherSeat = iAmA ? entry.seatB : entry.seatA;
    const givenByMe = iAmA ? [entry.cardFromA] : [entry.cardFromB];
    const receivedByMe = iAmA ? [entry.cardFromB] : [entry.cardFromA];
    return { otherSeat, givenLabel: "📤 내가 준 카드", receivedLabel: "📥 받은 카드", givenByMe, receivedByMe };
  }
  const isRecipient = viewerSeat === entry.recipientSeat;
  const otherSeat = isRecipient ? entry.giverSeat : entry.recipientSeat;
  if (isRecipient) {
    return { otherSeat, givenLabel: "📤 하사한 카드", receivedLabel: "📥 상납받은 카드", givenByMe: entry.returnedCards, receivedByMe: entry.givenCards };
  }
  return { otherSeat, givenLabel: "📤 상납한 카드", receivedLabel: "📥 하사받은 카드", givenByMe: entry.givenCards, receivedByMe: entry.returnedCards };
}

function PartyRow({
  entry,
  viewerSeat,
  names,
  titleFor,
}: {
  entry: ExchangeHistoryEntry;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  titleFor: (seat: SeatIndex) => string;
}) {
  const { otherSeat, givenLabel, receivedLabel, givenByMe, receivedByMe } = partyDirections(entry, viewerSeat);
  const otherTitle = titleFor(otherSeat);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-300/20 bg-amber-400/[0.05] p-2.5 text-[11px]">
      <p className="break-keep font-semibold text-amber-100/90">
        {titleEmoji(otherTitle)} {otherTitle}({names[otherSeat]})와(과) {entry.kind === "commoner" ? "자유 교환" : "세금 교환"}
      </p>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] break-keep text-white/50">{givenLabel}</span>
        <div className="flex flex-wrap gap-1">
          {givenByMe.map((c) => (
            <CardChip key={c.id} card={c} className="opacity-70 grayscale" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] break-keep text-emerald-200/70">{receivedLabel}</span>
        <div className="flex flex-wrap gap-1">
          {receivedByMe.map((c) => (
            <CardChip key={c.id} card={c} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({
  entry,
  viewerSeat,
  names,
  titleFor,
}: {
  entry: ExchangeHistoryEntry;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  titleFor: (seat: SeatIndex) => string;
}) {
  return isParty(entry, viewerSeat) ? (
    <PartyRow entry={entry} viewerSeat={viewerSeat} names={names} titleFor={titleFor} />
  ) : (
    <ThirdPartyRow entry={entry} titleFor={titleFor} />
  );
}

export interface ExchangeHistoryPanelProps {
  entries: ExchangeHistoryEntry[];
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  titleFor: (seat: SeatIndex) => string;
}

function PanelContent(props: ExchangeHistoryPanelProps) {
  // Newest first — the most recently resolved exchange is what a player is
  // most likely checking back on.
  const ordered = [...props.entries].reverse();
  return (
    <div className="flex flex-col gap-2">
      {ordered.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-black/20 p-3 text-center text-[11px] break-keep text-white/40">
          아직 세금 교환 기록이 없습니다.
        </p>
      ) : (
        ordered.map((entry) => <HistoryRow key={entry.id} entry={entry} viewerSeat={props.viewerSeat} names={props.names} titleFor={props.titleFor} />)
      )}
    </div>
  );
}

export default function ExchangeHistoryPanel(props: ExchangeHistoryPanelProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* Desktop: always-visible fixed column beside the board (AskUserQuestion). */}
      <aside
        className="hidden max-h-[80vh] w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-[24px] border border-white/10 p-3 text-xs backdrop-blur-md lg:flex"
        style={{ background: "rgba(20,16,32,0.55)" }}
      >
        <h3 className="text-[11px] font-semibold tracking-wide break-keep text-amber-200/90 uppercase">📜 세금 교환 기록</h3>
        <PanelContent {...props} />
      </aside>

      {/* Mobile/tablet: collapsed edge tab that opens a slide-in drawer, same pattern as AvalonRoleGuideSidebar. */}
      <button
        onClick={() => setDrawerOpen(true)}
        aria-label="세금 교환 기록 패널 열기"
        className="fixed top-1/2 right-0 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-xl border border-r-0 border-amber-300/30 bg-[#180f26] px-1.5 py-3 text-[10px] font-semibold text-amber-200 shadow-lg lg:hidden"
      >
        <span className="text-base">📜</span>
        <span className="[writing-mode:vertical-rl]">교환 기록</span>
        {props.entries.length > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {props.entries.length}
          </span>
        )}
      </button>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
          <div
            className="relative flex h-full w-[85vw] max-w-sm flex-col gap-3 overflow-y-auto border-l border-amber-300/20 p-4 text-xs shadow-2xl backdrop-blur-md"
            style={{ background: "rgba(20,16,32,0.92)" }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold tracking-wide break-keep text-amber-200/90 uppercase">📜 세금 교환 기록</h3>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="닫기"
                className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:border-white/30 hover:text-white"
              >
                ✕
              </button>
            </div>
            <PanelContent {...props} />
          </div>
        </div>
      )}
    </>
  );
}
