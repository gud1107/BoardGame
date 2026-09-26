"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useAudioSettingsStore } from "@/lib/audio/audioSettings";
import { FortressArt, SealStamp } from "./CardArt";
import { CardFace, COLOR_STYLE } from "./CardFace";
import { ADJACENCY, CARD_BY_ID, CHAIN_INFO, COLOR_INFO, FACTION_EMOJI, FACTION_LABEL, RACES, RACE_INFO, REGIONS, REGION_INFO, TECHS, TECH_INFO } from "./data";
import {
  availableSlots,
  calculateCardCost,
  calculateLandmarkCost,
  controlledCount,
  discardValue,
  fortressOf,
  hasToken,
  missingTech,
  techCoverage,
  otherFaction,
  raceSymbols,
  techProduction,
  unitsOf,
  type EngineAction,
  type Faction,
  type LandmarkTile,
  type LotrDuelCard,
  type LotrDuelState,
  type PendingStep,
  type PyramidSlot,
  type RegionId,
  type Seat,
} from "./engine";
import { ActionCinematicFX, EndingFX, FX_KEYFRAMES, type ActionFX } from "./ActionCinematicFX";
import { AURA, OpponentFocusAura, TURN_KEYFRAMES, TurnRimLight } from "./TurnAmbientFX";
import { diffFx, type CardPreview, type FxEvents } from "./fxEvents";
import { bump, centerOf, flyTo, imprint, inView, miniCard, visible } from "./motionFx";
import { getLotrAudio } from "./lotrAudioEngine";
import { CardChoiceModal, LandmarkConfirmModal, PendingChoiceModal } from "./ActionChoiceModal";
import AllianceTokenSelectModal from "./AllianceTokenSelectModal";
import HistoryLogDrawer from "./HistoryLogDrawer";
import MiddleEarthMap from "./MiddleEarthMap";
import RingTrackBoard, { raceDanger } from "./RingTrackBoard";
import type { PassiveTrigger } from "./PlayerPassivesHUD";
import PlayerTechHUD from "./PlayerTechHUD";
import VictoryCinematicModal from "./VictoryCinematicModal";
import AllianceCompendiumModal from "./AllianceCompendiumModal";

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
@keyframes lotrd-replay { 0%,100% { box-shadow: 0 0 10px rgba(251,191,36,.45) } 50% { box-shadow: 0 0 24px rgba(251,191,36,.95) } }
.lotrd-replay { animation: lotrd-replay 1.6s ease-in-out infinite }
@keyframes lotrd-anchor { 0%,100% { transform: translate(-50%, 0) } 50% { transform: translate(-50%, -4px) } }
.lotrd-anchor { animation: lotrd-anchor 1.4s ease-in-out infinite }
@keyframes lotrp-passive { 0%,100% { box-shadow: 0 0 6px var(--wax, rgba(251,191,36,.6)) } 50% { box-shadow: 0 0 18px 3px var(--wax, rgba(251,191,36,1)) } }
.lotrp-passive { animation: lotrp-passive .8s ease-in-out infinite }
@keyframes lotrp-gold { 0%,100% { box-shadow: 0 0 10px rgba(251,191,36,.45), inset 0 0 6px rgba(251,191,36,.2) } 50% { box-shadow: 0 0 26px rgba(251,191,36,.95), inset 0 0 14px rgba(251,191,36,.5) } }
.lotrp-gold { animation: lotrp-gold 1s ease-in-out infinite; background: rgba(251,191,36,.12) }
@keyframes lotrp-tech { 0%,100% { box-shadow: 0 0 8px rgba(251,191,36,.5); border-color: rgba(251,191,36,.6) } 50% { box-shadow: 0 0 22px rgba(251,191,36,1); border-color: rgba(253,230,138,1) } }
.lotrp-tech { animation: lotrp-tech 1s ease-in-out infinite; border-style: solid !important }
@keyframes lotrp-ember { 0%,100% { box-shadow: 0 0 6px rgba(249,115,22,.5) } 50% { box-shadow: 0 0 20px rgba(249,115,22,1) } }
.lotrp-ember { animation: lotrp-ember 1s ease-in-out infinite }
@keyframes lotrp-red { 0%,100% { box-shadow: 0 0 0 2px rgba(244,63,94,.55), 0 0 10px rgba(244,63,94,.4) } 50% { box-shadow: 0 0 0 3px rgba(251,113,133,1), 0 0 26px rgba(244,63,94,.9) } }
.lotrp-red { animation: lotrp-red .9s ease-in-out infinite }
@keyframes lotrp-violet { 0%,100% { box-shadow: 0 0 0 2px rgba(168,85,247,.55), 0 0 10px rgba(168,85,247,.4) } 50% { box-shadow: 0 0 0 3px rgba(216,180,254,1), 0 0 26px rgba(168,85,247,.9) } }
.lotrp-violet { animation: lotrp-violet .9s ease-in-out infinite }
@keyframes lotrp-cyan { 0%,100% { background: rgba(34,211,238,.18); box-shadow: 0 0 4px rgba(34,211,238,.5) } 50% { background: rgba(34,211,238,.4); box-shadow: 0 0 12px rgba(34,211,238,1) } }
.lotrp-cyan { animation: lotrp-cyan .9s ease-in-out infinite }
@keyframes lotrp-float { 0%,100% { transform: translate(-50%, 0) } 50% { transform: translate(-50%, -3px) } }
.lotrp-float { animation: lotrp-float 1s ease-in-out infinite; text-shadow: 0 0 6px rgba(251,191,36,.9) }
@keyframes lotrm-hop { 0% { transform: translateY(0) scale(.8) } 40% { transform: translateY(-9px) scale(1.15) } 100% { transform: translateY(0) scale(1) } }
.lotrm-hop { display: inline-block; animation: lotrm-hop .2s ease-out both }
@keyframes lotrm-reward { 0% { transform: translate(-50%, 0) scale(.6); opacity: 0 } 20% { opacity: 1; transform: translate(-50%, -6px) scale(1.15) } 100% { transform: translate(-50%, -26px) scale(1); opacity: 0 } }
.lotrm-reward { animation: lotrm-reward 1.1s ease-out both; text-shadow: 0 0 6px rgba(0,0,0,.9) }
@keyframes lotrm-drop { 0% { transform: translateY(-60px) scale(1.3); opacity: 0 } 55% { transform: translateY(4px) scale(.95); opacity: 1 } 70% { transform: translateY(-3px) } 85%,100% { transform: none; opacity: 1 } }
.lotrm-drop { animation: lotrm-drop .55s cubic-bezier(.3,.1,.4,1.4) both, lotrm-fadeout .4s ease-in 1.6s forwards }
@keyframes lotrm-fadeout { to { opacity: 0 } }
@keyframes lotrm-dust { 0%,45% { transform: scaleX(.2); opacity: 0 } 60% { opacity: .9 } 100% { transform: scaleX(2.2); opacity: 0 } }
.lotrm-dust { animation: lotrm-dust .9s ease-out both }
@keyframes lotrm-dissolve { 0% { transform: scale(1); opacity: 1; filter: none } 40% { transform: scale(1.3); filter: brightness(2) drop-shadow(0 0 8px #f97316) } 100% { transform: scale(.4) translateY(-12px); opacity: 0; filter: blur(3px) brightness(3) sepia(1) } }
.lotrm-dissolve { display: inline-block; animation: lotrm-dissolve .9s ease-in .25s both }
@media (prefers-reduced-motion: reduce) { .lotrm-hop, .lotrm-reward, .lotrm-drop, .lotrm-dust, .lotrm-dissolve { animation-duration: .01ms !important; animation-delay: 0s !important } }
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
  /** The opponent's live card focus (hovered / opened pyramid slot), from the room's `card-focus` broadcast. */
  opponentFocus?: CardFocus | null;
  /** Reports my own focused pyramid slot (null = none) so the opponent can see it. */
  onFocus?: (slot: number | null, turn: number) => void;
}

export type CardFocus = { seat: Seat; slot: number | null; turn: number };

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

export default function LotrDuelBoard({ state, viewerSeat, names, opponentConnected, onAction, onLeave, onRematch, onOpenRulebook, opponentFocus, onFocus }: Props) {
  const myFaction = state.factionOf[viewerSeat];
  const oppFaction = otherFaction(myFaction);
  const oppSeat: Seat = viewerSeat === "p1" ? "p2" : "p1";
  const nameOf = (f: Faction) => (f === myFaction ? names[viewerSeat] : names[oppSeat]);
  const me = state.players[myFaction];

  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [moveFrom, setMoveFrom] = useState<RegionId | null>(null);
  const [victoryClosed, setVictoryClosed] = useState(false);
  const [showCompendium, setShowCompendium] = useState(false);
  const [choiceHidden, setChoiceHidden] = useState(false);
  // Minimised (not cancelled) card / landmark choices — reopened from the floating anchor.
  const [cardHidden, setCardHidden] = useState(false);
  const [landmarkHidden, setLandmarkHidden] = useState(false);
  const [confirmLandmark, setConfirmLandmark] = useState<LandmarkTile["id"] | null>(null);
  // Clear local selections whenever the game moves on (derived during render, no effect).
  const [seenTurn, setSeenTurn] = useState(`${state.turnNumber}:${state.pending.length}:${state.seed}`);
  const turnKey = `${state.turnNumber}:${state.pending.length}:${state.seed}`;
  if (seenTurn !== turnKey) {
    setSeenTurn(turnKey);
    setSelectedSlot(null);
    setMoveFrom(null);
    setChoiceHidden(false);
    setCardHidden(false);
    setLandmarkHidden(false);
    setConfirmLandmark(null);
    if (state.phase === "PLAYING") setVictoryClosed(false);
  }

  const myTurn = state.phase === "PLAYING" && state.turn === myFaction;
  const front = state.pending[0];
  const act = (a: EngineAction) => {
    getLotrAudio().play("SELECT");
    onAction(a);
  };

  // ---- live card focus: mine goes out (mouse hover / opened card), the opponent's comes in ----
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const myFocus = myTurn && !front ? (selectedSlot ?? hoveredSlot) : null;
  const sentFocus = useRef<number | null>(null);
  const turnNumber = state.turnNumber;
  useEffect(() => {
    if (sentFocus.current === myFocus) return;
    sentFocus.current = myFocus;
    onFocus?.(myFocus, turnNumber);
  }, [myFocus, turnNumber, onFocus]);
  const oppFocusSlot =
    state.phase === "PLAYING" && !myTurn && opponentFocus && opponentFocus.seat === oppSeat && opponentFocus.turn === state.turnNumber ? opponentFocus.slot : null;

  // ---- cinematic FX, derived during render from the previous replayed state ----
  const [fxPrev, setFxPrev] = useState(state);
  const [fx, setFx] = useState<ActionFX | null>(null);
  const [ghost, setGhost] = useState<{ key: number; slot: PyramidSlot; mode: "PLAY" | "DISCARD" } | null>(null);
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const [trail, setTrail] = useState<{ key: number; faction: Faction; from: number; to: number } | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [rise, setRise] = useState<{ key: number; region: RegionId } | null>(null);
  const [drops, setDrops] = useState<{ key: number; items: FxEvents["drops"] } | null>(null);
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
      if (ev.drops.length > 0) setDrops({ key: (drops?.key ?? 0) + 1, items: ev.drops });
      const banner = bannerFor(ev, myFaction, n);
      if (banner) setFx(banner);
    } else if (fxPrev.seed !== state.seed) {
      // Rematch — drop leftovers from the previous game.
      setFx(null);
      setGhost(null);
      setTrail(null);
      setRise(null);
      setDrops(null);
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
    // Motion: coins / cards fly to whoever gained them — mine into my bottom HUD / dock, the
    // opponent's up into their profile chip in the header — plus tech runes / race seals for me.
    const actorCard =
      state.lastAction && state.lastAction.no !== p.lastAction?.no && state.lastAction.cardId ? { faction: state.lastAction.faction, card: CARD_BY_ID[state.lastAction.cardId] } : null;
    const lastCard = actorCard && actorCard.faction === myFaction ? actorCard.card : null;
    const ghostPt = ev.taken ? centerOf(visible("[data-lotr-ghost]")) : null;
    const srcPt = ghostPt ?? (ev.ring.length ? centerOf(visible("[data-lotr-track]")) : null) ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const dockOf = (f: Faction, part: "coins" | "cards"): Element | null =>
      f === myFaction
        ? part === "coins"
          ? visible("[data-lotr-coins]")
          : (inView(`[data-lotr-dock="${f}"]`) ?? visible("[data-lotr-hud]"))
        : (inView(part === "coins" ? "[data-lotr-opp-coins]" : "[data-lotr-opp-dock]") ?? inView(`[data-lotr-dock="${f}"]`) ?? visible("[data-lotr-opp-dock]"));
    for (const f of [myFaction, oppFaction]) {
      const gain = state.players[f].coins - p.players[f].coins;
      const coinEl = gain > 0 ? dockOf(f, "coins") : null;
      if (!coinEl) continue;
      const mine = f === myFaction;
      for (let i = 0; i < Math.min(gain, 6); i++)
        flyTo("🪙", srcPt, coinEl, {
          delay: 120 + i * 120,
          glow: mine ? undefined : `rgba(${AURA[f].rgb},.95)`,
          onLand: () => {
            bump(coinEl, mine ? undefined : `rgba(${AURA[f].rgb},.9)`);
            if (mine || i === 0) audio.play("COIN");
          },
        });
    }
    if (actorCard && ev.taken?.mode === "PLAY" && ghostPt) {
      const target = dockOf(actorCard.faction, "cards");
      const glow = `rgba(${AURA[actorCard.faction].rgb},.95)`;
      if (target) flyTo(miniCard(actorCard.card.color, actorCard.card.name), ghostPt, target, { delay: 60, duration: 820, size: 40, glow, onLand: () => bump(target, glow) });
    }
    if (lastCard && ev.taken?.mode === "PLAY" && ghostPt) {
      if (lastCard.color === "GRAY")
        for (const t of lastCard.providesTech ?? lastCard.selectTechChoice ?? []) {
          const slot = visible(`[data-lotr-tech="${t}"]`);
          if (slot) flyTo(TECH_INFO[t].emoji, ghostPt, slot, { delay: 150, duration: 750, size: 30, onLand: () => imprint(slot) });
        }
      if (lastCard.color === "GREEN" && lastCard.race) {
        const seal = visible(`[data-lotr-race="${lastCard.race}"]`);
        if (seal) flyTo(RACE_INFO[lastCard.race].emoji, ghostPt, seal, { delay: 150, duration: 750, size: 30, glow: "rgba(52,211,153,.95)", onLand: () => bump(seal, "rgba(249,115,22,.9)") });
      }
    }
    if (ev.chapter) audio.play("CHAPTER");
    else if (state.phase === "PLAYING" && state.turn === myFaction && p.turn !== myFaction) window.setTimeout(() => audio.play("MY_TURN"), 450);
  }, [state, myFaction, oppFaction]);

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

  // ---- ring markers hop one space every 0.2s instead of teleporting ----
  const [shown, setShown] = useState({ seed: state.seed, fr: state.ringTrack.frodoPosition, nz: state.ringTrack.nazgulPosition });
  if (shown.seed !== state.seed) setShown({ seed: state.seed, fr: state.ringTrack.frodoPosition, nz: state.ringTrack.nazgulPosition });
  useEffect(() => {
    const { frodoPosition, nazgulPosition } = state.ringTrack;
    if (shown.fr === frodoPosition && shown.nz === nazgulPosition) return;
    const t = window.setTimeout(
      () =>
        setShown((cur) => ({
          ...cur,
          fr: cur.fr < frodoPosition ? cur.fr + 1 : frodoPosition,
          nz: cur.nz < nazgulPosition ? cur.nz + 1 : nazgulPosition,
        })),
      200,
    );
    return () => window.clearTimeout(t);
  }, [shown, state.ringTrack]);

  // ---- predictive highlight while a pyramid card's modal is open ----
  const [previewMode, setPreviewMode] = useState<"PLAY" | "DISCARD">("PLAY");

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
  const preview = selected && myTurn && !front ? previewFor(state, myFaction, selected.card, previewMode) : null;
  // Which of my permanent alliance powers the current choice would set off (glows in the HUD tray).
  const passiveTrigger: PassiveTrigger | null =
    selected && myTurn && !front
      ? (() => {
          const cost = calculateCardCost(me, selected.card);
          const withoutWild = { ...me, allianceTokens: me.allianceTokens.filter((t) => t.id !== "DWARF_WILD_TECH") };
          return { cardColor: selected.card.color, mode: previewMode, viaChain: cost.viaChain, needsTech: !cost.viaChain && missingTech(withoutWild, selected.card.cost.tech) > 0 };
        })()
      : confirmLandmark && myTurn && !front
        ? { landmark: true }
        : null;

  return (
    <div className="flex items-start gap-3 text-white light:text-slate-900">
      <HistoryLogDrawer log={state.log} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
      <style>{KEYFRAMES + FX_KEYFRAMES + TURN_KEYFRAMES}</style>
      <ActionCinematicFX fx={fx} onDismiss={dismissFx} />
      {/* whose turn: breathing rim of light around the viewport in the active faction's colour */}
      {state.phase === "PLAYING" && <TurnRimLight faction={state.turn} mine={myTurn} />}
      {/* race danger: a marker 1–2 spaces from the finish — red vignette around the whole board */}
      {state.phase === "PLAYING" && raceDanger(state.ringTrack.frodoPosition, state.ringTrack.nazgulPosition, state.ringTrack.trackLength) && (
        <div className="lotrt-vignette pointer-events-none fixed inset-0 z-[35]" style={{ boxShadow: "inset 0 0 90px 18px rgba(225,29,72,.55)" }} aria-hidden />
      )}
      {state.phase === "GAME_OVER" && state.winner && !victoryClosed && <EndingFX winner={state.winner} />}

      {/* ---- header HUD ---- */}
      <div
        className={`${panel} flex flex-wrap items-center gap-x-4 gap-y-2 bg-gradient-to-r from-amber-900/20 to-transparent transition-colors duration-500 ${state.phase === "PLAYING" ? "lotrturn-breathe" : ""}`}
        style={state.phase === "PLAYING" ? ({ "--aura": AURA[state.turn].rgb, borderColor: `rgba(${AURA[state.turn].rgb},${myTurn ? 0.75 : 0.45})` } as CSSProperties) : undefined}
      >
        <span className="rounded-lg bg-amber-500/20 px-2 py-1 text-sm font-bold text-amber-200 light:text-amber-800">📖 {state.chapter}챕터</span>
        <span className="text-sm">
          {state.phase === "GAME_OVER" ? (
            <b>게임 종료</b>
          ) : myTurn ? (
            <span className="flex items-center gap-2">
              <span
                className="lotrturn-float inline-block rounded-full px-2.5 py-0.5 font-mono text-[11px] font-black text-neutral-950"
                style={{ background: `linear-gradient(90deg, ${AURA[myFaction].hex}, rgb(${AURA[myFaction].alt}))`, boxShadow: `0 0 14px rgba(${AURA[myFaction].rgb},.9)` }}
              >
                ★ 내 차례 (YOUR TURN)
              </span>
              <b className="text-emerald-300 light:text-emerald-700">
                {FACTION_EMOJI[myFaction]} {FACTION_LABEL[myFaction]}
              </b>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span className="animate-pulse rounded-full px-2.5 py-0.5 font-mono text-[11px] font-black text-white" style={{ background: AURA[state.turn].hex }}>
                ● 상대 턴 진행 중
              </span>
              <span className="text-white/60 light:text-slate-500">
                {nameOf(state.turn)}({FACTION_EMOJI[state.turn]} {FACTION_LABEL[state.turn]})이(가) 고심하고 있습니다…
              </span>
            </span>
          )}
        </span>
        <span
          data-lotr-opp-dock
          title="상대 진영 — 상대가 얻은 주화·카드는 여기로 날아옵니다"
          className={`flex items-center gap-1.5 rounded-xl border px-2 py-0.5 text-xs font-bold transition ${!myTurn && state.phase === "PLAYING" ? "lotrturn-breathe" : "border-white/10"}`}
          style={!myTurn && state.phase === "PLAYING" ? ({ "--aura": AURA[oppFaction].rgb, borderColor: AURA[oppFaction].hex, background: `rgba(${AURA[oppFaction].rgb},.12)` } as CSSProperties) : undefined}
        >
          <span>{FACTION_EMOJI[oppFaction]}</span>
          <span className="max-w-[7rem] truncate text-white/80 light:text-slate-700">상대 · {nameOf(oppFaction)}</span>
          <span data-lotr-opp-coins className="font-mono text-amber-300 light:text-amber-700">🪙 {state.players[oppFaction].coins}</span>
          <span className="font-mono text-white/60 light:text-slate-500">🃏 {state.players[oppFaction].tableauCards.length}</span>
        </span>
        <span className="text-xs text-white/60 light:text-slate-600">
          지역 지배 💍 {controlledCount(state, "FELLOWSHIP")}/7 · 👁️ {controlledCount(state, "SAURON")}/7
        </span>
        <span className="text-xs text-white/60 light:text-slate-600">
          원정 🧝 {fr}/{L} · 🐉 {nz}/{L} ({fr > nz ? `원정대 ${fr - nz}칸 앞` : nz > fr ? `나즈굴 ${nz - fr}칸 앞` : "같은 칸"})
        </span>
        <span className="ml-auto flex items-center gap-2">
          {state.phase === "GAME_OVER" && state.winner && victoryClosed && (
            <button
              type="button"
              onClick={() => setVictoryClosed(false)}
              className="lotrd-replay flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 px-3 py-1.5 text-xs font-black text-neutral-950 shadow-[0_0_15px_rgba(251,191,36,.6)] hover:scale-105"
            >
              🏆 승패 결과판 다시보기
            </button>
          )}
          <BgmControl />
          {!opponentConnected && <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[11px] text-rose-200">상대 연결 끊김</span>}
          <button
            type="button"
            onClick={() => setShowCompendium(true)}
            title="6종족 18개 동맹 능력 전체 도감"
            className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-200 hover:border-amber-400 light:border-amber-400 light:bg-amber-50 light:text-amber-800"
          >
            📜 종족 도감 (18)
          </button>
          <button onClick={onOpenRulebook} className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </span>
      </div>
      {showCompendium && <AllianceCompendiumModal state={state} myFaction={myFaction} onClose={() => setShowCompendium(false)} />}

      {/* ---- action prompt ---- */}
      <ActionPrompt
        state={state}
        myFaction={myFaction}
        myTurn={myTurn}
        front={front}
        moveFrom={moveFrom}
        opponentName={nameOf(oppFaction)}
        act={act}
        onOpenAlliance={() => setChoiceHidden(false)}
      />
      {myTurn && front && (front.kind === "TOKEN" || front.kind === "TOKEN_RACE") && !choiceHidden && (
        <AllianceTokenSelectModal
          key={`${state.turnNumber}:${state.pending.length}:${front.kind}`}
          state={state}
          step={front}
          onPickRace={(race) => act({ type: "PICK_RACE", faction: myFaction, race })}
          onPickToken={(tokenId) => act({ type: "PICK_TOKEN", faction: myFaction, tokenId })}
          onMinimize={() => setChoiceHidden(true)}
        />
      )}
      {myTurn && front && front.kind !== "TOKEN" && front.kind !== "TOKEN_RACE" && !choiceHidden && (
        <PendingChoiceModal
          key={`${state.turnNumber}:${state.pending.length}:${front.kind}`}
          state={state}
          faction={myFaction}
          step={front}
          act={act}
          onMinimize={() => setChoiceHidden(true)}
        />
      )}
      {myTurn && !front && confirmLandmark && !landmarkHidden && state.revealedLandmarks.some((t) => t.id === confirmLandmark) && (
        <LandmarkConfirmModal
          state={state}
          faction={myFaction}
          tile={state.revealedLandmarks.find((t) => t.id === confirmLandmark)!}
          onBuild={() => act({ type: "TAKE_LANDMARK", faction: myFaction, landmarkId: confirmLandmark })}
          onClose={() => setConfirmLandmark(null)}
          onMinimize={() => setLandmarkHidden(true)}
        />
      )}
      <ReopenAnchor
        anchor={
          myTurn && front && choiceHidden
            ? { icon: front.kind === "TOKEN" || front.kind === "TOKEN_RACE" ? "📜" : "⚡", label: `선택 대기 중: ${PENDING_LABEL[front.kind]} 다시 열기`, tone: front.kind === "TOKEN" || front.kind === "TOKEN_RACE" ? "emerald" : "amber", onClick: () => setChoiceHidden(false) }
            : myTurn && !front && selected && cardHidden
              ? { icon: "📥", label: `선택한 「${selected.card.name}」 처리창 다시 열기`, tone: "amber", onClick: () => setCardHidden(false) }
              : myTurn && !front && confirmLandmark && landmarkHidden
                ? { icon: "🏰", label: `「${state.revealedLandmarks.find((t) => t.id === confirmLandmark)?.name ?? "랜드마크"}」 건설창 다시 열기`, tone: "amber", onClick: () => setLandmarkHidden(false) }
                : null
        }
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.9fr)]">
        {/* ---- map ---- */}
        <div className="order-2 flex flex-col gap-2 lg:order-1">
          <div key={shakeKey} className={shakeKey > 0 ? "lotrfx-shake" : undefined}>
            <MiddleEarthMap
              state={state}
              targets={targets}
              selectedFrom={moveFrom}
              onRegion={onRegion}
              rise={rise}
              drops={drops}
              preview={preview?.regions ? { regions: preview.regions, tone: preview.regionTone ?? "red" } : null}
            />
          </div>
          <p className="text-[11px] text-white/40 light:text-slate-500">
            <b className="text-amber-300">💍 원정대 xN</b> · <b className="text-red-300">👁️ 사우론 xN</b> 유닛 · 🏰 원정대 / 🌋 사우론 요새 (전투로 파괴되지 않음). 같은 지역에 양측 유닛이 모이면 1:1로 동시에 사라집니다.
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
                <div
                  key={slot.card.id}
                  className="absolute"
                  style={{ ...slotBox(slot), zIndex: selectedSlot === i || oppFocusSlot === i ? 30 : slot.row + 1 }}
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse" && available && slot.isOpen) setHoveredSlot(i);
                  }}
                  onPointerLeave={() => setHoveredSlot((h) => (h === i ? null : h))}
                >
                  {oppFocusSlot === i && <OpponentFocusAura faction={oppFaction} />}
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
                    coverage={techCoverage(me, slot.card.cost.tech)}
                    viaChain={cost.viaChain}
                    locked={slot.isOpen && !available}
                    selected={selectedSlot === i}
                    onClick={() => {
                      setPreviewMode("PLAY");
                      setCardHidden(false);
                      setSelectedSlot(selectedSlot === i && !cardHidden ? null : i);
                    }}
                  />
                  </div>
                </div>
              );
            })}
            {/* Taken card rises out of the pyramid in a rune light pillar (ends fully transparent, so it can stay mounted). */}
            {ghost && (
              <div key={ghost.key} data-lotr-ghost className="pointer-events-none absolute" style={{ ...slotBox(ghost.slot), zIndex: 40 }}>
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
          {selected && myTurn && !front && !cardHidden && (
            <CardChoiceModal
              key={selected.card.id}
              state={state}
              faction={myFaction}
              card={selected.card}
              onPlay={() => act({ type: "TAKE_CARD", faction: myFaction, slot: selectedSlot!, mode: "PLAY" })}
              onDiscard={() => act({ type: "TAKE_CARD", faction: myFaction, slot: selectedSlot!, mode: "DISCARD" })}
              onClose={() => setSelectedSlot(null)}
              onMinimize={() => setCardHidden(true)}
              onPreview={setPreviewMode}
            />
          )}
        </div>

        {/* ---- ring track + landmarks + log ---- */}
        <div className="order-3 flex flex-col gap-3">
          <div data-lotr-track>
            {preview?.ring && (
              <p className="mb-1 rounded-lg bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold text-cyan-200">
                💍 {preview.ring.to - preview.ring.from}칸 전진 예정 → {preview.ring.to}번 칸
              </p>
            )}
            <RingTrackBoard fr={fr} nz={nz} L={L} shownFr={shown.fr} shownNz={shown.nz} trail={trail} preview={preview?.ring ?? null} />
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
                    onBuild={() => {
                      setLandmarkHidden(false);
                      setConfirmLandmark(tile.id);
                    }}
                  />
                );
              })}
            </div>
          </div>

        </div>
      </div>

      {/* ---- bottom dock ---- */}
      <div className="grid gap-3 md:grid-cols-2">
        <PlayerDock state={state} faction={myFaction} label={`나 · ${names[viewerSeat]}`} highlight />
        <PlayerDock state={state} faction={oppFaction} label={`상대 · ${names[oppSeat]}`} />
      </div>

      {state.phase === "PLAYING" && <PlayerTechHUD state={state} faction={myFaction} preview={preview} trigger={passiveTrigger} active={myTurn} />}
      </div>

      {state.phase === "GAME_OVER" && state.winner && !victoryClosed && (
        <VictoryCinematicModal state={state} myFaction={myFaction} onRematch={onRematch} onLeave={onLeave} onClose={() => setVictoryClosed(true)} />
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
  onOpenAlliance,
}: {
  state: LotrDuelState;
  myFaction: Faction;
  myTurn: boolean;
  front: PendingStep | undefined;
  moveFrom: RegionId | null;
  opponentName: string;
  act: (a: EngineAction) => void;
  onOpenAlliance: () => void;
}) {
  if (state.phase !== "PLAYING") return null;
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
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={`${btn} border-amber-400/60 bg-amber-500/20`} onClick={onOpenAlliance}>
          🎯 선택 창 열기
        </button>
        {front.kind === "MOVE" && (
          <>
            <span className="text-xs text-white/60 light:text-slate-500">또는 지도에서 출발 → 도착 지역을 누르세요.</span>
            <button className={btn} onClick={() => act({ type: "SKIP", faction: myFaction })}>
              이동 종료
            </button>
          </>
        )}
        {(front.kind === "PLACE" || front.kind === "SNIPE" || front.kind === "DESTROY_FORTRESS") && (
          <span className="text-xs text-white/60 light:text-slate-500">또는 지도에서 빛나는 지역을 누르세요.</span>
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
    <div
      data-lotr-dock={faction}
      className={`${panel} ${highlight ? "border-amber-400/30" : ""} ${state.turn === faction && state.phase === "PLAYING" ? "lotrturn-breathe" : ""}`}
      style={state.turn === faction && state.phase === "PLAYING" ? ({ "--aura": AURA[faction].rgb, borderColor: `rgba(${AURA[faction].rgb},.6)` } as CSSProperties) : undefined}
    >
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
      title: fellowship ? "원정 전진" : "나즈굴 질주",
      subText: `${fellowship ? "프로도 & 샘" : "나즈굴"} ${ring.to - ring.from}칸 전진 ${fellowship ? "— 운명의 산으로" : "— 종착점으로 질주한다"}`,
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

/** What `card` would change if taken in `mode` — drives the predictive highlight. */
function previewFor(state: LotrDuelState, faction: Faction, card: LotrDuelCard, mode: "PLAY" | "DISCARD"): CardPreview | null {
  if (mode === "DISCARD") return { coins: discardValue(state, faction) };
  const me = state.players[faction];
  const opp = otherFaction(faction);
  switch (card.color) {
    case "YELLOW":
      return { coins: card.coinsReward ?? 0 };
    case "BLUE": {
      const from = faction === "FELLOWSHIP" ? state.ringTrack.frodoPosition : state.ringTrack.nazgulPosition;
      return { ring: { faction, from, to: Math.min(state.ringTrack.trackLength, from + (card.ringAdvance ?? 0)) } };
    }
    case "RED":
      return { regions: hasToken(me, "ELF_RED_ANYWHERE") ? REGIONS : card.militaryUnits!.allowedRegions, regionTone: "red" };
    case "GRAY":
      return { techs: card.providesTech ?? card.selectTechChoice ?? [] };
    case "GREEN":
      return card.race ? { race: card.race } : null;
    case "PURPLE":
      if (card.tacticsType === "MULTI_MOVE") return { regions: REGIONS.filter((r) => unitsOf(state.boardRegions[r], faction) > 0), regionTone: "violet" };
      if (card.tacticsType === "SNIPE_UNIT") return { regions: REGIONS.filter((r) => unitsOf(state.boardRegions[r], opp) > 0), regionTone: "red" };
      return null;
  }
  return null;
}

const PENDING_LABEL: Record<PendingStep["kind"], string> = {
  TOKEN: "종족 동맹 능력 선택창",
  TOKEN_RACE: "종족 지원 더미 선택창",
  PLACE: "유닛 배치 선택창",
  MOVE: "유닛 이동 선택창",
  SNIPE: "적 유닛 제거 선택창",
  DESTROY_FORTRESS: "적 요새 파괴 선택창",
  DESTROY_GRAY: "회색 카드 파괴 선택창",
  DISCARD_PLAY: "버린 카드 선택창",
  ENT_CHOICE: "엔트 행진 선택창",
};

/**
 * Floating "reopen" anchor for a minimised modal — the choice itself is
 * never cancelled by minimising, so this pulsing button (bottom-center,
 * above the sticky HUD) brings the same modal back.
 */
function ReopenAnchor({ anchor }: { anchor: { icon: string; label: string; tone: "amber" | "emerald"; onClick: () => void } | null }) {
  if (!anchor) return null;
  return (
    <button
      type="button"
      onClick={anchor.onClick}
      className={`lotrd-anchor fixed bottom-28 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-2xl border-2 bg-neutral-950/95 px-4 py-2.5 text-xs font-bold shadow-2xl backdrop-blur-md sm:bottom-24 ${
        anchor.tone === "emerald"
          ? "border-emerald-400 text-emerald-200 shadow-[0_0_25px_rgba(52,211,153,.5)] hover:bg-emerald-950"
          : "border-amber-400 text-amber-200 shadow-[0_0_22px_rgba(251,191,36,.5)] hover:bg-amber-950"
      }`}
    >
      <span className="text-base">{anchor.icon}</span>
      <span className="truncate">{anchor.label}</span>
    </button>
  );
}
