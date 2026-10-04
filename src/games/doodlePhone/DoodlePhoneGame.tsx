"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import GameLeaveGuardModal from "@/components/GameLeaveGuardModal";
import Avatar from "@/components/common/Avatar";
import { useGameLeaveGuard } from "@/hooks/useGameLeaveGuard";
import { useBackgroundResync } from "@/hooks/useBackgroundResync";
import { useActiveRoomListing } from "@/games/shared/room/useActiveRoomListing";
import { trackGameEvent } from "@/lib/analytics/gameEvents";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
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
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  REACTION_EMOJIS,
  TIMEOUT_GRACE_MS,
  applyAction,
  computeRankings,
  consecutiveTimeouts,
  currentTurn,
  gamePhase,
  mergeStates,
  pageAt,
  pendingSeats,
  receiverOf,
  startGame,
  turnDurationMs,
  turnKind,
  type DoodlePhoneState,
  type EngineAction,
  type SeatIndex,
} from "./engine";
import LobbyOptionsPanel from "./LobbyOptionsPanel";
import { DEFAULT_OPTIONS, MODES, VOTE_WINDOW_MS, sanitizeOptions, themeApplies, type GameOptions } from "./modes";
import { THEME_INFO } from "./themes";
import { chooseBotAction, nextBotActor } from "./bot";
import DoodlePhoneBoard from "./DoodlePhoneBoard";
import DoodleSoundHud from "./DoodleSoundHud";
import DoodlePhoneRulebookModal from "./RulebookModal";
import { playTransitionSounds } from "./sounds";
import { ChunkAssembler, splitIntoChunks, type SyncChunk } from "./syncChunks";
import { selfResult } from "@/games/shared/selfResult";
import { doodlePhoneStatDetails } from "./stats";

/**
 * Online room for 그림 전화기 — the standard lockstep room (docs/cloud-sync.md,
 * cloned from CityChaseGame.tsx) with four deliberate differences, all
 * because every seat acts at the same time:
 *
 * 1. Incoming actions and `state-sync` snapshots are folded in with
 *    `applyAction`/`mergeStates`, which are order-independent (engine.ts
 *    module doc) — there is no "stale snapshot" rejection to get wrong.
 * 2. Snapshots can outgrow one Realtime message (many drawings), so they
 *    travel as `state-sync-chunk` slices from one designated responder.
 * 3. The turn timer lives here, not in the engine: every device counts down
 *    from when it saw the turn open, and only the host sends `TIMEOUT`.
 * 4. Bots are paced one seat at a time through `useBotAutoplay`, with a
 *    longer "thinking" window on drawing turns.
 *
 * Game mode + options (rulebook §9) are chosen by the host in the waiting
 * room, mirrored to guests via `room-options`, and frozen into `game-start`.
 * Because of that the room no longer auto-starts when seats fill — the host
 * presses start once the mode is set.
 */

type Occupant = {
  deviceId: string;
  seat: SeatIndex;
  name: string;
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
};

type Phase = "choose" | "enter-name" | "connecting" | "waiting" | "playing" | "room-full" | "supabase-missing" | "channel-error";

type SyncBody = {
  state: DoodlePhoneState;
  botSeats: SeatIndex[];
  botLevels: BotLevel[];
  botTakeover: BotTakeoverState;
};

const GAME_ID = "doodle-phone";
const CHANNEL_PREFIX = "doodle-phone-room-";
const CHUNK_SEND_SPACING_MS = 80;
/** A seat auto-filled by timeouts this many turns in a row gets an "idle" takeover vote. */
const IDLE_TIMEOUT_STREAK = 2;
const BOT_REACTION_CHANCE = 0.35;

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function seatStorageKey(code: string): string {
  return `doodle-phone-seat-${code}`;
}

function getStoredSeat(code: string): number | null {
  const v = window.localStorage.getItem(seatStorageKey(code));
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(seatStorageKey(code), String(seat));
}

export default function DoodlePhoneGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(6);
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [formError, setFormError] = useState<string | null>(null);
  const [showRulebook, setShowRulebook] = useState(false);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);

  // --- Game state: every path that changes it goes through `commitState` ---
  const [gameState, setGameState] = useState<DoodlePhoneState | null>(null);
  const gameStateRef = useRef<DoodlePhoneState | null>(null);
  const [turnStartedAt, setTurnStartedAt] = useState(0);
  const turnStartedAtRef = useRef(0);
  const completedSeedRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  const idsRef = useRef<Record<SeatIndex, string>>({});

  const [botSeats, setBotSeats] = useState<SeatIndex[]>([]);
  const botSeatsRef = useRef<SeatIndex[]>([]);
  const [botLevels, setBotLevels] = useState<BotLevel[]>([]);
  const botLevelsRef = useRef<BotLevel[]>([]);
  const botSeatSet = useMemo(() => new Set(botSeats), [botSeats]);

  const [botTakeover, setBotTakeover] = useState<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  const botTakeoverRef = useRef<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  const [dismissedVoteKey, setDismissedVoteKey] = useState<string | null>(null);

  const phaseRef = useRef<Phase>(phase);
  const occupantsRef = useRef<Occupant[]>([]);
  const namesRef = useRef<Record<SeatIndex, string>>({});
  const mySeatRef = useRef<SeatIndex | null>(null);
  const optionsRef = useRef<GameOptions>(options);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const startSentRef = useRef(false);
  const playerCountRef = useRef(targetPlayerCount);
  const isHost = intent === "create";

  useEffect(() => {
    botSeatsRef.current = botSeats;
    botLevelsRef.current = botLevels;
    phaseRef.current = phase;
    occupantsRef.current = occupants;
    mySeatRef.current = mySeat;
    optionsRef.current = options;
    onCompleteRef.current = onComplete;
    turnStartedAtRef.current = turnStartedAt;
  });

  const setRoster = useCallback((seats: SeatIndex[], levels: BotLevel[]) => {
    botSeatsRef.current = seats;
    botLevelsRef.current = levels;
    setBotSeats(seats);
    setBotLevels(levels);
  }, []);

  const setTakeover = useCallback((next: BotTakeoverState) => {
    botTakeoverRef.current = next;
    setBotTakeover(next);
  }, []);

  /**
   * The single write path for game state. Restarts the local turn clock when
   * the (derived) current turn changes, plays transition SFX, and reports
   * rankings once when a match reaches the finished phase.
   */
  const commitState = useCallback((next: DoodlePhoneState | null) => {
    const prev = gameStateRef.current;
    if (next === prev) return;
    gameStateRef.current = next;
    setGameState(next);
    if (next && (!prev || prev.seed !== next.seed || currentTurn(prev) !== currentTurn(next))) {
      const now = Date.now();
      turnStartedAtRef.current = now;
      setTurnStartedAt(now);
    }
    playTransitionSounds(prev, next);
    if (next && gamePhase(next) === "finished" && completedSeedRef.current !== next.seed) {
      completedSeedRef.current = next.seed;
      const rankings = computeRankings(next);
      onCompleteRef.current({
        rankings: rankings.map((r) => ({ playerId: idsRef.current[r.seat] ?? `seat-${r.seat}`, rank: r.rank })),
        self: selfResult(mySeatRef.current, rankings, { takeovers: botTakeoverRef.current.takeovers, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current }, (seat) => doodlePhoneStatDetails(next, seat)),
        finishedAt: new Date().toISOString(),
      });
    }
  }, []);

  const requestStateSync = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (channel.state !== "joined") channel.subscribe();
    channel.send({ type: "broadcast", event: "state-request", payload: { deviceId: getDeviceId() } });
  }, []);

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
    setMyName(name);
    setMyPlayerId(identity.name.trim() ? identity.playerId : undefined);
    setRoomCode(code);
    setPhase("connecting");
  }

  // --- Realtime channel -----------------------------------------------------
  useEffect(() => {
    if (!roomCode) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const deviceId = getDeviceId();
    const channel = supabase.channel(`${CHANNEL_PREFIX}${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;
    const assembler = new ChunkAssembler();

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const { seed, playerCount } = payload as { seed: number; playerCount: number };
      const matchOptions = sanitizeOptions(payload?.options);
      playerCountRef.current = playerCount;
      setOptions(matchOptions);
      setRoster((payload?.botSeats as SeatIndex[] | undefined) ?? [], (payload?.botLevels as BotLevel[] | undefined) ?? []);
      setTakeover(INITIAL_BOT_TAKEOVER_STATE);
      commitState(startGame(playerCount, seed, matchOptions));
      setPhase("playing");
    });

    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      setRoster((payload?.botSeats as SeatIndex[] | undefined) ?? [], (payload?.botLevels as BotLevel[] | undefined) ?? []);
    });

    channel.on("broadcast", { event: "room-options" }, ({ payload }) => {
      if (!isHost) setOptions(sanitizeOptions(payload?.options));
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const current = gameStateRef.current;
      const action = payload?.action as EngineAction | undefined;
      if (current && action) commitState(applyAction(current, action));
    });

    channel.on("broadcast", { event: "bot-takeover-event" }, ({ payload }) => {
      const event = payload?.event as BotTakeoverEvent | undefined;
      if (!event) return;
      setTakeover(reduceBotTakeover(botTakeoverRef.current, event));
      if (event.type !== "vote-cast") return;
      if (!botTakeoverRef.current.votes[event.seatKey]) return;
      const takenOverSeats = new Set(Object.keys(botTakeoverRef.current.takeovers).map(Number));
      const eligible = occupantsRef.current.filter(
        (o) => o.seat !== Number(event.seatKey) && !botSeatsRef.current.includes(o.seat) && !takenOverSeats.has(o.seat),
      ).length;
      if (voteThresholdMet(voteYesCount(botTakeoverRef.current, event.seatKey), eligible)) {
        channel.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "convert", seatKey: event.seatKey, at: Date.now() } } });
      }
    });

    channel.on("broadcast", { event: "state-request" }, ({ payload }) => {
      const requester = payload?.deviceId as string | undefined;
      const state = gameStateRef.current;
      if (!state) {
        if (isHost) {
          channel.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: botSeatsRef.current, botLevels: botLevelsRef.current } });
          channel.send({ type: "broadcast", event: "room-options", payload: { options: optionsRef.current } });
        }
        return;
      }
      if (!requester || requester === deviceId) return;
      // One responder instead of everyone: the host, or — if the host is
      // gone — the lowest-seat other occupant. Keeps a big snapshot from
      // being sent N−1 times.
      const others = occupantsRef.current.filter((o) => o.deviceId !== requester);
      const responder = others.find((o) => o.isHost) ?? [...others].sort((a, b) => a.seat - b.seat)[0];
      if (responder && responder.deviceId !== deviceId) return;
      const body: SyncBody = { state, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current, botTakeover: botTakeoverRef.current };
      const chunks = splitIntoChunks(JSON.stringify(body), requester, `${deviceId}:${Date.now()}`);
      chunks.forEach((chunk, i) => {
        window.setTimeout(() => channel.send({ type: "broadcast", event: "state-sync-chunk", payload: chunk }), i * CHUNK_SEND_SPACING_MS);
      });
    });

    channel.on("broadcast", { event: "state-sync-chunk" }, ({ payload }) => {
      const chunk = payload as SyncChunk | undefined;
      if (!chunk || chunk.forDeviceId !== deviceId) return;
      const full = assembler.accept(chunk);
      if (!full) return;
      const body = JSON.parse(full) as SyncBody;
      const local = gameStateRef.current;
      const merged = local && local.seed === body.state.seed ? mergeStates(local, body.state) : body.state;
      setRoster(body.botSeats ?? [], body.botLevels ?? []);
      setTakeover(body.botTakeover ?? INITIAL_BOT_TAKEOVER_STATE);
      commitState(merged);
      setPhase("playing");
    });

    let resolveFirstSync = () => {};
    const firstSync = new Promise<void>((resolve) => {
      resolveFirstSync = resolve;
    });
    let sawFirstSync = false;

    channel.on("presence", { event: "sync" }, () => {
      const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
      setOccupants(Object.values(raw).flat());
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
          const existing = Object.values(channel.presenceState() as RealtimePresenceState<Occupant>).flat();
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
  }, [roomCode, myName, myPlayerId, isHost, commitState, requestStateSync, setRoster, setTakeover]);

  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";
  const host = occupants.find((o) => o.isHost);
  const knownTargetPlayerCount = host?.targetPlayerCount ?? targetPlayerCount;

  // --- Seat-collision self-heal (docs/cloud-sync.md §3) ---------------------
  const reclaimAttemptsRef = useRef(0);
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

  // --- Lobby ----------------------------------------------------------------
  const sendGameStart = useCallback(() => {
    startSentRef.current = true;
    // "지금 시작" may leave target seats empty — only the filled ones play.
    const playerCount = Math.min(playerCountRef.current, occupantsRef.current.length + botSeatsRef.current.length);
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: {
        seed: Math.floor(Math.random() * 2 ** 31),
        playerCount,
        options: optionsRef.current,
        botSeats: botSeatsRef.current,
        botLevels: botLevelsRef.current,
      },
    });
  }, []);

  const updateOptions = useCallback(
    (patch: Partial<GameOptions>) => {
      if (!isHost) return;
      const next = sanitizeOptions({ ...optionsRef.current, ...patch });
      optionsRef.current = next;
      setOptions(next);
      channelRef.current?.send({ type: "broadcast", event: "room-options", payload: { options: next } });
    },
    [isHost],
  );

  const broadcastRoster = useCallback(
    (seats: SeatIndex[], levels: BotLevel[]) => {
      setRoster(seats, levels);
      channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: seats, botLevels: levels } });
    },
    [setRoster],
  );

  const addBotAtSeat = useCallback(
    (seat: SeatIndex, level: BotLevel) => {
      if (!isHost || botSeatsRef.current.includes(seat) || occupants.some((o) => o.seat === seat)) return;
      broadcastRoster([...botSeatsRef.current, seat], [...botLevelsRef.current, level]);
    },
    [isHost, occupants, broadcastRoster],
  );

  const fillEmptySeatsWithBots = useCallback(
    (level: BotLevel) => {
      if (!isHost) return;
      const taken = new Set<SeatIndex>([...occupants.map((o) => o.seat), ...botSeatsRef.current]);
      const empty = Array.from({ length: knownTargetPlayerCount }, (_, s) => s).filter((s) => !taken.has(s));
      if (empty.length === 0) return;
      broadcastRoster([...botSeatsRef.current, ...empty], [...botLevelsRef.current, ...empty.map(() => level)]);
    },
    [isHost, occupants, knownTargetPlayerCount, broadcastRoster],
  );

  const removeBotAtSeat = useCallback(
    (seat: SeatIndex) => {
      const idx = botSeatsRef.current.indexOf(seat);
      if (!isHost || idx < 0) return;
      broadcastRoster(
        botSeatsRef.current.filter((_, i) => i !== idx),
        botLevelsRef.current.filter((_, i) => i !== idx),
      );
    },
    [isHost, broadcastRoster],
  );

  // A human who takes a seat a bot was holding wins it (render-time, ARCHITECTURE.md §7.3).
  if (isHost && botSeats.length > 0) {
    const humanSeats = new Set(occupants.map((o) => o.seat));
    const keep = botSeats.map((s, i) => (humanSeats.has(s) ? -1 : i)).filter((i) => i !== -1);
    if (keep.length !== botSeats.length) {
      setBotSeats(keep.map((i) => botSeats[i]));
      setBotLevels(keep.map((i) => botLevels[i]));
    }
  }

  const handleAction = useCallback((action: EngineAction) => {
    channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action } });
  }, []);

  // --- Bots -----------------------------------------------------------------
  // Depends on a stable string key, not the whole takeover object (see DalmutiGame.tsx's 2026-09-03 note).
  const takeoverSeatKey = Object.keys(botTakeover.takeovers).sort().join(",");
  const takeoverSeats = useMemo(() => (takeoverSeatKey ? takeoverSeatKey.split(",").map(Number) : []), [takeoverSeatKey]);
  const allBotSeatSet = useMemo(() => new Set([...botSeatSet, ...takeoverSeats]), [botSeatSet, takeoverSeats]);
  const botCurrentActor = useCallback((state: DoodlePhoneState) => nextBotActor(state, allBotSeatSet), [allBotSeatSet]);
  const chooseAction = useCallback((state: DoodlePhoneState, actor: SeatIndex): EngineAction | null => {
    const idx = botSeatsRef.current.indexOf(actor);
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return chooseBotAction(state, actor, level);
  }, []);
  const botDrawingTurn = gameState !== null && gamePhase(gameState) === "turns" && turnKind(gameState, currentTurn(gameState)) === "drawing";

  useBotAutoplay<DoodlePhoneState, EngineAction, SeatIndex>({
    active: isHost && phase === "playing" && gameState !== null && gamePhase(gameState) === "turns",
    state: gameState,
    currentActor: botCurrentActor,
    botSeats: allBotSeatSet,
    chooseAction,
    dispatch: handleAction,
    minDelayMs: botDrawingTurn ? 2_500 : 1_200,
    maxDelayMs: botDrawingTurn ? 6_000 : 3_500,
    watchdogMs: 15_000,
  });

  // Host: bots react to freshly revealed pages, like the humans do.
  const showcaseKey = gameState && gamePhase(gameState) === "showcase" ? `${gameState.seed}:${gameState.showcase.album}:${gameState.showcase.revealed}` : null;
  useEffect(() => {
    const state = gameStateRef.current;
    if (!isHost || !showcaseKey || !state || state.showcase.revealed === 0) return;
    const { album, revealed } = state.showcase;
    const page = pageAt(state, album, revealed);
    if (!page) return;
    const timers = [...allBotSeatSet]
      .filter((seat) => seat !== page.author && seat < state.playerCount && Math.random() < BOT_REACTION_CHANCE)
      .map((seat) =>
        window.setTimeout(
          () => handleAction({ type: "REACT", seat, album, turn: revealed, emoji: REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)] }),
          700 + Math.random() * 1_900,
        ),
      );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [isHost, showcaseKey, allBotSeatSet, handleAction]);

  // Host: in score mode, bots cast their best-page vote once an album is fully revealed.
  useEffect(() => {
    const state = gameStateRef.current;
    if (!isHost || !showcaseKey || !state || state.options.mode !== "SCORE" || state.showcase.revealed !== state.playerCount) return;
    const { album } = state.showcase;
    const timers = [...allBotSeatSet]
      .filter((seat) => seat < state.playerCount)
      .map((seat) => {
        const choices = Array.from({ length: state.playerCount }, (_, i) => i + 1).filter((turn) => receiverOf(state.playerCount, album, turn) !== seat);
        const turn = choices[Math.floor(Math.random() * choices.length)];
        return window.setTimeout(() => handleAction({ type: "VOTE", seat, album, turn }), 1_500 + Math.random() * (VOTE_WINDOW_MS / 3));
      });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [isHost, showcaseKey, allBotSeatSet, handleAction]);

  // --- Host: turn timeout + idle takeover (rulebook §5) ---------------------
  const timeoutSentForRef = useRef<string | null>(null);
  const idleVoteSentRef = useRef(new Set<string>());
  useEffect(() => {
    if (!isHost || phase !== "playing") return;
    const id = window.setInterval(() => {
      const state = gameStateRef.current;
      if (!state || gamePhase(state) !== "turns") return;
      const turn = currentTurn(state);

      const turnKey = `${state.seed}:${turn}`;
      const elapsed = Date.now() - turnStartedAtRef.current;
      if (timeoutSentForRef.current !== turnKey && elapsed >= turnDurationMs(state, turn) + TIMEOUT_GRACE_MS) {
        timeoutSentForRef.current = turnKey;
        handleAction({ type: "TIMEOUT", turn, seats: pendingSeats(state) });
      }

      for (let seat = 0; seat < state.playerCount; seat++) {
        const seatKey = String(seat);
        const voteKey = `${state.seed}:${seat}:${turn}`;
        if (botSeatsRef.current.includes(seat) || idleVoteSentRef.current.has(voteKey)) continue;
        if (activeVoteFor(botTakeoverRef.current, seatKey) || isSeatTakenOver(botTakeoverRef.current, seatKey)) continue;
        if (consecutiveTimeouts(state, seat) < IDLE_TIMEOUT_STREAK) continue;
        idleVoteSentRef.current.add(voteKey);
        const occ = occupantsRef.current.find((o) => o.seat === seat);
        channelRef.current?.send({
          type: "broadcast",
          event: "bot-takeover-event",
          payload: {
            event: {
              type: "vote-start",
              seatKey,
              reason: "idle",
              startedAt: Date.now(),
              originalUserId: occ?.playerId ?? `${roomCode}:${seat}`,
              originalName: occ?.name ?? namesRef.current[seat] ?? "플레이어",
            },
          },
        });
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [isHost, phase, roomCode, handleAction]);

  // --- Seat → identity maps ---------------------------------------------------
  const seatCount = gameState?.playerCount ?? knownTargetPlayerCount;
  const ids: Record<SeatIndex, string> = useMemo(() => {
    const map: Record<SeatIndex, string> = {};
    for (let seat = 0; seat < seatCount; seat++) {
      const occ = occupants.find((o) => o.seat === seat);
      map[seat] = botTakeover.takeovers[seat]?.originalUserId ?? occ?.playerId ?? `${roomCode}:${seat}`;
    }
    return map;
  }, [roomCode, seatCount, occupants, botTakeover]);

  const names: Record<SeatIndex, string> = useMemo(() => {
    const map: Record<SeatIndex, string> = {};
    for (let seat = 0; seat < seatCount; seat++) {
      const takeover = botTakeover.takeovers[seat];
      const occ = occupants.find((o) => o.seat === seat);
      const botIdx = botSeats.indexOf(seat);
      map[seat] = takeover
        ? `🤖 AI ${takeover.originalName}`
        : seat === mySeat
          ? myName
          : (occ?.name ?? (botIdx >= 0 ? botDisplayName(botIdx, botLevels[botIdx]) : `플레이어 ${seat + 1}`));
    }
    return map;
  }, [occupants, mySeat, myName, seatCount, botSeats, botLevels, botTakeover]);

  useEffect(() => {
    idsRef.current = ids;
    namesRef.current = names;
  }, [ids, names]);

  const connectedSeats = useMemo(() => new Set([...occupants.map((o) => o.seat), ...botSeats, ...takeoverSeats]), [occupants, botSeats, takeoverSeats]);

  function eligibleVoterCountFor(seatKey: string): number {
    const takenOverSeats = new Set(Object.keys(botTakeover.takeovers).map(Number));
    return occupants.filter((o) => o.seat !== Number(seatKey) && !botSeats.includes(o.seat) && !takenOverSeats.has(o.seat)).length;
  }

  function castTakeoverVote(seatKey: string) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey, voterDeviceId: deviceId } } });
  }

  function proveStillHereOrReclaim(seatKey: string) {
    const type = isSeatTakenOver(botTakeover, seatKey) ? "reclaim" : "vote-cancel";
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type, seatKey } } });
  }

  function handleLeave() {
    if (channelRef.current) {
      getSupabase()?.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    window.history.replaceState(null, "", window.location.pathname);
    setRoomCode(null);
    setMySeat(null);
    setOccupants([]);
    commitState(null);
    setIdentity({ name: "" });
    setMyPlayerId(undefined);
    setCodeInput("");
    setRoster([], []);
    setTakeover(INITIAL_BOT_TAKEOVER_STATE);
    setDismissedVoteKey(null);
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
    maxPlayers: knownTargetPlayerCount,
  });

  function withGuard(node: ReactNode) {
    return (
      <>
        {node}
        <GameLeaveGuardModal open={exitConfirmOpen} onCancel={cancelExit} onConfirm={confirmExit} />
        {showRulebook && <DoodlePhoneRulebookModal onClose={() => setShowRulebook(false)} />}
      </>
    );
  }

  const panel = "flex flex-col items-center gap-3 rounded-2xl border p-8 text-center";

  if (phase === "supabase-missing") {
    return withGuard(
      <div className={`${panel} border-amber-400/30 bg-amber-400/10 light:border-amber-300 light:bg-amber-50`}>
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80 light:text-amber-800">
          그림 전화기는 실시간 온라인 전용이라 Supabase 설정(<code>NEXT_PUBLIC_SUPABASE_URL</code> / <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>)이 필요합니다.
        </p>
      </div>,
    );
  }

  if (phase === "room-full" || phase === "channel-error") {
    const full = phase === "room-full";
    return withGuard(
      <div className={`${panel} border-rose-400/30 bg-rose-400/10 light:border-rose-300 light:bg-rose-50`}>
        <span className="text-3xl">{full ? "🚫" : "📡"}</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">{full ? "이미 자리가 다 찬 방이에요" : "연결에 실패했습니다"}</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-fuchsia-600 px-5 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500">
          {full ? "처음으로" : "다시 시도"}
        </button>
      </div>,
    );
  }

  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId={GAME_ID}
        icon="✏️"
        title="그림 전화기: 낙서 릴레이"
        description={
          <p className="text-sm text-white/50 light:text-slate-500">
            갈틱폰 스타일 그림 릴레이 ({MIN_PLAYERS}~{MAX_PLAYERS}인). 문장은 그림이 되고, 그림은 다시 문장이 돼요. 마지막에 원래 문장과 비교하며 함께 웃어요!
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
              🎨 방 만들기
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
            <button onClick={() => setShowRulebook(true)} className="w-full rounded-xl border border-white/10 py-2.5 text-xs text-white/50 transition hover:border-white/25 light:border-slate-200 light:text-slate-500">
              📖 룰북 보기
            </button>
          </div>
        }
      />,
    );
  }

  if (phase === "enter-name") {
    const stepper = "h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30 light:border-slate-300 light:text-slate-700";
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-fuchsia-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900"
            />
          </label>
        )}
        {intent === "create" && (
          <>
            <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              인원 수 ({MIN_PLAYERS}~{MAX_PLAYERS}명 · 턴 수 = 인원 수)
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setTargetPlayerCount((n) => Math.max(MIN_PLAYERS, n - 1))} className={stepper}>
                  −
                </button>
                <span className="w-8 text-center text-lg font-semibold text-white light:text-slate-900">{targetPlayerCount}</span>
                <button type="button" onClick={() => setTargetPlayerCount((n) => Math.min(MAX_PLAYERS, n + 1))} className={stepper}>
                  +
                </button>
              </div>
            </div>
          </>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 light:bg-rose-50 light:text-rose-700">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
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
    const filled = occupants.length + botSeats.length;
    return withGuard(
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center light:border-slate-200 light:bg-white/90 light:shadow-sm">
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
              {filled} / {knownTargetPlayerCount}명 참여 중
            </p>
            {isHost && filled < knownTargetPlayerCount && <FillEmptySeatsButton emptyCount={knownTargetPlayerCount - filled} onFill={fillEmptySeatsWithBots} />}
            <div className="mt-2 flex flex-col gap-1.5">
              {Array.from({ length: knownTargetPlayerCount }, (_, seat) => {
                const occ = occupants.find((o) => o.seat === seat);
                const botIdx = botSeats.indexOf(seat);
                return (
                  <div key={seat} className="flex items-center justify-between gap-3 text-sm text-white/70 light:text-slate-600">
                    <span className="flex items-center gap-1.5">
                      {occ && <Avatar size={20} />}
                      {seat === mySeat ? "나" : `${seat + 1}번`}:{" "}
                      {occ ? occ.name : botIdx >= 0 ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30 light:text-slate-400">대기 중...</span>}
                    </span>
                    {isHost && seat !== mySeat && !occ && (botIdx >= 0 ? <RemoveBotButton onClick={() => removeBotAtSeat(seat)} /> : <AddBotButton onAddWithLevel={(level) => addBotAtSeat(seat, level)} />)}
                  </div>
                );
              })}
            </div>
            <LobbyOptionsPanel options={options} isHost={isHost} onChange={updateOptions} />
            {isHost ? (
              <button
                onClick={sendGameStart}
                disabled={filled < MIN_PLAYERS}
                className="w-full rounded-xl bg-fuchsia-600 py-3 text-sm font-bold text-white transition hover:bg-fuchsia-500 disabled:bg-white/10 disabled:text-white/40 light:disabled:bg-slate-200 light:disabled:text-slate-400"
              >
                {filled < MIN_PLAYERS
                  ? `최소 ${MIN_PLAYERS}명이 필요해요 (지금 ${filled}명 · AI 봇으로 채울 수 있어요)`
                  : `🚀 [${MODES[options.mode].title} 모드${themeApplies(options) ? ` × ${THEME_INFO[options.theme].name}` : ""}] 게임 시작 (${filled}명)`}
              </button>
            ) : (
              <p className="text-xs text-white/50 light:text-slate-500">방장이 게임 모드를 고르고 시작하길 기다리는 중이에요…</p>
            )}
            <button onClick={() => setShowRulebook(true)} className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/50 hover:border-white/25 light:border-slate-200 light:text-slate-500">
              📖 룰북
            </button>
          </>
        )}
      </div>,
    );
  }

  if (phase === "playing" && gameState && mySeat !== null) {
    if (mySeat >= gameState.playerCount) {
      return withGuard(
        <div className={`${panel} border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white`}>
          <span className="text-3xl">👀</span>
          <p className="text-sm text-white/70 light:text-slate-600">이번 판은 이미 시작돼서 자리가 없어요. 다음 판을 기다려주세요.</p>
          <button onClick={handleLeave} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70 light:border-slate-300 light:text-slate-600">
            나가기
          </button>
        </div>,
      );
    }
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {takeoverSeats.map((seat) => (
              <BotSeatBadge key={seat} variant="takeover" label={botTakeover.takeovers[seat]?.originalName ?? "이탈"} />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <DoodleSoundHud />
            <button onClick={() => setShowRulebook(true)} className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/50 hover:border-white/25 light:border-slate-200 light:text-slate-500">
              📖 룰북
            </button>
          </div>
        </div>
        <DoodlePhoneBoard
          state={gameState}
          viewerSeat={mySeat}
          names={names}
          connectedSeats={connectedSeats}
          isHost={isHost}
          turnStartedAt={turnStartedAt}
          onAction={handleAction}
          onRematch={sendGameStart}
          onLeave={handleLeave}
        />
      </>,
    );
  }

  return withGuard(null);
}
