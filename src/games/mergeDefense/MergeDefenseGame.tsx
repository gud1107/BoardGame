"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import RulebookGate from "@/components/lobby/RulebookGate";
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
import {
  applyAction,
  chooseBotAction,
  computeRankings,
  MAX_PLAYERS,
  MIN_PLAYERS,
  sanitizeAction,
  startGame,
  sanitizeLimit,
  sanitizeDifficulty,
  type Difficulty,
  eliminationLimit,
  BOSS_EVERY,
  stepGame,
  TICK_MS,
  type Action,
  type GameMode,
  type MergeDefenseState,
  type RankedSeat,
  type SeatIndex,
} from "./engine";
import MergeDefenseBoard from "./MergeDefenseBoard";
import { playVictory } from "./mergeDefenseAudio";
import { recordBestWave, useBestWaves } from "./bestWave";
import MergeDefenseResults, { type MatchRecord, type WaveHistory } from "./MergeDefenseResults";
import WaitingRoomPanel from "./WaitingRoomPanel";
import RoomSettings from "./RoomSettings";
import { SEAT_COLORS } from "./render";

/**
 * Online-room entry point for 랜덤 합성 디펜스.
 *
 * Host-authoritative like worm (see WormGame.tsx's module doc): only the host
 * applies actions and advances the authoritative simulation; it broadcasts a
 * snapshot every `BROADCAST_INTERVAL_MS`. Non-host clients send their
 * actions on `player-input` and, unlike worm, keep stepping their local copy
 * between snapshots so monsters glide instead of hopping 4×/sec. A client's
 * local step never decides an elimination or the game end on its own — it
 * pauses there and waits for the host's snapshot.
 *
 * Lobby AI: the host can fill every empty seat with a bot at start ("AI와
 * 연습" does this right away). Bots and taken-over seats are driven by
 * `chooseBotAction` inside the host loop.
 */

type Occupant = {
  deviceId: string;
  seat: SeatIndex;
  name: string;
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
  mode?: GameMode;
  /** Host-chosen elimination head count (null = by player count). */
  limit?: number | null;
  difficulty?: Difficulty;
  botSeats?: number[];
};
type Phase = "choose" | "enter-name" | "connecting" | "waiting" | "playing" | "post-game" | "room-full" | "supabase-missing" | "channel-error";

const GAME_ID = "merge-defense";
const BROADCAST_INTERVAL_MS = 250;
const BOT_DELAY_TICKS = 10; // a bot decides every 0.5s
const PING_MS = 5000;
const IDLE_VOTE_THRESHOLD_MS = 45_000;

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredSeat(code: string): number | null {
  const v = window.localStorage.getItem(`merge-defense-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`merge-defense-seat-${code}`, String(seat));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function aliveCount(s: MergeDefenseState): number {
  return s.boards.filter((b) => b.alive).length;
}

export default function MergeDefenseGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [practice, setPractice] = useState(false);
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(2);
  const [mode, setMode] = useState<GameMode>("survival");
  const [limitChoice, setLimitChoice] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const best = useBestWaves();
  /** This match's best-wave result for me: mode, difficulty, wave reached, previous record. */
  /** Results chart: each seat's peak monsters per wave, captured at game end. */
  const [waveHistory, setWaveHistory] = useState<WaveHistory | null>(null);
  const [myRecord, setMyRecord] = useState<MatchRecord | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<MergeDefenseState | null>(null);
  const [finalRankings, setFinalRankings] = useState<RankedSeat[] | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  function requestStateSync() {
    const channel = channelRef.current;
    if (!channel) return;
    if (channel.state !== "joined") channel.subscribe();
    channel.send({ type: "broadcast", event: "state-request", payload: {} });
  }
  const startSentRef = useRef(false);
  const playerCountRef = useRef(targetPlayerCount);
  const modeRef = useRef<GameMode>(mode);
  const limitRef = useRef<number | null>(limitChoice);
  const difficultyRef = useRef<Difficulty>(difficulty);
  const botSeatsRef = useRef<number[]>([]);
  const isHost = intent === "create";

  // The simulation copy the loop advances (authoritative on the host,
  // predicted on everyone else). `gameState` mirrors it for rendering.
  const simRef = useRef<MergeDefenseState | null>(null);
  const pendingRef = useRef<{ seat: SeatIndex; action: Action }[]>([]);
  const endHandledRef = useRef(false);

  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const occupantsRef = useRef<Occupant[]>([]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);

  const [botTakeover, setBotTakeover] = useState<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  const botTakeoverRef = useRef<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  function applyBotTakeoverEvent(event: BotTakeoverEvent) {
    const next = reduceBotTakeover(botTakeoverRef.current, event);
    botTakeoverRef.current = next;
    setBotTakeover(next);
  }
  // Last `player-input` (action or heartbeat ping) per seat — the idle
  // takeover trigger, same idea as worm's.
  const lastInputAtRef = useRef<Record<SeatIndex, number>>({});
  const matchStartedAtRef = useRef(0);
  const [dismissedVoteKey, setDismissedVoteKey] = useState<string | null>(null);

  const mySeatRef = useRef<SeatIndex | null>(null);
  useEffect(() => {
    mySeatRef.current = mySeat;
  }, [mySeat]);

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
    modeRef.current = mode;
    limitRef.current = limitChoice;
    difficultyRef.current = difficulty;
    setMyName(name);
    setMyPlayerId(identity.name.trim() ? identity.playerId : undefined);
    setRoomCode(code);
    setPhase("connecting");
  }

  function hostPresence(): Partial<Occupant> {
    return isHost ? { isHost: true, targetPlayerCount: playerCountRef.current, botSeats: botSeatsRef.current, mode: modeRef.current, limit: limitRef.current, difficulty: difficultyRef.current } : {};
  }

  useEffect(() => {
    if (!roomCode) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const deviceId = getDeviceId();
    const channel = supabase.channel(`merge-defense-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const playerCount = payload?.playerCount as number;
      const botSeats = Array.isArray(payload?.botSeats) ? (payload.botSeats as number[]) : [];
      playerCountRef.current = playerCount;
      botSeatsRef.current = botSeats;
      pendingRef.current = [];
      lastInputAtRef.current = {};
      matchStartedAtRef.current = Date.now();
      endHandledRef.current = false;
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      const startMode: GameMode = payload?.mode === "versus" ? "versus" : "survival";
      modeRef.current = startMode;
      const state = startGame(playerCount, seed, botSeats, startMode, sanitizeLimit(payload?.limit), sanitizeDifficulty(payload?.difficulty));
      simRef.current = state;
      setGameState(state);
      setFinalRankings(null);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "state-snapshot" }, ({ payload }) => {
      if (isHost) return;
      const snap = payload?.state as MergeDefenseState | undefined;
      if (!snap) return;
      // Catch the (slightly old) snapshot up to where our prediction already
      // is, so motion doesn't rubber-band backwards by the network delay.
      let next = snap;
      const local = simRef.current;
      if (local && next.phase === "playing" && local.tick > next.tick && local.tick - next.tick <= 20) {
        while (next.tick < local.tick) {
          const stepped = stepGame(next);
          if (stepped.phase !== "playing" || aliveCount(stepped) !== aliveCount(next)) break;
          next = stepped;
        }
      }
      simRef.current = next;
      setGameState(next);
    });

    channel.on("broadcast", { event: "player-input" }, ({ payload }) => {
      const seat = payload?.seat as SeatIndex | undefined;
      if (typeof seat !== "number") return;
      lastInputAtRef.current = { ...lastInputAtRef.current, [seat]: Date.now() };
      if (!isHost || seat === mySeatRef.current) return;
      const action = sanitizeAction(payload?.action);
      if (!action) return;
      if (simRef.current?.boards[seat]?.bot) return; // a late joiner landing on a lobby-bot seat can't steer it
      pendingRef.current.push({ seat, action });
    });

    channel.on("broadcast", { event: "bot-takeover-event" }, ({ payload }) => {
      const event = payload?.event as BotTakeoverEvent | undefined;
      if (!event) return;
      applyBotTakeoverEvent(event);
      if (event.type !== "vote-cast") return;
      const vote = botTakeoverRef.current.votes[event.seatKey];
      if (!vote) return;
      const takenOverSeats = new Set(Object.keys(botTakeoverRef.current.takeovers).map(Number));
      const eligible = occupantsRef.current.filter((o) => o.seat !== Number(event.seatKey) && !takenOverSeats.has(o.seat)).length;
      if (voteThresholdMet(voteYesCount(botTakeoverRef.current, event.seatKey), eligible)) {
        channel.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "convert", seatKey: event.seatKey, at: Date.now() } } });
      }
    });

    channel.on("broadcast", { event: "state-request" }, () => {
      if (isHost && simRef.current) {
        channel.send({ type: "broadcast", event: "state-sync", payload: { state: simRef.current, botTakeover: botTakeoverRef.current } });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      if (isHost) return;
      const state = payload?.state as MergeDefenseState | undefined;
      if (!state) return;
      const takeover = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
      botTakeoverRef.current = takeover;
      setBotTakeover(takeover);
      simRef.current = state;
      setGameState(state);
      if (state.phase === "playing") {
        setFinalRankings(null);
        setPhase("playing");
      }
    });

    channel.on("presence", { event: "leave" }, ({ leftPresences }) => {
      if (phaseRef.current !== "playing") return;
      for (const p of leftPresences as unknown as Occupant[]) {
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

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await Promise.race([firstSync, new Promise((resolve) => setTimeout(resolve, 800))]);
        let seat = getStoredSeat(roomCode);
        if (seat === null) {
          const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
          const existing = Object.values(raw).flat();
          const hostRecord = existing.find((o) => o.isHost);
          const taken = new Set([...existing.map((o) => o.seat), ...(hostRecord?.botSeats ?? [])]);
          seat = 0;
          while (taken.has(seat)) seat++;
          if (hostRecord && seat >= hostRecord.targetPlayerCount!) {
            setPhase("room-full");
            return;
          }
          storeSeat(roomCode, seat);
        }
        setMySeat(seat);
        await channel.track({ deviceId, seat, name: myName, playerId: myPlayerId, ...hostPresence() } satisfies Occupant);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, myName, myPlayerId, isHost]);

  // Idle takeover trigger + this client's own heartbeat.
  useEffect(() => {
    if (phase !== "playing" || !roomCode) return;
    const interval = window.setInterval(() => {
      if (phaseRef.current !== "playing") return;
      const seat = mySeatRef.current;
      if (seat !== null && document.visibilityState === "visible") {
        channelRef.current?.send({ type: "broadcast", event: "player-input", payload: { seat, action: null } });
      }
      const playerCount = simRef.current?.playerCount ?? 0;
      for (const occ of occupantsRef.current) {
        if (occ.seat >= playerCount) continue;
        const seatKey = String(occ.seat);
        if (activeVoteFor(botTakeoverRef.current, seatKey) || isSeatTakenOver(botTakeoverRef.current, seatKey)) continue;
        const lastAt = lastInputAtRef.current[occ.seat] ?? matchStartedAtRef.current;
        if (Date.now() - lastAt < IDLE_VOTE_THRESHOLD_MS) continue;
        channelRef.current?.send({
          type: "broadcast",
          event: "bot-takeover-event",
          payload: {
            event: {
              type: "vote-start",
              seatKey,
              reason: "idle",
              startedAt: Date.now(),
              originalUserId: occ.playerId ?? `${roomCode}:${occ.seat}`,
              originalName: occ.name,
            },
          },
        });
      }
    }, PING_MS);
    return () => window.clearInterval(interval);
  }, [phase, roomCode]);

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
    const taken = new Set(occupants.filter((o) => o.deviceId !== deviceId).map((o) => o.seat));
    let next = 0;
    while (taken.has(next)) next++;
    storeSeat(roomCode, next);
    setMySeat(next);
    channelRef.current?.track({ deviceId, seat: next, name: myName, playerId: myPlayerId, ...hostPresence() } satisfies Occupant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupants, mySeat, phase, deviceId, roomCode, myName, myPlayerId, isHost]);

  /** Waiting room: the host retunes the room; presence carries it to everyone. */
  function updateRoomSettings(patch: { mode?: GameMode; limit?: number | null; difficulty?: Difficulty }) {
    if (!isHost) return;
    if (patch.mode !== undefined) {
      modeRef.current = patch.mode;
      setMode(patch.mode);
    }
    if (patch.limit !== undefined) {
      limitRef.current = patch.limit;
      setLimitChoice(patch.limit);
    }
    if (patch.difficulty !== undefined) {
      difficultyRef.current = patch.difficulty;
      setDifficulty(patch.difficulty);
    }
    if (mySeatRef.current !== null) {
      channelRef.current?.track({ deviceId, seat: mySeatRef.current, name: myName, playerId: myPlayerId, ...hostPresence() } satisfies Occupant);
    }
  }

  /** Starts (or restarts) the match; every seat without a person becomes an AI. */
  function sendGameStart() {
    if (!isHost) return;
    startSentRef.current = true;
    const target = playerCountRef.current;
    const seated = new Set(occupantsRef.current.map((o) => o.seat));
    const botSeats = Array.from({ length: target }, (_, i) => i).filter((i) => !seated.has(i));
    botSeatsRef.current = botSeats;
    if (mySeatRef.current !== null) {
      channelRef.current?.track({ deviceId, seat: mySeatRef.current, name: myName, playerId: myPlayerId, ...hostPresence() } satisfies Occupant);
    }
    channelRef.current?.send({ type: "broadcast", event: "game-start", payload: { seed: randomSeed(), playerCount: target, botSeats, mode: modeRef.current, limit: limitRef.current, difficulty: difficultyRef.current } });
  }

  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current || mySeat === null) return;
    if (practice || occupants.length >= knownTargetPlayerCount) sendGameStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupants, phase, knownTargetPlayerCount, isHost, practice, mySeat]);

  // ---------------------------------------------------------------------
  // Simulation loop — authoritative on the host, predictive elsewhere.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (phase !== "playing") return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastBroadcast = 0;
    let finalSent = false;

    function frame(now: number) {
      acc += Math.min(now - last, 250);
      last = now;
      let sim = simRef.current;
      if (!sim) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const start = sim;
      while (acc >= TICK_MS && sim.phase === "playing") {
        if (isHost) {
          for (const { seat, action } of pendingRef.current.splice(0)) sim = applyAction(sim, seat, action);
          for (let seat = 0; seat < sim.playerCount; seat++) {
            const botSeat = sim.boards[seat].bot || isSeatTakenOver(botTakeoverRef.current, String(seat));
            if (!botSeat || (sim.tick + seat * 3) % BOT_DELAY_TICKS !== 0) continue;
            const a = chooseBotAction(sim, seat);
            if (a) sim = applyAction(sim, seat, a);
          }
          sim = stepGame(sim);
        } else {
          const next = stepGame(sim);
          // Eliminations and the end are the host's call — wait for its snapshot.
          if (next.phase !== "playing" || aliveCount(next) !== aliveCount(sim)) {
            acc = 0;
            break;
          }
          sim = next;
        }
        acc -= TICK_MS;
      }
      if (sim.phase !== "playing") acc = 0;
      if (sim !== start) {
        simRef.current = sim;
        setGameState(sim);
      }
      if (isHost && !finalSent && (now - lastBroadcast >= BROADCAST_INTERVAL_MS || sim.phase !== "playing")) {
        lastBroadcast = now;
        if (sim.phase !== "playing") finalSent = true;
        channelRef.current?.send({ type: "broadcast", event: "state-snapshot", payload: { state: sim } });
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [isHost, phase]);

  function handleAction(action: Action) {
    const seat = mySeat;
    if (seat === null) return;
    if (isHost) pendingRef.current.push({ seat, action });
    else channelRef.current?.send({ type: "broadcast", event: "player-input", payload: { seat, action } });
  }

  function castTakeoverVote(seatKey: string) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey, voterDeviceId: deviceId } } });
  }
  function proveStillHereOrReclaim(seatKey: string) {
    const type = isSeatTakenOver(botTakeover, seatKey) ? "reclaim" : "vote-cancel";
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type, seatKey } } });
  }

  function eligibleVoterCountFor(seatKey: string): number {
    const takenOverSeats = new Set(Object.keys(botTakeover.takeovers).map(Number));
    return occupants.filter((o) => o.seat !== Number(seatKey) && !takenOverSeats.has(o.seat)).length;
  }

  const playerCount = gameState?.playerCount ?? knownTargetPlayerCount;
  const lobbyBots = useMemo(() => (gameState ? gameState.boards.map((b, i) => (b.bot ? i : -1)).filter((i) => i >= 0) : []), [gameState]);
  const lobbyBotKey = lobbyBots.join(",");

  const ids: Record<SeatIndex, string> = useMemo(() => {
    const map: Record<SeatIndex, string> = {};
    const bots = new Set(lobbyBotKey ? lobbyBotKey.split(",").map(Number) : []);
    for (let seat = 0; seat < playerCount; seat++) {
      const occ = occupants.find((o) => o.seat === seat);
      map[seat] = bots.has(seat) ? `${roomCode}:bot${seat}` : (botTakeover.takeovers[seat]?.originalUserId ?? occ?.playerId ?? `${roomCode}:${seat}`);
    }
    return map;
  }, [roomCode, playerCount, occupants, botTakeover, lobbyBotKey]);

  const names: Record<SeatIndex, string> = useMemo(() => {
    const map: Record<SeatIndex, string> = {};
    const bots = new Set(lobbyBotKey ? lobbyBotKey.split(",").map(Number) : []);
    for (let seat = 0; seat < playerCount; seat++) {
      if (bots.has(seat)) {
        map[seat] = `🤖 AI ${seat + 1}`;
        continue;
      }
      const takeover = botTakeover.takeovers[seat];
      if (takeover) {
        map[seat] = `🤖 AI ${takeover.originalName}`;
        continue;
      }
      const occ = occupants.find((o) => o.seat === seat);
      map[seat] = seat === mySeat ? myName : (occ?.name ?? "상대");
    }
    return map;
  }, [occupants, mySeat, myName, playerCount, botTakeover, lobbyBotKey]);

  function handleGameEnd() {
    const sim = simRef.current;
    if (!sim || sim.phase !== "gameOver" || endHandledRef.current) return;
    endHandledRef.current = true;
    const rankings = computeRankings(sim);
    onComplete({
      rankings: rankings.map((r) => ({ playerId: ids[r.seat], rank: r.rank })),
      self: selfResult(mySeat, rankings, { takeovers: botTakeover.takeovers, botSeats: lobbyBots }, (seat) => ({
        maxWave: rankings.find((r) => r.seat === seat)?.wave ?? 0,
        kills: sim.boards[seat]?.kills ?? 0,
        rageKills: sim.boards[seat]?.rageKills ?? 0,
        maxCritCombo: sim.boards[seat]?.bestCombo ?? 0,
        // Real-play combo coverage (tuning target ~38% of waves from W10).
        lateWaves: sim.boards[seat]?.lateWaves ?? 0,
        comboBonusWaves: sim.boards[seat]?.comboBonusWaves ?? 0,
        jamsSent: sim.boards[seat]?.jamsSent ?? 0,
        jamsTaken: sim.boards[seat]?.jamsTaken ?? 0,
        jamsBlocked: sim.boards[seat]?.jamsBlocked ?? 0,
        reflectsTaken: sim.boards[seat]?.reflectsTaken ?? 0,
        // Board upgrades: highest level reached (max) + running totals for averages.
        maxFocus: sim.boards[seat]?.focus ?? 0,
        maxBrace: sim.boards[seat]?.brace ?? 0,
        focusTotal: sim.boards[seat]?.focus ?? 0,
        braceTotal: sim.boards[seat]?.brace ?? 0,
        // Per mode × difficulty bests (`max…` keys keep the highest across games).
        [`maxWave${sim.mode === "versus" ? "Versus" : "Survival"}${{ easy: "Easy", normal: "Normal", hard: "Hard" }[sanitizeDifficulty(sim.difficulty)]}`]:
          rankings.find((r) => r.seat === seat)?.wave ?? 0,
      })),
      finishedAt: new Date().toISOString(),
    });
    if (rankings.find((r) => r.seat === mySeat)?.rank === 1) playVictory();
    setWaveHistory({
      limit: eliminationLimit(sim),
      bossEvery: BOSS_EVERY,
      series: sim.boards.map((b, seat) => ({
        seat,
        color: SEAT_COLORS[seat] ?? "#94a3b8",
        out: !b.alive,
        // Survivors' current wave hasn't been closed out yet — append its running values.
        load: b.alive ? [...(b.loadHistory ?? []), b.wavePeak ?? 0] : (b.loadHistory ?? []),
        gold: b.alive ? [...(b.goldHistory ?? []), Math.round(b.goldEarned ?? 0)] : (b.goldHistory ?? []),
        kills: b.alive ? [...(b.killHistory ?? []), b.kills] : (b.killHistory ?? []),
        upgrades: b.upgradeLog ?? [],
      })),
    });
    const mine = rankings.find((r) => r.seat === mySeat);
    if (mine && mine.wave > 0) {
      const d = sanitizeDifficulty(sim.difficulty);
      setMyRecord({ mode: sim.mode, difficulty: d, wave: mine.wave, prev: recordBestWave(sim.mode, d, mine.wave) });
    } else {
      setMyRecord(null);
    }
    setFinalRankings(rankings);
    setPhase("post-game");
  }

  // Let the last explosion play out before the results screen.
  const isOver = gameState?.phase === "gameOver";
  useEffect(() => {
    if (!isOver || phase !== "playing") return;
    const t = window.setTimeout(handleGameEnd, 2200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOver, phase]);

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
    simRef.current = null;
    setGameState(null);
    setFinalRankings(null);
    botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
    setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
    botSeatsRef.current = [];
    setIdentity({ name: "" });
    setMyPlayerId(undefined);
    setCodeInput("");
    setPractice(false);
    setPhase("choose");
  }

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";

  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(roomCode !== null, handleLeave);
  useBackgroundResync(roomCode !== null && !isHost, requestStateSync);
  useActiveRoomListing({
    gameId: GAME_ID,
    roomCode,
    isHost,
    isWaiting: phase === "waiting" && !practice,
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

  const primaryBtn = "w-full rounded-xl bg-gradient-to-b from-amber-400 to-orange-600 py-3 text-sm font-bold text-white transition hover:brightness-110";
  const ghostBtn =
    "w-full rounded-xl border border-white/15 py-3 text-sm font-semibold text-white/80 transition hover:border-white/30 light:border-slate-300 light:text-slate-700 light:hover:border-slate-400";

  if (phase === "supabase-missing") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 text-center light:border-amber-300 light:bg-amber-50 light:shadow-sm">
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80 light:text-amber-800">
          랜덤 합성 디펜스는 온라인 방 전용이라 Supabase 설정(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)이 필요해요.
        </p>
      </div>,
    );
  }

  if (phase === "room-full") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center light:border-rose-300 light:bg-rose-50 light:shadow-sm">
        <span className="text-3xl">🚫</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">이미 자리가 꽉 찬 방이에요</h2>
        <p className="text-sm text-rose-100/80 light:text-rose-700">코드를 다시 확인하거나 새로운 방을 만들어보세요.</p>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-500">
          처음으로
        </button>
      </div>,
    );
  }

  if (phase === "channel-error") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center light:border-rose-300 light:bg-rose-50 light:shadow-sm">
        <span className="text-3xl">📡</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">연결에 실패했습니다</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-500">
          다시 시도
        </button>
      </div>,
    );
  }

  /** Host pickers shared by the waiting room and the post-game "next round" panel. */
  const roomSettingsProps = {
    mode,
    onMode: (m: GameMode) => updateRoomSettings({ mode: m }),
    best: best[mode],
    difficulty,
    limit: limitChoice,
    playerCount,
    onDifficulty: (d: Difficulty) => updateRoomSettings({ difficulty: d }),
    onLimit: (l: number | null) => updateRoomSettings({ limit: l }),
  };

  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId={GAME_ID}
        icon="🎲"
        title="랜덤 합성 디펜스"
        description={
          <p className="text-sm text-white/50 light:text-slate-500">
            소환하고, 같은 유닛 둘을 합쳐 더 센 유닛으로! {MIN_PLAYERS}~{MAX_PLAYERS}명이 같은 웨이브를 동시에 막는 실시간 생존 대결이에요.
          </p>
        }
        actions={
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => {
                setIntent("create");
                setPractice(true);
                setTargetPlayerCount(2);
                setPhase("enter-name");
              }}
              className={primaryBtn}
            >
              🤖 AI와 바로 대결
            </button>
            <button
              onClick={() => {
                setIntent("create");
                setPractice(false);
                setPhase("enter-name");
              }}
              className={ghostBtn}
            >
              🏰 방 만들기
            </button>
            <button
              onClick={() => {
                setIntent("join");
                setPractice(false);
                trackGameEvent(GAME_ID, "invite_click");
                setPhase("enter-name");
              }}
              className={ghostBtn}
            >
              🔑 초대 코드로 참여
            </button>
          </div>
        }
      />,
    );
  }

  if (phase === "enter-name") {
    const title = intent === "join" ? "초대 코드로 참여" : practice ? "AI와 대결" : "방 만들기";
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 light:border-slate-200 light:bg-white light:shadow-sm">
        <h2 className="text-base font-bold text-white light:text-slate-900">{title}</h2>
        <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} onEnter={enterRoom} accent="amber" />
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-amber-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400"
            />
          </label>
        )}
        {intent === "create" && (
          <RoomSettings
            mode={mode}
            onMode={setMode}
            best={best[mode]}
            difficulty={difficulty}
            limit={limitChoice}
            playerCount={targetPlayerCount}
            onDifficulty={setDifficulty}
            onLimit={setLimitChoice}
          />
        )}
        {intent === "create" && (
          <label className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
            {practice ? `AI 포함 인원 (${MIN_PLAYERS}~${MAX_PLAYERS}명)` : `인원 수 (${MIN_PLAYERS}~${MAX_PLAYERS}명)`}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTargetPlayerCount((n) => Math.max(MIN_PLAYERS, n - 1))}
                className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30 light:border-slate-300 light:text-slate-700"
              >
                −
              </button>
              <span className="w-8 text-center text-lg font-semibold text-white light:text-slate-900">{targetPlayerCount}</span>
              <button
                type="button"
                onClick={() => setTargetPlayerCount((n) => Math.min(MAX_PLAYERS, n + 1))}
                className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30 light:border-slate-300 light:text-slate-700"
              >
                +
              </button>
            </div>
          </label>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 light:bg-rose-50 light:text-rose-700">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-orange-600 py-2.5 text-sm font-semibold text-white hover:bg-orange-500">
            {intent === "join" ? "참여하기" : practice ? "시작하기" : "방 만들기"}
          </button>
        </div>
      </div>,
    );
  }

  if (phase === "connecting" || phase === "waiting") {
    return withGuard(
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center light:border-slate-200 light:bg-white light:shadow-sm">
        {phase === "connecting" || practice ? (
          <p className="text-sm text-white/50 light:text-slate-500">{practice ? "전장을 준비하는 중..." : "연결하는 중..."}</p>
        ) : (
          <WaitingRoomPanel
            roomCode={roomCode}
            shareUrl={shareUrl}
            seats={Array.from({ length: knownTargetPlayerCount }, (_, seat) => occupants.find((o) => o.seat === seat)?.name ?? null)}
            joined={occupants.length}
            mySeat={mySeat}
            hostRules={{ mode: host?.mode, difficulty: host?.difficulty, limit: host?.limit }}
            isHost={isHost}
            settings={{ ...roomSettingsProps, playerCount: knownTargetPlayerCount }}
            onFillWithAi={sendGameStart}
          />
        )}
      </div>,
    );
  }

  if (phase === "playing" && gameState && mySeat !== null && mySeat < gameState.playerCount) {
    const myVoteAsTarget = activeVoteFor(botTakeover, String(mySeat));
    const iAmTakenOver = isSeatTakenOver(botTakeover, String(mySeat));
    const voteToShow = Object.values(botTakeover.votes).find((v) => v.seatKey !== String(mySeat) && `${v.seatKey}:${v.startedAt}` !== dismissedVoteKey);
    return withGuard(
      <div className="flex flex-col gap-2">
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
        <MergeDefenseBoard state={gameState} mySeat={mySeat} names={names} onAction={handleAction} />
      </div>,
    );
  }

  if (phase === "post-game" && finalRankings) {
    return withGuard(
      <MergeDefenseResults
        rankings={finalRankings}
        names={names}
        mySeat={mySeat}
        mode={gameState?.mode}
        myRecord={myRecord}
        history={waveHistory}
        isHost={isHost}
        settings={{ ...roomSettingsProps, playerCount }}
        onLeave={handleLeave}
        onRestart={sendGameStart}
      />,
    );
  }

  return withGuard(null);
}
