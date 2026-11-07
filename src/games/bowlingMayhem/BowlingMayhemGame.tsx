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
  DEFAULT_OPTIONS,
  FRAME_CHOICES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  startGame,
  type BowlingState,
  type EngineAction,
  type FrameCount,
  type GameOptions,
  type Seat,
} from "./engine";
import { chooseBotAction } from "./bot";
import BowlingBoard from "./BowlingBoard";
import type { LiveAim } from "./aim";
import { MAX_SLOPE } from "./physics";
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
import { bowlingStatDetails } from "./stats";
import { getBowlingSound } from "./bowlingSound";
import { withUniqueNames } from "@/games/shared/room/uniqueNames";
import { DESYNC_DIGEST_EVENT, desyncOnDigest, desyncSkipSyncAnswer, useDesyncGuard } from "@/games/shared/room/useDesyncGuard";
import { IDLE_VOTE_MS } from "@/games/shared/bot/idleThresholds";

/** Idle-vote trigger for this game's tier — see idleThresholds.ts. */
const IDLE_VOTE_THRESHOLD_MS = IDLE_VOTE_MS.quick;

/**
 * Online-room entry point for 볼링 난장판 — the same lockstep room pattern as
 * alkkagi/AlkkagiGame.tsx (shared seed + replayed `EngineAction`s over a
 * Supabase Realtime channel, presence-derived seats, host-chosen lobby bots,
 * vote-based bot takeover, desync guard, room chat). Additions:
 *
 * - "aim" broadcast: the bowler's release spot / direction / hook and the
 *   power meter at ~10 Hz, purely cosmetic (rulebook §11). Only the `roll`
 *   integers affect the game, and every client re-simulates the pinfall
 *   (physics.ts).
 * - Replay pacing: bots wait until this client's replay of the last roll has
 *   finished, and the turn clock (§4) only starts once the pins settle.
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

const GAME_ID = "bowling-mayhem";

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

function sanitizeAim(raw: unknown): LiveAim | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
  const turn = num(r.turn, 0, 1e7);
  const x = num(r.x, -0.6, 0.6);
  const slope = num(r.slope, -MAX_SLOPE, MAX_SLOPE);
  const spin = num(r.spin, -1, 1);
  const power = num(r.power, -1, 1);
  if (turn === null || x === null || slope === null || spin === null || power === null) return null;
  return { turn: Math.round(turn), x, slope, spin, power, at: performance.now(), remote: true };
}

export default function BowlingMayhemGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(2);
  const [frames, setFrames] = useState<FrameCount>(DEFAULT_OPTIONS.frames);
  const [chaos, setChaos] = useState(DEFAULT_OPTIONS.chaos);
  const [itemsOn, setItemsOn] = useState(DEFAULT_OPTIONS.items);
  const [helper, setHelper] = useState(DEFAULT_OPTIONS.helper);
  const optionsRef = useRef<GameOptions>(DEFAULT_OPTIONS);
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<BowlingState | null>(null);
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
  const lastActorRef = useRef<{ actor: Seat | null; since: number }>({ actor: null, since: 0 });

  // The bowler's aim (remote via broadcast, mine via the board) — read by the scene each frame.
  const aimRef = useRef<LiveAim | null>(null);
  const aimSentRef = useRef(0);
  // This client's replay of the last roll is still playing (bots and the turn clock wait).
  const replayBusyRef = useRef(false);

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
  // Host broadcasts a digest of its settled state; a drifted client pulls the host's copy back.
  useDesyncGuard({ channelRef, state: gameState, isHost, active: phase === "playing" });

  // Same "lowest connected seat drives bots" rule as every other online game (see BluffRouletteGame.tsx).
  const canDriveBots = useMemo(() => {
    if (mySeat === null || occupants.length === 0) return false;
    const lowestPresentSeat = Math.min(...occupants.map((o) => o.seat));
    return mySeat === lowestPresentSeat;
  }, [mySeat, occupants]);
  const canDriveRef = useRef(false);
  useEffect(() => {
    canDriveRef.current = canDriveBots;
  }, [canDriveBots]);

  const gameStateRef = useRef<BowlingState | null>(null);
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
    optionsRef.current = { frames, chaos, items: itemsOn, helper };
    getBowlingSound().unlock();
    setMyName(name);
    setMyPlayerId(identity.name.trim() ? identity.playerId : undefined);
    setRoomCode(code);
    setPhase("connecting");
  }

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

    channel.on("broadcast", { event: "aim" }, ({ payload }) => {
      const seat = payload?.seat;
      if (typeof seat !== "number" || seat === mySeatRef.current) return;
      const state = gameStateRef.current;
      if (!state || state.activeSeat !== seat || state.phase !== "aim") return;
      const a = sanitizeAim(payload?.aim);
      if (a && a.turn === state.turn) aimRef.current = a;
    });

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const playerCount = payload?.playerCount as number;
      const roster = (payload?.botSeats as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      const options = (payload?.options as GameOptions | undefined) ?? DEFAULT_OPTIONS;
      playerCountRef.current = playerCount;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      aimRef.current = null;
      setGameState(startGame(playerCount, seed, { ...DEFAULT_OPTIONS, ...options }));
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

    channel.on("broadcast", { event: DESYNC_DIGEST_EVENT }, ({ payload }) => desyncOnDigest(channelRef, payload));
    channel.on("broadcast", { event: "state-request" }, ({ payload }) => {
      if (desyncSkipSyncAnswer(channelRef, payload)) return;
      if (gameStateRef.current) {
        channel.send({
          type: "broadcast",
          event: "state-sync",
          payload: { state: gameStateRef.current, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current, botTakeover: botTakeoverRef.current },
        });
      } else if (isHost) {
        channel.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: botSeatsRef.current, botLevels: botLevelsRef.current } });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const state = payload?.state as BowlingState | undefined;
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
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [roomCode, myName, myPlayerId, isHost]);

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
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: {
        seed: randomSeed(),
        playerCount: playerCountRef.current,
        botSeats: botSeatsRef.current,
        botLevels: botLevelsRef.current,
        options: optionsRef.current,
      },
    });
  }, []);

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

  /** My aim → local scene every frame, broadcast at ~10 Hz. */
  const handleAim = useCallback((a: LiveAim | null) => {
    aimRef.current = a;
    if (!a) return;
    const now = performance.now();
    if (now - aimSentRef.current < 100) return;
    aimSentRef.current = now;
    const { turn, x, slope, spin, power } = a;
    channelRef.current?.send({ type: "broadcast", event: "aim", payload: { seat: mySeatRef.current, aim: { turn, x, slope, spin, power } } });
  }, []);

  const handleBusy = useCallback((busy: boolean) => {
    replayBusyRef.current = busy;
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

  const takeoverSeatKey = Object.keys(botTakeover.takeovers).sort().join(",");
  const takeoverSeats = useMemo(() => (takeoverSeatKey ? (takeoverSeatKey.split(",").map(Number) as Seat[]) : []), [takeoverSeatKey]);
  const allBotSeatSet = useMemo(() => new Set([...botSeatSet, ...takeoverSeats]), [botSeatSet, takeoverSeats]);

  // Bots wait for this client's replay of the last roll, then line up a moment before bowling.
  const chooseAction = useCallback(async (state: BowlingState, actor: Seat): Promise<EngineAction | null> => {
    for (let i = 0; i < 48 && replayBusyRef.current; i++) await new Promise((r) => setTimeout(r, 250));
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 900));
    if (gameStateRef.current !== state) return null;
    const idx = botSeatsRef.current.indexOf(actor);
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return chooseBotAction(state, actor, level);
  }, []);

  useBotAutoplay<BowlingState, EngineAction, Seat>({
    active: canDriveBots && phase === "playing",
    state: gameState,
    currentActor,
    botSeats: allBotSeatSet,
    chooseAction,
    dispatch: handleAction,
    minDelayMs: 900,
    maxDelayMs: 1600,
    watchdogMs: 18000,
  });

  const allBotSeatsRef = useRef<Set<Seat>>(new Set());
  useEffect(() => {
    allBotSeatsRef.current = allBotSeatSet;
  }, [allBotSeatSet]);

  // Turn timer (§10) + idle takeover trigger, one interval.
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
      // the clock starts once the pins have settled (a replay takes several seconds)
      if (!seen || seen.turn !== state.turn || replayBusyRef.current) {
        const next = { turn: state.turn, at: now };
        turnSeenRef.current = next;
        setTurnSeen(next);
      } else if (canDriveRef.current && state.phase === "aim" && !allBotSeatsRef.current.has(state.activeSeat)) {
        if (now - seen.at >= AIM_TIMEOUT_MS + 800 && timeoutSentRef.current !== state.turn) {
          timeoutSentRef.current = state.turn;
          handleAction({ type: "timeout", seat: state.activeSeat, turn: state.turn });
        }
      }

      const actor = currentActor(state);
      if (actor !== lastActorRef.current.actor || replayBusyRef.current) {
        lastActorRef.current = { actor, since: now };
        return;
      }
      if (actor === null || botSeatsRef.current.includes(actor)) return;
      const seatKey = String(actor);
      if (activeVoteFor(botTakeoverRef.current, seatKey) || isSeatTakenOver(botTakeoverRef.current, seatKey)) return;
      if (now - lastActorRef.current.since < IDLE_VOTE_THRESHOLD_MS) return;
      const occ = occupantsRef.current.find((o) => o.seat === actor);
      channelRef.current?.send({
        type: "broadcast",
        event: "bot-takeover-event",
        payload: {
          event: {
            type: "vote-start",
            seatKey,
            reason: "idle",
            startedAt: now,
            originalUserId: occ?.playerId ?? `${roomCode}:${actor}`,
            originalName: occ?.name ?? namesRef.current[actor] ?? "상대",
          },
        },
      });
    }, 250);
    return () => window.clearInterval(interval);
  }, [phase, roomCode, handleAction]);

  const deadlineMs = gameState && turnSeen && turnSeen.turn === gameState.turn && gameState.phase === "aim" && !allBotSeatSet.has(gameState.activeSeat) ? turnSeen.at + AIM_TIMEOUT_MS : null;

  function castTakeoverVote(seatKey: string) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey, voterDeviceId: deviceId } } });
  }
  function proveStillHereOrReclaim(seatKey: string) {
    const type = isSeatTakenOver(botTakeover, seatKey) ? "reclaim" : "vote-cancel";
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type, seatKey } } });
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
      self: selfResult(mySeat, rankings, { takeovers: botTakeover.takeovers, botSeats, botLevels }, (seat) => bowlingStatDetails(gameState, seat)),
      finishedAt: new Date().toISOString(),
    });
    setFinalResult({ winnerName: names[winner.seat] });
    setPhase("post-game");
  }

  function handleLeave() {
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

  if (phase === "supabase-missing") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 text-center light:border-amber-400 light:bg-amber-50">
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80 light:text-amber-800">볼링 난장판은 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다(README 참고).</p>
      </div>,
    );
  }

  if (phase === "room-full") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center light:border-rose-400 light:bg-rose-50">
        <span className="text-3xl">🚫</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">이미 다른 사람이 참여 중인 방이에요</h2>
        <p className="text-sm text-rose-100/80 light:text-rose-800">코드를 다시 확인하거나 새로운 방을 만들어보세요.</p>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-fuchsia-600 px-5 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500">
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
        <button onClick={handleLeave} className="mt-2 rounded-full bg-fuchsia-600 px-5 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500">
          다시 시도
        </button>
      </div>,
    );
  }

  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId={GAME_ID}
        icon="🎳"
        title="볼링 난장판 온라인 대전"
        description={
          <p className="text-sm text-white/50 light:text-slate-500">
            {MIN_PLAYERS}~{MAX_PLAYERS}명이 각자 기기로 접속해 같은 3D 레인에서 차례로 볼링을 쳐요. 프레임마다 바뀌는 난장판 레인 + 상대 레인에 고깔·기름·선풍기! 혼자 연습도 되고, 빈자리는 봇이 채워요.
          </p>
        }
        actions={
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => {
                setIntent("create");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl bg-fuchsia-600 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
            >
              🎳 방 만들기
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

  if (phase === "enter-name") {
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 light:border-slate-200 light:bg-white/90 light:shadow-sm">
        <h2 className="text-base font-bold text-white light:text-slate-900">{intent === "create" ? "방 만들기" : "초대 코드로 참여"}</h2>
        <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} onEnter={enterRoom} accent="fuchsia" />
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-fuchsia-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400 light:focus:border-fuchsia-500"
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
                  onClick={() => setTargetPlayerCount((n) => Math.max(MIN_PLAYERS, n - 1))}
                  className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30 light:border-slate-300 light:text-slate-700 light:hover:border-slate-400"
                >
                  −
                </button>
                <span className="w-8 text-center text-lg font-semibold text-white light:text-slate-900">{targetPlayerCount}</span>
                <button
                  type="button"
                  onClick={() => setTargetPlayerCount((n) => Math.min(MAX_PLAYERS, n + 1))}
                  className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30 light:border-slate-300 light:text-slate-700 light:hover:border-slate-400"
                >
                  +
                </button>
              </div>
            </label>
            <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              프레임 수
              <div className="grid grid-cols-3 gap-2">
                {FRAME_CHOICES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrames(f)}
                    aria-pressed={frames === f}
                    className={`rounded-xl border px-2 py-2 text-xs ${frames === f ? "border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-100 light:text-fuchsia-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
                  >
                    <b className="block text-sm">{f === 3 ? "⚡ 3프레임" : f === 5 ? "🎳 5프레임" : "🏆 10프레임"}</b>
                    {f === 3 ? "후다닥 (1인 약 2분)" : f === 5 ? "기본 (1인 약 3분)" : "정식 300점 만점"}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setChaos((v) => !v)}
              aria-pressed={chaos}
              className={`rounded-xl border px-3 py-2 text-left text-xs ${chaos ? "border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-100 light:text-fuchsia-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              <b className="block text-sm">{chaos ? "🎲 난장판 레인 켜짐" : "🎲 난장판 레인 꺼짐"}</b>
              {chaos ? "2프레임부터 얼음·범퍼·거인 핀·옆바람… 프레임마다 레인이 바뀌어요" : "정통 볼링 레인만"}
            </button>
            <button
              type="button"
              onClick={() => setItemsOn((v) => !v)}
              aria-pressed={itemsOn}
              className={`rounded-xl border px-3 py-2 text-left text-xs ${itemsOn ? "border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-100 light:text-fuchsia-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              <b className="block text-sm">{itemsOn ? "🎒 방해 아이템 켜짐" : "🎒 방해 아이템 꺼짐"}</b>
              {itemsOn ? "🚧 고깔 · 🛢️ 기름 · 🌬️ 선풍기로 상대 레인 방해, 🍀 범퍼로 내 레인 보호 — 꼴찌는 아이템을 더 받아요" : "아이템 없이 실력으로만"}
            </button>
            <button
              type="button"
              onClick={() => setHelper((v) => !v)}
              aria-pressed={helper}
              className={`rounded-xl border px-3 py-2 text-left text-xs ${helper ? "border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-100 light:text-fuchsia-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-600"}`}
            >
              <b className="block text-sm">{helper ? "🔰 초보 도우미 켜짐" : "🔰 초보 도우미 꺼짐"}</b>
              {helper ? "조준할 때 공이 휘어 갈 길 전체를 미리 보여줘요" : "끄면 화살표까지만 — 훅은 감으로!"}
            </button>
          </>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 light:bg-rose-50 light:text-rose-700">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-fuchsia-600 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500">
            {intent === "create" ? "방 만들기" : "참여하기"}
          </button>
        </div>
      </div>,
    );
  }

  if (phase === "connecting" || phase === "waiting") {
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
                  return (
                    <p key={seat} className="flex items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600">
                      <span>
                        {seat === mySeat ? "나" : `${seat + 1}번`}:{" "}
                        {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30 light:text-slate-400">대기 중...</span>}
                      </span>
                      {isHost && !occ && <span>{isBot ? <RemoveBotButton onClick={() => removeBotAtSeat(seat)} /> : <AddBotButton onAddWithLevel={(level) => addBotAtSeat(seat, level)} />}</span>}
                    </p>
                  );
                })}
              </div>
              <p className="text-xs text-white/40 light:text-slate-400">{knownTargetPlayerCount}명이 모이면 자동으로 게임이 시작됩니다.</p>
              {isHost && occupants.length + botSeats.length >= MIN_PLAYERS && occupants.length + botSeats.length < knownTargetPlayerCount && (
                <button onClick={sendGameStart} className="rounded-full bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white hover:bg-fuchsia-500">
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
        <BowlingBoard
          state={gameState}
          viewerSeat={iAmTakenOver ? -1 : mySeat}
          names={names}
          connectedSeats={connectedSeats}
          botSeats={allBotSeatSet}
          deadlineMs={deadlineMs}
          nowMs={nowMs}
          aim={aimRef}
          onAim={handleAim}
          onAction={handleAction}
          onGameEnd={handleGameEnd}
          onBusy={handleBusy}
        />
        <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="게임 채팅" />
      </>,
    );
  }

  if (phase === "post-game" && finalResult) {
    return withGuard(
      <>
        <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center light:border-slate-200 light:bg-white/90 light:shadow-sm">
          <span className="text-4xl">🎳</span>
          <p className="text-white/80 light:text-slate-700">{finalResult.winnerName} 님이 1위로 게임이 끝났어요.</p>
          <div className="flex gap-2">
            <button onClick={handleLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400">
              나가기
            </button>
            <button onClick={sendGameStart} className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500">
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
