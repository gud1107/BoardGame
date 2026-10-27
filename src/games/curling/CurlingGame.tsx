"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import GameLeaveGuardModal from "@/components/GameLeaveGuardModal";
import { useGameLeaveGuard } from "@/hooks/useGameLeaveGuard";
import { useBackgroundResync } from "@/hooks/useBackgroundResync";
import { useActiveRoomListing } from "@/games/shared/room/useActiveRoomListing";
import { trackGameEvent } from "@/lib/analytics/gameEvents";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
import {
  AIM_TIMEOUT_MS,
  applyAction,
  computeRankings,
  currentActor,
  currentSide,
  currentThrower,
  DEFAULT_OPTIONS,
  FFA_MAX,
  FFA_MIN,
  MAX_PLAYERS,
  MIN_PLAYERS,
  normalizeOptions,
  RUN_GRACE_MS,
  sanitizeParams,
  startGame,
  type CurlingState,
  type EngineAction,
  type GameOptions,
  type Seat,
} from "./engine";
import { botSweepEvery, botWantsSweep, planBotThrowAsync } from "./bot";
import { botPrediction, EMPTY_PREDICTIONS, predictionHit, sanitizeCall, sanitizePrediction, stoneStayedIn, type Prediction, type PredictionBoard } from "./spectate";
import type { CallMark } from "./SheetCanvas";
import CurlingBoard, { REACT_COOLDOWN_MS, REACTION_TTL_MS, type LiveInfo, type Reaction, type ReactionKind } from "./CurlingBoard";
import type { AimView } from "./SheetCanvas";
import { LiveThrowRunner, packStones, SweepCounter, unpackStones, type LiveEvent, type LiveView, type SweepSample } from "./live";
import { inHouse, PARTY_KINDS, runThrow, type PartyKind, type ThrowSim } from "./physics";
import { getCurlingSound, shout, SWEEP_SHOUTS } from "./curlingSound";
import { useBotAutoplay } from "@/games/shared/bot/useBotAutoplay";
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
import { AddBotButton, BotSeatBadge, FillEmptySeatsButton, RemoveBotButton } from "@/components/lobby/BotSeatControls";
import RulebookGate from "@/components/lobby/RulebookGate";
import { BotTakeoverSelfBanner, BotTakeoverVoteModal } from "@/components/lobby/BotTakeoverVoteModal";
import { DEFAULT_BOT_LEVEL, type BotLevel } from "@/games/shared/bot/botDifficulty";
import {
  activeVoteFor,
  INITIAL_BOT_TAKEOVER_STATE,
  isSeatTakenOver,
  reduceBotTakeover,
  voteThresholdMet,
  voteYesCount,
  type BotTakeoverEvent,
  type BotTakeoverState,
} from "@/games/shared/bot/botTakeover";
import { v4 as uuid } from "uuid";
import type { ChatMessage, SendResult } from "@/lib/chat/types";
import { checkThrottle, recordSend, INITIAL_THROTTLE_STATE, type ThrottleState } from "@/lib/chat/throttle";
import { filterProfanity } from "@/lib/chat/profanity";
import { stripControlChars } from "@/lib/chat/sanitize";
import { loadRecentMessages, mergeHistoryIntoMessages, persistMessage } from "@/lib/chat/history";
import { formatBotTakeoverLog } from "@/lib/chat/systemLog";
import ChatDrawer from "@/components/chat/ChatDrawer";
import { selfResult } from "@/games/shared/selfResult";
import { curlingStatDetails } from "./stats";
import { withUniqueNames } from "@/games/shared/room/uniqueNames";

/**
 * Online-room entry point for 컬링 파티 — the same lockstep room pattern as
 * wobbleTower/WobbleTowerGame.tsx (shared seed + replayed `EngineAction`s
 * over a Supabase Realtime channel, presence-derived seats, host-chosen lobby
 * bots, vote-based bot takeover, room chat). Curling-specific (rulebook §15):
 *
 * - The thrower's client (the bot-driving client for bots) is that throw's
 *   authority: it runs `LiveThrowRunner`, mixes everyone's sweep taps
 *   ("sweep", batched 4 Hz) and the bots' sweep decisions into each 0.1 s
 *   frame, broadcasts stone snapshots ("live", ~10 Hz), and finally sends the
 *   `throw` action with the recorded sweep arrays. Every client — the
 *   authority included — applies that action through the deterministic engine.
 * - "aim" (5 Hz) shows the thrower's broom/charge to everyone — cosmetic.
 * - Clients that missed a live throw (reconnect) replay it from the record.
 * - Turn timer (§10): 40 s to throw, +30 s once the stone is sliding; the
 *   bot-driving client sends `timeout`, ignored if the turn moved on.
 */

type Occupant = {
  deviceId: string;
  seat: Seat;
  name: string;
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
};
type Phase = "choose" | "enter-name" | "connecting" | "waiting" | "playing" | "post-game" | "room-full" | "supabase-missing" | "channel-error";

const GAME_ID = "curling";
const LIVE_SEND_MS = 100;
const SWEEP_FLUSH_MS = 250;
const AIM_SEND_MS = 200;

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredSeat(code: string): number | null {
  const v = window.localStorage.getItem(`${GAME_ID}-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`${GAME_ID}-seat-${code}`, String(seat));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

const isKind = (v: unknown): v is PartyKind => typeof v === "string" && (PARTY_KINDS as readonly string[]).includes(v);
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

function sanitizeEvents(raw: unknown): LiveEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: LiveEvent[] = [];
  for (const e of raw.slice(0, 24)) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const x = num(r.x, -10, 50) ?? 0;
    const y = num(r.y, -10, 50) ?? 0;
    if (r.kind === "hit") out.push({ kind: "hit", x, y, power: num(r.power, 0, 20) ?? 1 });
    else if (r.kind === "out") out.push({ kind: "out", x, y, id: num(r.id, 0, 1e6) ?? 0 });
    else if (r.kind === "bomb" || r.kind === "stick" || r.kind === "solid") out.push({ kind: r.kind, x, y });
    else if (r.kind === "tee") out.push({ kind: "tee" });
  }
  return out;
}

export default function CurlingGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(4);
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const optionsRef = useRef<GameOptions>(DEFAULT_OPTIONS);
  const [formError, setFormError] = useState<string | null>(null);
  const stonesTouchedRef = useRef(false);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<CurlingState | null>(null);
  const [finalResult, setFinalResult] = useState<{ winnerName: string } | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatCooldownUntil, setChatCooldownUntil] = useState<number | null>(null);
  const chatThrottleRef = useRef<ThrottleState>(INITIAL_THROTTLE_STATE);
  const [botSeats, setBotSeats] = useState<Seat[]>([]);
  const botSeatsRef = useRef<Seat[]>([]);
  useEffect(() => {
    botSeatsRef.current = botSeats;
  }, [botSeats]);
  const [botLevels, setBotLevels] = useState<BotLevel[]>([]);
  const botLevelsRef = useRef<BotLevel[]>([]);
  useEffect(() => {
    botLevelsRef.current = botLevels;
  }, [botLevels]);
  const botSeatSet = useMemo(() => new Set(botSeats), [botSeats]);

  const [botTakeover, setBotTakeover] = useState<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  const botTakeoverRef = useRef<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  function applyBotTakeoverEvent(event: BotTakeoverEvent) {
    const next = reduceBotTakeover(botTakeoverRef.current, event);
    botTakeoverRef.current = next;
    setBotTakeover(next);
  }
  const [dismissedVoteKey, setDismissedVoteKey] = useState<string | null>(null);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // live throw (§15)
  const liveRef = useRef<LiveView | null>(null);
  const runnerRef = useRef<LiveThrowRunner | null>(null);
  const [liveInfo, setLiveInfo] = useState<LiveInfo | null>(null);
  const liveInfoAtRef = useRef(0);
  const liveStartRef = useRef<{ turn: number; at: number } | null>(null);
  const [liveStart, setLiveStart] = useState<{ turn: number; at: number } | null>(null);
  // §17 spectator layer: skip calls + predictions (never in the engine)
  const [calls, setCalls] = useState<{ turn: number; marks: Record<number, Omit<CallMark, "name">> }>({ turn: -1, marks: {} });
  const [predictions, setPredictions] = useState<PredictionBoard>(EMPTY_PREDICTIONS);
  const predictionsRef = useRef<PredictionBoard>(EMPTY_PREDICTIONS);
  const [predictLockTurn, setPredictLockTurn] = useState<number | null>(null);
  const predictLockRef = useRef<number | null>(null);
  const [seer, setSeer] = useState<Record<number, number>>({});
  const seerRef = useRef<Record<number, number>>({});
  const botSpectateRef = useRef<{ turn: number; due: { seat: number; at: number }[]; skipAsked: boolean }>({ turn: -1, due: [], skipAsked: false });
  const markLiveStart = useCallback((turn: number) => {
    const v = { turn, at: Date.now() };
    liveStartRef.current = v;
    setLiveStart(v);
    predictLockRef.current = turn;
    setPredictLockTurn(turn);
  }, []);
  const sweepCounter = useRef(new SweepCounter());
  const myTapsRef = useRef(new SweepCounter());
  const pendingTapsRef = useRef(0);
  const [myIntensity, setMyIntensity] = useState(0);
  const botSweepRef = useRef<Map<number, { frame: number; want: boolean }>>(new Map());
  const aimRef = useRef<AimView | null>(null);
  const aimSentRef = useRef(0);
  const lastThrowTurnRef = useRef<number | null>(null);
  const timeoutStreakRef = useRef<Record<number, number>>({});

  const [reactions, setReactions] = useState<Reaction[]>([]);
  const lastReactAtRef = useRef(0);

  const channelRef = useRef<RealtimeChannel | null>(null);
  function requestStateSync() {
    const channel = channelRef.current;
    if (!channel) return;
    if (channel.state !== "joined") channel.subscribe();
    channel.send({ type: "broadcast", event: "state-request", payload: {} });
  }
  const startSentRef = useRef(false);
  const playerCountRef = useRef(targetPlayerCount);
  const isHost = intent === "create";

  // Same "lowest connected seat drives bots" rule as every other online game.
  const canDriveBots = useMemo(() => {
    if (mySeat === null || occupants.length === 0) return false;
    const lowestPresentSeat = Math.min(...occupants.map((o) => o.seat));
    return mySeat === lowestPresentSeat;
  }, [mySeat, occupants]);
  const canDriveRef = useRef(false);
  useEffect(() => {
    canDriveRef.current = canDriveBots;
  }, [canDriveBots]);

  const gameStateRef = useRef<CurlingState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  const mySeatRef = useRef<Seat | null>(null);
  useEffect(() => {
    mySeatRef.current = mySeat;
  }, [mySeat]);

  const namesRef = useRef<Record<Seat, string>>({});
  const occupantsRef = useRef<Occupant[]>([]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);

  function enterRoom() {
    setFormError(null);
    if (!getSupabase()) {
      setPhase("supabase-missing");
      return;
    }
    const name = identity.name.trim() || "플레이어";
    const code = intent === "create" ? generateRoomCode() : codeInput.trim();
    if (intent === "join" && !/^\d{4}$/.test(code)) {
      setFormError("4자리 초대 코드를 정확히 입력하세요.");
      return;
    }
    playerCountRef.current = targetPlayerCount;
    optionsRef.current = normalizeOptions(targetPlayerCount, options);
    getCurlingSound().unlock();
    setMyName(name);
    setMyPlayerId(identity.name.trim() ? identity.playerId : undefined);
    setRoomCode(code);
    setPhase("connecting");
  }

  const pushLiveInfo = useCallback((v: LiveView, force = false) => {
    const now = performance.now();
    if (!force && now - liveInfoAtRef.current < 180) return;
    liveInfoAtRef.current = now;
    setLiveInfo((prev) => {
      if (prev && prev.own < 0.5 && v.sweep.own >= 0.5) shout(SWEEP_SHOUTS[Math.floor(Math.random() * SWEEP_SHOUTS.length)]);
      return { turn: v.turn, seat: v.seat, side: v.side, passedTee: v.passedTee, own: v.sweep.own, opp: v.sweep.opp, who: v.sweep.who };
    });
  }, []);

  useEffect(() => {
    if (!roomCode) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const deviceId = getDeviceId();
    const channel = supabase.channel(`${GAME_ID}-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    const chatChannel = `room:${GAME_ID}:${roomCode}`;
    void loadRecentMessages(chatChannel).then((history) => {
      setChatMessages((prev) => mergeHistoryIntoMessages(prev, history));
    });

    channel.on("broadcast", { event: "chat-message" }, ({ payload }) => {
      const message = payload?.message as ChatMessage | undefined;
      if (!message) return;
      setChatMessages((prev) => [...prev, message]);
    });

    // stone snapshots from the throw's authority
    channel.on("broadcast", { event: "live" }, ({ payload }) => {
      const st = gameStateRef.current;
      if (!st || !payload) return;
      const turn = payload.turn;
      if (turn !== st.turn) return;
      const cur = liveRef.current;
      if (cur && cur.local && cur.turn === turn) return; // my own packets / my replay
      const seat = num(payload.seat, 0, MAX_PLAYERS - 1);
      const side = num(payload.side, 0, MAX_PLAYERS - 1);
      const id = num(payload.id, 0, 1e6);
      if (seat === null || side === null || id === null || currentThrower(st) !== seat) return;
      const kind = isKind(payload.kind) ? payload.kind : null;
      const meta = new Map(st.stones.map((s) => [s.id, { side: s.side, kind: s.kind }]));
      const stones = unpackStones(payload.s, meta, { side, kind, id });
      if (!stones) return;
      let view = cur;
      if (!view || view.turn !== turn) {
        view = { turn, seat, side, deliveredId: id, kind, local: false, snaps: [], sweep: { own: 0, opp: 0, who: [] }, passedTee: false, done: false, pending: [] };
        liveRef.current = view;
        markLiveStart(turn);
        getCurlingSound().play("release");
        if (kind === "ghost") getCurlingSound().play("ghost");
        aimRef.current = null;
      }
      view.snaps.push({ at: performance.now(), tick: num(payload.t, 0, 1e6) ?? 0, stones });
      if (view.snaps.length > 10) view.snaps.splice(0, view.snaps.length - 10);
      const sw = payload.sw as Record<string, unknown> | undefined;
      const who = Array.isArray(sw?.who) ? (sw!.who as unknown[]).filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x < MAX_PLAYERS).slice(0, MAX_PLAYERS) : [];
      view.sweep = { own: num(sw?.own, 0, 1) ?? 0, opp: num(sw?.opp, 0, 1) ?? 0, who };
      view.passedTee = payload.tee === true;
      view.pending.push(...sanitizeEvents(payload.ev));
      if (payload.done === true) view.done = true;
      pushLiveInfo(view, payload.done === true || payload.tee === true);
    });

    // sweep taps → the authority
    channel.on("broadcast", { event: "sweep" }, ({ payload }) => {
      const seat = num(payload?.seat, 0, MAX_PLAYERS - 1);
      const taps = num(payload?.taps, 0, 20);
      const view = liveRef.current;
      if (seat === null || !taps || !runnerRef.current || !view?.local || payload?.turn !== view.turn || seat === mySeatRef.current) return;
      sweepCounter.current.add(seat, Math.round(taps));
    });

    // the thrower's broom (cosmetic)
    channel.on("broadcast", { event: "aim" }, ({ payload }) => {
      const st = gameStateRef.current;
      if (!st || payload?.turn !== st.turn || payload?.seat === mySeatRef.current || currentThrower(st) !== payload?.seat) return;
      if (liveRef.current?.turn === st.turn) return;
      const aim = num(payload.aim, -2.5, 2.5);
      if (aim === null) return;
      const charge = payload.charge === null ? null : num(payload.charge, 0, 1);
      aimRef.current = { aim, spin: payload.spin === -1 ? -1 : 1, charge, side: currentSide(st), kind: isKind(payload.kind) ? payload.kind : null, interactive: false };
    });

    channel.on("broadcast", { event: "call" }, ({ payload }) => {
      const st = gameStateRef.current;
      const c = sanitizeCall(payload, MAX_PLAYERS);
      if (!st || !c || c.turn !== st.turn || st.phase !== "aim" || c.seat >= st.playerCount) return;
      const side = currentSide(st);
      if (st.sideOf[c.seat] !== side || currentThrower(st) === c.seat) return;
      getCurlingSound().play("aim");
      setCalls((prev) => ({ turn: c.turn, marks: { ...(prev.turn === c.turn ? prev.marks : {}), [c.seat]: { seat: c.seat, side, x: c.x, y: c.y, tag: c.tag } } }));
    });

    channel.on("broadcast", { event: "predict" }, ({ payload }) => {
      const st = gameStateRef.current;
      const pr = sanitizePrediction(payload, MAX_PLAYERS);
      if (!st || !pr || pr.turn !== st.turn || st.phase !== "aim" || currentThrower(st) === pr.seat || predictLockRef.current === pr.turn) return;
      const cur = predictionsRef.current.turn === pr.turn ? predictionsRef.current : { turn: pr.turn, picks: {} };
      const next: PredictionBoard = { turn: pr.turn, picks: { ...cur.picks, [pr.seat]: pr.pick } };
      predictionsRef.current = next;
      setPredictions(next);
    });

    channel.on("broadcast", { event: "seer" }, ({ payload }) => {
      const seat = num(payload?.seat, 0, MAX_PLAYERS - 1);
      const score = num(payload?.score, 0, 10_000);
      if (seat === null || score === null || !Number.isInteger(seat)) return;
      const next = { ...seerRef.current, [seat]: Math.max(seerRef.current[seat] ?? 0, Math.round(score)) };
      seerRef.current = next;
      setSeer(next);
    });

    channel.on("broadcast", { event: "react" }, ({ payload }) => {
      const seat = num(payload?.seat, 0, MAX_PLAYERS - 1);
      const kind = payload?.kind as ReactionKind;
      if (seat === null || !["clap", "fire", "gasp", "lol", "pray"].includes(kind) || typeof payload?.id !== "string") return;
      getCurlingSound().play("react");
      const now = Date.now();
      setReactions((prev) => [...prev.filter((x) => now - x.at < REACTION_TTL_MS && x.id !== payload.id), { id: payload.id, seat, kind, at: now }].slice(-14));
    });

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const playerCount = payload?.playerCount as number;
      const roster = (payload?.botSeats as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      const opts = (payload?.options as GameOptions | undefined) ?? DEFAULT_OPTIONS;
      playerCountRef.current = playerCount;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      runnerRef.current?.stop();
      runnerRef.current = null;
      liveRef.current = null;
      aimRef.current = null;
      setLiveInfo(null);
      lastThrowTurnRef.current = null;
      timeoutStreakRef.current = {};
      setReactions([]);
      predictionsRef.current = EMPTY_PREDICTIONS;
      setPredictions(EMPTY_PREDICTIONS);
      seerRef.current = {};
      setSeer({});
      setCalls({ turn: -1, marks: {} });
      setGameState(startGame(playerCount, seed, opts));
      setFinalResult(null);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      const roster = (payload?.botSeats as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
    });

    channel.on("broadcast", { event: "bot-takeover-event" }, ({ payload }) => {
      const event = payload?.event as BotTakeoverEvent | undefined;
      if (!event) return;
      if (event.type === "convert") {
        const vote = botTakeoverRef.current.votes[event.seatKey];
        if (vote) {
          setChatMessages((prev) => [
            ...prev,
            {
              id: uuid(),
              channel: chatChannel,
              deviceId: "system",
              senderName: "시스템",
              body: formatBotTakeoverLog(vote.originalName),
              type: "SYSTEM",
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      }
      applyBotTakeoverEvent(event);
      if (event.type !== "vote-cast") return;
      const vote = botTakeoverRef.current.votes[event.seatKey];
      if (!vote) return;
      const takenOverSeats = new Set(Object.keys(botTakeoverRef.current.takeovers).map(Number));
      const eligible = occupantsRef.current.filter((o) => o.seat !== Number(event.seatKey) && !botSeatsRef.current.includes(o.seat) && !takenOverSeats.has(o.seat)).length;
      if (voteThresholdMet(voteYesCount(botTakeoverRef.current, event.seatKey), eligible)) {
        channel.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "convert", seatKey: event.seatKey, at: Date.now() } } });
      }
    });

    channel.on("broadcast", { event: "state-request" }, () => {
      if (gameStateRef.current) {
        channel.send({
          type: "broadcast",
          event: "state-sync",
          payload: { state: gameStateRef.current, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current, botTakeover: botTakeoverRef.current, seer: seerRef.current },
        });
      } else if (isHost) {
        channel.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: botSeatsRef.current, botLevels: botLevelsRef.current } });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const state = payload?.state as CurlingState | undefined;
      if (!state) return;
      const roster = (payload?.botSeats as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      const takeover = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = takeover;
      setBotTakeover(takeover);
      const seerSync = payload?.seer as Record<number, number> | undefined;
      if (seerSync && typeof seerSync === "object") {
        const merged = { ...seerRef.current };
        for (const [k, v] of Object.entries(seerSync)) if (typeof v === "number" && Number.isFinite(v)) merged[Number(k)] = Math.max(merged[Number(k)] ?? 0, Math.round(v));
        seerRef.current = merged;
        setSeer(merged);
      }
      // never rewind: a slower sync must not undo actions this client already applied
      setGameState((prev) => (prev && prev.seed === state.seed && prev.turn > state.turn ? prev : state));
      setFinalResult(null);
      setPhase("playing");
    });

    let resolveFirstSync = () => {};
    const firstSync = new Promise<void>((resolve) => {
      resolveFirstSync = resolve;
    });
    let sawFirstSync = false;

    channel.on("presence", { event: "sync" }, () => {
      const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
      setOccupants(withUniqueNames(Object.values(raw).flat()));
      if (!sawFirstSync) {
        sawFirstSync = true;
        resolveFirstSync();
      }
    });

    channel.on("presence", { event: "leave" }, ({ leftPresences }) => {
      if (phaseRef.current !== "playing") return;
      for (const p of leftPresences as unknown as Occupant[]) {
        if (botSeatsRef.current.includes(p.seat)) continue;
        if (activeVoteFor(botTakeoverRef.current, String(p.seat)) || isSeatTakenOver(botTakeoverRef.current, String(p.seat))) continue;
        channel.send({
          type: "broadcast",
          event: "bot-takeover-event",
          payload: {
            event: {
              type: "vote-start",
              seatKey: String(p.seat),
              reason: "disconnected",
              startedAt: Date.now(),
              originalUserId: p.playerId ?? `${roomCode}:${p.seat}`,
              originalName: p.name,
            },
          },
        });
      }
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await Promise.race([firstSync, new Promise((resolve) => setTimeout(resolve, 800))]);
        let seat = getStoredSeat(roomCode);
        if (seat === null) {
          const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
          const existing = Object.values(raw).flat();
          const taken = new Set([...existing.map((o) => o.seat), ...botSeatsRef.current]);
          seat = 0;
          while (taken.has(seat)) seat++;
          const hostRecord = existing.find((o) => o.isHost);
          if (hostRecord && seat >= hostRecord.targetPlayerCount!) {
            setPhase("room-full");
            return;
          }
          storeSeat(roomCode, seat);
        }
        setMySeat(seat);
        await channel.track({
          deviceId,
          seat,
          name: myName,
          playerId: myPlayerId,
          ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current } : {}),
        } satisfies Occupant);
        requestStateSync();
        setPhase((p) => (p === "connecting" ? "waiting" : p));
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setPhase("channel-error");
      }
    });

    return () => {
      runnerRef.current?.stop();
      runnerRef.current = null;
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [roomCode, myName, myPlayerId, isHost, pushLiveInfo, markLiveStart]);

  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";
  const host = occupants.find((o) => o.isHost);
  const knownTargetPlayerCount = host?.targetPlayerCount ?? targetPlayerCount;
  const reclaimAttemptsRef = useRef(0);

  useEffect(() => {
    if (mySeat === null || !roomCode || phase === "playing" || phase === "post-game" || phase === "room-full") return;
    const conflicting = occupants.filter((o) => o.seat === mySeat && o.deviceId !== deviceId);
    if (conflicting.length === 0) {
      reclaimAttemptsRef.current = 0;
      return;
    }
    const iShouldMove = conflicting.some((o) => o.deviceId < deviceId);
    if (!iShouldMove) return;
    if (reclaimAttemptsRef.current >= 3) {
      setPhase("room-full");
      return;
    }
    reclaimAttemptsRef.current += 1;
    const taken = new Set([...occupants.filter((o) => o.deviceId !== deviceId).map((o) => o.seat), ...botSeatsRef.current]);
    let next = 0;
    while (taken.has(next)) next++;
    storeSeat(roomCode, next);
    setMySeat(next);
    channelRef.current?.track({
      deviceId,
      seat: next,
      name: myName,
      playerId: myPlayerId,
      ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current } : {}),
    } satisfies Occupant);
  }, [occupants, mySeat, phase, deviceId, roomCode, myName, myPlayerId, isHost]);

  const sendGameStart = useCallback(() => {
    startSentRef.current = true;
    const count = playerCountRef.current;
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: {
        seed: randomSeed(),
        playerCount: count,
        botSeats: botSeatsRef.current,
        botLevels: botLevelsRef.current,
        options: normalizeOptions(count, optionsRef.current),
      },
    });
  }, []);

  /** "지금 시작" with fewer seats than planned. */
  const startNow = useCallback(
    (count: number) => {
      playerCountRef.current = count;
      sendGameStart();
    },
    [sendGameStart],
  );

  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current) return;
    // Two guests joining at the same instant can briefly share a seat — wait until every seat is distinct.
    const seats = new Set([...occupants.map((o) => o.seat), ...botSeats]);
    if (seats.size === occupants.length + botSeats.length && seats.size >= knownTargetPlayerCount) sendGameStart();
  }, [occupants, botSeats, phase, knownTargetPlayerCount, isHost, sendGameStart]);

  const addBotAtSeat = useCallback(
    (seat: Seat, level: BotLevel) => {
      if (!isHost) return;
      if (botSeatsRef.current.includes(seat) || occupants.some((o) => o.seat === seat)) return;
      const nextSeats = [...botSeatsRef.current, seat];
      const nextLevels = [...botLevelsRef.current, level];
      botSeatsRef.current = nextSeats;
      setBotSeats(nextSeats);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: nextSeats, botLevels: nextLevels } });
    },
    [isHost, occupants],
  );

  const fillEmptySeatsWithBots = useCallback(
    (level: BotLevel) => {
      if (!isHost) return;
      const taken = new Set<Seat>([...occupants.map((o) => o.seat), ...botSeatsRef.current]);
      const emptySeats = Array.from({ length: knownTargetPlayerCount }, (_, seat) => seat).filter((seat) => !taken.has(seat));
      if (emptySeats.length === 0) return;
      const nextSeats = [...botSeatsRef.current, ...emptySeats];
      const nextLevels = [...botLevelsRef.current, ...emptySeats.map(() => level)];
      botSeatsRef.current = nextSeats;
      setBotSeats(nextSeats);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: nextSeats, botLevels: nextLevels } });
    },
    [isHost, occupants, knownTargetPlayerCount],
  );

  const removeBotAtSeat = useCallback(
    (seat: Seat) => {
      if (!isHost) return;
      const idx = botSeatsRef.current.indexOf(seat);
      if (idx === -1) return;
      const nextSeats = botSeatsRef.current.filter((_, i) => i !== idx);
      const nextLevels = botLevelsRef.current.filter((_, i) => i !== idx);
      botSeatsRef.current = nextSeats;
      setBotSeats(nextSeats);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: nextSeats, botLevels: nextLevels } });
    },
    [isHost],
  );

  if (isHost && botSeats.length > 0) {
    const humanSeats = new Set(occupants.map((o) => o.seat));
    const keepIdx = botSeats.map((s, i) => (humanSeats.has(s) ? -1 : i)).filter((i) => i !== -1);
    if (keepIdx.length !== botSeats.length) {
      setBotSeats(keepIdx.map((i) => botSeats[i]));
      setBotLevels(keepIdx.map((i) => botLevels[i]));
    }
  }

  const handleAction = useCallback((action: EngineAction) => {
    channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action } });
  }, []);

  const takeoverSeatKey = Object.keys(botTakeover.takeovers).sort().join(",");
  const takeoverSeats = useMemo(() => (takeoverSeatKey ? (takeoverSeatKey.split(",").map(Number) as Seat[]) : []), [takeoverSeatKey]);
  const allBotSeatSet = useMemo(() => new Set([...botSeatSet, ...takeoverSeats]), [botSeatSet, takeoverSeats]);
  const allBotSeatsRef = useRef<Set<Seat>>(new Set());
  useEffect(() => {
    allBotSeatsRef.current = allBotSeatSet;
  }, [allBotSeatSet]);

  const levelOf = useCallback((seat: Seat): BotLevel => {
    const idx = botSeatsRef.current.indexOf(seat);
    return idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
  }, []);

  /** §6 — this frame's sweep: humans' tap rate + bots' look-ahead decisions. */
  const sweepFor = useCallback(
    (st: CurlingState, sim: ThrowSim, frame: number, throwSide: number): SweepSample => {
      const now = performance.now();
      let humanOwn = 0;
      let humanOpp = 0;
      const who: number[] = [];
      for (let seat = 0; seat < st.playerCount; seat++) {
        if (allBotSeatsRef.current.has(seat)) continue;
        const v = sweepCounter.current.intensity(seat, now);
        if (v <= 0) continue;
        const own = st.sideOf[seat] === throwSide;
        if (!own && !sim.passedTee) continue;
        if (own) humanOwn += v;
        else humanOpp += v;
        who.push(seat);
      }
      let botOwn = 0;
      let botOpp = 0;
      const decidedSide = new Map<number, boolean>();
      for (const seat of allBotSeatsRef.current) {
        if (seat >= st.playerCount) continue;
        const botSide = st.sideOf[seat];
        const own = botSide === throwSide;
        if (!own && !sim.passedTee) continue;
        const lvl = levelOf(seat);
        const rec = botSweepRef.current.get(seat) ?? { frame: -99, want: false };
        if (frame - rec.frame >= botSweepEvery(lvl)) {
          let want = decidedSide.get(botSide);
          if (want === undefined) {
            want = botWantsSweep(st, sim, botSide, lvl, Math.random, { own: Math.min(1, humanOwn), opp: Math.min(1, humanOpp) });
            decidedSide.set(botSide, want);
          }
          rec.frame = frame;
          rec.want = want;
          botSweepRef.current.set(seat, rec);
        }
        if (!rec.want) continue;
        if (own) botOwn = 1;
        else botOpp = 1;
        who.push(seat);
      }
      return { own: Math.min(10, Math.round((humanOwn + botOwn) * 10)), opp: Math.min(10, Math.round((humanOpp + botOpp) * 10)), who };
    },
    [levelOf],
  );

  /** Become the authority for this turn's throw and run it live (§15). */
  const startAuthorityThrow = useCallback(
    (seat: Seat, raw: { aim: number; weight: number; spin: 1 | -1; useCard: boolean }) => {
      const st = gameStateRef.current;
      if (!st || st.phase !== "aim" || currentThrower(st) !== seat) return;
      if (liveRef.current && liveRef.current.turn === st.turn) return;
      const side = currentSide(st);
      const p = sanitizeParams(raw.aim, raw.weight, raw.spin);
      const kind = raw.useCard && st.options.party ? st.cards[side] : null;
      const turn = st.turn;
      sweepCounter.current.clear();
      botSweepRef.current.clear();
      const view: LiveView = { turn, seat, side, deliveredId: st.nextStoneId, kind, local: true, snaps: [], sweep: { own: 0, opp: 0, who: [] }, passedTee: false, done: false, pending: [] };
      liveRef.current = view;
      aimRef.current = null;
      markLiveStart(turn);
      getCurlingSound().play("release");
      if (kind === "ghost") getCurlingSound().play("ghost");
      let lastSent = 0;
      let netEvents: LiveEvent[] = [];
      runnerRef.current?.stop();
      const runner = new LiveThrowRunner(st.stones, { ...p, kind }, side, st.nextStoneId, {
        sweep: (sim, frame) => sweepFor(st, sim, frame, side),
        frame: (snap, events, sw, sim) => {
          if (liveRef.current !== view) return;
          view.snaps = [snap];
          view.sweep = { own: sw.own / 10, opp: sw.opp / 10, who: sw.who };
          const teeNow = sim.passedTee && !view.passedTee;
          view.passedTee = sim.passedTee;
          view.pending.push(...events);
          netEvents.push(...events);
          const now = performance.now();
          if (now - lastSent >= LIVE_SEND_MS || sim.done || events.length > 0) {
            lastSent = now;
            channelRef.current?.send({
              type: "broadcast",
              event: "live",
              payload: {
                turn,
                seat,
                side,
                id: view.deliveredId,
                kind,
                t: snap.tick,
                s: packStones(snap.stones),
                ev: netEvents,
                sw: { own: view.sweep.own, opp: view.sweep.opp, who: sw.who },
                tee: sim.passedTee,
                done: sim.done,
              },
            });
            netEvents = [];
          }
          pushLiveInfo(view, teeNow || sim.done);
        },
        done: (own, opp) => {
          if (liveRef.current !== view) return;
          view.done = true;
          handleAction({ type: "throw", seat, turn, aim: p.aim, weight: p.weight, spin: p.spin, useCard: kind !== null, own, opp });
        },
      });
      runnerRef.current = runner;
      runner.run();
    },
    [sweepFor, pushLiveInfo, handleAction, markLiveStart],
  );

  const chooseAction = useCallback(
    async (state: CurlingState, actor: Seat): Promise<EngineAction | null> => {
      const plan = await planBotThrowAsync(state, levelOf(actor));
      return { type: "throw", seat: actor, turn: state.turn, ...plan, own: [], opp: [] };
    },
    [levelOf],
  );

  // A bot's "throw" is a plan: this client runs it live like a human throw.
  const dispatchBot = useCallback(
    (a: EngineAction) => {
      if (a.type === "throw") {
        const st = gameStateRef.current;
        if (!st || st.turn !== a.turn) return;
        startAuthorityThrow(a.seat, a);
      } else handleAction(a);
    },
    [startAuthorityThrow, handleAction],
  );

  useBotAutoplay<CurlingState, EngineAction, Seat>({
    active: canDriveBots && phase === "playing",
    state: gameState,
    currentActor,
    botSeats: allBotSeatSet,
    chooseAction,
    dispatch: dispatchBot,
    minDelayMs: 1200,
    maxDelayMs: 2600,
    watchdogMs: 30_000,
  });

  // the action landed: drop the live view, or replay a throw this client never saw (§15)
  useEffect(() => {
    if (!gameState) return;
    const lt = gameState.lastThrow;
    const view = liveRef.current;
    if (view && view.turn < gameState.turn && !(view.local && !view.done)) {
      liveRef.current = null;
      runnerRef.current?.stop();
      runnerRef.current = null;
      setLiveInfo(null);
    }
    if (lt && lastThrowTurnRef.current !== lt.turn) {
      const first = lastThrowTurnRef.current === null;
      lastThrowTurnRef.current = lt.turn;
      // 🔮 score calls: mine here, bots' on the driving client (each device sends only its own total)
      const board = predictionsRef.current;
      if (!first && board.turn === lt.turn) {
        const stayed = stoneStayedIn(gameState, lt);
        const scoreFor = (seat: number) => {
          const pick = board.picks[seat];
          if (!pick || !predictionHit(pick, stayed)) return;
          channelRef.current?.send({ type: "broadcast", event: "seer", payload: { seat, score: (seerRef.current[seat] ?? 0) + 1 } });
        };
        if (mySeatRef.current !== null) scoreFor(mySeatRef.current);
        if (canDriveRef.current) for (const b of allBotSeatsRef.current) scoreFor(b);
      }
      // two time-outs in a row → ask the table about a bot (§10)
      const streak = timeoutStreakRef.current;
      streak[lt.seat] = lt.auto ? (streak[lt.seat] ?? 0) + 1 : 0;
      if (lt.auto && streak[lt.seat] >= 2 && canDriveRef.current && !allBotSeatsRef.current.has(lt.seat)) {
        const key = String(lt.seat);
        if (!activeVoteFor(botTakeoverRef.current, key) && !isSeatTakenOver(botTakeoverRef.current, key)) {
          const occ = occupantsRef.current.find((o) => o.seat === lt.seat);
          channelRef.current?.send({
            type: "broadcast",
            event: "bot-takeover-event",
            payload: { event: { type: "vote-start", seatKey: key, reason: "idle", startedAt: Date.now(), originalUserId: occ?.playerId ?? `${roomCode}:${lt.seat}`, originalName: occ?.name ?? namesRef.current[lt.seat] ?? "상대" } },
          });
        }
      }
      const sawIt = view && view.turn === lt.turn;
      if (!sawIt && !first) {
        // replay from the record, a bit faster than real time
        const replay: LiveView = { turn: lt.turn, seat: lt.seat, side: lt.side, deliveredId: lt.stoneId, kind: lt.params.kind, local: true, snaps: [], sweep: { own: 0, opp: 0, who: [] }, passedTee: false, done: false, pending: [] };
        liveRef.current = replay;
        runnerRef.current?.stop();
        const runner = new LiveThrowRunner(
          lt.before,
          lt.params,
          lt.side,
          lt.stoneId,
          {
            sweep: () => ({ own: 0, opp: 0, who: [] }),
            frame: (snap, events, sw, sim) => {
              if (liveRef.current !== replay) return;
              replay.snaps = [snap];
              replay.sweep = { own: sw.own / 10, opp: sw.opp / 10, who: [] };
              replay.passedTee = sim.passedTee;
              replay.pending.push(...events);
            },
            done: () => {
              replay.done = true;
              window.setTimeout(() => {
                if (liveRef.current === replay) liveRef.current = null;
              }, 400);
            },
          },
          1.6,
          { own: lt.own, opp: lt.opp },
        );
        runnerRef.current = runner;
        runner.run();
      }
    }
    if (aimRef.current && !aimRef.current.interactive) {
      // stale broom from the previous thrower (my own aim is cleared by the board)
      aimRef.current = null;
    }
    // a new throw: fresh calls/predictions; bots plan their own (driver only)
    if (gameState.phase === "aim" && canDriveRef.current) {
      const thr = currentThrower(gameState);
      const due: { seat: number; at: number }[] = [];
      for (const b of allBotSeatsRef.current) if (b !== thr && b < gameState.playerCount && Math.random() < 0.75) due.push({ seat: b, at: Date.now() + 1200 + Math.random() * 3500 });
      botSpectateRef.current = { turn: gameState.turn, due, skipAsked: false };
    }
    // bots cheer / groan at big moments (driver only)
    if (lt && canDriveRef.current && liveRef.current?.turn !== gameState.turn) {
      const big = ["double", "triple", "button", "bomb", "ownGoal", "through", "hog"].includes(lt.call.key);
      if (big)
        for (const b of allBotSeatsRef.current) {
          if (b === lt.seat || b >= gameState.playerCount || Math.random() > 0.3) continue;
          const kind: ReactionKind = ["ownGoal", "through", "hog"].includes(lt.call.key) ? (Math.random() < 0.5 ? "lol" : "gasp") : gameState.sideOf[b] === lt.side ? (Math.random() < 0.5 ? "clap" : "fire") : "gasp";
          window.setTimeout(() => channelRef.current?.send({ type: "broadcast", event: "react", payload: { seat: b, kind, id: uuid() } }), 500 + Math.random() * 1200);
        }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.turn]);

  const handleAimLive = useCallback((a: AimView | null) => {
    aimRef.current = a;
    const st = gameStateRef.current;
    const seat = mySeatRef.current;
    if (!a || !st || seat === null) return;
    const now = performance.now();
    if (now - aimSentRef.current < AIM_SEND_MS) return;
    aimSentRef.current = now;
    channelRef.current?.send({ type: "broadcast", event: "aim", payload: { seat, turn: st.turn, aim: a.aim, spin: a.spin, charge: a.charge === null ? null : Math.round(a.charge * 1000) / 1000, kind: a.kind } });
  }, []);

  const handleThrow = useCallback(
    (p: { aim: number; weight: number; spin: 1 | -1; useCard: boolean }) => {
      const seat = mySeatRef.current;
      if (seat === null) return;
      startAuthorityThrow(seat, p);
    },
    [startAuthorityThrow],
  );

  const handleSweep = useCallback(() => {
    const seat = mySeatRef.current;
    const view = liveRef.current;
    const st = gameStateRef.current;
    if (seat === null || !view || !st || view.turn !== st.turn || view.done) return;
    if (st.sideOf[seat] !== view.side && !view.passedTee) return;
    getCurlingSound().play("sweep");
    myTapsRef.current.add(seat, 1);
    if (runnerRef.current && view.local) sweepCounter.current.add(seat, 1);
    else pendingTapsRef.current += 1;
  }, []);

  // flush my taps to the authority + my own meter
  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setInterval(() => {
      const seat = mySeatRef.current;
      const view = liveRef.current;
      if (seat !== null && pendingTapsRef.current > 0 && view && !view.local) {
        channelRef.current?.send({ type: "broadcast", event: "sweep", payload: { seat, turn: view.turn, taps: pendingTapsRef.current } });
      }
      pendingTapsRef.current = 0;
      setMyIntensity(seat === null ? 0 : myTapsRef.current.intensity(seat));
    }, SWEEP_FLUSH_MS);
    return () => window.clearInterval(id);
  }, [phase]);

  const handleEvent = useCallback((e: LiveEvent) => {
    const s = getCurlingSound();
    if (e.kind === "hit") s.play("hit", Math.min(1, e.power / 5));
    else if (e.kind === "out") s.play("out");
    else if (e.kind === "bomb") s.play("bomb");
    else if (e.kind === "stick") s.play("stick");
    else if (e.kind === "solid") s.play("solid");
  }, []);

  const sendCall = useCallback((x: number, y: number, tag: CallMark["tag"]) => {
    const seat = mySeatRef.current;
    const st = gameStateRef.current;
    if (seat === null || !st) return;
    const now = Date.now();
    if (now - lastReactAtRef.current < 350) return;
    lastReactAtRef.current = now;
    channelRef.current?.send({ type: "broadcast", event: "call", payload: { seat, turn: st.turn, x, y, tag } });
  }, []);

  const sendPrediction = useCallback((pick: Prediction) => {
    const seat = mySeatRef.current;
    const st = gameStateRef.current;
    if (seat === null || !st || st.phase !== "aim" || currentThrower(st) === seat || predictLockRef.current === st.turn) return;
    channelRef.current?.send({ type: "broadcast", event: "predict", payload: { seat, turn: st.turn, pick } });
  }, []);

  const sendReaction = useCallback((kind: ReactionKind) => {
    const seat = mySeatRef.current;
    if (seat === null) return;
    const now = Date.now();
    if (now - lastReactAtRef.current < REACT_COOLDOWN_MS) return;
    lastReactAtRef.current = now;
    channelRef.current?.send({ type: "broadcast", event: "react", payload: { seat, kind, id: uuid() } });
  }, []);

  const sendChatMessage = useCallback(
    (rawBody: string): SendResult => {
      const now = Date.now();
      const check = checkThrottle(chatThrottleRef.current, now);
      if (!check.ok) {
        setChatCooldownUntil(check.lockedUntil ?? null);
        return { ok: false, lockedUntil: check.lockedUntil };
      }
      const trimmed = stripControlChars(rawBody);
      if (!trimmed) return { ok: false };
      const { clean } = filterProfanity(trimmed);
      chatThrottleRef.current = recordSend(chatThrottleRef.current, now);
      setChatCooldownUntil(chatThrottleRef.current.lockedUntil);
      const message: ChatMessage = {
        id: uuid(),
        channel: `room:${GAME_ID}:${roomCode}`,
        deviceId,
        // the roster label (withUniqueNames), so a shared nickname reads "상어 2" in chat too
        senderName: occupantsRef.current.find((o) => o.deviceId === deviceId)?.name || myName || "게스트",
        body: clean,
        type: "USER",
        createdAt: new Date(now).toISOString(),
      };
      channelRef.current?.send({ type: "broadcast", event: "chat-message", payload: { message } });
      void persistMessage(message);
      return { ok: true };
    },
    [roomCode, myName, deviceId],
  );

  // Turn timer (§10), one interval.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [turnSeen, setTurnSeen] = useState<{ turn: number; at: number } | null>(null);
  const turnSeenRef = useRef<{ turn: number; at: number } | null>(null);
  const timeoutSentRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      const state = gameStateRef.current;
      if (!state) return;
      const seen = turnSeenRef.current;
      if (!seen || seen.turn !== state.turn) {
        const next = { turn: state.turn, at: now };
        turnSeenRef.current = next;
        setTurnSeen(next);
        return;
      }
      const actor = currentThrower(state);
      if (canDriveRef.current && actor !== null && state.phase === "aim") {
        const plan = botSpectateRef.current;
        if (plan.turn === state.turn && predictLockRef.current !== state.turn) {
          const keep: typeof plan.due = [];
          for (const d of plan.due) {
            if (d.at > now) keep.push(d);
            else channelRef.current?.send({ type: "broadcast", event: "predict", payload: { seat: d.seat, turn: state.turn, pick: botPrediction() } });
          }
          plan.due = keep;
        }
        // 🤖 AI skip: a bot teammate of a human thrower calls the shot it would play
        const mate = state.options.mode === "team" && !allBotSeatsRef.current.has(actor) ? state.members[state.sideOf[actor]].find((m) => m !== actor && allBotSeatsRef.current.has(m)) : undefined;
        if (mate !== undefined && plan.turn === state.turn && !plan.skipAsked) {
          plan.skipAsked = true;
          const turn = state.turn;
          const side = currentSide(state);
          void planBotThrowAsync(state, levelOf(mate), Math.random, true).then((p) => {
            const st = gameStateRef.current;
            if (!st || st.turn !== turn || liveRef.current?.turn === turn) return;
            const sim = runThrow(state.stones, { aim: p.aim, weight: p.weight, spin: p.spin, kind: p.useCard ? state.cards[side] : null }, side, state.nextStoneId);
            const alive = new Set(sim.restingStones().map((s) => s.id));
            const victim = state.stones.find((s) => s.side !== side && !alive.has(s.id));
            const d = sim.deliveredStone();
            const call = victim ? { x: victim.x, y: victim.y, tag: "hit" as const } : d.out === null ? { x: d.x, y: d.y, tag: inHouse(d) ? ("draw" as const) : ("guard" as const) } : null;
            if (call) channelRef.current?.send({ type: "broadcast", event: "call", payload: { seat: mate, turn, x: Math.round(call.x * 100) / 100, y: Math.round(call.y * 100) / 100, tag: call.tag } });
          });
        }
      }
      if (!canDriveRef.current || actor === null || allBotSeatsRef.current.has(actor)) return;
      const started = liveStartRef.current?.turn === state.turn ? liveStartRef.current.at : null;
      const deadline = started !== null ? started + RUN_GRACE_MS : seen.at + AIM_TIMEOUT_MS;
      if (now >= deadline + 800 && timeoutSentRef.current !== state.turn) {
        timeoutSentRef.current = state.turn;
        handleAction({ type: "timeout", seat: actor, turn: state.turn });
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [phase, handleAction, levelOf]);

  const thrower = gameState ? currentThrower(gameState) : null;
  const liveStarted = gameState && liveStart?.turn === gameState.turn ? liveStart.at : null;
  const deadlineMs =
    gameState && turnSeen && turnSeen.turn === gameState.turn && thrower !== null && !allBotSeatSet.has(thrower) ? (liveStarted !== null ? liveStarted + RUN_GRACE_MS : turnSeen.at + AIM_TIMEOUT_MS) : null;

  function castTakeoverVote(seatKey: string) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey, voterDeviceId: deviceId } } });
  }
  function proveStillHereOrReclaim(seatKey: string) {
    const type = isSeatTakenOver(botTakeover, seatKey) ? "reclaim" : "vote-cancel";
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type, seatKey } } });
    timeoutStreakRef.current[Number(seatKey)] = 0;
  }

  const ids: Record<Seat, string> = useMemo(() => {
    const map: Record<Seat, string> = {};
    const count = gameState?.playerCount ?? knownTargetPlayerCount;
    for (let seat = 0; seat < count; seat++) {
      const occ = occupants.find((o) => o.seat === seat);
      map[seat] = botTakeover.takeovers[seat]?.originalUserId ?? occ?.playerId ?? `${roomCode}:${seat}`;
    }
    return map;
  }, [roomCode, gameState, knownTargetPlayerCount, occupants, botTakeover]);

  const names: Record<Seat, string> = useMemo(() => {
    const map: Record<Seat, string> = {};
    const count = gameState?.playerCount ?? knownTargetPlayerCount;
    for (let seat = 0; seat < count; seat++) {
      const takeover = botTakeover.takeovers[seat];
      if (takeover) {
        map[seat] = `🤖 AI ${takeover.originalName}`;
        continue;
      }
      const occ = occupants.find((o) => o.seat === seat);
      const botIdx = botSeats.indexOf(seat);
      map[seat] = seat === mySeat ? myName : (occ?.name ?? (botIdx >= 0 ? botDisplayName(botIdx, botLevels[botIdx]) : "상대"));
    }
    return map;
  }, [occupants, mySeat, myName, gameState, knownTargetPlayerCount, botSeats, botLevels, botTakeover]);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);

  const connectedSeats = useMemo(() => new Set([...occupants.map((o) => o.seat), ...botSeats, ...takeoverSeats]), [occupants, botSeats, takeoverSeats]);

  function eligibleVoterCountFor(seatKey: string): number {
    const takenOverSeats = new Set(Object.keys(botTakeover.takeovers).map(Number));
    return occupants.filter((o) => o.seat !== Number(seatKey) && !botSeats.includes(o.seat) && !takenOverSeats.has(o.seat)).length;
  }

  function handleGameEnd() {
    if (!gameState || gameState.phase !== "ended") return;
    const rankings = computeRankings(gameState);
    const winner = rankings.find((r) => r.rank === 1)!;
    onComplete({
      rankings: rankings.map((r) => ({ playerId: ids[r.seat], rank: r.rank })),
      self: selfResult(mySeat, rankings, { takeovers: botTakeover.takeovers, botSeats, botLevels }, (seat) => curlingStatDetails(gameState, seat)),
      finishedAt: new Date().toISOString(),
    });
    setFinalResult({ winnerName: names[winner.seat] });
    setPhase("post-game");
  }

  function handleLeave() {
    runnerRef.current?.stop();
    runnerRef.current = null;
    liveRef.current = null;
    if (channelRef.current) {
      const supabase = getSupabase();
      supabase?.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    window.history.replaceState(null, "", window.location.pathname);
    setRoomCode(null);
    setMySeat(null);
    setOccupants([]);
    setGameState(null);
    setFinalResult(null);
    setLiveInfo(null);
    setIdentity({ name: "" });
    setMyPlayerId(undefined);
    setCodeInput("");
    botSeatsRef.current = [];
    setBotSeats([]);
    botLevelsRef.current = [];
    setBotLevels([]);
    botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
    setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
    setDismissedVoteKey(null);
    setChatMessages([]);
    setChatCooldownUntil(null);
    chatThrottleRef.current = INITIAL_THROTTLE_STATE;
    setPhase("choose");
  }

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";

  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(roomCode !== null, handleLeave);
  useBackgroundResync(roomCode !== null, requestStateSync);
  useActiveRoomListing({
    gameId: GAME_ID,
    roomCode,
    isHost,
    isWaiting: phase === "waiting",
    isPlaying: phase === "playing",
    hostName: myName,
    playerCount: occupants.length,
    occupants,
    maxPlayers: knownTargetPlayerCount,
  });

  function withGuard(node: ReactNode) {
    return (
      <>
        {node}
        <GameLeaveGuardModal open={exitConfirmOpen} onCancel={cancelExit} onConfirm={confirmExit} />
      </>
    );
  }

  const optBtn = (on: boolean) => `rounded-xl border px-3 py-2 text-left text-xs ${on ? "border-sky-400 bg-sky-500/15 text-sky-100 light:text-sky-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`;

  if (phase === "supabase-missing") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 text-center light:border-amber-400 light:bg-amber-50">
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80 light:text-amber-800">컬링 파티는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다(README 참고).</p>
      </div>,
    );
  }

  if (phase === "room-full") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center light:border-rose-400 light:bg-rose-50">
        <span className="text-3xl">🚫</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">이미 다른 사람이 참여 중인 방이에요</h2>
        <p className="text-sm text-rose-100/80 light:text-rose-800">코드를 다시 확인하거나 새로운 방을 만들어보세요.</p>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500">
          처음으로
        </button>
      </div>,
    );
  }

  if (phase === "channel-error") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center light:border-rose-400 light:bg-rose-50">
        <span className="text-3xl">📡</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">연결에 실패했습니다</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500">
          다시 시도
        </button>
      </div>,
    );
  }

  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId={GAME_ID}
        icon="🥌"
        title="컬링 파티 온라인 대전"
        description={
          <p className="text-sm text-white/50 light:text-slate-500">
            {MIN_PLAYERS}~{MAX_PLAYERS}명이 각자 기기로 접속해 스톤을 던지고, 다 같이 연타로 쓸어요! 엔드마다 💣🐘🍯🌀👻🧲 파티 스톤이 하나씩. 빈자리는 봇이 채워요. 컬링이 처음이어도 괜찮아요 — 첫 판에 그림 안내가 뜨고, 게임 중에도 🔰 코치가 그때그때 알려 줘요.
          </p>
        }
        actions={
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => {
                setIntent("create");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white transition hover:bg-sky-500"
            >
              🥌 방 만들기
            </button>
            <button
              onClick={() => {
                setIntent("join");
                trackGameEvent(GAME_ID, "invite_click");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl border border-white/15 py-3 text-sm font-semibold text-white/80 transition hover:border-white/30 light:border-slate-300 light:text-slate-700 light:hover:border-slate-400"
            >
              🔑 초대 코드로 참여
            </button>
          </div>
        }
      />,
    );
  }

  /** Each player's throws per end in 팀전 (the bigger team throws a little less each). */
  function perPerson(stones: number): string {
    const big = Math.ceil(targetPlayerCount / 2);
    const small = Math.floor(targetPlayerCount / 2) || 1;
    const lo = Math.floor(stones / big);
    const hi = Math.ceil(stones / small);
    return lo === hi ? String(lo) : `${lo}~${hi}`;
  }

  function changePlayerCount(delta: number) {
    const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, targetPlayerCount + delta));
    setTargetPlayerCount(n);
    // big tables default to more stones so everyone throws at least twice an end (§2)
    if (!stonesTouchedRef.current) setOptions((o) => ({ ...o, stones: n >= 6 ? 8 : 4 }));
  }

  if (phase === "enter-name") {
    const ffaOk = targetPlayerCount >= FFA_MIN && targetPlayerCount <= FFA_MAX;
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 light:border-slate-200 light:bg-white/90 light:shadow-sm">
        <h2 className="text-base font-bold text-white light:text-slate-900">{intent === "create" ? "방 만들기" : "초대 코드로 참여"}</h2>
        <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} onEnter={enterRoom} accent="emerald" />
        </div>
        {intent === "join" && (
          <label className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
            초대 코드 (4자리)
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  enterRoom();
                }
              }}
              placeholder="0000"
              inputMode="numeric"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-sky-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400 light:focus:border-sky-500"
            />
          </label>
        )}
        {intent === "create" && (
          <>
            <label className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              인원 수 ({MIN_PLAYERS}~{MAX_PLAYERS}명)
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => changePlayerCount(-1)}
                  className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30 light:border-slate-300 light:text-slate-700 light:hover:border-slate-400"
                >
                  −
                </button>
                <span className="w-8 text-center text-lg font-semibold text-white light:text-slate-900">{targetPlayerCount}</span>
                <button
                  type="button"
                  onClick={() => changePlayerCount(1)}
                  className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30 light:border-slate-300 light:text-slate-700 light:hover:border-slate-400"
                >
                  +
                </button>
              </div>
            </label>
            <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              모드
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setOptions((o) => ({ ...o, mode: "team" }))} className={optBtn(options.mode === "team" || !ffaOk)}>
                  <b className="block text-sm">🔴🟡 팀전</b>
                  자리 홀짝으로 두 팀
                </button>
                <button type="button" disabled={!ffaOk} onClick={() => setOptions((o) => ({ ...o, mode: "ffa" }))} className={`${optBtn(options.mode === "ffa" && ffaOk)} disabled:opacity-40`}>
                  <b className="block text-sm">🎯 개인전</b>
                  {ffaOk ? "모두 각자 (3~6명)" : "3~6명일 때만"}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              엔드 수
              <div className="grid grid-cols-3 gap-2">
                {([1, 3, 5] as const).map((e) => (
                  <button key={e} type="button" onClick={() => setOptions((o) => ({ ...o, ends: e }))} className={optBtn(options.ends === e)}>
                    <b className="block text-sm">{e}엔드</b>
                    {e === 1 ? "번개 약 4분" : e === 3 ? "기본 약 12분" : "길게 약 20분"}
                  </button>
                ))}
              </div>
            </div>
            {(options.mode === "team" || !ffaOk) && (
              <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
                팀당 스톤 수 (엔드마다)
                <div className="grid grid-cols-3 gap-2">
                  {([4, 6, 8] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        stonesTouchedRef.current = true;
                        setOptions((o) => ({ ...o, stones: n }));
                      }}
                      className={optBtn(options.stones === n)}
                    >
                      <b className="block text-sm">{n}개</b>
                      {n === 4 ? "빠름" : n === 6 ? "보통" : "정식"} · 1인 {perPerson(n)}번
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <button type="button" onClick={() => setOptions((o) => ({ ...o, party: !o.party }))} className={optBtn(options.party)}>
                <b className="block text-sm">🎉 파티 스톤 {options.party ? "ON" : "OFF"}</b>
                💣🐘🍯🌀👻🧲 엔드마다 1개
              </button>
              <button type="button" onClick={() => setOptions((o) => ({ ...o, fgz: !o.fgz }))} className={optBtn(options.fgz)}>
                <b className="block text-sm">🛡️ 프리 가드 존 {options.fgz ? "ON" : "OFF"}</b>
                초반 가드 보호(정식 규칙)
              </button>
              <button type="button" onClick={() => setOptions((o) => ({ ...o, guide: !o.guide }))} className={`${optBtn(options.guide)} col-span-2`}>
                <b className="block text-sm">🔰 초보 도우미 {options.guide ? "ON" : "OFF"}</b>
                힘 모을 때 휘는 길 미리보기 + 지금 점수 나는 스톤에 번호 — 처음 하는 사람이 있으면 켜 두세요(모두에게 똑같이 보여요)
              </button>
            </div>
          </>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 light:bg-rose-50 light:text-rose-700">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500">
            {intent === "create" ? "방 만들기" : "참여하기"}
          </button>
        </div>
      </div>,
    );
  }

  if (phase === "connecting" || phase === "waiting") {
    const opts = normalizeOptions(knownTargetPlayerCount, options);
    return withGuard(
      <>
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center light:border-slate-200 light:bg-white/90 light:shadow-sm">
          {phase === "connecting" ? (
            <p className="text-sm text-white/50 light:text-slate-500">연결하는 중...</p>
          ) : (
            <>
              <p className="text-sm text-white/50 light:text-slate-500">초대 코드</p>
              <p className="text-4xl font-bold tracking-[0.3em] text-white light:text-slate-900">{roomCode}</p>
              <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400">
                🔗 초대 링크 복사
              </button>
              {isHost && (
                <p className="text-xs text-white/50 light:text-slate-500">
                  {opts.mode === "team" ? "팀전" : "개인전"} · {opts.ends}엔드{opts.mode === "team" ? ` · 팀당 ${opts.stones}스톤` : ""} · 파티 스톤 {opts.party ? "ON" : "OFF"} · 프리 가드 존 {opts.fgz ? "ON" : "OFF"} · 초보 도우미 {opts.guide ? "ON" : "OFF"}
                </p>
              )}
              <p className="text-xs text-white/50 light:text-slate-500">
                {occupants.length + botSeats.length} / {knownTargetPlayerCount}명 참여 중
              </p>
              {isHost && occupants.length + botSeats.length < knownTargetPlayerCount && (
                <FillEmptySeatsButton emptyCount={knownTargetPlayerCount - occupants.length - botSeats.length} onFill={fillEmptySeatsWithBots} />
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                {Array.from({ length: knownTargetPlayerCount }, (_, seat) => {
                  const occ = occupants.find((o) => o.seat === seat);
                  const botIdx = botSeats.indexOf(seat);
                  const isBot = botIdx >= 0;
                  const teamMark = opts.mode === "team" || !isHost ? (seat % 2 === 0 ? "🔴" : "🟡") : "";
                  return (
                    <p key={seat} className="flex items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600">
                      <span>
                        {isHost ? teamMark : ""} {seat === mySeat ? "나" : `${seat + 1}번`}:{" "}
                        {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30 light:text-slate-400">대기 중...</span>}
                      </span>
                      {isHost && !occ && <span>{isBot ? <RemoveBotButton onClick={() => removeBotAtSeat(seat)} /> : <AddBotButton onAddWithLevel={(level) => addBotAtSeat(seat, level)} />}</span>}
                    </p>
                  );
                })}
              </div>
              <p className="text-xs text-white/40 light:text-slate-400">{knownTargetPlayerCount}명이 모이면 자동으로 게임이 시작됩니다.</p>
              {isHost && occupants.length + botSeats.length >= MIN_PLAYERS && occupants.length + botSeats.length < knownTargetPlayerCount && (
                <button onClick={() => startNow(occupants.length + botSeats.length)} className="rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500">
                  지금 시작 ({occupants.length + botSeats.length}명)
                </button>
              )}
            </>
          )}
        </div>
        <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="대기실 채팅" />
      </>,
    );
  }

  if (phase === "playing" && gameState && mySeat !== null) {
    const myVoteAsTarget = activeVoteFor(botTakeover, String(mySeat));
    const iAmTakenOver = isSeatTakenOver(botTakeover, String(mySeat));
    const voteToShow = Object.values(botTakeover.votes).find((v) => v.seatKey !== String(mySeat) && `${v.seatKey}:${v.startedAt}` !== dismissedVoteKey);
    return withGuard(
      <>
        {myVoteAsTarget && <BotTakeoverSelfBanner mode="prove-presence" onConfirm={() => proveStillHereOrReclaim(String(mySeat))} />}
        {!myVoteAsTarget && iAmTakenOver && <BotTakeoverSelfBanner mode="reclaim" onConfirm={() => proveStillHereOrReclaim(String(mySeat))} />}
        {voteToShow && (
          <BotTakeoverVoteModal
            targetName={names[Number(voteToShow.seatKey)] ?? voteToShow.originalName}
            reason={voteToShow.reason}
            yesCount={voteToShow.yesVoterDeviceIds.length}
            eligibleVoterCount={eligibleVoterCountFor(voteToShow.seatKey)}
            hasVoted={voteToShow.yesVoterDeviceIds.includes(deviceId)}
            onVoteYes={() => castTakeoverVote(voteToShow.seatKey)}
            onDismiss={() => setDismissedVoteKey(`${voteToShow.seatKey}:${voteToShow.startedAt}`)}
          />
        )}
        {takeoverSeats.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {takeoverSeats.map((seat) => (
              <BotSeatBadge key={seat} variant="takeover" label={botTakeover.takeovers[seat]?.originalName ?? "이탈"} />
            ))}
          </div>
        )}
        <CurlingBoard
          state={gameState}
          viewerSeat={iAmTakenOver ? -1 : mySeat}
          names={names}
          connectedSeats={connectedSeats}
          botSeats={allBotSeatSet}
          canDrive={canDriveBots}
          deadlineMs={deadlineMs}
          nowMs={nowMs}
          live={liveRef}
          liveInfo={liveInfo}
          aim={aimRef}
          myIntensity={myIntensity}
          onThrow={handleThrow}
          onAimLive={handleAimLive}
          onSweep={handleSweep}
          onAction={handleAction}
          onGameEnd={handleGameEnd}
          reactions={reactions}
          onReact={sendReaction}
          onEvent={handleEvent}
          calls={calls.turn === gameState.turn ? Object.values(calls.marks).map((m) => ({ ...m, name: names[m.seat] ?? `${m.seat + 1}번`, bot: allBotSeatSet.has(m.seat) })) : []}
          onCall={sendCall}
          predictions={predictions.turn === gameState.turn ? predictions : EMPTY_PREDICTIONS}
          predictLocked={predictLockTurn === gameState.turn}
          onPredict={sendPrediction}
          seer={seer}
        />
        <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="게임 채팅" />
      </>,
    );
  }

  if (phase === "post-game" && finalResult) {
    return withGuard(
      <>
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center light:border-slate-200 light:bg-white/90 light:shadow-sm">
          <span className="text-4xl">🥌</span>
          <p className="text-white/80 light:text-slate-700">{finalResult.winnerName} 님(편)이 1위로 게임이 끝났어요.</p>
          <div className="flex gap-2">
            <button onClick={handleLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400">
              나가기
            </button>
            <button onClick={sendGameStart} className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500">
              다시하기
            </button>
          </div>
        </div>
        <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="게임 채팅" />
      </>,
    );
  }

  return withGuard(null);
}
