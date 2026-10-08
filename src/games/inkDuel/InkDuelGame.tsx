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
import { CharacterPicker, MapPicker, mapLabel, ModePicker, modeLabel, RtRulesPicker, rtRulesLabel, type GameMode } from "./LobbyPickers";
import RealtimeBoard, { type CommandBody } from "./RealtimeBoard";
import { DEFAULT_RT_RULES, newBotMemory, rtBotThink, sanitizeRules, startRealtime, stepRealtime, type RtBotMemory, type RtCommand, type RtInput, type RtRules, type RtState } from "./realtime";
import { RtClientBuffer, snapFromState, viewFromState, type RtSnap, type RtView } from "./rtView";
import { CharacterAvatar } from "./ArenaCanvas";
import { isMapId, MAP_IDS, type MapId } from "./maps";
import {
  applyAction,
  chooseBotAction,
  computeRankings,
  currentActor,
  isStateSyncStale,
  MAX_PLAYERS,
  MIN_PLAYERS,
  startGame,
  type EngineAction,
  type InkDuelState,
  type SeatIndex,
} from "./engine";
import InkDuelBoard from "./InkDuelBoard";
import InkDuelRulebookModal from "./RulebookModal";
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
import { selfResult } from "@/games/shared/selfResult";

/**
 * Online-room multiplayer entry point for 낙서 결투 — same lockstep pattern
 * as every other `<Game>Game.tsx` (docs/cloud-sync.md), cloned from
 * CityChaseGame.tsx's 2~N seat room. The host broadcasts one seed; every
 * client builds the same arena and replays the same `EngineAction`s (each
 * fire action carries the doodle itself, and the flight is simulated
 * deterministically inside engine.ts). Bot turns wait until the host's
 * shot replay has finished so a bot never fires mid-animation.
 */

type Occupant = {
  deviceId: string;
  seat: SeatIndex;
  name: string;
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
  /** Character this player picked (null/undefined = no preference). */
  character?: number;
  /** Host only: the map choice for the next match. */
  mapPick?: MapId | "random";
  /** Host only: 🛑 stop (turn-based) or 🏃 moving (real-time). */
  modePick?: GameMode;
  /** Host only: 🏃 moving-mode tuning. */
  rtRules?: RtRules;
};
type Phase =
  | "choose"
  | "enter-name"
  | "connecting"
  | "waiting"
  | "playing"
  | "post-game"
  | "room-full"
  | "supabase-missing"
  | "channel-error";

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredSeat(code: string): number | null {
  const v = window.localStorage.getItem(`ink-duel-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`ink-duel-seat-${code}`, String(seat));
}

export default function InkDuelGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(2);
  const [formError, setFormError] = useState<string | null>(null);
  const [showRulebook, setShowRulebook] = useState(false);
  const [myChar, setMyChar] = useState<number | null>(null);
  const myCharRef = useRef<number | null>(null);
  const [mapPick, setMapPick] = useState<MapId | "random">("random");
  const mapPickRef = useRef<MapId | "random">("random");
  const [modePick, setModePick] = useState<GameMode>("stop");
  const modePickRef = useRef<GameMode>("stop");
  const [rtRules, setRtRules] = useState<RtRules>(DEFAULT_RT_RULES);
  const rtRulesRef = useRef<RtRules>(DEFAULT_RT_RULES);
  // The running match's mode + 🏃 moving-mode plumbing (host simulates, guests interpolate snapshots).
  const [gameMode, setGameMode] = useState<GameMode>("stop");
  const gameModeRef = useRef<GameMode>("stop");
  const [matchCount, setMatchCount] = useState(0);
  const rtRef = useRef<RtState | null>(null);
  const rtBufferRef = useRef(new RtClientBuffer());
  const [rtHud, setRtHud] = useState<RtView | null>(null);
  const rtHudAtRef = useRef(0);
  // Who runs the 🏃 simulation. Starts as the room host; if the host vanishes mid-match the
  // lowest connected seat takes over from the latest backup (epoch +1; higher epoch always wins).
  const [simHost, setSimHostState] = useState(false);
  const simHostRef = useRef(false);
  const setSimHost = (v: boolean) => {
    simHostRef.current = v;
    setSimHostState(v);
  };
  const epochRef = useRef(0);
  const simHostSeatRef = useRef<number | null>(null);
  const lastSnapAtRef = useRef(0);
  const rtBackupRef = useRef<RtState | null>(null);
  const mySeatRef = useRef<SeatIndex | null>(null);
  const [tookOver, setTookOver] = useState(false);
  const rtInputsRef = useRef<Record<number, RtInput>>({});
  const rtCommandsRef = useRef<RtCommand[]>([]);
  const rtBotMemRef = useRef<Record<number, RtBotMemory>>({});
  const [animating, setAnimating] = useState(false);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  useEffect(() => {
    mySeatRef.current = mySeat;
  }, [mySeat]);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<InkDuelState | null>(null);
  const [finalResult, setFinalResult] = useState<{ lines: string[] } | null>(null);

  const [botSeats, setBotSeats] = useState<SeatIndex[]>([]);
  const botSeatsRef = useRef<SeatIndex[]>([]);
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
  const lastActorRef = useRef<{ actor: SeatIndex | null; since: number }>({ actor: null, since: 0 });
  const IDLE_VOTE_THRESHOLD_MS = 45_000;

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

  const gameStateRef = useRef<InkDuelState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const occupantsRef = useRef<Occupant[]>([]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);

  const namesRef = useRef<Record<SeatIndex, string>>({});

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

  useEffect(() => {
    if (!roomCode) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const deviceId = getDeviceId();
    const channel = supabase.channel(`ink-duel-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const playerCount = payload?.playerCount as number;
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      playerCountRef.current = playerCount;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      const characters = (payload?.characters as (number | null)[] | undefined) ?? [];
      const map = isMapId(payload?.map) ? payload.map : undefined;
      const mode: GameMode = payload?.mode === "moving" ? "moving" : "stop";
      gameModeRef.current = mode;
      setGameMode(mode);
      setMatchCount(playerCount);
      if (mode === "moving") {
        rtInputsRef.current = {};
        rtCommandsRef.current = [];
        rtBotMemRef.current = {};
        rtBufferRef.current = new RtClientBuffer();
        rtRef.current = isHost ? startRealtime(playerCount, seed, { map, characters }, sanitizeRules(payload?.rules)) : null;
        setSimHost(isHost);
        epochRef.current = 0;
        simHostSeatRef.current = null;
        rtBackupRef.current = null;
        lastSnapAtRef.current = performance.now();
        setTookOver(false);
        setRtHud(rtRef.current ? viewFromState(rtRef.current) : null);
        setGameState(null);
      } else {
        rtRef.current = null;
        setRtHud(null);
        setGameState(startGame(playerCount, seed, { map, characters }));
      }
      setFinalResult(null);
      setPhase("playing");
    });

    // 🏃 Moving mode: the host is the only simulator (docs/cloud-sync.md §5).
    channel.on("broadcast", { event: "rt-snapshot" }, ({ payload }) => {
      const snap = payload?.snap as RtSnap | undefined;
      if (!snap) return;
      const epoch = snap.epoch ?? 0;
      if (simHostRef.current) {
        // Someone else is simulating too: the newer epoch (or, on a tie, the lower seat) keeps it.
        const mine = mySeatRef.current ?? 99;
        if (snap.hostSeat === mine || epoch < epochRef.current || (epoch === epochRef.current && (snap.hostSeat ?? 99) > mine)) return;
        setSimHost(false);
        rtRef.current = null;
      }
      if (epoch < epochRef.current) return;
      epochRef.current = epoch;
      simHostSeatRef.current = snap.hostSeat ?? null;
      lastSnapAtRef.current = performance.now();
      rtBufferRef.current.push(snap, performance.now());
      if (gameModeRef.current !== "moving") {
        gameModeRef.current = "moving";
        setGameMode("moving");
        setMatchCount(snap.players.length);
      }
      const now = performance.now();
      if (now - rtHudAtRef.current > 120 || snap.phase === "gameOver") {
        rtHudAtRef.current = now;
        setRtHud(rtBufferRef.current.view(now));
      }
      // A late joiner (or a guest that missed game-start) drops straight into the match.
      setPhase((p) => (p === "waiting" || p === "connecting" ? "playing" : p));
    });
    channel.on("broadcast", { event: "rt-backup" }, ({ payload }) => {
      if (simHostRef.current) return;
      const state = payload?.state as RtState | undefined;
      if (state && (payload?.epoch ?? 0) >= epochRef.current) rtBackupRef.current = state;
    });
    channel.on("broadcast", { event: "rt-input" }, ({ payload }) => {
      if (!simHostRef.current) return;
      const seat = payload?.seat as number;
      const input = payload?.input as RtInput | undefined;
      if (!Number.isInteger(seat) || !input || botSeatsRef.current.includes(seat)) return;
      rtInputsRef.current[seat] = { left: !!input.left, right: !!input.right, jump: !!input.jump };
    });
    channel.on("broadcast", { event: "rt-command" }, ({ payload }) => {
      if (!simHostRef.current) return;
      const command = payload?.command as RtCommand | undefined;
      if (command && Number.isInteger(command.seat)) rtCommandsRef.current.push(command);
    });

    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
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

    channel.on("broadcast", { event: "state-request" }, () => {
      if (gameModeRef.current === "moving") {
        // Only the host knows the live real-time state.
        if (simHostRef.current && rtRef.current) {
          channel.send({
            type: "broadcast",
            event: "state-sync",
            payload: { rt: { ...snapFromState(rtRef.current, { full: true }), epoch: epochRef.current, hostSeat: mySeatRef.current ?? undefined }, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current, botTakeover: botTakeoverRef.current },
          });
        }
        return;
      }
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
      const rt = payload?.rt as RtSnap | undefined;
      if (rt) {
        if (simHostRef.current) return;
        epochRef.current = Math.max(epochRef.current, rt.epoch ?? 0);
        lastSnapAtRef.current = performance.now();
        rtBufferRef.current.push(rt, performance.now());
        gameModeRef.current = "moving";
        setGameMode("moving");
        setMatchCount(rt.players.length);
        const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
        botSeatsRef.current = roster;
        setBotSeats(roster);
        const takeover = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
        botTakeoverRef.current = takeover;
        setBotTakeover(takeover);
        setRtHud(rtBufferRef.current.view(performance.now()));
        setFinalResult(null);
        setPhase("playing");
        return;
      }
      const state = payload?.state as InkDuelState | undefined;
      if (!state) return;
      // See engine.ts's `isStateSyncStale` doc — rejects a snapshot that
      // raced behind this client's own already-applied `game-action`.
      if (isStateSyncStale(gameStateRef.current, state)) return;
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      const takeover = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = takeover;
      setBotTakeover(takeover);
      setGameState(state);
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
          character: myCharRef.current ?? undefined,
          ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current, mapPick: mapPickRef.current, modePick: modePickRef.current, rtRules: rtRulesRef.current } : {}),
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
  const hostMapLabel = mapLabel(host?.mapPick);
  const hostModeLabel = modeLabel(host?.modePick);
  const hostRulesLabel = host?.modePick === "moving" ? rtRulesLabel(host?.rtRules) : "";
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
      character: myCharRef.current ?? undefined,
      ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current, mapPick: mapPickRef.current, modePick: modePickRef.current, rtRules: rtRulesRef.current } : {}),
    } satisfies Occupant);
  }, [occupants, mySeat, phase, deviceId, roomCode, myName, myPlayerId, isHost]);

  const sendGameStart = useCallback(() => {
    startSentRef.current = true;
    // Early start ("지금 시작") may leave target seats empty — only count the
    // filled ones so no phantom seat ever gets a turn (see RatATatCat).
    const filledCount = Math.min(playerCountRef.current, occupantsRef.current.length + botSeatsRef.current.length);
    const characters = Array.from({ length: filledCount }, (_, seat) => occupantsRef.current.find((o) => o.seat === seat)?.character ?? null);
    const pick = mapPickRef.current;
    const map = pick === "random" ? MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)] : pick;
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: { seed: Math.floor(Math.random() * 2 ** 31), playerCount: filledCount, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current, characters, map, mode: modePickRef.current, rules: rtRulesRef.current },
    });
  }, []);

  /** Re-publish my presence after changing my character (or, as host, the map). */
  const retrack = (next: { character?: number | null; map?: MapId | "random"; mode?: GameMode; rules?: RtRules }) => {
    if (next.rules !== undefined) {
      rtRulesRef.current = next.rules;
      setRtRules(next.rules);
    }
    if (next.mode !== undefined) {
      modePickRef.current = next.mode;
      setModePick(next.mode);
    }
    if (next.character !== undefined) {
      myCharRef.current = next.character;
      setMyChar(next.character);
    }
    if (next.map !== undefined) {
      mapPickRef.current = next.map;
      setMapPick(next.map);
    }
    if (mySeat === null || !channelRef.current) return;
    channelRef.current.track({
      deviceId,
      seat: mySeat,
      name: myName,
      playerId: myPlayerId,
      character: myCharRef.current ?? undefined,
      ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current, mapPick: mapPickRef.current, modePick: modePickRef.current, rtRules: rtRulesRef.current } : {}),
    } satisfies Occupant);
  };

  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current) return;
    if (occupants.length + botSeats.length >= knownTargetPlayerCount) {
      sendGameStart();
    }
  }, [occupants, botSeats, phase, knownTargetPlayerCount, isHost, sendGameStart]);

  const addBotAtSeat = useCallback(
    (seat: SeatIndex, level: BotLevel) => {
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

  // Host-only: fill every currently-empty seat with a bot of one chosen
  // level in a single click (same "bot-roster" broadcast as `addBotAtSeat`,
  // just with every empty seat appended at once instead of one).
  const fillEmptySeatsWithBots = useCallback(
    (level: BotLevel) => {
      if (!isHost) return;
      const taken = new Set<SeatIndex>([...occupants.map((o) => o.seat), ...botSeatsRef.current]);
      const emptySeats = Array.from({ length: knownTargetPlayerCount }, (_, seat) => seat as SeatIndex).filter(
        (seat) => !taken.has(seat),
      );
      if (emptySeats.length === 0) return;
      const nextSeats = [...botSeatsRef.current, ...emptySeats];
      const nextLevels = [...botLevelsRef.current, ...emptySeats.map(() => level)];
      botSeatsRef.current = nextSeats;
      setBotSeats(nextSeats);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      channelRef.current?.send({
        type: "broadcast",
        event: "bot-roster",
        payload: { botSeats: nextSeats, botLevels: nextLevels },
      });
    },
    [isHost, occupants, knownTargetPlayerCount],
  );

  const removeBotAtSeat = useCallback(
    (seat: SeatIndex) => {
      if (!isHost) return;
      const idx = botSeatsRef.current.indexOf(seat);
      if (idx < 0) return;
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

  // 🏃 Moving mode host loop: bots think, the world steps, snapshots go out ~12/s.
  useEffect(() => {
    if (!(phase === "playing" && gameMode === "moving" && simHost)) return;
    let raf = 0;
    let last = performance.now();
    let lastSnap = 0;
    let lastHud = 0;
    let lastBackup = 0;
    let terrainVer = -1;
    let wallsVer = -1;
    let terrainFreshUntil = 0;
    let wallsFreshUntil = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const s = rtRef.current;
      if (!s) return;
      const dt = Math.min(100, now - last);
      last = now;
      const cmds = rtCommandsRef.current.splice(0);
      const botSet = new Set<number>([...botSeatsRef.current, ...Object.keys(botTakeoverRef.current.takeovers).map(Number)]);
      for (const seat of botSet) {
        if (!s.players[seat]) continue;
        const mem = (rtBotMemRef.current[seat] ??= newBotMemory(Math.random));
        const idx = botSeatsRef.current.indexOf(seat);
        const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
        const c = rtBotThink(s, seat, level, mem, Math.random);
        if (c) cmds.push(c);
        rtInputsRef.current[seat] = mem.input;
      }
      stepRealtime(s, dt, rtInputsRef.current, cmds);
      if (s.terrainVer !== terrainVer) {
        terrainVer = s.terrainVer;
        terrainFreshUntil = now + 1000;
      }
      if (s.wallsVer !== wallsVer) {
        wallsVer = s.wallsVer;
        wallsFreshUntil = now + 1000;
      }
      if (now - lastSnap >= 80) {
        lastSnap = now;
        const snap = { ...snapFromState(s, { terrainFresh: now < terrainFreshUntil, wallsFresh: now < wallsFreshUntil }), epoch: epochRef.current, hostSeat: mySeatRef.current ?? undefined };
        channelRef.current?.send({ type: "broadcast", event: "rt-snapshot", payload: { snap } });
      }
      if (now - lastBackup >= 500 && s.phase === "playing") {
        // Full state for a guest to resume from if this tab disappears (events stripped — they're cosmetic).
        lastBackup = now;
        channelRef.current?.send({ type: "broadcast", event: "rt-backup", payload: { state: { ...s, events: [] }, epoch: epochRef.current } });
      }
      if (now - lastHud >= 120) {
        lastHud = now;
        setRtHud(viewFromState(s));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, gameMode, simHost]);

  // Guests watch for a silent simulation host and the lowest connected seat takes over.
  useEffect(() => {
    if (!(phase === "playing" && gameMode === "moving" && !simHost)) return;
    const id = window.setInterval(() => {
      const backup = rtBackupRef.current;
      const me = mySeatRef.current;
      if (!backup || me === null || backup.phase !== "playing") return;
      if (performance.now() - lastSnapAtRef.current < 2500) return;
      const silent = simHostSeatRef.current;
      const humans = occupantsRef.current.map((o) => o.seat).filter((seat) => seat !== silent && !botSeatsRef.current.includes(seat));
      if (humans.length === 0 || Math.min(...humans) !== me) return;
      rtRef.current = JSON.parse(JSON.stringify(backup)) as RtState;
      rtInputsRef.current = {};
      rtCommandsRef.current = [];
      rtBotMemRef.current = {};
      epochRef.current += 1;
      simHostSeatRef.current = me;
      lastSnapAtRef.current = performance.now();
      setSimHost(true);
      setTookOver(true);
    }, 500);
    return () => window.clearInterval(id);
  }, [phase, gameMode, simHost]);

  const getRtView = useCallback(
    (now: number): RtView | null => (simHost ? (rtRef.current ? viewFromState(rtRef.current) : null) : rtBufferRef.current.view(now)),
    [simHost],
  );
  const sendRtInput = useCallback(
    (input: RtInput) => {
      if (mySeat === null) return;
      if (simHost) rtInputsRef.current[mySeat] = input;
      else channelRef.current?.send({ type: "broadcast", event: "rt-input", payload: { seat: mySeat, input } });
    },
    [simHost, mySeat],
  );
  const sendRtCommand = useCallback(
    (cmd: CommandBody) => {
      if (mySeat === null) return;
      const command = { ...cmd, seat: mySeat } as RtCommand;
      if (simHost) rtCommandsRef.current.push(command);
      else channelRef.current?.send({ type: "broadcast", event: "rt-command", payload: { command } });
    },
    [simHost, mySeat],
  );

  function castTakeoverVote(seatKey: string) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey, voterDeviceId: deviceId } } });
  }
  function proveStillHereOrReclaim(seatKey: string) {
    const type = isSeatTakenOver(botTakeover, seatKey) ? "reclaim" : "vote-cancel";
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type, seatKey } } });
  }

  // See DalmutiGame.tsx's 2026-09-03 freeze-fix comment: depends on a
  // stable string key (not the whole `botTakeover` object) so an unrelated
  // seat's vote/convert broadcast can't reset a bot's in-flight action
  // timer via `useBotAutoplay`.
  const takeoverSeatKey = Object.keys(botTakeover.takeovers).sort().join(",");
  const takeoverSeats = useMemo(() => (takeoverSeatKey ? (takeoverSeatKey.split(",").map(Number) as SeatIndex[]) : []), [takeoverSeatKey]);
  const allBotSeatSet = useMemo(() => new Set([...botSeatSet, ...takeoverSeats]), [botSeatSet, takeoverSeats]);

  const chooseAction = useCallback((state: InkDuelState, actor: SeatIndex): EngineAction | null => {
    const idx = botSeatsRef.current.indexOf(actor);
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return chooseBotAction(state, actor, level);
  }, []);

  useBotAutoplay<InkDuelState, EngineAction, SeatIndex>({
    // Hold bot turns while the shot replay is still on the host's screen.
    active: isHost && phase === "playing" && gameState?.phase !== "gameOver" && !animating,
    state: gameState,
    currentActor,
    botSeats: allBotSeatSet,
    chooseAction,
    dispatch: handleAction,
  });

  // "무응답(idle)" takeover trigger — see DalmutiGame.tsx/NoThanksGame.tsx for the full rationale.
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = window.setInterval(() => {
      const state = gameStateRef.current;
      if (!state) return;
      const actor = currentActor(state);
      if (actor !== lastActorRef.current.actor) {
        lastActorRef.current = { actor, since: Date.now() };
        return;
      }
      if (actor === null) return;
      if (botSeatsRef.current.includes(actor)) return;
      const seatKey = String(actor);
      if (activeVoteFor(botTakeoverRef.current, seatKey) || isSeatTakenOver(botTakeoverRef.current, seatKey)) return;
      if (Date.now() - lastActorRef.current.since < IDLE_VOTE_THRESHOLD_MS) return;
      const occ = occupantsRef.current.find((o) => o.seat === actor);
      channelRef.current?.send({
        type: "broadcast",
        event: "bot-takeover-event",
        payload: {
          event: {
            type: "vote-start",
            seatKey,
            reason: "idle",
            startedAt: Date.now(),
            originalUserId: occ?.playerId ?? `${roomCode}:${actor}`,
            originalName: occ?.name ?? namesRef.current[actor] ?? "상대",
          },
        },
      });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [phase, roomCode]);

  const ids: Record<SeatIndex, string> = useMemo(() => {
    const map: Record<SeatIndex, string> = {};
    const count = gameState?.playerCount ?? (matchCount || knownTargetPlayerCount);
    for (let seat = 0; seat < count; seat++) {
      const occ = occupants.find((o) => o.seat === seat);
      map[seat] = botTakeover.takeovers[seat]?.originalUserId ?? occ?.playerId ?? `${roomCode}:${seat}`;
    }
    return map;
  }, [roomCode, gameState, matchCount, knownTargetPlayerCount, occupants, botTakeover]);

  const names: Record<SeatIndex, string> = useMemo(() => {
    const map: Record<SeatIndex, string> = {};
    const count = gameState?.playerCount ?? (matchCount || knownTargetPlayerCount);
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
  }, [occupants, mySeat, myName, gameState, matchCount, knownTargetPlayerCount, botSeats, botLevels, botTakeover]);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);

  const connectedSeats = useMemo(() => new Set([...occupants.map((o) => o.seat), ...botSeats, ...takeoverSeats]), [occupants, botSeats, takeoverSeats]);

  function eligibleVoterCountFor(seatKey: string): number {
    const takenOverSeats = new Set(Object.keys(botTakeover.takeovers).map(Number));
    return occupants.filter((o) => o.seat !== Number(seatKey) && !botSeats.includes(o.seat) && !takenOverSeats.has(o.seat)).length;
  }

  function handleGameEnd() {
    const src = gameMode === "moving" ? rtHud : gameState;
    if (!src || src.phase !== "gameOver") return;
    const rankings = computeRankings(src);
    const dealt = (seat: SeatIndex) => (gameMode === "moving" ? (rtHud?.players[seat]?.damageDealt ?? 0) : (gameState?.damageDealt[seat] ?? 0));
    onComplete({
      rankings: rankings.map((r) => ({ playerId: ids[r.seat], rank: r.rank })),
      self: selfResult(mySeat, rankings, { takeovers: botTakeover.takeovers, botSeats, botLevels }),
      finishedAt: new Date().toISOString(),
    });
    setFinalResult({
      lines: rankings
        .slice()
        .sort((a, b) => a.rank - b.rank)
        .map((r) => `${r.rank === 1 ? "🏆" : `${r.rank}위`} ${names[r.seat]} — 가한 피해 ${dealt(r.seat)}`),
    });
    setPhase("post-game");
  }

  function handleRematch() {
    sendGameStart();
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
    rtRef.current = null;
    setRtHud(null);
    gameModeRef.current = "stop";
    setGameMode("stop");
    setSimHost(false);
    rtBackupRef.current = null;
    setTookOver(false);
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
    setAnimating(false);
    setPhase("choose");
  }

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";

  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(roomCode !== null, handleLeave);
  useBackgroundResync(roomCode !== null, requestStateSync);
  // Desktop lobby dashboard "실시간 활성 대기실" panel (src/app/page.tsx) —
  // best-effort, see useActiveRoomListing.ts.
  useActiveRoomListing({
    gameId: "ink-duel",
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
        {showRulebook && <InkDuelRulebookModal onClose={() => setShowRulebook(false)} />}
      </>
    );
  }

  if (phase === "supabase-missing") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 light:border-amber-300 light:bg-amber-50 p-8 text-center">
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80 light:text-amber-800">
          낙서 결투는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
          <code className="mx-1 rounded bg-black/30 light:bg-slate-200 light:text-slate-800 px-1.5 py-0.5 text-xs">.env.local</code>
          에 <code className="rounded bg-black/30 light:bg-slate-200 light:text-slate-800 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code> /
          <code className="mx-1 rounded bg-black/30 light:bg-slate-200 light:text-slate-800 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
          를 채워주세요 (README 참고).
        </p>
      </div>
    );
  }

  if (phase === "room-full") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 light:border-rose-300 light:bg-rose-50 p-8 text-center">
        <span className="text-3xl">🚫</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">이미 다른 사람이 참여 중인 방이에요</h2>
        <p className="text-sm text-rose-100/80 light:text-rose-700">코드를 다시 확인하거나 새로운 방을 만들어보세요.</p>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
          처음으로
        </button>
      </div>
    );
  }

  if (phase === "channel-error") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 light:border-rose-300 light:bg-rose-50 p-8 text-center">
        <span className="text-3xl">📡</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">연결에 실패했습니다</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
          다시 시도
        </button>
      </div>
    );
  }

  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId="ink-duel"
        icon="✏️"
        title="낙서 결투 온라인 대전"
        description={<p className="text-sm text-white/50 light:text-slate-500">2~4인 턴제 포격전. 공책에 그린 낙서가 그대로 무기가 되어 날아가요 — 곧은 선은 창, 닫힌 도형은 폭탄, 지그재그는 번개! AI 봇과 혼자서도 즐길 수 있어요.</p>}
        actions={
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => {
                setIntent("create");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              🎲 방 만들기
            </button>
            <button
              onClick={() => {
                setIntent("join");
                trackGameEvent("ink-duel", "invite_click");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl border border-white/15 light:border-slate-300 py-3 text-sm font-semibold text-white/80 light:text-slate-700 transition hover:border-white/30 light:hover:border-slate-400"
            >
              🔑 초대 코드로 참여
            </button>
            <button onClick={() => setShowRulebook(true)} className="w-full rounded-xl border border-white/10 light:border-slate-200 py-2.5 text-xs text-white/50 light:text-slate-500 transition hover:border-white/25 light:hover:border-slate-400">
              📖 룰북 보기
            </button>
          </div>
        }
      />
    );
  }

  if (phase === "enter-name") {
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white/90 light:shadow-sm p-6">
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
              className="rounded-lg border border-white/10 bg-white/5 light:border-slate-300 light:bg-white px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white light:text-slate-900 placeholder:text-white/20 light:placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none"
            />
          </label>
        )}
        {intent === "create" && (
          <label className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
            인원 수 ({MIN_PLAYERS}~{MAX_PLAYERS}명)
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTargetPlayerCount((n) => Math.max(MIN_PLAYERS, n - 1))}
                className="h-8 w-8 rounded-full border border-white/15 light:border-slate-300 text-white/80 light:text-slate-700 hover:border-white/30 light:hover:border-slate-400"
              >
                −
              </button>
              <span className="w-8 text-center text-lg font-semibold text-white light:text-slate-900">{targetPlayerCount}</span>
              <button
                type="button"
                onClick={() => setTargetPlayerCount((n) => Math.min(MAX_PLAYERS, n + 1))}
                className="h-8 w-8 rounded-full border border-white/15 light:border-slate-300 text-white/80 light:text-slate-700 hover:border-white/30 light:hover:border-slate-400"
              >
                +
              </button>
            </div>
          </label>
        )}
        <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
          내 캐릭터 <span className="text-[11px] text-white/40 light:text-slate-400">(대기실에서도 바꿀 수 있어요 · 겹치면 먼저 고른 사람 우선)</span>
          <CharacterPicker
            value={myChar}
            onChange={(c) => {
              myCharRef.current = c;
              setMyChar(c);
            }}
          />
        </div>
        {intent === "create" && (
          <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
            모드
            <ModePicker
              value={modePick}
              onChange={(m) => {
                modePickRef.current = m;
                setModePick(m);
              }}
            />
            {modePick === "moving" && (
              <RtRulesPicker
                value={rtRules}
                onChange={(r) => {
                  rtRulesRef.current = r;
                  setRtRules(r);
                }}
              />
            )}
          </div>
        )}
        {intent === "create" && (
          <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
            맵
            <MapPicker
              value={mapPick}
              onChange={(m) => {
                mapPickRef.current = m;
                setMapPick(m);
              }}
            />
          </div>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 light:bg-rose-50 px-3 py-2 text-xs text-rose-300 light:text-rose-700">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 light:border-slate-300 py-2.5 text-sm text-white/70 light:text-slate-600 hover:border-white/30 light:hover:border-slate-400">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
            {intent === "create" ? "방 만들기" : "참여하기"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "connecting" || phase === "waiting") {
    return withGuard(
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white/90 light:shadow-sm p-8 text-center">
        {phase === "connecting" ? (
          <p className="text-sm text-white/50 light:text-slate-500">연결하는 중...</p>
        ) : (
          <>
            <p className="text-sm text-white/50 light:text-slate-500">초대 코드</p>
            <p className="text-4xl font-bold tracking-[0.3em] text-white light:text-slate-900">{roomCode}</p>
            <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="rounded-full border border-white/15 light:border-slate-300 px-4 py-2 text-xs text-white/70 light:text-slate-600 hover:border-white/30 light:hover:border-slate-400">
              🔗 초대 링크 복사
            </button>
            <p className="text-xs text-white/50 light:text-slate-500">
              {occupants.length + botSeats.length} / {knownTargetPlayerCount}명 참여 중
            </p>
            {isHost && occupants.length + botSeats.length < knownTargetPlayerCount && (
              <FillEmptySeatsButton
                emptyCount={knownTargetPlayerCount - occupants.length - botSeats.length}
                onFill={fillEmptySeatsWithBots}
              />
            )}
            <div className="mt-2 flex flex-col gap-1.5">
              {Array.from({ length: knownTargetPlayerCount }, (_, seat) => {
                const occ = occupants.find((o) => o.seat === seat);
                const botIdx = botSeats.indexOf(seat);
                const isBot = botIdx >= 0;
                return (
                  <div key={seat} className="flex items-center justify-between gap-3 text-sm text-white/70 light:text-slate-600">
                    <span className="flex items-center gap-1.5">
                      {occ && (occ.character !== undefined && occ.character !== null ? <CharacterAvatar char={occ.character} size={24} /> : <Avatar size={20} />)}
                      {seat === mySeat ? "나" : `${seat + 1}번`}: {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30 light:text-slate-400">대기 중...</span>}
                    </span>
                    {isHost && seat !== mySeat && !occ && (isBot ? <RemoveBotButton onClick={() => removeBotAtSeat(seat)} /> : <AddBotButton onAddWithLevel={(level) => addBotAtSeat(seat, level)} />)}
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex w-full max-w-md flex-col gap-1.5 text-left text-xs text-white/60 light:text-slate-500">
              내 캐릭터
              <CharacterPicker
                value={myChar}
                onChange={(c) => retrack({ character: c })}
                takenBy={Object.fromEntries(
                  occupants.filter((o) => o.deviceId !== deviceId && typeof o.character === "number").map((o) => [o.character as number, o.name]),
                )}
              />
            </div>
            {isHost ? (
              <div className="flex w-full max-w-md flex-col gap-1.5 text-left text-xs text-white/60 light:text-slate-500">
                모드
                <ModePicker value={modePick} onChange={(m) => retrack({ mode: m })} />
                {modePick === "moving" && (
                  <>
                    무빙 모드 설정
                    <RtRulesPicker value={rtRules} onChange={(r) => retrack({ rules: r })} />
                  </>
                )}
                맵
                <MapPicker value={mapPick} onChange={(m) => retrack({ map: m })} />
              </div>
            ) : (
              (hostMapLabel || hostModeLabel) && (
                <p className="text-xs text-white/60 light:text-slate-500">
                  {hostModeLabel} {hostMapLabel && `· 맵: ${hostMapLabel}`} {hostRulesLabel && `· ${hostRulesLabel}`}
                </p>
              )
            )}
            <p className="text-xs text-white/40 light:text-slate-400">{knownTargetPlayerCount}명이 모이면 자동으로 게임이 시작됩니다. AI 봇으로도 채울 수 있어요.</p>
            {isHost && occupants.length + botSeats.length >= MIN_PLAYERS && occupants.length + botSeats.length < knownTargetPlayerCount && (
              <button onClick={sendGameStart} className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500">
                지금 시작 ({occupants.length + botSeats.length}명)
              </button>
            )}
            <button onClick={() => setShowRulebook(true)} className="rounded-full border border-white/10 light:border-slate-200 px-3 py-1 text-[11px] text-white/50 light:text-slate-500 hover:border-white/25 light:hover:border-slate-400">
              📖 룰북
            </button>
          </>
        )}
      </div>
    );
  }

  if (phase === "playing" && mySeat !== null && gameMode === "moving") {
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
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-300 light:text-amber-700">🏃 무빙 모드 — 실시간</span>
          {tookOver && simHost && <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-semibold text-sky-300 light:text-sky-700">📡 방장 연결이 끊겨 내 기기가 게임을 이어서 진행 중</span>}
          <button onClick={() => setShowRulebook(true)} className="rounded-full border border-white/10 light:border-slate-200 px-3 py-1 text-[11px] text-white/50 light:text-slate-500 hover:border-white/25 light:hover:border-slate-400">
            📖 룰북
          </button>
        </div>
        <RealtimeBoard
          getView={getRtView}
          hud={rtHud}
          viewerSeat={mySeat}
          names={names}
          connectedSeats={connectedSeats}
          onInput={sendRtInput}
          onCommand={sendRtCommand}
          onGameEnd={handleGameEnd}
        />
      </>
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
        <div className="mb-2 flex justify-end">
          <button onClick={() => setShowRulebook(true)} className="rounded-full border border-white/10 light:border-slate-200 px-3 py-1 text-[11px] text-white/50 light:text-slate-500 hover:border-white/25 light:hover:border-slate-400">
            📖 룰북
          </button>
        </div>
        <InkDuelBoard
          state={gameState}
          viewerSeat={mySeat}
          names={names}
          connectedSeats={connectedSeats}
          onAction={handleAction}
          onAnimatingChange={setAnimating}
          onGameEnd={handleGameEnd}
        />
      </>
    );
  }

  if (phase === "post-game" && finalResult) {
    return withGuard(
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white/90 light:shadow-sm p-8 text-center">
        <span className="text-4xl">✏️</span>
        <ol className="flex flex-col gap-1 text-sm text-white/80 light:text-slate-700">
          {finalResult.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <div className="flex gap-2">
          <button onClick={handleLeave} className="rounded-xl border border-white/15 light:border-slate-300 px-4 py-2.5 text-sm text-white/70 light:text-slate-600 hover:border-white/30 light:hover:border-slate-400">
            나가기
          </button>
          <button onClick={handleRematch} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
            다시하기
          </button>
        </div>
      </div>
    );
  }

  return withGuard(null);
}
