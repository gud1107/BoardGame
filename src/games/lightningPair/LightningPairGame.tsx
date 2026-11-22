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
import { BotTakeoverSelfBanner, BotTakeoverVoteModal } from "@/components/lobby/BotTakeoverVoteModal";
import { AddBotButton, BotSeatBadge, FillEmptySeatsButton, RemoveBotButton } from "@/components/lobby/BotSeatControls";
import RulebookGate from "@/components/lobby/RulebookGate";
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
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
import { selfResult } from "@/games/shared/selfResult";
import { seededRng } from "@/lib/rng";
import { applyAction, avgRt, createGame, isFinished, score, tick, type PairAction, type PairState, type SeatIndex } from "./engine";
import { IDLE_MS, MAX_PLAYERS, MIN_PLAYERS, MODE_INFO, SEAT_COLORS, SEAT_SYMBOLS, type Mode } from "./data";
import { createBotMemory, runBots } from "./bots";
import LightningPairBoard from "./LightningPairBoard";
import RulebookModal from "./RulebookModal";
import { getLightningPairSound } from "./lightningPairSound";
import { lightningPairDetails } from "./stats";
import { withUniqueNames } from "@/games/shared/room/uniqueNames";
import { DESYNC_DIGEST_EVENT, desyncOnDigest, desyncSkipSyncAnswer, useDesyncGuard } from "@/games/shared/room/useDesyncGuard";

/**
 * 번개 짝꿍 online room (정오의 발도 방 구조를 옮겨 옴). Host-authoritative realtime (see engine.ts): the
 * host runs `tick` every HOST_TICK_MS, applies every client's claim the moment it arrives (each claim
 * carries the reaction time the client measured itself), drives lobby/takeover bots, and broadcasts the
 * snapshot on every change plus a heartbeat. Clients estimate the host clock from `hostNow` for display only.
 *
 * Room lifecycle (create/join, seats, `?room=`, presence, reconnect via
 * state-request/state-sync, bot roster, bot-takeover vote) follows the same
 * protocol as worm/doodle-phone.
 *
 * Known limitation shared with worm: if the host's tab closes mid-game the
 * game stops for everyone (no host migration).
 */

const GAME_ID = "lightning-pair";
const HOST_TICK_MS = 20;
const HEARTBEAT_MS = 1000;

type Occupant = {
  deviceId: string;
  seat: SeatIndex;
  name: string;
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
};

type Phase = "choose" | "enter-name" | "connecting" | "waiting" | "playing" | "room-full" | "supabase-missing" | "channel-error";

interface RoomOptions {
  mode: Mode;
}

/** Quick-start bot difficulty presets shown on the choose screen. */
const SOLO_PRESETS: { label: string; level: BotLevel }[] = [
  { label: "쉬움", level: 3 },
  { label: "보통", level: 6 },
  { label: "어려움", level: 9 },
];

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredSeat(code: string): number | null {
  const v = window.localStorage.getItem(`lightning-pair-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`lightning-pair-seat-${code}`, String(seat));
}

function isPairAction(a: unknown): a is PairAction {
  return !!a && typeof a === "object" && typeof (a as { type?: unknown }).type === "string";
}

export default function LightningPairGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(4);
  const [soloLevel, setSoloLevel] = useState<BotLevel | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<PairState | null>(null);
  const [options, setOptions] = useState<RoomOptions>({ mode: "grab" });
  const optionsRef = useRef<RoomOptions>(options);
  const [lobbyRulebook, setLobbyRulebook] = useState(false);

  const [botSeats, setBotSeats] = useState<SeatIndex[]>([]);
  const [botLevels, setBotLevels] = useState<BotLevel[]>([]);
  const botSeatsRef = useRef<SeatIndex[]>([]);
  const botLevelsRef = useRef<BotLevel[]>([]);
  const setRoster = useCallback((seats: SeatIndex[], levels: BotLevel[]) => {
    botSeatsRef.current = seats;
    botLevelsRef.current = levels;
    setBotSeats(seats);
    setBotLevels(levels);
  }, []);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const isHost = intent === "create";
  // Host broadcasts a digest of its settled state; a drifted client pulls the host's copy back.
  useDesyncGuard({ channelRef, state: gameState, isHost, active: phase === "playing" });
  const startSentRef = useRef(false);
  const playerCountRef = useRef(targetPlayerCount);
  const soloStartRef = useRef<BotLevel | null>(null);

  const gameStateRef = useRef<PairState | null>(null);
  /** 방장 시계 − 내 시계 (표시용) */
  const [clockOffset, setClockOffset] = useState(0);
  const clockOffsetRef = useRef(0);
  useEffect(() => {
    clockOffsetRef.current = clockOffset;
  }, [clockOffset]);
  const phaseRef = useRef<Phase>(phase);
  const occupantsRef = useRef<Occupant[]>([]);
  const mySeatRef = useRef<SeatIndex | null>(null);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);
  useEffect(() => {
    mySeatRef.current = mySeat;
  }, [mySeat]);

  const [botTakeover, setBotTakeover] = useState<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  const botTakeoverRef = useRef<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  function applyBotTakeoverEvent(event: BotTakeoverEvent) {
    const next = reduceBotTakeover(botTakeoverRef.current, event);
    botTakeoverRef.current = next;
    setBotTakeover(next);
  }
  const [dismissedVoteKey, setDismissedVoteKey] = useState<string | null>(null);
  const lastSeenAtRef = useRef<Record<number, number>>({});

  // Host-only bookkeeping.
  const botMemoryRef = useRef(createBotMemory());
  const lastBroadcastRef = useRef(0);
  const completedMatchRef = useRef<string | null>(null);
  const matchIdRef = useRef<string>("");

  function requestStateSync() {
    const channel = channelRef.current;
    if (!channel) return;
    if (channel.state !== "joined") channel.subscribe();
    channel.send({ type: "broadcast", event: "state-request", payload: {} });
  }

  /** Host: commit a new state locally and broadcast it. */
  const commitHostState = useCallback((next: PairState) => {
    gameStateRef.current = next;
    setGameState(next);
    lastBroadcastRef.current = Date.now();
    channelRef.current?.send({ type: "broadcast", event: "state", payload: { state: next, hostNow: Date.now(), matchId: matchIdRef.current } });
  }, []);

  /** Host: apply one action now. */
  const hostApply = useCallback(
    (action: PairAction) => {
      const cur = gameStateRef.current;
      if (!cur) return;
      const next = applyAction(cur, action, Date.now());
      if (next !== cur) commitHostState(next);
    },
    [commitHostState],
  );

  function enterRoom(solo: BotLevel | null = soloLevel) {
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
    soloStartRef.current = intent === "create" ? solo : null;
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
    const channel = supabase.channel(`lightning-pair-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const playerCount = payload?.playerCount as number;
      const mode: Mode = payload?.mode === "dump" ? "dump" : "grab";
      matchIdRef.current = String(payload?.matchId ?? seed);
      setRoster((payload?.botSeats as SeatIndex[] | undefined) ?? [], (payload?.botLevels as BotLevel[] | undefined) ?? []);
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      botMemoryRef.current = createBotMemory();
      lastSeenAtRef.current = {};
      // 덱은 seed로 모두가 똑같이 만든다 (숨길 정보 없음).
      const state = createGame({ playerCount, mode, seed, now: Date.now(), rng: seededRng(seed) });
      gameStateRef.current = state;
      setGameState(state);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "state" }, ({ payload }) => {
      if (isHost) return;
      const state = payload?.state as PairState | undefined;
      if (!state) return;
      if (payload?.matchId) matchIdRef.current = String(payload.matchId);
      if (typeof payload?.hostNow === "number") setClockOffset(Math.round((payload.hostNow - Date.now()) / 50) * 50);
      gameStateRef.current = state;
      setGameState(state);
      if (phaseRef.current !== "playing") setPhase("playing");
    });

    channel.on("broadcast", { event: "action" }, ({ payload }) => {
      const action = payload?.action;
      if (typeof payload?.seat === "number") lastSeenAtRef.current[payload.seat as number] = Date.now();
      if (!isHost || !isPairAction(action)) return;
      hostApply(action);
    });

    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      setRoster((payload?.botSeats as SeatIndex[] | undefined) ?? [], (payload?.botLevels as BotLevel[] | undefined) ?? []);
    });

    channel.on("broadcast", { event: "room-options" }, ({ payload }) => {
      const next: RoomOptions = { mode: payload?.options?.mode === "dump" ? "dump" : "grab" };
      optionsRef.current = next;
      setOptions(next);
    });

    channel.on("broadcast", { event: "bot-takeover-event" }, ({ payload }) => {
      const event = payload?.event as BotTakeoverEvent | undefined;
      if (!event) return;
      applyBotTakeoverEvent(event);
      if (event.type !== "vote-cast") return;
      const vote = botTakeoverRef.current.votes[event.seatKey];
      if (!vote) return;
      const takenOverSeats = new Set(Object.keys(botTakeoverRef.current.takeovers).map(Number));
      const eligible = occupantsRef.current.filter(
        (o) => o.seat !== Number(event.seatKey) && !botSeatsRef.current.includes(o.seat) && !takenOverSeats.has(o.seat),
      ).length;
      if (voteThresholdMet(voteYesCount(botTakeoverRef.current, event.seatKey), eligible)) {
        channel.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "convert", seatKey: event.seatKey, at: Date.now() } } });
      }
    });

    channel.on("broadcast", { event: DESYNC_DIGEST_EVENT }, ({ payload }) => desyncOnDigest(channelRef, payload));
    channel.on("broadcast", { event: "state-request" }, ({ payload }) => {
      if (desyncSkipSyncAnswer(channelRef, payload)) return;
      if (!isHost) {
        // Lobby-stage roster/options still come from the host only.
        return;
      }
      channel.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: botSeatsRef.current, botLevels: botLevelsRef.current } });
      channel.send({ type: "broadcast", event: "room-options", payload: { options: optionsRef.current } });
      if (gameStateRef.current) {
        channel.send({
          type: "broadcast",
          event: "state-sync",
          payload: { state: gameStateRef.current, hostNow: Date.now(), matchId: matchIdRef.current, botTakeover: botTakeoverRef.current, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current },
        });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      if (isHost) return;
      const state = payload?.state as PairState | undefined;
      if (!state) return;
      const takeover = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
      botTakeoverRef.current = takeover;
      setBotTakeover(takeover);
      setRoster((payload?.botSeats as SeatIndex[] | undefined) ?? [], (payload?.botLevels as BotLevel[] | undefined) ?? []);
      if (payload?.matchId) matchIdRef.current = String(payload.matchId);
      if (typeof payload?.hostNow === "number") setClockOffset(Math.round((payload.hostNow - Date.now()) / 50) * 50);
      gameStateRef.current = state;
      setGameState(state);
      setPhase("playing");
    });

    channel.on("presence", { event: "leave" }, ({ leftPresences }) => {
      if (phaseRef.current !== "playing" || !gameStateRef.current || isFinished(gameStateRef.current)) return;
      for (const p of leftPresences as unknown as Occupant[]) {
        const seatKey = String(p.seat);
        if (activeVoteFor(botTakeoverRef.current, seatKey) || isSeatTakenOver(botTakeoverRef.current, seatKey)) continue;
        channel.send({
          type: "broadcast",
          event: "bot-takeover-event",
          payload: {
            event: { type: "vote-start", seatKey, reason: "disconnected", startedAt: Date.now(), originalUserId: p.playerId ?? `${roomCode}:${p.seat}`, originalName: p.name },
          },
        });
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- channel lifetime is the room, like every other online game
  }, [roomCode, myName, myPlayerId, isHost]);

  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";
  const host = occupants.find((o) => o.isHost);
  const knownTargetPlayerCount = host?.targetPlayerCount ?? targetPlayerCount;
  const reclaimAttemptsRef = useRef(0);

  // Seat self-healing (two devices grabbed the same seat) — same as worm.
  useEffect(() => {
    if (mySeat === null || !roomCode || phase === "playing" || phase === "room-full") return;
    const conflicting = occupants.filter((o) => o.seat === mySeat && o.deviceId !== deviceId);
    if (conflicting.length === 0) {
      reclaimAttemptsRef.current = 0;
      return;
    }
    if (!conflicting.some((o) => o.deviceId < deviceId)) return;
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

  // ------------------------------------------------------------- lobby
  const broadcastRoster = useCallback(
    (seats: SeatIndex[], levels: BotLevel[]) => {
      setRoster(seats, levels);
      channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: seats, botLevels: levels } });
    },
    [setRoster],
  );

  const sendGameStart = useCallback(() => {
    startSentRef.current = true;
    const filled = occupantsRef.current.length + botSeatsRef.current.length;
    const playerCount = Math.max(MIN_PLAYERS, Math.min(playerCountRef.current, filled));
    const seed = Math.floor(Math.random() * 2 ** 31);
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: { seed, playerCount, mode: optionsRef.current.mode, matchId: `${seed}-${Date.now()}`, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current },
    });
  }, []);

  function updateOptions(next: RoomOptions) {
    if (!isHost) return;
    optionsRef.current = next;
    setOptions(next);
    channelRef.current?.send({ type: "broadcast", event: "room-options", payload: { options: next } });
  }

  function addBotAtSeat(seat: SeatIndex, level: BotLevel) {
    if (!isHost || botSeatsRef.current.includes(seat) || occupants.some((o) => o.seat === seat)) return;
    broadcastRoster([...botSeatsRef.current, seat], [...botLevelsRef.current, level]);
  }

  function fillEmptySeatsWithBots(level: BotLevel) {
    if (!isHost) return;
    const taken = new Set<SeatIndex>([...occupants.map((o) => o.seat), ...botSeatsRef.current]);
    const empty = Array.from({ length: knownTargetPlayerCount }, (_, s) => s).filter((s) => !taken.has(s));
    if (empty.length === 0) return;
    broadcastRoster([...botSeatsRef.current, ...empty], [...botLevelsRef.current, ...empty.map(() => level)]);
  }

  function removeBotAtSeat(seat: SeatIndex) {
    const idx = botSeatsRef.current.indexOf(seat);
    if (!isHost || idx < 0) return;
    broadcastRoster(
      botSeatsRef.current.filter((_, i) => i !== idx),
      botLevelsRef.current.filter((_, i) => i !== idx),
    );
  }

  // A human who takes a seat a bot was holding wins it (render-time, like
  // doodle-phone; the corrected roster rides along in game-start).
  if (isHost && botSeats.length > 0 && phase === "waiting") {
    const humanSeats = new Set(occupants.map((o) => o.seat));
    const keep = botSeats.map((s, i) => (humanSeats.has(s) ? -1 : i)).filter((i) => i !== -1);
    if (keep.length !== botSeats.length) {
      setBotSeats(keep.map((i) => botSeats[i]));
      setBotLevels(keep.map((i) => botLevels[i]));
    }
  }
  useEffect(() => {
    botSeatsRef.current = botSeats;
    botLevelsRef.current = botLevels;
  }, [botSeats, botLevels]);

  // Solo quick start: fill every other seat with bots once we're in.
  useEffect(() => {
    if (!isHost || phase !== "waiting" || mySeat === null || soloStartRef.current === null) return;
    const level = soloStartRef.current;
    soloStartRef.current = null;
    const seats = Array.from({ length: playerCountRef.current }, (_, s) => s).filter((s) => s !== mySeat);
    broadcastRoster(seats, seats.map(() => level));
  }, [isHost, phase, mySeat, broadcastRoster]);

  // Auto start once every seat is a human or a bot.
  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current || mySeat === null) return;
    if (occupants.length + botSeats.length >= knownTargetPlayerCount) sendGameStart();
  }, [occupants, botSeats, phase, knownTargetPlayerCount, isHost, mySeat, sendGameStart]);

  // ------------------------------------------------------------- host loop
  useEffect(() => {
    if (!isHost || phase !== "playing") return;
    const id = window.setInterval(() => {
      const cur = gameStateRef.current;
      if (!cur) return;
      const now = Date.now();
      let next = tick(cur, now);

      // Lobby bots + takeover bots (a seat whose human left plays as Lv.7).
      const takeovers = botTakeoverRef.current.takeovers;
      const bots = new Map<SeatIndex, number>();
      botSeatsRef.current.forEach((seat, i) => bots.set(seat, botLevelsRef.current[i] ?? DEFAULT_BOT_LEVEL));
      for (const key of Object.keys(takeovers)) bots.set(Number(key), DEFAULT_BOT_LEVEL + 2);

      for (const action of runBots(next, now, bots, botMemoryRef.current, Math.random)) next = applyAction(next, action, now);

      if (next !== cur || now - lastBroadcastRef.current >= HEARTBEAT_MS) commitHostState(next);
    }, HOST_TICK_MS);
    return () => window.clearInterval(id);
  }, [isHost, phase, commitHostState]);

  // Idle trigger: a human seat that pressed nothing for IDLE_MS gets a takeover vote (cards don't wait).
  useEffect(() => {
    if (phase !== "playing" || !roomCode) return;
    const id = window.setInterval(() => {
      const s = gameStateRef.current;
      if (!s || isFinished(s) || s.phase === "intro") return;
      const hostNow = Date.now() + (isHost ? 0 : clockOffsetRef.current);
      for (const occ of occupantsRef.current) {
        if (occ.seat >= s.playerCount || botSeatsRef.current.includes(occ.seat)) continue;
        const seatKey = String(occ.seat);
        if (activeVoteFor(botTakeoverRef.current, seatKey) || isSeatTakenOver(botTakeoverRef.current, seatKey)) continue;
        if (hostNow - s.lastActAt[occ.seat] < IDLE_MS) continue;
        channelRef.current?.send({
          type: "broadcast",
          event: "bot-takeover-event",
          payload: { event: { type: "vote-start", seatKey, reason: "idle", startedAt: Date.now(), originalUserId: occ.playerId ?? `${roomCode}:${occ.seat}`, originalName: occ.name } },
        });
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [phase, roomCode, isHost]);

  const sendAction = useCallback(
    (action: PairAction) => {
      const seat = mySeatRef.current;
      if (isHost) {
        if (seat !== null) lastSeenAtRef.current[seat] = Date.now();
        hostApply(action);
      } else {
        channelRef.current?.send({ type: "broadcast", event: "action", payload: { action, seat } });
      }
    },
    [isHost, hostApply],
  );

  // ------------------------------------------------------------- names
  const takeoverSeatKey = Object.keys(botTakeover.takeovers).sort().join(",");
  const takeoverSeats = useMemo(() => (takeoverSeatKey ? takeoverSeatKey.split(",").map(Number) : []), [takeoverSeatKey]);
  const botSeatSet = useMemo(() => new Set([...botSeats, ...takeoverSeats]), [botSeats, takeoverSeats]);

  const playerCount = gameState?.playerCount ?? knownTargetPlayerCount;
  const names = useMemo(() => {
    const list: string[] = [];
    for (let seat = 0; seat < playerCount; seat++) {
      const takeover = botTakeover.takeovers[seat];
      const botIdx = botSeats.indexOf(seat);
      const occ = occupants.find((o) => o.seat === seat);
      if (takeover) list.push(`🤖 AI ${takeover.originalName}`);
      else if (botIdx >= 0) list.push(botDisplayName(botIdx, botLevels[botIdx]));
      else list.push(seat === mySeat ? myName : (occ?.name ?? `${seat + 1}번`));
    }
    return list;
  }, [playerCount, botTakeover, botSeats, botLevels, occupants, mySeat, myName]);

  const ids = useMemo(() => {
    const list: string[] = [];
    for (let seat = 0; seat < playerCount; seat++) {
      const occ = occupants.find((o) => o.seat === seat);
      list.push(botTakeover.takeovers[seat]?.originalUserId ?? occ?.playerId ?? `${roomCode}:${seat}`);
    }
    return list;
  }, [playerCount, occupants, botTakeover, roomCode]);

  // ------------------------------------------------------------- completion
  useEffect(() => {
    if (!gameState || !isFinished(gameState) || mySeat === null || !gameState.ranking) return;
    const key = matchIdRef.current;
    if (completedMatchRef.current === key) return;
    completedMatchRef.current = key;
    const ranking = gameState.ranking;
    getLightningPairSound().play(ranking[0] === mySeat ? "victory" : "defeat");
    const rankings = ranking.map((seat, i) => ({ seat, rank: i + 1 }));
    onComplete({
      rankings: rankings.map((r) => ({ playerId: ids[r.seat], rank: r.rank })),
      self: selfResult(mySeat, rankings, { takeovers: botTakeover.takeovers, botSeats, botLevels }, (seat, rank) => lightningPairDetails(gameState, seat, rank)),
      finishedAt: new Date().toISOString(),
    });
  }, [gameState, mySeat, ids, botTakeover, botSeats, botLevels, onComplete]);

  // ------------------------------------------------------------- leave
  function handleLeave() {
    if (channelRef.current) {
      getSupabase()?.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    window.history.replaceState(null, "", window.location.pathname);
    setRoomCode(null);
    setMySeat(null);
    setOccupants([]);
    gameStateRef.current = null;
    setGameState(null);
    setRoster([], []);
    botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
    setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
    setIdentity({ name: "" });
    setMyPlayerId(undefined);
    setCodeInput("");
    setSoloLevel(null);
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
    isPlaying: phase === "playing" && !!gameState && !isFinished(gameState),
    unlisted: botSeats.length > 0 && occupants.length <= 1 && botSeats.length + occupants.length >= knownTargetPlayerCount,
    hostName: myName,
    playerCount: occupants.length + botSeats.length,
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

  const panel = "flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 light:border-slate-200 light:bg-white light:shadow-sm";
  const primaryBtn = "rounded-xl bg-yellow-400 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-yellow-300";
  const ghostBtn = "rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400";

  if (phase === "supabase-missing" || phase === "room-full" || phase === "channel-error") {
    const copy = {
      "supabase-missing": ["⚠️", "온라인 대전을 사용할 수 없어요", "Supabase 설정(.env.local)이 필요합니다 (README 참고)."],
      "room-full": ["🚫", "이미 자리가 다 찬 방이에요", "코드를 다시 확인하거나 새로운 방을 만들어보세요."],
      "channel-error": ["📡", "연결에 실패했습니다", "잠시 후 다시 시도해 주세요."],
    }[phase];
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center light:border-rose-300 light:bg-rose-50">
        <span className="text-3xl">{copy[0]}</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">{copy[1]}</h2>
        <p className="text-sm text-rose-100/80 light:text-rose-700">{copy[2]}</p>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-indigo-500 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-400">
          처음으로
        </button>
      </div>,
    );
  }

  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId={GAME_ID}
        icon="⚡"
        title="번개 짝꿍 — 두 카드의 같은 그림을 먼저!"
        description={
          <p className="text-sm text-white/50 light:text-slate-500">
            {MIN_PLAYERS}~{MAX_PLAYERS}명. 어떤 두 카드든 같은 그림이 딱 하나 — 내 카드와 가운데 카드에 똑같이 있는 그림을 먼저 누르세요! 틀리면 ❄️ 얼음. ⚡ 쟁탈전 · 🎯 떨이전.
          </p>
        }
        actions={
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => {
                setIntent("create");
                setSoloLevel(null);
                setPhase("enter-name");
              }}
              className="w-full rounded-xl bg-yellow-400 py-3 text-sm font-semibold text-slate-900 transition hover:bg-yellow-300"
            >
              ⚡ 방 만들기
            </button>
            <button
              onClick={() => {
                setIntent("join");
                trackGameEvent(GAME_ID, "invite_click");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl border border-white/15 py-3 text-sm font-semibold text-white/80 transition hover:border-white/30 light:border-slate-300 light:text-slate-700"
            >
              🔑 초대 코드로 참여
            </button>
            <div className="mt-1 flex flex-col gap-1.5 rounded-xl border border-sky-400/20 bg-sky-400/5 p-2.5">
              <p className="text-xs font-semibold text-sky-200 light:text-sky-700">🤖 봇과 바로 하기</p>
              <div className="flex gap-1.5">
                {SOLO_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => {
                      setIntent("create");
                      setSoloLevel(p.level);
                      setPhase("enter-name");
                    }}
                    className="flex-1 rounded-lg border border-sky-400/30 py-1.5 text-xs text-sky-100 transition hover:bg-sky-400/10 light:text-sky-800"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        }
      />,
    );
  }

  if (phase === "enter-name") {
    return withGuard(
      <div className={panel}>
        <h2 className="text-base font-bold text-white light:text-slate-900">
          {intent === "join" ? "초대 코드로 참여" : soloLevel !== null ? `🤖 봇과 바로 하기 (${SOLO_PRESETS.find((p) => p.level === soloLevel)?.label})` : "방 만들기"}
        </h2>
        <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} onEnter={() => enterRoom()} accent="amber" />
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-indigo-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900"
            />
          </label>
        )}
        {intent === "create" && (
          <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
            인원 수 ({MIN_PLAYERS}~{MAX_PLAYERS}명{soloLevel !== null ? ", 나 빼고 전부 봇" : ""})
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setTargetPlayerCount((n) => Math.max(MIN_PLAYERS, n - 1))} className="h-8 w-8 rounded-full border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700">
                −
              </button>
              <span className="w-8 text-center text-lg font-semibold text-white light:text-slate-900">{targetPlayerCount}</span>
              <button type="button" onClick={() => setTargetPlayerCount((n) => Math.min(MAX_PLAYERS, n + 1))} className="h-8 w-8 rounded-full border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700">
                +
              </button>
            </div>
          </div>
        )}
        {intent === "create" && (
          <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
            규칙
            <div className="flex gap-1.5">
              {(["grab", "dump"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    optionsRef.current = { mode: m };
                    setOptions({ mode: m });
                  }}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${options.mode === m ? "border-yellow-400 bg-yellow-400/20 text-yellow-100 light:text-yellow-800" : "border-white/15 light:border-slate-300"}`}
                >
                  {MODE_INFO[m].emoji} {MODE_INFO[m].label}
                </button>
              ))}
            </div>
            <p className="text-xs text-white/40 light:text-slate-400">{MODE_INFO[options.mode].short}</p>
          </div>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 light:bg-rose-50 light:text-rose-700">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className={`flex-1 ${ghostBtn}`}>
            뒤로
          </button>
          <button onClick={() => enterRoom()} className={`flex-1 ${primaryBtn}`}>
            {intent === "join" ? "참여하기" : soloLevel !== null ? "바로 시작" : "방 만들기"}
          </button>
        </div>
      </div>,
    );
  }

  if (phase === "connecting" || phase === "waiting") {
    const filled = occupants.length + botSeats.length;
    return withGuard(
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center light:border-slate-200 light:bg-white light:shadow-sm">
        {phase === "connecting" ? (
          <p className="text-sm text-white/50 light:text-slate-500">연결하는 중...</p>
        ) : (
          <>
            <p className="text-sm text-white/50 light:text-slate-500">초대 코드</p>
            <p className="text-4xl font-bold tracking-[0.3em] text-white light:text-slate-900">{roomCode}</p>
            <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
              🔗 초대 링크 복사
            </button>
            <p className="text-xs text-white/50 light:text-slate-500">
              {filled} / {knownTargetPlayerCount}명
            </p>
            {isHost && filled < knownTargetPlayerCount && <FillEmptySeatsButton emptyCount={knownTargetPlayerCount - filled} onFill={fillEmptySeatsWithBots} />}
            <div className="flex w-full max-w-xs flex-col gap-1.5">
              {Array.from({ length: knownTargetPlayerCount }, (_, seat) => {
                const occ = occupants.find((o) => o.seat === seat);
                const botIdx = botSeats.indexOf(seat);
                return (
                  <div key={seat} className="flex items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600">
                    <span>
                      {seat === mySeat ? "나" : `${seat + 1}번`}:{" "}
                      {occ ? occ.name : botIdx >= 0 ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30 light:text-slate-400">대기 중...</span>}
                    </span>
                    {isHost && seat !== mySeat && !occ && (botIdx >= 0 ? <RemoveBotButton onClick={() => removeBotAtSeat(seat)} /> : <AddBotButton onAddWithLevel={(level) => addBotAtSeat(seat, level)} />)}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1.5 text-xs">
              {(["grab", "dump"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={!isHost}
                  onClick={() => updateOptions({ mode: m })}
                  className={`rounded-full border px-3 py-1 ${options.mode === m ? "border-yellow-400 bg-yellow-400/20 text-yellow-100 light:text-yellow-800" : "border-white/15 text-white/50 light:border-slate-300 light:text-slate-500"}`}
                >
                  {MODE_INFO[m].emoji} {MODE_INFO[m].label}
                </button>
              ))}
            </div>
            <p className="text-xs text-white/40 light:text-slate-400">자리가 다 차면 자동으로 시작해요.</p>
            <button onClick={() => setLobbyRulebook(true)} className="rounded-full border border-white/15 px-4 py-1.5 text-xs text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
              📖 룰북 보기
            </button>
            {lobbyRulebook && <RulebookModal onClose={() => setLobbyRulebook(false)} />}
            {isHost && filled >= MIN_PLAYERS && filled < knownTargetPlayerCount && (
              <button onClick={sendGameStart} className="rounded-full bg-indigo-500 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-400">
                지금 시작 ({filled}명)
              </button>
            )}
          </>
        )}
      </div>,
    );
  }

  if (phase === "playing" && gameState && mySeat !== null && mySeat < gameState.playerCount) {
    const myVoteAsTarget = activeVoteFor(botTakeover, String(mySeat));
    const iAmTakenOver = isSeatTakenOver(botTakeover, String(mySeat));
    const voteToShow = Object.values(botTakeover.votes).find((v) => v.seatKey !== String(mySeat) && `${v.seatKey}:${v.startedAt}` !== dismissedVoteKey);
    const eligibleFor = (seatKey: string) => {
      const takenOver = new Set(Object.keys(botTakeover.takeovers).map(Number));
      return occupants.filter((o) => o.seat !== Number(seatKey) && !botSeats.includes(o.seat) && !takenOver.has(o.seat)).length;
    };
    const proveStillHereOrReclaim = (seatKey: string) => {
      const type = isSeatTakenOver(botTakeover, seatKey) ? "reclaim" : "vote-cancel";
      channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type, seatKey } } });
    };

    if (isFinished(gameState) && gameState.ranking) {
      const ranking = gameState.ranking;
      const champ = ranking[0];
      const iWon = champ === mySeat;
      const grab = gameState.mode === "grab";
      return withGuard(
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-yellow-400/30 bg-[radial-gradient(circle_at_50%_0%,rgba(250,204,21,0.3),rgba(15,23,42,0.88)_70%)] p-6 text-center light:border-yellow-200 light:bg-[radial-gradient(circle_at_50%_0%,rgba(254,240,138,1),rgba(255,255,255,1)_70%)]">
          <span className="text-5xl">{iWon ? "🏆" : "⚡"}</span>
          <h2 className="text-2xl font-black text-white light:text-slate-900">{iWon ? "번개 눈썰미 우승!" : `${names[champ]} 우승`}</h2>
          <p className="text-sm text-white/60 light:text-slate-500">
            {MODE_INFO[gameState.mode].emoji} {MODE_INFO[gameState.mode].label} · {gameState.playerCount}명 · 짝 {gameState.seq}번
          </p>
          <div className="w-full max-w-md overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-white/50 light:text-slate-500">
                  <th className="px-1.5 py-1 text-left">순위</th>
                  <th className="px-1.5 py-1 text-left">이름</th>
                  <th className="px-1.5 py-1 text-right">{grab ? "점수" : "남은 카드"}</th>
                  <th className="px-1.5 py-1 text-right">최고</th>
                  <th className="px-1.5 py-1 text-right">평균</th>
                  <th className="px-1.5 py-1 text-right">❄️ 틀림</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((seat, i) => {
                  const st = gameState.stats[seat];
                  const avg = avgRt(st);
                  return (
                    <tr key={seat} className={`border-t border-white/10 light:border-slate-200 ${seat === mySeat ? "font-bold text-yellow-100 light:text-yellow-800" : "text-white/80 light:text-slate-700"}`}>
                      <td className="px-1.5 py-1 text-left">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}위`}</td>
                      <td className="px-1.5 py-1 text-left">
                        <span style={{ color: SEAT_COLORS[seat] }}>{SEAT_SYMBOLS[seat]}</span> {names[seat]}
                      </td>
                      <td className="px-1.5 py-1 text-right tabular-nums">{grab ? `${score(gameState, seat)}점${st.goldens ? ` (⚡${st.goldens})` : ""}` : `${score(gameState, seat)}장`}</td>
                      <td className="px-1.5 py-1 text-right tabular-nums">{st.minRt ? `${(st.minRt / 1000).toFixed(2)}초` : "-"}</td>
                      <td className="px-1.5 py-1 text-right tabular-nums">{avg !== null ? `${(avg / 1000).toFixed(2)}초` : "-"}</td>
                      <td className="px-1.5 py-1 text-right tabular-nums">{st.wrong}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button onClick={handleLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
              나가기
            </button>
            {isHost && (
              <button
                onClick={() => {
                  getLightningPairSound().unlock();
                  sendGameStart();
                }}
                className="rounded-xl bg-yellow-400 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-yellow-300"
              >
                다시하기
              </button>
            )}
          </div>
          {isHost && (
            <div className="flex gap-1.5 text-xs">
              {(["grab", "dump"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => updateOptions({ mode: m })}
                  className={`rounded-full border px-3 py-1 ${options.mode === m ? "border-yellow-400 bg-yellow-400/20 text-yellow-100 light:text-yellow-800" : "border-white/15 text-white/50 light:border-slate-300 light:text-slate-500"}`}
                >
                  다음 판 {MODE_INFO[m].emoji} {MODE_INFO[m].label}
                </button>
              ))}
            </div>
          )}
          {!isHost && <p className="text-xs text-white/40 light:text-slate-400">방장이 다시하기를 누르면 새 판이 시작돼요</p>}
        </div>,
      );
    }

    return withGuard(
      <div className="flex flex-col gap-2">
        {myVoteAsTarget && <BotTakeoverSelfBanner mode="prove-presence" onConfirm={() => proveStillHereOrReclaim(String(mySeat))} />}
        {!myVoteAsTarget && iAmTakenOver && <BotTakeoverSelfBanner mode="reclaim" onConfirm={() => proveStillHereOrReclaim(String(mySeat))} />}
        {voteToShow && (
          <BotTakeoverVoteModal
            targetName={names[Number(voteToShow.seatKey)] ?? voteToShow.originalName}
            reason={voteToShow.reason}
            yesCount={voteToShow.yesVoterDeviceIds.length}
            eligibleVoterCount={eligibleFor(voteToShow.seatKey)}
            hasVoted={voteToShow.yesVoterDeviceIds.includes(deviceId)}
            onVoteYes={() =>
              channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey: voteToShow.seatKey, voterDeviceId: deviceId } } })
            }
            onDismiss={() => setDismissedVoteKey(`${voteToShow.seatKey}:${voteToShow.startedAt}`)}
          />
        )}
        {takeoverSeats.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {takeoverSeats.map((seat) => (
              <BotSeatBadge key={seat} variant="takeover" label={botTakeover.takeovers[seat]?.originalName ?? "이탈"} />
            ))}
          </div>
        )}
        <LightningPairBoard state={gameState} mySeat={mySeat} names={names} botSeats={botSeatSet} onAction={sendAction} clockOffset={isHost ? 0 : clockOffset} />
      </div>,
    );
  }

  return withGuard(
    <div className="rounded-2xl border border-white/10 p-8 text-center text-sm text-white/50 light:border-slate-200 light:text-slate-500">
      게임 정보를 불러오는 중...
      <button onClick={handleLeave} className="ml-2 underline">
        처음으로
      </button>
    </div>,
  );
}
