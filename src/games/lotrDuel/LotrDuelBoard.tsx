"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { FortressArt, SealStamp } from "./CardArt";
import { CardFace, COLOR_STYLE, CostChips, cardGlyph, describeCard } from "./CardFace";
import { ADJACENCY, CHAIN_INFO, COLOR_INFO, FACTION_EMOJI, FACTION_LABEL, RACES, RACE_INFO, REGIONS, REGION_INFO, TECHS, TECH_INFO, TOKENS } from "./data";
import {
  WIN_TEXT,
  availableSlots,
  calculateCardCost,
  calculateLandmarkCost,
  controlledCount,
  discardValue,
  fortressOf,
  missingTech,
  otherFaction,
  raceSymbols,
  techProduction,
  tokenOptions,
  unitsOf,
  type EngineAction,
  type Faction,
  type LandmarkTile,
  type LotrDuelState,
  type PendingStep,
  type PyramidSlot,
  type RegionId,
  type Seat,
} from "./engine";
import { ActionCinematicFX, EndingFX, FX_KEYFRAMES, type ActionFX } from "./ActionCinematicFX";
import { diffFx, type FxEvents } from "./fxEvents";
import { getLotrAudio } from "./lotrAudioEngine";
import MiddleEarthMap from "./MiddleEarthMap";
import RingTrackBoard from "./RingTrackBoard";

/**
 * 반지의 제왕: 가운데땅에서의 대결 in-game view.
 *
 * Desktop (lg+): header HUD, then 3 columns — map | chapter pyramid | ring
 * track + landmarks — and a bottom dock with both players' tableaus.
 * Phones: the same blocks stacked, with the action prompt and the pyramid
 * first (that's where every turn starts). Content-sized, no hard 100dvh (the
 * shared `/games/[gameId]` page chrome would make it overflow).
 */

const KEYFRAMES = `
@keyframes lotrd-rim { 0%,100% { box-shadow: 0 0 6px 1px rgba(251,191,36,.45), 0 4px 10px rgba(0,0,0,.55) } 50% { box-shadow: 0 0 16px 4px rgba(251,191,36,.85), 0 4px 10px rgba(0,0,0,.55) } }
.lotrd-rim { animation: lotrd-rim 2.2s ease-in-out infinite }
@keyframes lotrd-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(52,211,153,.55) } 50% { box-shadow: 0 0 0 5px rgba(52,211,153,0) } }
.lotrd-target { animation: lotrd-pulse 1.4s ease-in-out infinite }
@keyframes lotrd-clash { 0% { background: rgba(244,63,94,.65); transform: scale(1.25) } 100% { background: rgba(244,63,94,0); transform: scale(1) } }
.lotrd-clash { animation: lotrd-clash .9s ease-out both }
@keyframes lotrd-in { 0% { opacity: 0; transform: translateY(6px) } 100% { opacity: 1; transform: none } }
.lotrd-in { animation: lotrd-in .3s ease-out both }
@keyframes lotrd-emblem { 0% { transform: scale(.4) rotate(-20deg); opacity: 0 } 60% { transform: scale(1.15) rotate(4deg); opacity: 1 } 100% { transform: scale(1) } }
.lotrd-emblem { animation: lotrd-emblem .9s cubic-bezier(.2,.9,.2,1) both }
`;

const panel = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const h3 = "mb-2 text-[11px] font-semibold tracking-wide text-white/50 uppercase light:text-slate-500";

interface Props {
  state: LotrDuelState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  opponentConnected: boolean;
  onAction: (action: EngineAction) => void;
  onLeave: () => void;
  onRematch: () => void;
  onOpenRulebook: () => void;
}

function stepText(step: PendingStep): string {
  switch (step.kind) {
    case "PLACE":
      return `유닛 ${step.count}개를 배치할 지역을 고르세요 (${step.regions.length === REGIONS.length ? "어느 지역이든" : step.regions.map((r) => REGION_INFO[r].name).join(" / ")})`;
    case "MOVE":
      return `유닛 이동 (남은 ${step.remaining}회) — 출발 지역 → 인접 도착 지역 순으로 고르세요`;
    case "SNIPE":
      return `제거할 적 유닛이 있는 지역을 고르세요 (남은 ${step.count}개)`;
    case "DESTROY_FORTRESS":
      return "파괴할 적 요새를 고르세요";
    case "DESTROY_GRAY":
      return "파괴할 상대의 회색(기술) 카드를 고르세요";
    case "DISCARD_PLAY":
      return "버린 카드 더미에서 무료로 내려놓을 카드 1장을 고르세요";
    case "TOKEN_RACE":
      return "동맹 토큰을 볼 종족 더미를 고르세요";
    case "TOKEN":
      return "공개된 동맹 토큰 중 1개를 가져가세요";
    case "ENT_CHOICE":
      return `엔트 행진 — 효과를 고르세요 (남은 ${step.remaining}번)`;
  }
}

export default function LotrDuelBoard({ state, viewerSeat, names, opponentConnected, onAction, onLeave, onRematch, onOpenRulebook }: Props) {
  const myFaction = state.factionOf[viewerSeat];
  const oppFaction = otherFaction(myFaction);
  const oppSeat: Seat = viewerSeat === "p1" ? "p2" : "p1";
  const nameOf = (f: Faction) => (f === myFaction ? names[viewerSeat] : names[oppSeat]);
  const me = state.players[myFaction];

  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [moveFrom, setMoveFrom] = useState<RegionId | null>(null);
  const [victoryClosed, setVictoryClosed] = useState(false);
  // Clear local selections whenever the game moves on (derived during render, no effect).
  const [seenTurn, setSeenTurn] = useState(`${state.turnNumber}:${state.pending.length}:${state.seed}`);
  const turnKey = `${state.turnNumber}:${state.pending.length}:${state.seed}`;
  if (seenTurn !== turnKey) {
    setSeenTurn(turnKey);
    setSelectedSlot(null);
    setMoveFrom(null);
    if (state.phase === "PLAYING") setVictoryClosed(false);
  }

  const myTurn = state.phase === "PLAYING" && state.turn === myFaction;
  const front = state.pending[0];
  const act = (a: EngineAction) => {
    getLotrAudio().play("SELECT");
    onAction(a);
  };

  // ---- cinematic FX, derived during render from the previous replayed state ----
  const [fxPrev, setFxPrev] = useState(state);
  const [fx, setFx] = useState<ActionFX | null>(null);
  const [ghost, setGhost] = useState<{ key: number; slot: PyramidSlot; mode: "PLAY" | "DISCARD" } | null>(null);
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const [trail, setTrail] = useState<{ key: number; faction: Faction; from: number; to: number } | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [rise, setRise] = useState<{ key: number; region: RegionId } | null>(null);
  if (fxPrev !== state) {
    const ev = diffFx(fxPrev, state);
    setFxPrev(state);
    if (ev) {
      const n = (state.lastAction?.no ?? 0) * 100 + state.turnNumber;
      if (ev.taken) setGhost({ key: n, slot: fxPrev.pyramidGrid[ev.taken.slot], mode: ev.taken.mode });
      if (ev.flippedCardIds.length > 0) setFlipped(new Set(ev.flippedCardIds));
      const ring = ev.ring[ev.ring.length - 1];
      if (ring) setTrail({ key: n, ...ring });
      if (ev.combat) setShakeKey((k) => k + 1);
      if (ev.landmark) setRise({ key: n, region: ev.landmark.region });
      const banner = bannerFor(ev, myFaction, n);
      if (banner) setFx(banner);
    } else if (fxPrev.seed !== state.seed) {
      // Rematch — drop leftovers from the previous game.
      setFx(null);
      setGhost(null);
      setTrail(null);
      setRise(null);
    }
  }
  const dismissFx = useCallback(() => setFx(null), []);

  // ---- sound cues + chapter BGM ----
  const prev = useRef(state);
  useEffect(() => {
    const p = prev.current;
    prev.current = state;
    const ev = diffFx(p, state);
    if (!ev) return;
    const audio = getLotrAudio();
    if (ev.gameOver) {
      window.setTimeout(() => audio.playEnding(ev.gameOver!), 400);
      return;
    }
    if (ev.landmark) audio.play("LANDMARK");
    else if (ev.taken) audio.play(ev.taken.mode === "PLAY" ? "CARD_PICK" : "CARD_DISCARD");
    else if (ev.moved) audio.play("MOVE");
    else if (ev.unitsPlaced) audio.play("UNIT_PLACE");
    if (ev.flippedCardIds.length > 0) window.setTimeout(() => audio.play("CARD_FLIP"), 180);
    if (ev.combat) window.setTimeout(() => audio.play("COMBAT"), 120);
    ev.ring.forEach((r) => window.setTimeout(() => audio.play(r.faction === "FELLOWSHIP" ? "RING_FELLOWSHIP" : "RING_NAZGUL"), 250));
    if (ev.alliance) window.setTimeout(() => audio.playAlliance(ev.alliance!.token.race), 300);
    if (ev.chapter) audio.play("CHAPTER");
    else if (state.phase === "PLAYING" && state.turn === myFaction && p.turn !== myFaction) window.setTimeout(() => audio.play("MY_TURN"), 450);
  }, [state, myFaction]);

  // Chapter theme — silently ignored until the first gesture unlocks audio.
  useEffect(() => {
    getLotrAudio().setTheme(state.phase === "GAME_OVER" ? "silence" : state.chapter);
  }, [state.chapter, state.phase]);
  useEffect(() => {
    const unlock = () => getLotrAudio().unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      getLotrAudio().stop();
    };
  }, []);

  // ---- map targets for region-based pending steps ----
  const targets = new Set<RegionId>();
  if (myTurn && front) {
    if (front.kind === "PLACE") front.regions.forEach((r) => targets.add(r));
    else if (front.kind === "MOVE") {
      if (moveFrom) {
        ADJACENCY[moveFrom].forEach((r) => targets.add(r));
        targets.add(moveFrom);
      } else REGIONS.filter((r) => unitsOf(state.boardRegions[r], myFaction) > 0).forEach((r) => targets.add(r));
    } else if (front.kind === "SNIPE") REGIONS.filter((r) => unitsOf(state.boardRegions[r], oppFaction) > 0).forEach((r) => targets.add(r));
    else if (front.kind === "DESTROY_FORTRESS") REGIONS.filter((r) => fortressOf(state.boardRegions[r], oppFaction)).forEach((r) => targets.add(r));
  }
  function onRegion(r: RegionId) {
    if (!myTurn || !front) return;
    if (front.kind === "PLACE") act({ type: "PLACE", faction: myFaction, region: r });
    else if (front.kind === "SNIPE") act({ type: "SNIPE", faction: myFaction, region: r });
    else if (front.kind === "DESTROY_FORTRESS") act({ type: "DESTROY_FORTRESS", faction: myFaction, region: r });
    else if (front.kind === "MOVE") {
      if (!moveFrom) setMoveFrom(r);
      else if (r === moveFrom) setMoveFrom(null);
      else {
        onAction({ type: "MOVE", faction: myFaction, from: moveFrom, to: r });
        setMoveFrom(null);
      }
    }
  }

  const open = new Set(availableSlots(state));
  const selected = selectedSlot !== null && open.has(selectedSlot) ? state.pyramidGrid[selectedSlot] : null;
  const selectedCost = selected ? calculateCardCost(me, selected.card) : null;

  // ---- pyramid geometry (half-card units) ----
  const rows = Math.max(...state.pyramidGrid.map((s) => s.row)) + 1;
  const maxX = Math.max(...state.pyramidGrid.map((s) => Math.abs(s.x)));
  const span = (maxX + 1) * 2; // in half-card units
  const cardW = 2 / span; // fraction of width
  const cardH = (cardW * 4) / 3; // 3:4 cards
  const rowStep = cardH * 0.52;
  const totalH = (rows - 1) * rowStep + cardH;

  const slotBox = (slot: PyramidSlot): CSSProperties => ({
    left: `${((slot.x - 1 + span / 2) / span) * 100}%`,
    top: `${((slot.row * rowStep) / totalH) * 100}%`,
    width: `${cardW * 100}%`,
    height: `${(cardH / totalH) * 100}%`,
    padding: "1.5%",
  });

  const { frodoPosition: fr, nazgulPosition: nz, trackLength: L } = state.ringTrack;
  const winnerIsMe = state.winner === myFaction;

  return (
    <div className="flex flex-col gap-3 text-white light:text-slate-900">
      <style>{KEYFRAMES + FX_KEYFRAMES}</style>
      <ActionCinematicFX fx={fx} onDismiss={dismissFx} />
      {state.phase === "GAME_OVER" && state.winner && !victoryClosed && <EndingFX winner={state.winner} />}

      {/* ---- header HUD ---- */}
      <div className={`${panel} flex flex-wrap items-center gap-x-4 gap-y-2 bg-gradient-to-r from-amber-900/20 to-transparent`}>
        <span className="rounded-lg bg-amber-500/20 px-2 py-1 text-sm font-bold text-amber-200 light:text-amber-800">📖 {state.chapter}챕터</span>
        <span className="text-sm">
          {state.phase === "GAME_OVER" ? (
            <b>게임 종료</b>
          ) : myTurn ? (
            <b className="text-emerald-300 light:text-emerald-700">내 차례 ({FACTION_EMOJI[myFaction]} {FACTION_LABEL[myFaction]})</b>
          ) : (
            <span className="text-white/60 light:text-slate-500">
              {nameOf(state.turn)}의 차례 ({FACTION_EMOJI[state.turn]} {FACTION_LABEL[state.turn]})
            </span>
          )}
        </span>
        <span className="text-xs text-white/60 light:text-slate-600">
          지역 지배 💍 {controlledCount(state, "FELLOWSHIP")}/7 · 👁️ {controlledCount(state, "SAURON")}/7
        </span>
        <span className="text-xs text-white/60 light:text-slate-600">
          원정 🧝 {fr}/{L} · 🐉 {nz < 0 ? `대기 ${nz}` : nz} (간격 {fr - nz})
        </span>
        <span className="ml-auto flex items-center gap-2">
          <BgmControl />
          {!opponentConnected && <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[11px] text-rose-200">상대 연결 끊김</span>}
          <button onClick={onOpenRulebook} className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </span>
      </div>

      {/* ---- action prompt ---- */}
      <ActionPrompt state={state} myFaction={myFaction} myTurn={myTurn} front={front} moveFrom={moveFrom} opponentName={nameOf(oppFaction)} act={act} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.9fr)]">
        {/* ---- map ---- */}
        <div className="order-2 flex flex-col gap-2 lg:order-1">
          <p className={h3}>가운데땅 지도</p>
          <div key={shakeKey} className={shakeKey > 0 ? "lotrfx-shake" : undefined}>
            <MiddleEarthMap state={state} targets={targets} selectedFrom={moveFrom} onRegion={onRegion} rise={rise} />
          </div>
          <p className="text-[11px] text-white/40 light:text-slate-500">
            🟡 원정대 유닛 · ⚫ 사우론 유닛 · 🏰/🏯 요새 (전투로 파괴되지 않음). 같은 지역에 양측 유닛이 모이면 1:1로 동시에 사라집니다.
          </p>
        </div>

        {/* ---- pyramid ---- */}
        <div className="order-1 flex flex-col gap-2 lg:order-2">
          <p className={h3}>
            {state.chapter}챕터 카드 피라미드 · 남은 {state.pyramidGrid.filter((s) => !s.isTaken).length}장
          </p>
          <div className="relative w-full" style={{ aspectRatio: `${1} / ${totalH}` }}>
            {state.pyramidGrid.map((slot, i) => {
              if (slot.isTaken) return null;
              const available = open.has(i);
              const cost = calculateCardCost(me, slot.card);
              const justFlipped = flipped.has(slot.card.id);
              return (
                <div key={slot.card.id} className="absolute" style={{ ...slotBox(slot), zIndex: selectedSlot === i ? 30 : slot.row + 1 }}>
                  {justFlipped && (
                    <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                      {Array.from({ length: 8 }, (_, k) => (
                        <span
                          key={k}
                          className="absolute h-1.5 w-1.5 rounded-full bg-amber-200 shadow-[0_0_6px_#fbbf24]"
                          style={{ ["--a" as string]: `${k * 45}deg`, animation: `lotrfx-flip-spark 700ms ease-out ${150 + k * 15}ms both` } as CSSProperties}
                        />
                      ))}
                    </span>
                  )}
                  <div className={`h-full w-full ${justFlipped ? "lotrfx-flip" : ""}`}>
                  <CardFace
                    card={slot.isOpen ? slot.card : null}
                    faceDown={!slot.isOpen}
                    chapter={state.chapter}
                    available={available && myTurn && !front}
                    affordable={cost.canAfford}
                    costInCoins={cost.costInCoins}
                    viaChain={cost.viaChain}
                    locked={slot.isOpen && !available}
                    selected={selectedSlot === i}
                    onClick={() => setSelectedSlot(selectedSlot === i ? null : i)}
                  />
                  </div>
                </div>
              );
            })}
            {/* Taken card rises out of the pyramid in a rune light pillar (ends fully transparent, so it can stay mounted). */}
            {ghost && (
              <div key={ghost.key} className="pointer-events-none absolute" style={{ ...slotBox(ghost.slot), zIndex: 40 }}>
                <span
                  className={`lotrfx-pillar absolute -top-[120%] left-[15%] h-[220%] w-[70%] rounded-full blur-md ${ghost.mode === "PLAY" ? "bg-gradient-to-t from-amber-300/80 via-amber-200/30 to-transparent" : "bg-gradient-to-t from-slate-300/60 to-transparent"}`}
                />
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[clamp(10px,2vw,16px)] text-amber-200 drop-shadow-[0_0_6px_gold]" style={{ animation: "lotrfx-rim 900ms ease-out both" }}>
                  ᚱᛁᛜ
                </span>
                <div className="lotrfx-card-rise h-full w-full">
                  <CardFace card={ghost.slot.card} available chapter={state.chapter} affordable />
                </div>
              </div>
            )}
          </div>
          {selected && selectedCost && myTurn && !front && (
            <div className={`${panel} lotrd-in flex flex-col gap-2 border-amber-400/40`}>
              <div className="flex items-start gap-3">
                <div className="aspect-[3/4] w-[84px] shrink-0">
                  <CardFace card={selected.card} available chapter={state.chapter} affordable={selectedCost.canAfford} costInCoins={selectedCost.costInCoins} viaChain={selectedCost.viaChain} />
                </div>
                <div className="min-w-0 text-sm">
                  <p className="font-bold">
                    {selected.card.name} <span className="text-xs font-normal text-white/50 light:text-slate-500">({COLOR_INFO[selected.card.color].name})</span>
                  </p>
                  <p className="text-xs text-white/70 light:text-slate-600">{describeCard(selected.card)}</p>
                  <p className="mt-1 text-xs text-white/60 light:text-slate-500">
                    비용: <CostChips card={selected.card} />
                    {selected.card.providesChain && <span className="ml-2">연계 제공 {CHAIN_INFO[selected.card.providesChain]}</span>}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={!selectedCost.canAfford}
                  onClick={() => act({ type: "TAKE_CARD", faction: myFaction, slot: selectedSlot!, mode: "PLAY" })}
                  className="flex-1 rounded-xl bg-amber-500 py-2 text-sm font-semibold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
                >
                  {selectedCost.viaChain ? "🔗 연계로 무료 내려놓기" : selectedCost.canAfford ? `내려놓기 (${selectedCost.costInCoins}주화)` : `주화 부족 (${selectedCost.costInCoins} 필요)`}
                </button>
                <button
                  onClick={() => act({ type: "TAKE_CARD", faction: myFaction, slot: selectedSlot!, mode: "DISCARD" })}
                  className="flex-1 rounded-xl border border-white/20 py-2 text-sm font-semibold text-white/80 hover:border-white/40 light:border-slate-300 light:text-slate-700"
                >
                  버리기 (+{discardValue(state, myFaction)}주화)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---- ring track + landmarks + log ---- */}
        <div className="order-3 flex flex-col gap-3">
          <div className={panel}>
            <p className={h3}>반지 원정 트랙</p>
            <RingTrackBoard key={trail?.key ?? 0} frodoPos={fr} nazgulPos={nz} trail={trail} />
            <p className="mt-2 text-[11px] text-white/55 light:text-slate-600">
              파란 카드의 💍는 <b>내 말</b>을 전진시키고, <b>지나가거나 멈춘 모든 칸의 보상</b>을 순서대로 받습니다. 🧝 프로도 & 샘이 🌋 운명의 산({L})에 닿으면 원정대 즉시 승리 · 🐉 나즈굴이 프로도 칸에 닿거나 추월하면 사우론 즉시 승리.
            </p>
          </div>

          <div className={panel}>
            <p className={h3}>랜드마크 (공개 {state.revealedLandmarks.length}장 · 더미 {state.landmarkDeck.length})</p>
            <div className="flex flex-col gap-1.5">
              {state.revealedLandmarks.length === 0 && <p className="text-xs text-white/40">이번 챕터엔 남은 랜드마크가 없습니다. 챕터가 끝나면 3장으로 채워집니다.</p>}
              {state.revealedLandmarks.map((tile) => {
                const cost = calculateLandmarkCost(state, myFaction, tile);
                return (
                  <LandmarkTileCard
                    key={tile.id}
                    tile={tile}
                    cost={cost.costInCoins}
                    surcharge={cost.costInCoins - tile.baseCost.coins - missingTech(me, tile.baseCost.tech)}
                    canAfford={cost.canAfford}
                    canBuild={myTurn && !front}
                    onBuild={() => act({ type: "TAKE_LANDMARK", faction: myFaction, landmarkId: tile.id })}
                  />
                );
              })}
            </div>
          </div>

          <div className={`${panel} max-h-48 overflow-y-auto`}>
            <p className={h3}>기록</p>
            <ul className="flex flex-col gap-0.5 text-[11px] text-white/65 light:text-slate-600">
              {[...state.log].reverse().slice(0, 14).map((e) => (
                <li key={e.no} className={e.faction === "FELLOWSHIP" ? "text-amber-200/90 light:text-amber-800" : e.faction === "SAURON" ? "text-rose-200/80 light:text-rose-800" : ""}>
                  {e.faction ? FACTION_EMOJI[e.faction] : "•"} {e.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ---- bottom dock ---- */}
      <div className="grid gap-3 md:grid-cols-2">
        <PlayerDock state={state} faction={myFaction} label={`나 · ${names[viewerSeat]}`} highlight />
        <PlayerDock state={state} faction={oppFaction} label={`상대 · ${names[oppSeat]}`} />
      </div>

      {state.phase === "GAME_OVER" && state.winner && !victoryClosed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="lotrd-in w-full max-w-sm rounded-3xl border border-amber-400/40 bg-gradient-to-b from-[#221a0c] to-[#0b0906] p-6 text-center text-white shadow-[0_0_60px_rgba(251,191,36,.25)]">
            <div className="lotrd-emblem text-6xl">{state.winner === "FELLOWSHIP" ? "💍" : "👁️"}</div>
            <p className="mt-3 text-xl font-black">{winnerIsMe ? "승리!" : "패배"}</p>
            <p className="mt-1 text-sm text-amber-200">
              {FACTION_LABEL[state.winner]} — {state.winType ? WIN_TEXT[state.winType] : ""}
            </p>
            <p className="mt-2 text-xs text-white/50">
              지역 {controlledCount(state, "FELLOWSHIP")} : {controlledCount(state, "SAURON")} · 원정 🧝{fr} 🐉{nz} · 종족 {raceSymbols(state.players.FELLOWSHIP).size} : {raceSymbols(state.players.SAURON).size}
            </p>
            <div className="mt-5 flex gap-2">
              <button onClick={onRematch} className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-black hover:bg-amber-400">
                재대결 (진영 교대)
              </button>
              <button onClick={onLeave} className="flex-1 rounded-xl border border-white/20 py-2.5 text-sm text-white/80 hover:border-white/40">
                나가기
              </button>
            </div>
            <button onClick={() => setVictoryClosed(true)} className="mt-3 text-xs text-white/40 hover:text-white/70">
              보드 보기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionPrompt({
  state,
  myFaction,
  myTurn,
  front,
  moveFrom,
  opponentName,
  act,
}: {
  state: LotrDuelState;
  myFaction: Faction;
  myTurn: boolean;
  front: PendingStep | undefined;
  moveFrom: RegionId | null;
  opponentName: string;
  act: (a: EngineAction) => void;
}) {
  if (state.phase !== "PLAYING") return null;
  const opp = otherFaction(myFaction);
  if (!myTurn) {
    return (
      <div className={`${panel} text-sm text-white/60 light:text-slate-600`}>
        ⏳ {opponentName}이(가) {front ? `선택 중 — ${stepText(front)}` : "카드나 랜드마크를 고르는 중입니다."}
      </div>
    );
  }
  if (!front) {
    return (
      <div className={`${panel} border-emerald-400/40 text-sm`}>
        <b className="text-emerald-300 light:text-emerald-700">내 차례</b> — 피라미드에서 앞면이 드러난(🟢 초록 점 = 지불 가능) 카드를 골라 내려놓거나 버리고, 또는 랜드마크를 건설하세요.
        {state.extraTurn && <span className="ml-2 rounded bg-amber-500/25 px-1.5 text-xs text-amber-200">이번 턴 후 추가 턴</span>}
      </div>
    );
  }
  const btn = "rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs font-semibold hover:border-amber-300 light:border-slate-300 light:bg-white";
  return (
    <div className={`${panel} lotrd-in flex flex-col gap-2 border-amber-400/50 bg-amber-500/10`}>
      <p className="text-sm">
        <span className="mr-1 rounded bg-amber-500/30 px-1.5 text-xs">{front.source}</span>
        <b>{stepText(front)}</b>
        {front.kind === "MOVE" && moveFrom && <span className="ml-1 text-xs text-amber-200">출발: {REGION_INFO[moveFrom].name}</span>}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {front.kind === "PLACE" &&
          front.regions.map((r) => (
            <button key={r} className={btn} onClick={() => act({ type: "PLACE", faction: myFaction, region: r })}>
              {REGION_INFO[r].name}
            </button>
          ))}
        {front.kind === "SNIPE" &&
          REGIONS.filter((r) => unitsOf(state.boardRegions[r], opp) > 0).map((r) => (
            <button key={r} className={btn} onClick={() => act({ type: "SNIPE", faction: myFaction, region: r })}>
              🎯 {REGION_INFO[r].name} ({unitsOf(state.boardRegions[r], opp)})
            </button>
          ))}
        {front.kind === "DESTROY_FORTRESS" &&
          REGIONS.filter((r) => fortressOf(state.boardRegions[r], opp)).map((r) => (
            <button key={r} className={btn} onClick={() => act({ type: "DESTROY_FORTRESS", faction: myFaction, region: r })}>
              🌳 {REGION_INFO[r].name} 요새
            </button>
          ))}
        {front.kind === "MOVE" && (
          <>
            <span className="self-center text-xs text-white/60 light:text-slate-500">지도에서 출발 → 도착 지역을 누르세요.</span>
            <button className={btn} onClick={() => act({ type: "SKIP", faction: myFaction })}>
              이동 종료
            </button>
          </>
        )}
        {front.kind === "DESTROY_GRAY" &&
          state.players[opp].tableauCards
            .filter((c) => c.color === "GRAY")
            .map((c) => (
              <button key={c.id} className={btn} onClick={() => act({ type: "DESTROY_GRAY", faction: myFaction, cardId: c.id })}>
                🔥 {c.name} {cardGlyph(c)}
              </button>
            ))}
        {front.kind === "DISCARD_PLAY" &&
          state.discardedCards.map((c) => (
            <button key={c.id} className={`${btn} ${COLOR_STYLE[c.color].chip}`} onClick={() => act({ type: "DISCARD_PLAY", faction: myFaction, cardId: c.id })} title={describeCard(c)}>
              {cardGlyph(c)} {c.name}
            </button>
          ))}
        {front.kind === "TOKEN_RACE" &&
          RACES.filter((r) => state.allianceTokenDecks[r].length > 0).map((r) => (
            <button key={r} className={btn} onClick={() => act({ type: "PICK_RACE", faction: myFaction, race: r })}>
              {RACE_INFO[r].emoji} {RACE_INFO[r].name} ({state.allianceTokenDecks[r].length})
            </button>
          ))}
        {front.kind === "TOKEN" &&
          tokenOptions(state, front).map((id) => {
            const t = TOKENS[id];
            return (
              <button key={id} className={`${btn} max-w-[15rem] text-left`} onClick={() => act({ type: "PICK_TOKEN", faction: myFaction, tokenId: id })}>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-6 w-6 shrink-0">
                    <SealStamp race={t.race} />
                  </span>
                  {t.name} <span className="text-[10px] text-white/50">{t.isOneShot ? "즉시 1회" : "지속"}</span>
                </span>
                <span className="block text-[11px] font-normal text-white/65 light:text-slate-600">{t.description}</span>
              </button>
            );
          })}
        {front.kind === "ENT_CHOICE" && (
          <>
            <button className={btn} onClick={() => act({ type: "ENT_PICK", faction: myFaction, option: "SNIPE" })}>
              🎯 적 유닛 1개 제거
            </button>
            <button className={btn} onClick={() => act({ type: "ENT_PICK", faction: myFaction, option: "DRAIN" })}>
              🪙 상대 주화 1개 차감
            </button>
            <button className={btn} onClick={() => act({ type: "ENT_PICK", faction: myFaction, option: "MOVE" })}>
              👣 유닛 이동 1회
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PlayerDock({ state, faction, label, highlight }: { state: LotrDuelState; faction: Faction; label: string; highlight?: boolean }) {
  const p = state.players[faction];
  const { fixed, choices, wild } = techProduction(p);
  const races = raceSymbols(p);
  const raceCount = (r: string) => p.tableauCards.filter((c) => c.color === "GREEN" && c.race === r).length;
  const colorCounts = p.tableauCards.reduce<Record<string, number>>((m, c) => ({ ...m, [c.color]: (m[c.color] ?? 0) + 1 }), {});
  const chains = [...new Set(p.tableauCards.map((c) => c.providesChain).filter((x): x is string => !!x))];
  return (
    <div className={`${panel} ${highlight ? "border-amber-400/30" : ""} ${state.turn === faction && state.phase === "PLAYING" ? "ring-1 ring-emerald-400/50" : ""}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <b className="text-sm">
          {FACTION_EMOJI[faction]} {FACTION_LABEL[faction]}
        </b>
        <span className="text-xs text-white/50 light:text-slate-500">{label}</span>
        <span className="ml-auto flex gap-2 text-sm font-bold">
          <span title="주화">🪙 {p.coins}</span>
          <span title="보급처 유닛" className="text-white/70 light:text-slate-600">
            🪖 {p.unitsInSupply}
          </span>
          <span title="보급처 요새" className="text-white/70 light:text-slate-600">
            🏰 {p.fortressesInSupply}
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          <span className="w-14 shrink-0 text-white/45 light:text-slate-500">기술</span>
          {TECHS.filter((s) => fixed[s] > 0).map((s) => (
            <span key={s} className="rounded bg-slate-500/25 px-1.5 py-0.5" title={TECH_INFO[s].name}>
              {TECH_INFO[s].emoji}×{fixed[s]}
            </span>
          ))}
          {choices.map((c, i) => (
            <span key={i} className="rounded bg-slate-500/25 px-1.5 py-0.5" title="매 턴 둘 중 하나">
              {c.map((s) => TECH_INFO[s].emoji).join("/")}
            </span>
          ))}
          {wild > 0 && <span className="rounded bg-slate-500/25 px-1.5 py-0.5">⛏️아무거나</span>}
          {TECHS.every((s) => fixed[s] === 0) && choices.length === 0 && wild === 0 && <span className="text-white/30">없음 (부족분 1개당 1주화)</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="w-14 shrink-0 text-white/45 light:text-slate-500">종족 {races.size}/6</span>
          {RACES.map((r) => (
            <span
              key={r}
              title={`${RACE_INFO[r].name}${raceCount(r) ? ` ×${raceCount(r)}` : ""}${p.pairRacesClaimed.includes(r) ? " (2장 동맹 획득)" : ""}`}
              className={`relative h-7 w-7 transition ${races.has(r) ? "" : "opacity-30 grayscale"}`}
            >
              <SealStamp race={r} />
              {raceCount(r) > 1 && <span className="absolute -right-1 -bottom-1 rounded-full bg-black/80 px-1 text-[9px] font-bold text-amber-200 ring-1 ring-amber-300/50">{raceCount(r)}</span>}
            </span>
          ))}
          <span title="독수리 (호빗 동맹 토큰)" className={`h-7 w-7 ${races.has("EAGLE") ? "" : "opacity-20 grayscale"}`}>
            <SealStamp race="EAGLE" />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="w-14 shrink-0 text-white/45 light:text-slate-500">카드</span>
          {(["GRAY", "GREEN", "RED", "YELLOW", "BLUE", "PURPLE"] as const).map((c) =>
            colorCounts[c] ? (
              <span key={c} className={`rounded px-1.5 py-0.5 ${COLOR_STYLE[c].chip}`}>
                {COLOR_INFO[c].emoji}
                {colorCounts[c]}
              </span>
            ) : null,
          )}
          {chains.length > 0 && <span className="text-white/60">🔗{chains.map((c) => CHAIN_INFO[c]).join("")}</span>}
        </div>
        {(p.allianceTokens.length > 0 || p.constructedLandmarks.length > 0) && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-14 shrink-0 text-white/45 light:text-slate-500">동맹</span>
            {p.allianceTokens.map((t) => (
              <span key={t.id} title={t.description} className={`rounded px-1.5 py-0.5 ${t.isOneShot ? "bg-white/5 text-white/50" : "bg-amber-500/20 text-amber-100 light:text-amber-800"}`}>
                {RACE_INFO[t.race].emoji} {t.name}
              </span>
            ))}
            {p.constructedLandmarks.map((l) => (
              <span key={l.id} className="rounded bg-white/10 px-1.5 py-0.5" title={l.description}>
                🏰 {l.name}
              </span>
            ))}
          </div>
        )}
        <p className="text-[11px] text-white/40 light:text-slate-500">
          주둔 지역 {controlledCount(state, faction)}/7 · 보드 유닛 {REGIONS.reduce((n, r) => n + unitsOf(state.boardRegions[r], faction), 0)}
        </p>
      </div>
    </div>
  );
}

const RACE_BANNER_COLOR = { ELF: "EMERALD", DWARF: "GOLD", HOBBIT: "EMERALD", HUMAN: "BLUE", ENT: "EMERALD", WIZARD: "BLUE" } as const;

/** Picks the one banner worth a full-screen moment — alliance > fortress > clash > chapter > ring. */
function bannerFor(ev: FxEvents, myFaction: Faction, id: number): ActionFX | null {
  if (ev.gameOver) return null;
  const who = (f: Faction) => (f === myFaction ? "내" : "상대");
  if (ev.alliance) {
    const t = ev.alliance.token;
    return { id, type: "ALLIANCE_SPARK", emblem: RACE_INFO[t.race].emoji, color: RACE_BANNER_COLOR[t.race], title: `${RACE_INFO[t.race].name} 동맹`, subText: `${who(ev.alliance.faction)} 동맹 토큰 「${t.name}」 — ${t.description}` };
  }
  if (ev.landmark) {
    return { id, type: "LANDMARK_RISE", emblem: "🏰", color: "GOLD", title: "요새 건립", subText: `${who(ev.landmark.faction)} ${REGION_INFO[ev.landmark.region].name} 요새 — 전투로 무너지지 않습니다` };
  }
  if (ev.combat) {
    return { id, type: "COMBAT", emblem: "⚔️", color: "RED", title: "격돌!", subText: `${REGION_INFO[ev.combat.region].name} — 양측 유닛 ${ev.combat.losses}개씩 전사` };
  }
  if (ev.chapter) {
    return {
      id,
      type: "CHAPTER",
      emblem: ev.chapter === 2 ? "🐉" : "🌋",
      color: ev.chapter === 2 ? "BLUE" : "RED",
      title: `${ev.chapter}챕터`,
      subText: ev.chapter === 2 ? "전란의 격돌 — 나즈굴의 추격이 시작된다" : "운명의 산 결전 — 대군세가 몰려온다",
    };
  }
  const ring = ev.ring[ev.ring.length - 1];
  if (ring) {
    const fellowship = ring.faction === "FELLOWSHIP";
    return {
      id,
      type: "RING_PULSE",
      emblem: fellowship ? "💍" : "🐉",
      color: fellowship ? "BLUE" : "RED",
      title: fellowship ? "원정 전진" : "나즈굴 추격",
      subText: `${fellowship ? "프로도 & 샘" : "나즈굴"} ${ring.to - ring.from}칸 전진 ${fellowship ? "— 운명의 산으로" : "— 반지의 사자를 쫓는다"}`,
    };
  }
  return null;
}

/**
 * Sound effects on/off, BGM on/off + volume, reading the shared audio settings store (same control
 * as mafia's — turning it on also lifts the site-wide default mute so it
 * actually plays; turning it off leaves the master switch alone).
 */
function BgmControl() {
  const masterMuted = useAudioSettingsStore((s) => s.masterMuted);
  const bgmMuted = useAudioSettingsStore((s) => s.bgmMuted);
  const bgmVolume = useAudioSettingsStore((s) => s.bgmVolume);
  const setMasterMuted = useAudioSettingsStore((s) => s.setMasterMuted);
  const setBgmMuted = useAudioSettingsStore((s) => s.setBgmMuted);
  const setBgmVolume = useAudioSettingsStore((s) => s.setBgmVolume);
  const sfxMuted = useAudioSettingsStore((s) => s.sfxMuted);
  const setSfxMuted = useAudioSettingsStore((s) => s.setSfxMuted);
  const on = !masterMuted && !bgmMuted;
  const sfxOn = !masterMuted && !sfxMuted;
  return (
    <span className="flex items-center gap-1">
      <button
        onClick={() => {
          getLotrAudio().unlock();
          if (sfxOn) setSfxMuted(true);
          else {
            if (masterMuted) setMasterMuted(false);
            setSfxMuted(false);
          }
        }}
        title={sfxOn ? "효과음 끄기" : "효과음 켜기"}
        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${sfxOn ? "border-amber-300/50 bg-amber-400/15 text-amber-200 light:text-amber-800" : "border-white/15 text-white/50 hover:border-white/30 light:border-slate-300 light:text-slate-500"}`}
      >
        {sfxOn ? "🔔 효과음" : "🔕 효과음"}
      </button>
      <button
        onClick={() => {
          getLotrAudio().unlock();
          if (on) setBgmMuted(true);
          else {
            if (masterMuted) setMasterMuted(false);
            setBgmMuted(false);
          }
        }}
        title={on ? "배경음악 끄기" : "배경음악 켜기"}
        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${on ? "border-amber-300/50 bg-amber-400/15 text-amber-200 light:text-amber-800" : "border-white/15 text-white/50 hover:border-white/30 light:border-slate-300 light:text-slate-500"}`}
      >
        {on ? "🔊 BGM" : "🔇 BGM"}
      </button>
      {on && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={bgmVolume}
          onChange={(e) => setBgmVolume(Number(e.target.value))}
          aria-label="배경음악 볼륨"
          className="hidden w-16 accent-amber-400 sm:block"
        />
      )}
    </span>
  );
}

/**
 * Art-deco landmark tile — fortress illustration, target region, bonus text,
 * and a cost badge that spells out the "+1 per own fortress" surcharge.
 */
function LandmarkTileCard({
  tile,
  cost,
  surcharge,
  canAfford,
  canBuild,
  onBuild,
}: {
  tile: LandmarkTile;
  cost: number;
  surcharge: number;
  canAfford: boolean;
  canBuild: boolean;
  onBuild: () => void;
}) {
  const ready = canBuild && canAfford;
  return (
    <div
      className={`rounded-2xl p-[2px] transition ${ready ? "lotrd-rim bg-gradient-to-r from-[#f7dc8c] via-[#a8741f] to-[#f2c14e]" : "bg-gradient-to-r from-[#5a4520] via-[#2e2410] to-[#5a4520]"}`}
    >
      <div className="relative flex items-stretch gap-2 overflow-hidden rounded-[14px] bg-gradient-to-r from-[#0d0b10] via-[#17131f] to-[#0d0b10] p-2">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-amber-300/40">
          <FortressArt />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0">
              <h4 className="truncate font-serif text-sm font-black tracking-wide text-amber-200">{tile.name}</h4>
              <p className="text-[10px] text-amber-400/80">📍 {REGION_INFO[tile.targetRegion].name}에 요새</p>
            </div>
            <span className="flex shrink-0 items-center gap-0.5 rounded-xl bg-black/60 px-1.5 py-0.5 text-[11px] font-black ring-1 ring-amber-500/30">
              <span className={canAfford ? "text-amber-200" : "text-rose-300"}>🪙{cost}</span>
              {surcharge > 0 && <span className="text-[9px] text-white/50">(요새+{surcharge})</span>}
            </span>
          </div>
          <p className="mt-1 rounded-lg bg-black/40 p-1 text-[10px] leading-tight text-white/75 ring-1 ring-white/5">{tile.description}</p>
          <p className="mt-0.5 text-[10px] text-white/45">
            인쇄 비용 🪙{tile.baseCost.coins}
            {tile.baseCost.tech?.map((s) => TECH_INFO[s].emoji).join("")}
          </p>
        </div>
        {canBuild && (
          <button
            disabled={!canAfford}
            onClick={onBuild}
            className="self-center rounded-lg bg-gradient-to-b from-amber-300 to-amber-600 px-2.5 py-1.5 text-xs font-black text-black shadow hover:brightness-110 disabled:from-white/10 disabled:to-white/10 disabled:text-white/35"
          >
            건설
          </button>
        )}
      </div>
    </div>
  );
}
