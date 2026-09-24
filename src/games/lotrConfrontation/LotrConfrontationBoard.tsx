"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CardFace } from "./CardFace";
import { CombatResultModal, LiveCombatModal, VictoryModal } from "./CombatModals";
import { CARDS, CHARACTERS, FACTION_CHARACTERS, FACTION_LABEL, SETUP_SLOTS } from "./data";
import { TURN_LIMIT, otherFaction, randomPlacement, type CharacterId, type EngineAction, type Faction, type LotrState, type Seat } from "./engine";
import { lotrSfx } from "./lotrAudio";
import MiddleEarthMap, { type MapToken } from "./MiddleEarthMap";
import { getLegalMoves, piecesIn } from "./movement";

/**
 * 반지의 제왕: 가운데땅에서의 대결 in-game view — dark-luxury Middle-earth
 * theme with amber rim light.
 *
 * Mobile: content-sized rather than a hard `h-[100dvh]` (this renders inside
 * the shared `/games/[gameId]` page chrome, and a hard 100dvh there overflows
 * the real viewport — same reason as splendorDuel/SplendorDuelBoard.tsx). The
 * map is capped at 52dvh tall on phones and the hand is a single horizontal
 * strip, so the whole table fits a phone screen.
 * Desktop (md+): map on the left, status / hand / log panel on the right.
 */

const KEYFRAMES = `
@keyframes lotr-flip { 0% { transform: perspective(600px) rotateY(90deg); opacity: 0 } 100% { transform: perspective(600px) rotateY(0); opacity: 1 } }
.lotr-card-flip { animation: lotr-flip .55s cubic-bezier(.2,.8,.2,1) both }
@keyframes lotr-modal-in { 0% { transform: scale(.92); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }
.lotr-modal-in { animation: lotr-modal-in .28s ease-out both }
@keyframes lotr-stamp { 0% { transform: scale(2.2); opacity: 0; letter-spacing: .4em } 60% { transform: scale(.95); opacity: 1 } 100% { transform: scale(1); letter-spacing: normal } }
.lotr-stamp { animation: lotr-stamp .6s cubic-bezier(.2,.9,.2,1) both .35s }
@keyframes lotr-dead { 0% { filter: none; transform: none } 40% { transform: translateX(-4px) rotate(-2deg) } 70% { transform: translateX(4px) rotate(2deg) } 100% { filter: grayscale(1) brightness(.55); transform: none } }
.lotr-dead { animation: lotr-dead .7s ease-out both .5s }
@keyframes lotr-battle-glow { 0%,100% { box-shadow: 0 0 10px rgba(244,63,94,.4) } 50% { box-shadow: 0 0 28px rgba(244,63,94,.85) } }
.lotr-battle-glow { animation: lotr-battle-glow 1.1s ease-in-out infinite }
@keyframes lotr-rune { 0%,100% { opacity: .55; text-shadow: 0 0 2px currentColor } 50% { opacity: 1; text-shadow: 0 0 8px currentColor } }
.lotr-rune { animation: lotr-rune 2.6s ease-in-out infinite }
@keyframes lotr-emblem { 0% { transform: scale(.4) rotate(-20deg); opacity: 0; filter: drop-shadow(0 0 0 gold) } 60% { transform: scale(1.15) rotate(4deg); opacity: 1 } 100% { transform: scale(1); filter: drop-shadow(0 0 18px rgba(251,191,36,.7)) } }
.lotr-victory-emblem { animation: lotr-emblem .9s cubic-bezier(.2,.9,.2,1) both }
@keyframes lotr-turn { 0% { opacity: 0; transform: translateY(-4px) } 100% { opacity: 1; transform: none } }
.lotr-turn-in { animation: lotr-turn .35s ease-out both }
`;

interface Props {
  state: LotrState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  onLeave: () => void;
  onRematch: () => void;
  onOpenRulebook: () => void;
}

export default function LotrConfrontationBoard({ state, viewerSeat, names, opponentConnected, onAction, onLeave, onRematch, onOpenRulebook }: Props) {
  const myFaction = state.factionOf[viewerSeat];
  const oppFaction = otherFaction(myFaction);
  const oppSeat: Seat = viewerSeat === "p1" ? "p2" : "p1";

  // ---- setup (local draft until confirmed) ----
  const [draft, setDraft] = useState<Record<string, string>>(() => randomPlacement(myFaction, state.seed + (viewerSeat === "p1" ? 11 : 23)));
  const [draftSeed, setDraftSeed] = useState(state.seed);
  if (draftSeed !== state.seed) {
    // New game (rematch) — reset the draft during render (no effect needed).
    setDraftSeed(state.seed);
    setDraft(randomPlacement(myFaction, state.seed + (viewerSeat === "p1" ? 11 : 23)));
  }
  const [selected, setSelected] = useState<CharacterId | null>(null);
  const [seenReport, setSeenReport] = useState(state.lastCombat?.no ?? 0);
  const [victoryClosed, setVictoryClosed] = useState(false);
  const [showOppCards, setShowOppCards] = useState(false);
  // Phones: the hand is collapsed by default (cards are picked inside the combat modal anyway).
  const [showHand, setShowHand] = useState(false);

  const inSetup = state.phase === "SETUP" && !state.setupDone[myFaction];
  const myTurn = state.phase === "MOVEMENT" && state.turn === myFaction;

  // ---- sound cues on state transitions ----
  const prev = useRef(state);
  useEffect(() => {
    const p = prev.current;
    prev.current = state;
    if (p === state) return;
    if (state.combatCount > p.combatCount) {
      lotrSfx.battle();
      window.setTimeout(() => lotrSfx.reveal(), 350);
    } else if (state.lastMove !== p.lastMove && state.lastMove) lotrSfx.move();
    if (state.lastCombat && state.lastCombat.no !== p.lastCombat?.no) {
      const r = state.lastCombat;
      if (r.outcome === "escaped") lotrSfx.escape();
      else if (r.attacker.died || r.defender.died) lotrSfx.death();
      else lotrSfx.survive();
    }
    if (state.phase === "GAME_OVER" && p.phase !== "GAME_OVER") window.setTimeout(() => (state.winner === myFaction ? lotrSfx.victory() : lotrSfx.defeat()), 600);
    else if (state.phase === "MOVEMENT" && state.turn === myFaction && (p.turn !== myFaction || p.phase === "SETUP")) lotrSfx.myTurn();
  }, [state, myFaction]);

  // ---- tokens on the map (fog of war applied here) ----
  const tokens: MapToken[] = useMemo(() => {
    const out: MapToken[] = [];
    if (inSetup) {
      for (const c of FACTION_CHARACTERS[myFaction]) out.push({ id: c, faction: myFaction, regionId: draft[c], hidden: false, mine: true });
    }
    for (const p of Object.values(state.pieces)) {
      if (!p) continue;
      if (inSetup && p.faction === myFaction) continue;
      const mine = p.faction === myFaction;
      out.push({
        id: p.characterId,
        faction: p.faction,
        regionId: p.regionId,
        hidden: !mine && !p.isRevealed,
        mine,
        frozen: state.immobile[p.characterId] !== undefined && state.immobile[p.characterId]! >= state.turnNumber,
      });
    }
    return out;
  }, [state, inSetup, draft, myFaction]);

  const legal = useMemo(() => (myTurn && selected ? getLegalMoves(state, selected) : []), [myTurn, selected, state]);
  const targets: Record<string, "move" | "attack"> = {};
  for (const r of legal) targets[r] = piecesIn(state, r).some((p) => p.faction !== myFaction) ? "attack" : "move";

  const setupFree = useMemo(() => {
    if (!inSetup || !selected) return [];
    return Object.entries(SETUP_SLOTS[myFaction])
      .filter(([r, n]) => r !== draft[selected] && Object.values(draft).filter((v) => v === r).length < n)
      .map(([r]) => r);
  }, [inSetup, selected, draft, myFaction]);

  function onTokenClick(id: CharacterId) {
    if (inSetup) {
      if (!selected) return setSelected(id);
      if (selected === id) return setSelected(null);
      setDraft((d) => ({ ...d, [selected]: d[id], [id]: d[selected] }));
      lotrSfx.select();
      return setSelected(null);
    }
    if (!myTurn) return;
    lotrSfx.select();
    setSelected((s) => (s === id ? null : id));
  }

  function onRegionClick(regionId: string) {
    if (inSetup && selected) {
      setDraft((d) => ({ ...d, [selected]: regionId }));
      setSelected(null);
      return;
    }
    if (myTurn && selected && targets[regionId]) {
      onAction({ type: "move", faction: myFaction, pieceId: selected, to: regionId });
      setSelected(null);
    }
  }

  const alive = (f: Faction) => Object.values(state.pieces).filter((p) => p && p.faction === f).length;
  const dead = (f: Faction) => state.graveyard.filter((c) => CHARACTERS[c].faction === f);

  const report = state.lastCombat && state.lastCombat.no > seenReport && !state.combat ? state.lastCombat : null;

  let status: string;
  if (state.phase === "SETUP") {
    status = inSetup
      ? "🌫️ 말을 고른 뒤 다른 말(자리 교환) 또는 빈 구역을 누르세요."
      : "상대가 안개 속에서 말을 배치하는 중…";
  } else if (state.phase === "GAME_OVER") {
    status = `🏆 ${state.winner ? FACTION_LABEL[state.winner] : ""} 승리 — ${state.winReason ?? ""}`;
  } else if (state.phase === "COMBAT") {
    status = "⚔️ 전투가 벌어지고 있습니다!";
  } else if (myTurn) {
    status = selected ? `${CHARACTERS[selected].name} 선택됨 — 빛나는 구역으로 이동하세요 (⚔️ = 전투).` : "내 차례 — 이동할 말 1개를 고르세요.";
  } else {
    status = `${names[oppSeat]}의 차례…`;
  }

  const myHandSorted = useMemo(
    () =>
      [...state.hands[myFaction]].sort((a, b) => {
        const ca = CARDS[a];
        const cb = CARDS[b];
        if (ca.type !== cb.type) return ca.type === "BASIC" ? -1 : 1;
        return ca.power - cb.power || a.localeCompare(b);
      }),
    [state.hands, myFaction],
  );

  const factionTone = (f: Faction) => (f === "FELLOWSHIP" ? "text-sky-300" : "text-rose-400");

  return (
    <div className="flex flex-col gap-2 text-neutral-100 select-none">
      <style>{KEYFRAMES}</style>

      {/* Header: turn + Shire invasion counter */}
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 rounded-2xl border border-amber-500/25 bg-neutral-950/90 px-3 shadow-[0_0_24px_rgba(245,158,11,0.08)]">
        <div key={`${state.turn}-${state.phase}`} className="lotr-turn-in flex min-w-0 items-center gap-2">
          <span className="text-base">{state.phase === "SETUP" ? "🌫️" : state.turn === "FELLOWSHIP" ? "💍" : "👁️"}</span>
          <span className={`truncate font-serif text-xs font-black tracking-widest ${state.phase === "SETUP" ? "text-amber-200" : factionTone(state.turn)}`}>
            {state.phase === "SETUP" ? "비밀 배치" : `${FACTION_LABEL[state.turn]}의 턴`}
          </span>
          {state.phase !== "SETUP" && <span className="text-[10px] text-white/35">#{state.turnNumber}</span>}
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="font-bold text-rose-400" title="사우론 말 3개가 샤이어에 들어가면 사우론 승리">
            🏡 침공 {state.shireInvadersCount}/3
          </span>
          <button onClick={onOpenRulebook} className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-400/10">
            📖
          </button>
        </div>
      </header>

      {/* Opponent strip */}
      <PlayerStrip
        name={names[oppSeat]}
        faction={oppFaction}
        alive={alive(oppFaction)}
        dead={dead(oppFaction)}
        hand={state.hands[oppFaction].length}
        discard={state.discards[oppFaction].length}
        connected={opponentConnected}
        onToggleCards={() => setShowOppCards((v) => !v)}
      />
      {showOppCards && (
        <div className="flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-black/40 p-2">
          <p className="w-full text-[10px] text-white/45">상대 손에 남은 카드 (버린 카드는 공개 정보라 역산 가능)</p>
          {[...state.hands[oppFaction]].sort().map((id) => (
            <CardFace key={id} cardId={id} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-4">
        <div className="md:w-[560px] md:shrink-0">
          <MiddleEarthMap
            viewerFaction={myFaction}
            tokens={tokens}
            selectedId={selected}
            targets={targets}
            softRegions={setupFree}
            lastMove={state.lastMove}
            battleRegion={state.combat?.regionId ?? null}
            onTokenClick={onTokenClick}
            onRegionClick={onRegionClick}
          />
        </div>

        <aside className="flex min-w-0 flex-1 flex-col gap-2">
          <div className={`rounded-2xl border px-3 py-2 text-xs leading-snug ${myTurn || inSetup ? "border-amber-400/50 bg-amber-500/10 text-amber-100" : "border-white/10 bg-white/5 text-white/70"}`}>
            {status}
            {state.phase !== "SETUP" && state.turnNumber > TURN_LIMIT - 40 && state.phase !== "GAME_OVER" && (
              <span className="mt-1 block text-rose-300">⏳ {TURN_LIMIT}턴이 지나면 사우론이 승리합니다 (현재 {state.turnNumber}턴).</span>
            )}
          </div>

          {inSetup && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDraft(randomPlacement(myFaction, Math.floor(Math.random() * 1e9)));
                  setSelected(null);
                }}
                className="flex-1 rounded-xl border border-amber-400/40 py-2 text-xs font-bold text-amber-200 hover:bg-amber-400/10"
              >
                🎲 무작위 재배치
              </button>
              <button
                onClick={() => {
                  onAction({ type: "setup", faction: myFaction, placement: draft as Partial<Record<CharacterId, string>> });
                  setSelected(null);
                }}
                className="flex-1 rounded-xl bg-amber-500 py-2 text-xs font-black text-black hover:bg-amber-400"
              >
                ✅ 배치 완료
              </button>
            </div>
          )}

          <PlayerStrip
            name={`${names[viewerSeat]} (나)`}
            faction={myFaction}
            alive={alive(myFaction)}
            dead={dead(myFaction)}
            hand={state.hands[myFaction].length}
            discard={state.discards[myFaction].length}
            connected
            onToggleCards={() => setShowHand((v) => !v)}
          />

          {/* My hand — horizontal strip on phones, wrapped grid on desktop */}
          <div className={`rounded-2xl border border-white/10 bg-black/30 p-2 md:block ${showHand ? "block" : "hidden"}`}>
            <p className="mb-1 text-[10px] text-white/45">
              내 전투 카드 {state.hands[myFaction].length}장 · 버린 더미 {state.discards[myFaction].length}장 {state.hands[myFaction].length <= 3 && "· 손패가 0장이 되면 버린 더미 전체를 회수합니다"}
            </p>
            <div className="flex gap-1.5 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
              {myHandSorted.map((id) => (
                <CardFace key={id} cardId={id} />
              ))}
            </div>
          </div>

          <details className="hidden rounded-2xl border border-white/10 bg-black/30 p-2 text-[11px] text-white/60 md:block" open>
            <summary className="cursor-pointer text-[10px] text-white/45">전황 기록</summary>
            <ul className="mt-1 flex max-h-44 flex-col-reverse gap-0.5 overflow-y-auto">
              {[...state.log].reverse().map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </details>
        </aside>
      </div>

      {state.combat && <LiveCombatModal key={state.combatCount} state={state} myFaction={myFaction} onAction={onAction} />}
      {report && <CombatResultModal report={report} myFaction={myFaction} onClose={() => setSeenReport(report.no)} />}
      {!state.combat && !report && state.phase === "GAME_OVER" && !victoryClosed && (
        <VictoryModal
          state={state}
          myFaction={myFaction}
          onRematch={() => {
            setVictoryClosed(false);
            onRematch();
          }}
          onLeave={onLeave}
          onClose={() => setVictoryClosed(true)}
        />
      )}
      {state.phase === "GAME_OVER" && victoryClosed && (
        <div className="flex gap-2">
          <button onClick={onLeave} className="flex-1 rounded-xl border border-white/15 py-2 text-xs text-white/70">
            나가기
          </button>
          <button onClick={onRematch} className="flex-1 rounded-xl bg-amber-500 py-2 text-xs font-black text-black">
            진영 바꿔 재대결
          </button>
        </div>
      )}
    </div>
  );
}

function PlayerStrip({
  name,
  faction,
  alive,
  dead,
  hand,
  discard,
  connected,
  onToggleCards,
}: {
  name: string;
  faction: Faction;
  alive: number;
  dead: CharacterId[];
  hand: number;
  discard: number;
  connected: boolean;
  onToggleCards?: () => void;
}) {
  const light = faction === "FELLOWSHIP";
  return (
    <div className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-1.5 text-[11px] ${light ? "border-sky-400/25 bg-sky-950/30" : "border-red-500/25 bg-red-950/30"}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <span>{light ? "💍" : "👁️"}</span>
        <span className="truncate font-bold text-white/90">{name}</span>
        <span className={light ? "text-sky-300" : "text-rose-400"}>{FACTION_LABEL[faction]}</span>
        {!connected && <span className="text-[10px] text-rose-300">(연결 끊김)</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-white/60">
        <span title="생존 말">🧍{alive}</span>
        {dead.length > 0 && (
          <span title={`전사: ${dead.map((d) => CHARACTERS[d].name).join(", ")}`} className="max-w-24 truncate opacity-70">
            🪦{dead.map((d) => CHARACTERS[d].emoji).join("")}
          </span>
        )}
        {onToggleCards ? (
          <button onClick={onToggleCards} className="rounded-full border border-white/15 px-1.5 hover:border-white/30" title="카드 목록 펼치기/접기">
            🂠{hand}
          </button>
        ) : (
          <span>🂠{hand}</span>
        )}
        <span title="버린 카드">🗑{discard}</span>
      </div>
    </div>
  );
}
