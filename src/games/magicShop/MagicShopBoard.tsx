"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { CARDS, cardDef, EL_EMOJI, EL_NAMES, ELEMENTS, isChoiceCard, orderDef, SUPPLY_IDS, WEB } from "./cards";
import {
  allCards,
  autoStore,
  canPay,
  finalRows,
  REROLL_COST,
  simpleHandIdxs,
  TURN_MS,
  websOf,
  type EngineAction,
  type LogEntry,
  type MagicState,
  type SeatIndex,
} from "./engine";
import { ElChip, GoldChip, MagicCard, OrderCard, SEAT_COLORS, SEAT_SHAPES } from "./CardArt";
import { getMagicShopSound, magicIntensity, magicSoundCues } from "./magicShopSound";

export interface MagicShopBoardProps {
  state: MagicState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  isHost: boolean;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
  onRulebook: () => void;
}

/** An action without its seat/turn (distributes over the union). */
type ActionBody = EngineAction extends infer A ? (A extends EngineAction ? Omit<A, "seat" | "turn"> : never) : never;

/** Ms left in this turn by this client's own clock (negative once overdue). */
function useTurnClock(turn: number): number {
  const [left, setLeft] = useState({ turn, ms: TURN_MS });
  useEffect(() => {
    const at = Date.now();
    const tick = () => setLeft({ turn, ms: TURN_MS - (Date.now() - at) });
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [turn]);
  return left.turn === turn ? left.ms : TURN_MS;
}

const PANEL = "rounded-2xl border border-white/10 bg-[#1a1030]/85 p-2.5 text-white shadow-lg";
const H = "mb-1.5 flex items-center justify-between gap-2 text-xs font-bold text-violet-100/80";

function logText(e: LogEntry, nameOf: (s: SeatIndex) => string): string {
  const who = e.seat >= 0 ? nameOf(e.seat) : "";
  switch (e.kind) {
    case "play":
      return `${who}: ${cardDef(e.card!).emoji} ${cardDef(e.card!).name}`;
    case "buy":
      return `${who} 🛒 ${cardDef(e.card!).emoji} ${cardDef(e.card!).name} 구매`;
    case "fulfil":
      return `${who} 📜 ${orderDef(e.order!).emoji} ${orderDef(e.order!).customer}에게 「${orderDef(e.order!).potion}」 납품 ⭐+${e.n}`;
    case "trash":
      return `${who} 🧹 ${cardDef(e.card!).emoji} ${cardDef(e.card!).name} 폐기`;
    case "reroll":
      return `${who} 🔄 ${orderDef(e.order!).emoji} ${orderDef(e.order!).customer} 돌려보냄`;
    case "curse":
      return `${who} 🐈‍⬛ ${(e.victims ?? []).map(nameOf).join(", ")}에게 🕸️ 거미줄`;
    case "reshuffle":
      return `${who} 🔀 버린 더미를 섞어 새 덱 (${e.n}장)`;
    case "leave":
      return `⏳ ${orderDef(e.order!).emoji} ${orderDef(e.order!).customer}이(가) 기다리다 떠났어요`;
    case "end":
      return `${who} 턴 끝${e.n ? ` · 🧪 ${e.n}개 보관` : ""}`;
    case "timeout":
      return `${who} ⏰ 시간 초과 — 자동 진행`;
  }
}

export default function MagicShopBoard({ state, viewerSeat, names, connectedSeats, isHost, onAction, onGameEnd, onRulebook }: MagicShopBoardProps) {
  const sound = getMagicShopSound;
  useSoundCues(state, sound, magicSoundCues);
  useSuiteBgm(sound, state.phase !== "gameOver", magicIntensity(state));

  const nameOf = (seat: SeatIndex) => names[seat] ?? `${seat + 1}번`;
  const myTurn = state.phase === "playing" && state.active === viewerSeat;
  const me = state.players[viewerSeat];
  const active = state.players[state.active];
  const turn = state.turn;

  // ── per-turn UI state ──
  const [uiTurn, setUiTurn] = useState(turn);
  const [trashPick, setTrashPick] = useState<number[]>([]);
  const [store, setStore] = useState<number[] | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [showDeck, setShowDeck] = useState(false);
  if (uiTurn !== turn) {
    setUiTurn(turn);
    setTrashPick([]);
    setStore(null);
    setConfirmEnd(false);
  }
  const pendingKey = state.pending ? `${state.seq}` : "";
  const [trashKey, setTrashKey] = useState(pendingKey);
  if (trashKey !== pendingKey) {
    setTrashKey(pendingKey);
    setTrashPick([]);
  }

  // ── my-turn chime + last-10-seconds ticks + timeouts ──
  const remaining = useTurnClock(turn);
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const chimedRef = useRef(-1);
  useEffect(() => {
    if (myTurn && chimedRef.current !== turn) {
      chimedRef.current = turn;
      sound().play("myTurn");
    }
  }, [myTurn, turn, sound]);
  const tickRef = useRef(-1);
  useEffect(() => {
    if (!myTurn || seconds > 10 || seconds <= 0 || tickRef.current === seconds) return;
    tickRef.current = seconds;
    sound().play("tick");
  }, [myTurn, seconds, sound]);
  const timedOutRef = useRef(-1);
  useEffect(() => {
    if (state.phase !== "playing" || timedOutRef.current === turn) return;
    const seat = myTurn ? viewerSeat : isHost && remaining <= -6000 ? state.active : null;
    if (seat === null || remaining > 0) return;
    timedOutRef.current = turn;
    onAction({ type: "timeout", seat, turn });
  }, [remaining, myTurn, isHost, state.phase, turn, state.active, viewerSeat, onAction]);

  const act = (a: ActionBody) => onAction({ ...a, seat: viewerSeat, turn } as EngineAction);

  const pool = state.pool;
  const leftover = pool.els.reduce((a, b) => a + b, 0);
  const storeNow = store ?? autoStore(state, viewerSeat);
  const storeSum = storeNow.reduce((a, b) => a + b, 0);
  const unplayed = myTurn ? me.hand.filter((c) => c !== WEB).length : 0;
  const simpleCount = myTurn ? simpleHandIdxs(me.hand).length : 0;
  const pendingMine = myTurn && state.pending;

  function adjustStore(e: number, d: number) {
    const next = [...storeNow];
    next[e] = Math.max(0, Math.min(pool.els[e], next[e] + d));
    if (next.reduce((a, b) => a + b, 0) > me.flask) return sound().play("invalid");
    sound().play("ui");
    setStore(next);
  }

  function endTurn() {
    if (unplayed > 0 && !confirmEnd) {
      setConfirmEnd(true);
      return;
    }
    act({ type: "end", store: storeNow });
  }

  const deckList = useMemo(() => {
    const counts = new Map<number, number>();
    for (const c of allCards(me)) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => cardDef(b[0]).cost - cardDef(a[0]).cost || a[0] - b[0]);
  }, [me]);

  const recentLog = state.log.slice(-8).reverse();

  return (
    <div className="flex flex-col gap-2.5 rounded-3xl bg-gradient-to-b from-[#24123f] via-[#170c2b] to-[#0d0818] p-2 text-white sm:p-3">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold">
          <span className="text-xl">🧙</span>
          마법 상점
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-violet-100">
            라운드 {state.round} · 목표 ⭐{state.goal}
          </span>
          {state.finalRound && state.phase === "playing" && <span className="animate-pulse rounded-full bg-rose-500/80 px-2 py-0.5 text-[11px]">🔔 마지막 라운드</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <SuiteSoundHud suite={sound} icon="🧙" label="Moonlit Apothecary" preview="fulfil" />
          <button onClick={onRulebook} className="rounded-full border border-white/15 px-3 py-1 text-[11px] text-white/70 hover:border-white/35">
            📖 룰북
          </button>
        </div>
      </div>

      {/* players */}
      <div className={`grid gap-1.5 ${state.playerCount <= 2 ? "grid-cols-2" : state.playerCount === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}>
        {state.players.map((p, seat) => {
          const isActive = state.phase === "playing" && seat === state.active;
          const webs = websOf(p);
          return (
            <div key={seat} className={`rounded-xl border p-1.5 text-[11px] ${isActive ? "border-amber-300 bg-amber-300/10" : "border-white/10 bg-white/[0.04]"}`}>
              <div className="flex items-center justify-between gap-1">
                <span className="truncate font-bold" style={{ color: SEAT_COLORS[seat] }}>
                  {SEAT_SHAPES[seat]} {nameOf(seat)}
                  {seat === viewerSeat && <span className="text-white/60"> (나)</span>}
                </span>
                {!connectedSeats.has(seat) && <span title="연결 끊김">📡</span>}
                {isActive && <span className="tabular-nums text-amber-200">⏱{seconds}</span>}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-yellow-200" style={{ width: `${Math.min(100, (p.fame / state.goal) * 100)}%` }} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-white/75">
                <span className="font-bold text-amber-200">⭐{p.fame}</span>
                <span title="덱 / 버린 더미">📚{p.deck.length}/{p.discard.length}</span>
                <span title="의뢰 수">📜{p.orders.length}</span>
                <span title="보관병 칸">🧪{p.flask}</span>
                {webs > 0 && <span title="거미줄 (끝날 때 −1씩)">🕸️{webs}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* orders */}
      <section className={PANEL}>
        <div className={H}>
          <span>📜 손님 의뢰 — 원소를 내고 명성 받기</span>
          <span className="font-normal text-white/50">남은 손님 {state.orderDeck.length}</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {state.orders.map((id, slot) => {
            if (id === null) return <div key={slot} className="flex h-44 items-center justify-center rounded-xl border border-dashed border-white/15 text-xs text-white/40">빈 자리</div>;
            const payable = myTurn && !state.pending && canPay(pool, orderDef(id).need);
            const canReroll = myTurn && !state.pending && !state.rerolled && pool.gold >= REROLL_COST && state.orderDeck.length > 0;
            return (
              <div key={`${slot}-${id}`} className="flex flex-col gap-1">
                <OrderCard id={id} age={state.orderAge[slot] ?? 0} payable={payable} />
                {myTurn && (
                  <div className="flex gap-1">
                    <button
                      disabled={!payable}
                      onClick={() => act({ type: "fulfil", slot, order: id })}
                      className="min-h-10 min-w-0 flex-1 whitespace-nowrap rounded-lg bg-emerald-600 px-1 text-xs font-bold text-white disabled:bg-white/10 disabled:text-white/35"
                    >
                      <span className="sm:hidden">납품</span>
                      <span className="hidden sm:inline">🧪 납품</span>
                    </button>
                    <button
                      disabled={!canReroll}
                      onClick={() => act({ type: "reroll", slot, order: id })}
                      title={`🪙${REROLL_COST}로 이 손님을 돌려보내고 새 손님 받기 (턴에 한 번)`}
                      aria-label={`🪙${REROLL_COST}로 손님 바꾸기`}
                      className="min-h-10 shrink-0 whitespace-nowrap rounded-lg border border-white/15 px-1.5 text-[11px] text-white/75 disabled:opacity-30"
                    >
                      🔄<span className="hidden sm:inline">🪙{REROLL_COST}</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* shop */}
      <section className={PANEL}>
        <div className={H}>
          <span>🛒 진열대 (산 카드는 버린 더미로)</span>
          <span className="font-normal text-white/50">창고 {state.shopDeck.length}장</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {state.shop.map((id, slot) => (
            <ShopSlot key={`s${slot}`} id={id} gold={pool.gold} enabled={!!myTurn && !state.pending} onBuy={() => id !== null && act({ type: "buy", src: "shop", slot, card: id })} />
          ))}
          {SUPPLY_IDS.map((id) => (
            <ShopSlot key={`c${id}`} id={id} gold={pool.gold} enabled={!!myTurn && !state.pending} counter onBuy={() => act({ type: "buy", src: "supply", slot: id, card: id })} />
          ))}
        </div>
      </section>

      {/* this turn's table */}
      <section className={PANEL}>
        <div className={H}>
          <span>{myTurn ? "✨ 이번 턴 내 가마솥" : `⏳ ${nameOf(state.active)} 님의 가마솥`}</span>
          <span className="flex flex-wrap items-center gap-1">
            <GoldChip n={pool.gold} size="md" />
            {pool.els.map((v, e) => (
              <ElChip key={e} e={e} n={v} size="md" dim={v === 0} />
            ))}
          </span>
        </div>
        <div className="flex min-h-[56px] flex-wrap gap-1">
          {active.played.length === 0 ? (
            <p className="self-center text-[11px] text-white/45">{myTurn ? "손의 카드를 눌러 내세요. 🪙로 카드를 사고, 원소로 의뢰를 채워요." : "아직 낸 카드가 없어요."}</p>
          ) : (
            active.played.map((c, i) => (
              <span key={i} className="rounded-lg border border-white/15 bg-white/[0.06] px-1.5 py-0.5 text-[11px]" title={cardDef(c).text}>
                {cardDef(c).emoji} {cardDef(c).name}
              </span>
            ))
          )}
        </div>
      </section>

      {/* my hand */}
      <section className={`${PANEL} ${myTurn ? "border-amber-300/50" : ""}`}>
        <div className={H}>
          <span>🃏 내 손 ({me.hand.length}장)</span>
          <span className="flex items-center gap-2 font-normal text-white/55">
            <span>
              덱 {me.deck.length} · 버림 {me.discard.length}
            </span>
            <button onClick={() => setShowDeck((v) => !v)} className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] hover:border-white/35">
              📚 내 카드 {allCards(me).length}장
            </button>
          </span>
        </div>
        {pendingMine && (
          <div className="mb-2 rounded-xl border border-rose-300/50 bg-rose-500/15 p-2 text-center text-xs">
            🧹 {cardDef(state.pending!.card).name}: 없앨 카드를 최대 {state.pending!.max}장 고르세요 (게임에서 사라져요)
            <div className="mt-1.5 flex justify-center gap-2">
              <button onClick={() => act({ type: "trash", idxs: [] })} className="min-h-10 rounded-lg border border-white/20 px-3 text-xs">
                안 없앰
              </button>
              <button onClick={() => act({ type: "trash", idxs: trashPick })} disabled={trashPick.length === 0} className="min-h-10 rounded-lg bg-rose-500 px-3 text-xs font-bold disabled:opacity-40">
                🧹 {trashPick.length}장 폐기
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-1.5">
          {me.hand.length === 0 && <p className="py-4 text-[11px] text-white/45">손에 카드가 없어요.</p>}
          {me.hand.map((c, i) => {
            const picked = trashPick.includes(i);
            const playable = myTurn && !state.pending && c !== WEB;
            const clickable = playable || (pendingMine && true);
            return (
              <button
                key={`${i}-${c}`}
                disabled={!clickable}
                onClick={() => {
                  if (pendingMine) {
                    if (picked) setTrashPick(trashPick.filter((x) => x !== i));
                    else if (trashPick.length < state.pending!.max) setTrashPick([...trashPick, i]);
                    else sound().play("invalid");
                    return;
                  }
                  act({ type: "play", idx: i, card: c });
                }}
                className={`transition ${clickable ? "hover:-translate-y-1 active:scale-95" : "opacity-80"} disabled:cursor-default`}
                aria-label={`${cardDef(c).name} ${pendingMine ? (picked ? "폐기 선택됨" : "폐기 고르기") : "내기"}`}
              >
                <MagicCard id={c} compact selected={picked} glow={!!playable && isChoiceCard(c)} />
              </button>
            );
          })}
        </div>

        {myTurn && !state.pending && (
          <div className="mt-2 flex flex-col gap-2">
            {leftover > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl bg-white/[0.05] p-1.5 text-[11px]">
                <span className="text-white/70">
                  🧪 다음 턴에 남길 원소 ({storeSum}/{me.flask}칸)
                </span>
                {Array.from({ length: ELEMENTS }, (_, e) =>
                  pool.els[e] > 0 ? (
                    <span key={e} className="flex items-center gap-0.5 rounded-full border border-white/15 px-1">
                      <button className="h-7 w-7 rounded-full text-sm" onClick={() => adjustStore(e, -1)} aria-label={`${EL_NAMES[e]} 덜 남기기`}>
                        −
                      </button>
                      {EL_EMOJI[e]}
                      {storeNow[e]}
                      <button className="h-7 w-7 rounded-full text-sm" onClick={() => adjustStore(e, 1)} aria-label={`${EL_NAMES[e]} 더 남기기`}>
                        +
                      </button>
                    </span>
                  ) : null,
                )}
                <span className="text-white/45">나머지는 사라져요 · 🪙는 남지 않아요</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                disabled={simpleCount === 0}
                onClick={() => act({ type: "playAll" })}
                className="min-h-11 rounded-xl border border-violet-300/50 bg-violet-500/25 text-sm font-bold disabled:opacity-35"
                title="고르기가 필요 없는 카드를 모두 내요 (🧹·🪞는 직접)"
              >
                ▶ 모두 내기 {simpleCount > 0 && `(${simpleCount})`}
              </button>
              <button onClick={endTurn} className={`min-h-11 rounded-xl text-sm font-bold ${confirmEnd ? "bg-rose-500" : "bg-amber-400 text-black"}`}>
                {confirmEnd ? `손에 ${unplayed}장 남았어요 — 그래도 끝내기` : `⏭ 턴 끝 (${seconds}초)`}
              </button>
            </div>
          </div>
        )}
        {!myTurn && state.phase === "playing" && (
          <p className="mt-2 text-center text-xs text-white/60">
            ⏳ {nameOf(state.active)} 님이 장사하는 중… ({seconds}초)
          </p>
        )}

        {showDeck && (
          <div className="mt-2 flex flex-wrap gap-1 rounded-xl bg-black/30 p-2">
            {deckList.map(([c, n]) => (
              <span key={c} className="rounded-lg border border-white/10 px-1.5 py-0.5 text-[11px]" title={cardDef(c).text}>
                {cardDef(c).emoji} {cardDef(c).name} ×{n}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* log */}
      <section className="rounded-2xl border border-white/10 bg-black/30 p-2 text-[11px] text-white/70">
        <div className="mb-1 font-bold text-white/60">📒 장부</div>
        <ul className="flex flex-col gap-0.5">
          {recentLog.length === 0 && <li className="text-white/40">첫 손님을 기다리는 중…</li>}
          {recentLog.map((e) => (
            <li key={e.seq} className={e.kind === "fulfil" ? "font-semibold text-emerald-200" : e.kind === "curse" ? "text-rose-200" : ""}>
              {logText(e, nameOf)}
            </li>
          ))}
        </ul>
      </section>

      {state.phase === "gameOver" && <FinalPanel state={state} nameOf={nameOf} viewerSeat={viewerSeat} onGameEnd={onGameEnd} />}
    </div>
  );
}

function ShopSlot({ id, gold, enabled, counter, onBuy }: { id: number | null; gold: number; enabled: boolean; counter?: boolean; onBuy: () => void }) {
  if (id === null) return <div className="flex h-[124px] items-center justify-center rounded-xl border border-dashed border-white/15 text-[11px] text-white/35">품절</div>;
  const d = CARDS[id];
  const affordable = enabled && gold >= d.cost;
  return (
    <div className="flex flex-col gap-1">
      <MagicCard id={id} />
      {enabled ? (
        <button
          onClick={onBuy}
          disabled={!affordable}
          className="min-h-9 rounded-lg bg-yellow-400 text-[11px] font-black text-black disabled:bg-white/10 disabled:font-semibold disabled:text-white/35"
        >
          {affordable ? `🛒 사기` : `🪙${d.cost} 필요`}
        </button>
      ) : (
        <span className="text-center text-[10px] text-white/40">{counter ? "계산대 · 늘 있음" : "진열대"}</span>
      )}
    </div>
  );
}

function FinalPanel({ state, nameOf, viewerSeat, onGameEnd }: { state: MagicState; nameOf: (s: SeatIndex) => string; viewerSeat: SeatIndex; onGameEnd: () => void }) {
  const rows = [...finalRows(state)].sort((a, b) => b.total - a.total || b.orders - a.orders || a.cards - b.cards);
  const best = rows[0];
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-3 sm:items-center">
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-2xl border border-amber-300/40 bg-[#1d1033] p-4 text-white shadow-2xl">
        <h2 className="text-center text-base font-bold">🧙 상점 문 닫을 시간! 최종 명성</h2>
        <table className="w-full text-xs">
          <thead className="text-white/50">
            <tr>
              <th className="text-left">상점 주인</th>
              <th>명성</th>
              <th title="거미줄 1장당 −1">🕸️</th>
              <th title="동점이면 의뢰가 많은 사람">📜</th>
              <th title="그래도 동점이면 카드가 적은 사람">📚</th>
              <th>합계</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.seat} className="border-t border-white/10">
                <td className="py-1.5 font-semibold">
                  {r.total === best.total && r.orders === best.orders && r.cards === best.cards && "👑 "}
                  <span style={{ color: SEAT_COLORS[r.seat] }}>{SEAT_SHAPES[r.seat]}</span> {nameOf(r.seat)}
                  {r.seat === viewerSeat && " (나)"}
                </td>
                <td className="text-center">{r.fame}</td>
                <td className="text-center">{r.webs ? `−${r.webs}` : "0"}</td>
                <td className="text-center">{r.orders}</td>
                <td className="text-center">{r.cards}</td>
                <td className="text-center font-bold text-amber-300">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-center text-[11px] text-white/50">동점이면 의뢰를 더 많이 채운 사람, 그래도 같으면 카드가 적은 사람이 앞서요.</p>
        <button onClick={onGameEnd} className="rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-black hover:bg-amber-300">
          🏆 결과 확정
        </button>
      </div>
    </div>
  );
}
