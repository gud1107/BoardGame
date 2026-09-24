"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import CardMarket from "./CardMarket";
import { CardActionSheet, PendingPanel, VictoryModal } from "./DuelModals";
import { DuelToken, TOKEN_LABEL } from "./DuelToken";
import {
  BeginnerGuide,
  EdgeDrawer,
  VictoryPanel,
  type GuideTopic,
} from "./DuelSidePanels";
import GoldReservoir from "./GoldReservoir";
import PlayerDock from "./PlayerDock";
import SpiralGridBoard from "./SpiralGridBoard";
import { playDuelEventSound, playDuelVictorySound } from "./splendorDuelAudio";
import {
  canAfford,
  getValidMoves,
  isValidSelection,
  otherSeat,
  RESERVE_LIMIT,
  selectionGivesPrivilege,
  type DuelCard,
  type DuelEvent,
  type EngineAction,
  type Level,
  type ScrollSource,
  type Seat,
  type SplendorDuelState,
} from "./engine";

/**
 * 스플렌더 대결 in-game view — "dark luxury gem lounge" theme.
 *
 * Desktop (md+): opponent dock / [gem board | card market] / my dock.
 * Mobile: content-sized rather than a hard `h-[100dvh]` (this renders inside
 * the shared `/games/[gameId]` page chrome, and a hard 100dvh there overflows
 * the real viewport — see mineOfOblivion2/MineOfOblivion2MobileBoard.tsx's
 * doc comment for the concrete bug). To keep a phone free of page scroll the
 * board and the card market share one slot behind a 2-tab switch, so only
 * one of the two tall sections is ever laid out at once.
 */

function subscribeMq(cb: () => void) {
  const mq = window.matchMedia("(min-width: 768px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useIsDesktop() {
  return useSyncExternalStore(
    subscribeMq,
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  );
}

function scrollNote(from: ScrollSource, gainer: string) {
  if (from === "table") return ` · ${gainer} 📜+1`;
  if (from === "opponent") return ` · ${gainer}이(가) 📜을 빼앗음`;
  return "";
}

function describeEvent(e: DuelEvent, names: Record<Seat, string>): string {
  const who = names[e.seat];
  const opp = names[otherSeat(e.seat)];
  switch (e.kind) {
    case "take":
      return `${who}: 토큰 ${e.count}개 획득${e.penalty ? ` ⚠️ 페널티${scrollNote(e.scrollFrom, opp)}` : ""}`;
    case "scrollUse":
      return `${who}: 📜 특권 스크롤 사용`;
    case "refill":
      return `${who}: 🔄 보드 보충${scrollNote(e.scrollFrom, opp)}`;
    case "reserve":
      return `${who}: 📥 카드 예약${e.gainedGold ? " + 황금" : " (황금 소진 — 카드만 예약)"}`;
    case "buy":
      return `${who}: 💰 카드 구매${scrollNote(e.scrollFrom, who)}`;
    case "royal":
      return `${who}: 👑 왕실 카드 획득${scrollNote(e.scrollFrom, who)}`;
    case "steal":
      return `${who}: ✋ ${opp}의 ${TOKEN_LABEL[e.color]} 토큰 강탈!`;
    case "copy":
      return `${who}: ? ${TOKEN_LABEL[e.color]} 보너스 복사`;
    case "takeMatching":
      return `${who}: ⬇ ${TOKEN_LABEL[e.color]} 토큰 추가 획득`;
    case "discard":
      return `${who}: 초과 토큰 반납`;
    case "extraTurn":
      return `${who}: ↻ 추가 턴!`;
    case "pass":
      return `${who}: 할 수 있는 행동이 없어 턴 종료`;
  }
}

/**
 * The 3 situations in which taking/refilling hands the OPPONENT a scroll
 * (rulebook §3), always shown under the gem board. The case the current
 * selection would trigger lights up, so the penalty is visible before
 * confirming. Phones get a one-line chip version to keep the board tab
 * scroll-free.
 */
function PrivilegeGiftRules({ active }: { active: "pearl" | "triple" | null }) {
  const items = [
    { key: "pearl", icon: <><DuelToken color="pearl" className="h-3.5 w-3.5" /><DuelToken color="pearl" className="h-3.5 w-3.5" /></>, full: "진주 토큰 2개를 가져올 때", short: "진주 2개" },
    { key: "triple", icon: <><DuelToken color="red" className="h-3.5 w-3.5" /><DuelToken color="red" className="h-3.5 w-3.5" /><DuelToken color="red" className="h-3.5 w-3.5" /></>, full: "같은 색상의 기본 보석 토큰 3개를 가져올 때", short: "같은 색 3개" },
    { key: "refill", icon: <span className="text-[13px] leading-none">🔄</span>, full: "자신의 턴 시작 시 선택 행동으로 주머니의 토큰을 꺼내 게임 보드를 채울(리필할) 때", short: "보드 채우기" },
  ] as const;
  const on = (k: string) => active === k;
  return (
    <div className={`w-full rounded-xl border px-2 py-1 md:py-1.5 ${active ? "border-amber-300/70 bg-amber-400/10" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"}`}>
      <p className="text-[10px] font-black text-amber-200 md:text-[11px] light:text-amber-700">
        📜 상대에게 두루마리 1개를 주는 3가지 상황
        {active && <span className="ml-1 text-amber-300">— 지금 선택이 해당돼요!</span>}
      </p>
      {/* Phone: one chip row */}
      <div className="mt-0.5 flex flex-wrap gap-1 md:hidden">
        {items.map((it) => (
          <span key={it.key} className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-bold ${on(it.key) ? "bg-amber-400 text-black" : "bg-black/40 text-white/75 light:bg-slate-100 light:text-slate-600"}`}>
            {it.icon}
            {it.short}
          </span>
        ))}
      </div>
      {/* Desktop: full sentences */}
      <ol className="mt-1 hidden flex-col gap-0.5 md:flex">
        {items.map((it, i) => (
          <li key={it.key} className={`flex items-center gap-1.5 rounded-md px-1 text-[11px] leading-snug ${on(it.key) ? "bg-amber-400 font-bold text-black" : "text-white/75 light:text-slate-600"}`}>
            <span className="w-3 shrink-0 font-mono text-[10px] opacity-70">{i + 1}</span>
            <span className="inline-flex shrink-0 items-center">{it.icon}</span>
            <span>{it.full}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function SplendorDuelBoard({
  state,
  viewerSeat,
  names,
  opponentConnected,
  onAction,
  onLeave,
  onRematch,
  onOpenRulebook,
}: {
  state: SplendorDuelState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  onLeave: () => void;
  onRematch: () => void;
  onOpenRulebook: () => void;
}) {
  const isDesktop = useIsDesktop();
  const me = state.players[viewerSeat];
  const oppSeat = otherSeat(viewerSeat);
  const myTurn = state.activeSeat === viewerSeat && state.phase !== "gameOver";
  const canMain = myTurn && state.phase === "playing" && !state.mandatoryDone;
  const pendingHead =
    myTurn && state.phase === "resolving" ? state.pending[0] : undefined;

  const [selected, setSelected] = useState<number[]>([]);
  const [scrollMode, setScrollMode] = useState(false);
  const [sheet, setSheet] = useState<{
    card: DuelCard;
    level: Level;
    index?: number;
    fromReserved: boolean;
  } | null>(null);
  const [victoryClosed, setVictoryClosed] = useState(false);
  const [mobileTab, setMobileTab] = useState<"board" | "market">("board");

  // Reset local UI selection whenever the turn/phase moves on — "compare
  // during render" pattern (no setState-in-effect), same as the rest of this
  // codebase.
  const turnKey = `${state.turnNumber}:${state.phase}:${state.eventSeq}`;
  const [seenTurnKey, setSeenTurnKey] = useState(turnKey);
  if (seenTurnKey !== turnKey) {
    setSeenTurnKey(turnKey);
    setSelected([]);
    setScrollMode(false);
    setSheet(null);
    if (state.phase !== "gameOver") setVictoryClosed(false);
    if (pendingHead?.kind === "takeToken") setMobileTab("board");
  }

  // Sound for every new engine event; skip whatever event was already there on mount/resync.
  const lastSoundSeq = useRef(state.eventSeq);
  useEffect(() => {
    if (state.eventSeq === lastSoundSeq.current) return;
    lastSoundSeq.current = state.eventSeq;
    if (state.lastEvent) playDuelEventSound(state.lastEvent);
  }, [state.eventSeq, state.lastEvent]);
  const wasOver = useRef(state.phase === "gameOver");
  useEffect(() => {
    if (state.phase === "gameOver" && !wasOver.current) playDuelVictorySound();
    wasOver.current = state.phase === "gameOver";
  }, [state.phase]);

  const validMoves = useMemo(
    () => (myTurn ? getValidMoves(state, viewerSeat) : []),
    [state, viewerSeat, myTurn],
  );
  const mustPass =
    canMain && validMoves.length === 1 && validMoves[0].type === "pass";
  const selectionValid =
    selected.length > 0 && isValidSelection(selected, state.grid);
  const penalty =
    selectionValid && selectionGivesPrivilege(selected, state.grid);
  // Which of the 3 "opponent gets a scroll" cases the current selection hits.
  const penaltyKind: "pearl" | "triple" | null = !penalty
    ? null
    : selected.filter((i) => state.grid[i] === "pearl").length >= 2
      ? "pearl"
      : "triple";
  const canRefill =
    canMain && state.bag.length > 0 && state.grid.some((t) => t === null);

  const takeTargets = useMemo(
    () =>
      pendingHead?.kind === "takeToken"
        ? new Set(
            state.grid.flatMap((t, i) => (t === pendingHead.color ? [i] : [])),
          )
        : undefined,
    [pendingHead, state.grid],
  );

  function onCellClick(cell: number) {
    if (pendingHead?.kind === "takeToken") {
      if (takeTargets?.has(cell))
        onAction({ type: "resolveTakeToken", seat: viewerSeat, cell });
      return;
    }
    if (!canMain) return;
    if (scrollMode) {
      onAction({ type: "useScroll", seat: viewerSeat, cell });
      return;
    }
    setSelected((prev) => {
      if (prev.includes(cell)) return prev.filter((c) => c !== cell);
      const next = [...prev, cell];
      if (next.length > 3) return [cell];
      return next;
    });
  }

  let status: string;
  if (state.phase === "gameOver") status = `${names[state.winner!]} 승리!`;
  else if (!myTurn)
    status = `${names[state.activeSeat]}의 차례${opponentConnected ? "" : " (연결 끊김)"}`;
  else if (pendingHead?.kind === "takeToken")
    status = `⬇ 보드에서 ${TOKEN_LABEL[pendingHead.color]} 토큰 1개를 고르세요`;
  else if (state.phase === "resolving") status = "능력/정리 단계를 처리하세요";
  else if (scrollMode) status = "📜 가져올 토큰 1개를 고르세요 (황금 제외)";
  else status = "내 차례 — 토큰 선택 또는 카드 구매/예약";

  const lastEvent = state.lastEvent;

  // Which beginner-guide card the right panel should spotlight right now.
  let guideFocus: GuideTopic | null = null;
  if (pendingHead) {
    guideFocus = {
      stealToken: "steal",
      copyBonus: "abilities",
      takeToken: "abilities",
      chooseRoyal: "royal",
      discard: "limit",
    }[pendingHead.kind] as GuideTopic;
  } else if (canMain) {
    guideFocus = scrollMode
      ? "scroll"
      : selected.length > 0
        ? "gems"
        : sheet
          ? sheet.fromReserved
            ? "buy"
            : "reserve"
          : "gems";
  }

  const boardSection = (
    <section
      className={`${isDesktop || mobileTab === "board" ? "flex" : "hidden"} flex-col items-center gap-1.5 rounded-3xl border border-white/10 bg-black/40 p-1.5 md:col-span-5 md:gap-2 md:p-2 light:border-slate-200 light:bg-white/70`}
    >
      <div className="flex w-full items-center justify-between px-1 text-[10px] font-bold tracking-widest text-amber-300/80">
        <span className="font-serif whitespace-nowrap">GEM BOARD</span>
        <span className="flex items-center gap-1.5">
          <GoldReservoir count={state.goldSupply} />
          <span
            className="font-mono whitespace-nowrap text-white/40 light:text-slate-400"
            title="주머니 · 공용 스크롤"
          >
            👝{state.bag.length} · 📜{state.tableScrolls}
          </span>
        </span>
      </div>
      <div className="mx-auto w-full max-w-[20dvh] md:max-w-none">
        <SpiralGridBoard
          grid={state.grid}
          selected={selected}
          selectable={
            pendingHead?.kind === "takeToken"
              ? (takeTargets ?? new Set())
              : canMain
                ? null
                : new Set()
          }
          highlight={takeTargets}
          onCellClick={
            canMain || pendingHead?.kind === "takeToken"
              ? onCellClick
              : undefined
          }
        />
      </div>
      {canMain && (
        <div className="flex w-full flex-wrap items-center justify-center gap-1.5">
          <button
            onClick={() => {
              setScrollMode((m) => !m);
              setSelected([]);
            }}
            disabled={me.scrolls === 0}
            className={`rounded-lg border px-2 py-1 text-[11px] font-bold disabled:opacity-30 ${scrollMode ? "border-amber-300 bg-amber-400 text-black" : "border-amber-500/40 text-amber-200 light:text-amber-700"}`}
          >
            📜 두루마리 쓰기 ({me.scrolls})
          </button>
          <button
            onClick={() => onAction({ type: "refillBoard", seat: viewerSeat })}
            disabled={!canRefill}
            title="주머니의 토큰으로 빈칸을 채웁니다. 상대가 스크롤 1개를 얻습니다."
            className="rounded-lg border border-white/15 px-2 py-1 text-[11px] font-bold text-white/80 disabled:opacity-30 light:text-slate-700"
          >
            🔄 보드 채우기 (상대 📜+1)
          </button>
          {selected.length > 0 && (
            <>
              <button
                onClick={() =>
                  onAction({
                    type: "takeTokens",
                    seat: viewerSeat,
                    cells: selected,
                  })
                }
                disabled={!selectionValid}
                className="rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 px-3 py-1 text-[11px] font-black text-black disabled:opacity-30"
              >
                ✓ {selected.length}개 가져오기
              </button>
              <button
                onClick={() => setSelected([])}
                className="rounded-lg px-2 py-1 text-[11px] text-white/50"
              >
                취소
              </button>
            </>
          )}
          {mustPass && (
            <button
              onClick={() => onAction({ type: "pass", seat: viewerSeat })}
              className="rounded-lg border border-rose-400/40 px-2 py-1 text-[11px] text-rose-200"
            >
              턴 넘기기
            </button>
          )}
        </div>
      )}
      {selected.length > 0 && !selectionValid && (
        <p className="text-[11px] font-bold text-rose-300">
          ❌ 잘못된 선택 — 가로/세로/대각선으로 붙어 있는 1~3개만 가능
        </p>
      )}
      <PrivilegeGiftRules active={penaltyKind} />
    </section>
  );

  const marketSection = (
    <section
      className={`${isDesktop || mobileTab === "market" ? "block" : "hidden"} rounded-3xl border border-white/10 bg-black/30 p-2 md:col-span-7 light:border-slate-200 light:bg-white/70`}
    >
      <CardMarket
        state={state}
        viewer={me}
        compact={!isDesktop}
        isAffordable={(c) => canMain && canAfford(c, me)}
        onCardClick={
          canMain
            ? (card, level, index) =>
                setSheet({ card, level, index, fromReserved: false })
            : undefined
        }
        onDeckClick={
          canMain && me.reserved.length < RESERVE_LIMIT
            ? (level) =>
                onAction({ type: "reserveCard", seat: viewerSeat, level })
            : undefined
        }
      />
      {canMain && (
        <p className="mt-1.5 hidden text-center text-[10px] text-white/40 md:block light:text-slate-400">
          카드를 눌러 구매/예약 · 덱을 누르면 맨 위 카드를 비공개 예약
        </p>
      )}
    </section>
  );

  return (
    <div className="xl:grid xl:grid-cols-[200px_minmax(0,1fr)_236px] xl:items-start xl:gap-3">
      <aside className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-3xl border border-amber-500/20 bg-stone-950/80 p-3 xl:block light:border-amber-500/30 light:bg-white/80">
        <VictoryPanel state={state} viewerSeat={viewerSeat} names={names} />
      </aside>
      <EdgeDrawer side="left" label="🏆 승리 조건">
        <VictoryPanel state={state} viewerSeat={viewerSeat} names={names} />
      </EdgeDrawer>
      <div
        className="relative flex flex-col gap-1.5 rounded-3xl border border-amber-500/20 p-2 md:gap-2 text-white select-none sm:p-3 light:border-amber-500/30 light:text-slate-900"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(120,53,15,0.35) 0%, transparent 55%), linear-gradient(180deg, #0c0a09 0%, #0a0a0f 100%)",
        }}
      >
        <style>{`
        @keyframes sd-toast { 0% { opacity: 0; transform: translateY(-6px); } 10%, 80% { opacity: 1; transform: none; } 100% { opacity: 0; } }
        @keyframes sd-pop { 0% { opacity: 0; transform: scale(0.8); } 60% { transform: scale(1.04); } 100% { opacity: 1; transform: none; } }
        .sd-victory-pop { animation: sd-pop 0.5s cubic-bezier(.2,.9,.3,1.2) both; }
      `}</style>

        <PlayerDock
          player={state.players[oppSeat]}
          name={names[oppSeat]}
          isMe={false}
          isActive={state.activeSeat === oppSeat && state.phase !== "gameOver"}
          compact={!isDesktop}
        />

        <div className="flex items-center justify-between gap-2 px-1">
          <p
            className={`min-w-0 truncate text-xs font-bold ${myTurn ? "text-amber-200 light:text-amber-700" : "text-white/60 light:text-slate-500"}`}
          >
            {status}
          </p>
          <span className="flex min-w-0 shrink items-center gap-2">
            {lastEvent && (
              <p
                key={state.eventSeq}
                className="truncate text-[10px] text-white/70 light:text-slate-600"
                style={{ animation: "sd-toast 3.5s ease forwards" }}
              >
                {describeEvent(lastEvent, names)}
              </p>
            )}
            <button
              onClick={onOpenRulebook}
              className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/50 hover:border-white/25 light:border-slate-200 light:text-slate-500"
            >
              📖 룰북
            </button>
          </span>
        </div>

        {!isDesktop && (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-0.5 light:bg-slate-100">
            {(["board", "market"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setMobileTab(t)}
                className={`rounded-lg py-1.5 text-xs font-bold ${mobileTab === t ? "bg-amber-400 text-black" : "text-white/60 light:text-slate-500"}`}
              >
                {t === "board" ? "💎 보석 보드" : "🃏 카드 마켓"}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
          {boardSection}
          {marketSection}
        </div>

        <PlayerDock
          player={me}
          name={names[viewerSeat]}
          isMe
          isActive={myTurn}
          compact={!isDesktop}
          canBuyReserved={(c) => canMain && canAfford(c, me)}
          onReservedClick={
            canMain
              ? (card) =>
                  setSheet({ card, level: card.level, fromReserved: true })
              : undefined
          }
        />

        {sheet && canMain && (
          <CardActionSheet
            card={sheet.card}
            player={me}
            fromReserved={sheet.fromReserved}
            canReserve={me.reserved.length < RESERVE_LIMIT}
            goldLeft={state.goldSupply}
            onClose={() => setSheet(null)}
            onBuy={() =>
              onAction({
                type: "buyCard",
                seat: viewerSeat,
                cardId: sheet.card.id,
                source: sheet.fromReserved ? "reserved" : "market",
              })
            }
            onReserve={() =>
              onAction({
                type: "reserveCard",
                seat: viewerSeat,
                level: sheet.level,
                marketIndex: sheet.index,
              })
            }
          />
        )}

        {pendingHead && pendingHead.kind !== "takeToken" && (
          <PendingPanel
            key={`${state.eventSeq}:${pendingHead.kind}`}
            state={state}
            seat={viewerSeat}
            onAction={onAction}
          />
        )}

        {state.phase === "gameOver" && !victoryClosed && (
          <VictoryModal
            state={state}
            viewerSeat={viewerSeat}
            names={names}
            onRematch={onRematch}
            onLeave={onLeave}
            onClose={() => setVictoryClosed(true)}
          />
        )}
        {state.phase === "gameOver" && victoryClosed && (
          <div className="flex justify-center gap-2">
            <button
              onClick={onRematch}
              className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-black"
            >
              🔁 다시 하기
            </button>
            <button
              onClick={onLeave}
              className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white/70"
            >
              나가기
            </button>
          </div>
        )}
      </div>
      <aside className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-3xl border border-amber-500/20 bg-stone-950/80 p-3 xl:block light:border-amber-500/30 light:bg-white/80">
        <BeginnerGuide focus={guideFocus} />
      </aside>
      <EdgeDrawer side="right" label="📘 도움말">
        <BeginnerGuide focus={guideFocus} />
      </EdgeDrawer>
    </div>
  );
}
