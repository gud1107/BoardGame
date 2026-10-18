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
import {
  applyAction,
  chooseBotAction,
  currentActor,
  DEFAULT_TIME_CONTROL,
  otherColor,
  otherSeat,
  SEATS,
  startGame,
  TIME_CONTROLS,
  type ChessState,
  type Color,
  type EngineAction,
  type Seat,
} from "./engine";
import ChessBoard from "./ChessBoard";
import ChessRulebookModal from "./RulebookModal";
import { chessStatDetails } from "./stats";
import { useBotAutoplay } from "@/games/shared/bot/useBotAutoplay";
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
import { roleSelfResult } from "@/games/shared/selfResult";
import { AddBotButton, BotSeatBadge, RemoveBotButton } from "@/components/lobby/BotSeatControls";
import RulebookGate from "@/components/lobby/RulebookGate";
import { BotTakeoverSelfBanner, BotTakeoverVoteModal } from "@/components/lobby/BotTakeoverVoteModal";
import { DEFAULT_BOT_LEVEL, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { requestBotAction } from "@/games/shared/bot/botWorkerClient";
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

/**
 * Online-room entry point for 체스 — the 2-player lockstep wiring of
 * `splendorDuel/SplendorDuelGame.tsx` (seed broadcast → `startGame`, every
 * move replays as an `EngineAction`), plus chess-specific pieces:
 *
 * - Room settings (§2, §12.1): the host picks the time control and their
 *   colour in the waiting room; synced via `room-settings` and carried in
 *   `game-start`. A rematch swaps colours.
 * - Clock (§12.2): each client records when it saw the current turn begin
 *   (`turnStartRef`, set in the broadcast handler, not an effect) and stamps
 *   its own moves — and the host its bots' moves — with `spentMs`. Any client
 *   whose local view of the side-to-move's clock hits zero sends `flag`.
 * - Bots Lv.5+ think in the shared Web Worker (search up to 1.6 s).
 */

type Occupant = {
  deviceId: string;
  role: Seat;
  name: string;
  playerId?: string;
};

type Phase = "choose" | "enter-name" | "connecting" | "waiting" | "playing" | "room-full" | "supabase-missing" | "channel-error";

type HostColor = Color | "random";
interface RoomSettings {
  timeControlId: string;
  hostColor: HostColor;
}
const DEFAULT_SETTINGS: RoomSettings = { timeControlId: DEFAULT_TIME_CONTROL, hostColor: "random" };

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredRole(code: string): Seat | null {
  try {
    const v = window.localStorage.getItem(`chess-role-${code}`);
    return v === "p1" || v === "p2" ? v : null;
  } catch {
    return null;
  }
}

function storeRole(code: string, role: Seat) {
  try {
    window.localStorage.setItem(`chess-role-${code}`, role);
  } catch {
    /* private mode */
  }
}

function chessCurrentActor(state: ChessState): Seat | null {
  return currentActor(state);
}

const THEME = "border-white/10 bg-gradient-to-b from-[#1b1611] via-[#0e0c0a] to-black";

export default function ChessGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [showRulebook, setShowRulebook] = useState(false);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Seat | null>(null);
  const myRoleRef = useRef<Seat | null>(null);
  useEffect(() => {
    myRoleRef.current = myRole;
  }, [myRole]);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<ChessState | null>(null);
  const [turnStartedAt, setTurnStartedAt] = useState(0);
  const turnStartRef = useRef(0);
  const flagSentRef = useRef<string | null>(null);

  const [settings, setSettings] = useState<RoomSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef<RoomSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const [botRoles, setBotRoles] = useState<Seat[]>([]);
  const botRolesRef = useRef<Seat[]>([]);
  useEffect(() => {
    botRolesRef.current = botRoles;
  }, [botRoles]);
  const [botLevels, setBotLevels] = useState<BotLevel[]>([]);
  const botLevelsRef = useRef<BotLevel[]>([]);
  useEffect(() => {
    botLevelsRef.current = botLevels;
  }, [botLevels]);
  const botRoleSet = useMemo(() => new Set(botRoles), [botRoles]);

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
  // §19: a clocked game already punishes stalling (the clock runs out), so the
  // idle vote is only for 무제한 games — and long, since thinking is normal in chess.
  const IDLE_VOTE_THRESHOLD_MS = 180_000;
  const occupantsRef = useRef<Occupant[]>([]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  function requestStateSync() {
    const channel = channelRef.current;
    if (!channel) return;
    if (channel.state !== "joined") channel.subscribe();
    channel.send({ type: "broadcast", event: "state-request", payload: {} });
  }
  const startSentRef = useRef(false);
  const completedRef = useRef(false);

  const gameStateRef = useRef<ChessState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  /** Host while present, otherwise the guest — the one client allowed to commit actions. */
  function isAuthorityNow() {
    return myRoleRef.current === "p1" || !occupantsRef.current.some((o) => o.role === "p1");
  }
  function sendAction(action: EngineAction) {
    const channel = channelRef.current;
    if (!channel) return;
    channel.send({ type: "broadcast", event: isAuthorityNow() ? "game-action" : "propose", payload: { action } });
  }

  /** The client just saw a new turn begin (clock reference point, §12.2). */
  function markTurnStart() {
    const t = Date.now();
    turnStartRef.current = t;
    setTurnStartedAt(t);
  }

  const namesRef = useRef<Record<Seat, string>>({ p1: "상대", p2: "상대" });
  const takeoverRoles = useMemo(() => Object.keys(botTakeover.takeovers) as Seat[], [botTakeover]);
  const allBotRoleSet = useMemo(() => new Set([...botRoleSet, ...takeoverRoles]), [botRoleSet, takeoverRoles]);

  const opponentSeat = myRole ? otherSeat(myRole) : null;
  const names: Record<Seat, string> = useMemo(() => {
    const byRole = (r: Seat) => occupants.find((o) => o.role === r)?.name;
    const fallback = (r: Seat) => {
      const idx = botRoles.indexOf(r);
      return idx >= 0 ? botDisplayName(idx, botLevels[idx]) : "상대";
    };
    const takenOver = (r: Seat) => botTakeover.takeovers[r];
    return {
      p1: takenOver("p1") ? `🤖 AI ${takenOver("p1")!.originalName}` : ((myRole === "p1" ? myName : byRole("p1")) ?? fallback("p1")),
      p2: takenOver("p2") ? `🤖 AI ${takenOver("p2")!.originalName}` : ((myRole === "p2" ? myName : byRole("p2")) ?? fallback("p2")),
    };
  }, [occupants, myRole, myName, botRoles, botLevels, botTakeover]);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);
  const ids: Record<Seat, string> = useMemo(() => {
    const byRole = (r: Seat) => occupants.find((o) => o.role === r)?.playerId;
    return {
      p1: botTakeover.takeovers.p1?.originalUserId ?? byRole("p1") ?? `${roomCode}:p1`,
      p2: botTakeover.takeovers.p2?.originalUserId ?? byRole("p2") ?? `${roomCode}:p2`,
    };
  }, [roomCode, occupants, botTakeover]);
  const opponentIsBot = opponentSeat ? allBotRoleSet.has(opponentSeat) : false;
  const opponentConnected = (opponentSeat ? occupants.some((o) => o.role === opponentSeat) : false) || opponentIsBot;

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
    const role: Seat = getStoredRole(code) ?? (intent === "create" ? "p1" : "p2");
    storeRole(code, role);
    window.history.replaceState(null, "", `${window.location.pathname}?room=${code}`);
    setMyName(name);
    setMyPlayerId(identity.name.trim() ? identity.playerId : undefined);
    setMyRole(role);
    setRoomCode(code);
    setPhase("connecting");
  }

  useEffect(() => {
    if (!roomCode || !myRole) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const deviceId = getDeviceId();
    const channel = supabase.channel(`chess-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;
    completedRef.current = false;

    const adoptRoster = (payload: Record<string, unknown> | undefined) => {
      const roster = (payload?.botRoles as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botRolesRef.current = roster;
      setBotRoles(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
    };
    const adoptSettings = (payload: Record<string, unknown> | undefined) => {
      const s = payload?.settings as RoomSettings | undefined;
      if (!s) return;
      settingsRef.current = s;
      setSettings(s);
    };

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      adoptRoster(payload);
      adoptSettings(payload);
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      completedRef.current = false;
      flagSentRef.current = null;
      const s = (payload?.settings as RoomSettings | undefined) ?? settingsRef.current;
      const next = startGame(payload?.seed as number, { timeControlId: s.timeControlId, hostColor: s.hostColor });
      gameStateRef.current = next;
      setGameState(next);
      markTurnStart();
      setPhase("playing");
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      const prev = gameStateRef.current;
      if (!prev || !action) return;
      const next = applyAction(prev, action);
      if (next === prev) return;
      gameStateRef.current = next;
      if (next.moves.length !== prev.moves.length) markTurnStart();
      setGameState(next);
    });

    // The host is the source of truth for both — it ignores the echo of its
    // own replies, which could otherwise land after a quick settings click
    // and snap it back to the defaults.
    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      if (myRole !== "p1") adoptRoster(payload);
    });
    channel.on("broadcast", { event: "room-settings" }, ({ payload }) => {
      if (myRole !== "p1") adoptSettings(payload);
    });

    // Single writer: only the authority (the host, or the guest while the
    // host is away) broadcasts `game-action`; the other client proposes and
    // the authority re-broadcasts. Every client then applies actions in one
    // sender's order, so a last-second move and a flag can't land in
    // different orders on the two screens.
    channel.on("broadcast", { event: "propose" }, ({ payload }) => {
      if (!isAuthorityNow() || !payload?.action) return;
      channel.send({ type: "broadcast", event: "game-action", payload: { action: payload.action } });
    });

    channel.on("broadcast", { event: "bot-takeover-event" }, ({ payload }) => {
      const event = payload?.event as BotTakeoverEvent | undefined;
      if (!event) return;
      applyBotTakeoverEvent(event);
      if (event.type !== "vote-cast") return;
      const vote = botTakeoverRef.current.votes[event.seatKey];
      if (!vote) return;
      const otherRole = event.seatKey === "p1" ? "p2" : "p1";
      const takenOverRoles = new Set(Object.keys(botTakeoverRef.current.takeovers));
      const eligible = occupantsRef.current.some((o) => o.role === otherRole && !botRolesRef.current.includes(o.role) && !takenOverRoles.has(o.role)) ? 1 : 0;
      if (voteThresholdMet(voteYesCount(botTakeoverRef.current, event.seatKey), eligible)) {
        channel.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "convert", seatKey: event.seatKey, at: Date.now() } } });
      }
    });

    channel.on("broadcast", { event: "state-request" }, () => {
      if (!gameStateRef.current) {
        if (myRole === "p1") {
          channel.send({ type: "broadcast", event: "bot-roster", payload: { botRoles: botRolesRef.current, botLevels: botLevelsRef.current } });
          channel.send({ type: "broadcast", event: "room-settings", payload: { settings: settingsRef.current } });
        }
        return;
      }
      channel.send({
        type: "broadcast",
        event: "state-sync",
        payload: {
          state: gameStateRef.current,
          botRoles: botRolesRef.current,
          botLevels: botLevelsRef.current,
          botTakeover: botTakeoverRef.current,
          settings: settingsRef.current,
        },
      });
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const syncedState = payload?.state as ChessState | undefined;
      if (!syncedState) return;
      adoptRoster(payload);
      adoptSettings(payload);
      const takeover = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
      botTakeoverRef.current = takeover;
      setBotTakeover(takeover);
      const prev = gameStateRef.current;
      gameStateRef.current = syncedState;
      if (!prev || prev.moves.length !== syncedState.moves.length || prev.phase !== syncedState.phase) markTurnStart();
      setGameState(syncedState);
      setPhase((p) => (p === "connecting" || p === "waiting" ? "playing" : p));
    });

    channel.on("presence", { event: "sync" }, () => {
      const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
      setOccupants(Object.values(raw).flat());
    });

    channel.on("presence", { event: "leave" }, ({ leftPresences }) => {
      if (phaseRef.current !== "playing") return;
      for (const p of leftPresences as unknown as Occupant[]) {
        if (botRolesRef.current.includes(p.role)) continue;
        if (activeVoteFor(botTakeoverRef.current, p.role) || isSeatTakenOver(botTakeoverRef.current, p.role)) continue;
        channel.send({
          type: "broadcast",
          event: "bot-takeover-event",
          payload: { event: { type: "vote-start", seatKey: p.role, reason: "disconnected", startedAt: Date.now(), originalUserId: p.playerId ?? `${roomCode}:${p.role}`, originalName: p.name } },
        });
      }
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ deviceId, role: myRole, name: myName, playerId: myPlayerId } satisfies Occupant);
        setPhase((p) => (p === "connecting" ? "waiting" : p));
        requestStateSync();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setPhase("channel-error");
      }
    });

    return () => {
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [roomCode, myRole, myName, myPlayerId]);

  if (myRole && phase !== "room-full") {
    const deviceId = getDeviceId();
    const conflict = occupants.some((o) => o.role === myRole && o.deviceId !== deviceId);
    if (conflict) setPhase("room-full");
  }

  const isHost = myRole === "p1";

  const sendStart = useCallback((s: RoomSettings) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: { seed: Math.floor(Math.random() * 1_000_000_000), botRoles: botRolesRef.current, botLevels: botLevelsRef.current, settings: s },
    });
  }, []);

  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current) return;
    const hasP1 = occupants.some((o) => o.role === "p1") || botRoles.includes("p1");
    const hasP2 = occupants.some((o) => o.role === "p2") || botRoles.includes("p2");
    if (hasP1 && hasP2) {
      startSentRef.current = true;
      sendStart(settingsRef.current);
    }
  }, [occupants, botRoles, phase, isHost, sendStart]);

  function updateSettings(patch: Partial<RoomSettings>) {
    if (!isHost) return;
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    channelRef.current?.send({ type: "broadcast", event: "room-settings", payload: { settings: next } });
  }

  const addBotAtRole = useCallback(
    (role: Seat, level: BotLevel) => {
      if (!isHost) return;
      if (botRolesRef.current.includes(role) || occupants.some((o) => o.role === role)) return;
      const nextRoles = [...botRolesRef.current, role];
      const nextLevels = [...botLevelsRef.current, level];
      botRolesRef.current = nextRoles;
      setBotRoles(nextRoles);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botRoles: nextRoles, botLevels: nextLevels } });
    },
    [isHost, occupants],
  );

  const removeBotAtRole = useCallback(
    (role: Seat) => {
      if (!isHost) return;
      const idx = botRolesRef.current.indexOf(role);
      if (idx === -1) return;
      const nextRoles = botRolesRef.current.filter((_, i) => i !== idx);
      const nextLevels = botLevelsRef.current.filter((_, i) => i !== idx);
      botRolesRef.current = nextRoles;
      setBotRoles(nextRoles);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botRoles: nextRoles, botLevels: nextLevels } });
    },
    [isHost],
  );

  if (isHost && botRoles.length > 0) {
    const humanRoles = new Set(occupants.map((o) => o.role));
    const keepIdx = botRoles.map((r, i) => (humanRoles.has(r) ? -1 : i)).filter((i) => i !== -1);
    if (keepIdx.length !== botRoles.length) {
      setBotRoles(keepIdx.map((i) => botRoles[i]));
      setBotLevels(keepIdx.map((i) => botLevels[i]));
    }
  }

  /** Stamps moves with the time this client watched the turn run (§12.2). */
  const handleAction = useCallback((action: EngineAction) => {
    const ply = gameStateRef.current?.moves.length;
    const stamped: EngineAction = action.type === "move" ? { ...action, spentMs: Math.max(0, Date.now() - turnStartRef.current), ply } : action;
    sendAction(stamped);
    // sendAction only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lv.1-4 search shallowly on the main thread; Lv.5+ (depth 3+ / iterative
  // deepening up to 1.6 s) runs in the shared bot Worker so the UI never
  // freezes — requestBotAction falls back to the same synchronous call.
  const chooseAction = useCallback((state: ChessState, actor: Seat): EngineAction | null | Promise<EngineAction | null> => {
    const idx = botRolesRef.current.indexOf(actor);
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    if (level >= 5) {
      return requestBotAction<EngineAction>("chess", state, actor, level, Math.floor(Math.random() * 1_000_000_000), () => chooseBotAction(state, actor, level));
    }
    return chooseBotAction(state, actor, level);
  }, []);

  // Bots follow the authority, so a takeover bot keeps playing if the host leaves.
  const isAuthority = myRole === "p1" || !occupants.some((o) => o.role === "p1");
  useBotAutoplay<ChessState, EngineAction, Seat>({
    active: isAuthority && phase === "playing",
    state: gameState,
    currentActor: chessCurrentActor,
    botSeats: allBotRoleSet,
    chooseAction,
    dispatch: handleAction,
  });

  // §12.3 시간 패: any client that sees the side to move run out claims it.
  useEffect(() => {
    if (phase !== "playing" || !myRole) return;
    const id = window.setInterval(() => {
      const s = gameStateRef.current;
      if (!s || s.phase !== "playing" || !s.clock || s.moves.length < 2) return;
      const elapsed = Date.now() - turnStartRef.current;
      if (elapsed < s.remainingMs[s.pos.turn]) return;
      const key = `${s.moves.length}:${s.pos.turn}`;
      if (flagSentRef.current === key) return;
      flagSentRef.current = key;
      sendAction({ type: "flag", seat: myRole, spentMs: elapsed, ply: s.moves.length });
    }, 250);
    return () => window.clearInterval(id);
    // sendAction only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, myRole]);

  // "무응답(idle)" takeover trigger.
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = window.setInterval(() => {
      const state = gameStateRef.current;
      if (!state) return;
      const actor = chessCurrentActor(state);
      if (actor !== lastActorRef.current.actor) {
        lastActorRef.current = { actor, since: Date.now() };
        return;
      }
      if (actor === null || state.clock) return;
      if (botRolesRef.current.includes(actor)) return;
      if (activeVoteFor(botTakeoverRef.current, actor) || isSeatTakenOver(botTakeoverRef.current, actor)) return;
      if (Date.now() - lastActorRef.current.since < IDLE_VOTE_THRESHOLD_MS) return;
      const occ = occupantsRef.current.find((o) => o.role === actor);
      channelRef.current?.send({
        type: "broadcast",
        event: "bot-takeover-event",
        payload: { event: { type: "vote-start", seatKey: actor, reason: "idle", startedAt: Date.now(), originalUserId: occ?.playerId ?? `${roomCode}:${actor}`, originalName: occ?.name ?? namesRef.current[actor] ?? "상대" } },
      });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [phase, roomCode]);

  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";

  function castTakeoverVote(seatKey: string) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey, voterDeviceId: deviceId } } });
  }
  function proveStillHereOrReclaim(seatKey: string) {
    const type = isSeatTakenOver(botTakeover, seatKey) ? "reclaim" : "vote-cancel";
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type, seatKey } } });
  }

  // Report the finished game (§20) — draws rank both seats 1st.
  useEffect(() => {
    if (!gameState || gameState.phase !== "gameOver" || !gameState.result || completedRef.current) return;
    completedRef.current = true;
    const result = gameState.result;
    const rankOf = (seat: Seat) => (result.winner === null || gameState.colors[seat] === result.winner ? 1 : 2);
    onComplete({
      rankings: SEATS.map((seat) => ({ playerId: ids[seat], rank: rankOf(seat) })),
      self: roleSelfResult(
        myRole,
        SEATS.map((role) => ({ role, rank: rankOf(role) })),
        { takeovers: botTakeoverRef.current.takeovers, botRoles: botRolesRef.current, botLevels: botLevelsRef.current },
        (role) => chessStatDetails(gameState, role),
      ),
      finishedAt: new Date().toISOString(),
    });
  }, [gameState, ids, onComplete, myRole]);

  function handleRematch() {
    const prev = gameStateRef.current;
    // §2: colours swap on every rematch.
    const next: RoomSettings = { ...settingsRef.current, hostColor: prev ? otherColor(prev.colors.p1) : settingsRef.current.hostColor };
    settingsRef.current = next;
    setSettings(next);
    startSentRef.current = true;
    sendStart(next);
  }

  function handleLeave() {
    if (channelRef.current) {
      const supabase = getSupabase();
      supabase?.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    window.history.replaceState(null, "", window.location.pathname);
    setRoomCode(null);
    setMyRole(null);
    setOccupants([]);
    gameStateRef.current = null;
    setGameState(null);
    setIdentity({ name: "" });
    setMyPlayerId(undefined);
    setCodeInput("");
    botRolesRef.current = [];
    setBotRoles([]);
    botLevelsRef.current = [];
    setBotLevels([]);
    botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
    setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
    setDismissedVoteKey(null);
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
    setPhase("choose");
  }

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";

  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(roomCode !== null, handleLeave);
  useBackgroundResync(roomCode !== null, requestStateSync);
  useActiveRoomListing({
    gameId: "chess",
    roomCode,
    isHost,
    isWaiting: phase === "waiting",
    isPlaying: phase === "playing",
    hostName: myName,
    playerCount: occupants.length,
    occupants,
    maxPlayers: 2,
  });

  function withGuard(node: ReactNode) {
    return (
      <>
        {node}
        <GameLeaveGuardModal open={exitConfirmOpen} onCancel={cancelExit} onConfirm={confirmExit} />
        {showRulebook && <ChessRulebookModal onClose={() => setShowRulebook(false)} />}
      </>
    );
  }

  if (phase === "supabase-missing") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 text-center">
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80 light:text-amber-800">
          체스는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다. <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">.env.local</code>에{" "}
          <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code> / <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>를 채워주세요 (README 참고).
        </p>
      </div>,
    );
  }

  if (phase === "room-full") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center">
        <span className="text-3xl">🚫</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">이미 다른 사람이 참여 중인 방이에요</h2>
        <p className="text-sm text-rose-100/80 light:text-rose-700">코드를 다시 확인하거나 새로운 방을 만들어보세요.</p>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-400">
          처음으로
        </button>
      </div>,
    );
  }

  if (phase === "channel-error") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center">
        <span className="text-3xl">📡</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">연결에 실패했습니다</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-400">
          다시 시도
        </button>
      </div>,
    );
  }

  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId="chess"
        containerClassName={`${THEME} light:border-slate-200 light:bg-none light:bg-white`}
        icon="♟️"
        title="체스 온라인 대전"
        description={<p className="text-sm text-white/50 light:text-slate-500">두 사람이 각자 기기로 접속해 실시간으로 둬요. 상대가 없으면 대기실에서 AI 봇(Lv.1~10)을 앉히세요.</p>}
        actions={
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => {
                setIntent("create");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-white transition hover:bg-amber-400"
            >
              ♟️ 방 만들기
            </button>
            <button
              onClick={() => {
                setIntent("join");
                trackGameEvent("chess", "invite_click");
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
    return withGuard(
      <div className={`flex flex-col gap-4 rounded-2xl border p-6 ${THEME} light:border-slate-200 light:bg-none light:bg-white`}>
        <h2 className="text-base font-bold text-white light:text-slate-900">{intent === "create" ? "방 만들기" : "초대 코드로 참여"}</h2>
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-amber-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900"
            />
          </label>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white hover:bg-amber-400">
            {intent === "create" ? "방 만들기" : "참여하기"}
          </button>
        </div>
      </div>,
    );
  }

  if (phase === "connecting" || phase === "waiting") {
    const colorLabel = (role: Seat) => {
      const host = settings.hostColor;
      if (host === "random") return "백/흑 무작위";
      const c = role === "p1" ? host : otherColor(host);
      return c === "w" ? "백 ♔ (먼저 둠)" : "흑 ♚";
    };
    const pill = (on: boolean) =>
      `rounded-lg border px-2 py-1.5 text-xs transition ${on ? "border-amber-400 bg-amber-400/20 font-bold text-amber-100 light:text-amber-800" : "border-white/10 text-white/60 hover:border-white/30 light:border-slate-200 light:text-slate-600"} disabled:cursor-default disabled:hover:border-white/10`;
    return withGuard(
      <div className={`flex flex-col items-center gap-5 rounded-2xl border p-6 text-center sm:p-8 ${THEME} light:border-slate-200 light:bg-none light:bg-white`}>
        {phase === "connecting" ? (
          <p className="text-sm text-white/50 light:text-slate-500">연결하는 중...</p>
        ) : (
          <>
            <p className="text-sm text-white/50 light:text-slate-500">초대 코드</p>
            <p className="text-4xl font-bold tracking-[0.3em] text-white light:text-slate-900">{roomCode}</p>
            <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
              🔗 초대 링크 복사
            </button>

            <div className="flex w-full max-w-sm flex-col gap-3 text-left">
              <div>
                <p className="mb-1.5 text-xs font-semibold text-white/50 light:text-slate-500">⏱️ 시간 {isHost ? "" : "(방장이 정해요)"}</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {TIME_CONTROLS.map((t) => (
                    <button key={t.id} disabled={!isHost} onClick={() => updateSettings({ timeControlId: t.id })} className={pill(settings.timeControlId === t.id)}>
                      <span className="block">{t.label}</span>
                      <span className="block text-[10px] opacity-60">{t.kind}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-white/50 light:text-slate-500">♟️ 방장의 색</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      ["w", "백 ♔"],
                      ["random", "🎲 무작위"],
                      ["b", "흑 ♚"],
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} disabled={!isHost} onClick={() => updateSettings({ hostColor: v })} className={pill(settings.hostColor === v)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-1 flex w-full max-w-sm flex-col gap-1.5">
              {(["p1", "p2"] as const).map((role) => {
                const occ = occupants.find((o) => o.role === role);
                const botIdx = botRoles.indexOf(role);
                const isBot = botIdx >= 0;
                return (
                  <div key={role} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm text-white/70 light:bg-slate-50 light:text-slate-600">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {occ && <Avatar size={20} />}
                      <span className="shrink-0 text-xs text-white/40 light:text-slate-400">{role === "p1" ? "방장" : "참가자"}</span>
                      <span className="truncate">{occ ? `${occ.name}${role === myRole ? " (나)" : ""}` : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30 light:text-slate-400">대기 중...</span>}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-[11px] text-white/40 light:text-slate-400">{colorLabel(role)}</span>
                      {isHost && !occ && (isBot ? <RemoveBotButton onClick={() => removeBotAtRole(role)} /> : <AddBotButton onAddWithLevel={(level) => addBotAtRole(role, level)} />)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-white/40 light:text-slate-500">2명이 모이면(또는 봇을 앉히면) 바로 시작합니다. 시간·색은 그 전에 정하세요.</p>
          </>
        )}
      </div>,
    );
  }

  if (phase === "playing" && gameState && myRole) {
    const myVoteAsTarget = activeVoteFor(botTakeover, myRole);
    const iAmTakenOver = isSeatTakenOver(botTakeover, myRole);
    const voteToShow = Object.values(botTakeover.votes).find((v) => v.seatKey !== myRole && `${v.seatKey}:${v.startedAt}` !== dismissedVoteKey);
    return withGuard(
      <>
        {myVoteAsTarget && <BotTakeoverSelfBanner mode="prove-presence" onConfirm={() => proveStillHereOrReclaim(myRole)} />}
        {!myVoteAsTarget && iAmTakenOver && <BotTakeoverSelfBanner mode="reclaim" onConfirm={() => proveStillHereOrReclaim(myRole)} />}
        {voteToShow && (
          <BotTakeoverVoteModal
            targetName={names[voteToShow.seatKey as Seat] ?? voteToShow.originalName}
            reason={voteToShow.reason}
            yesCount={voteToShow.yesVoterDeviceIds.length}
            eligibleVoterCount={1}
            hasVoted={voteToShow.yesVoterDeviceIds.includes(deviceId)}
            onVoteYes={() => castTakeoverVote(voteToShow.seatKey)}
            onDismiss={() => setDismissedVoteKey(`${voteToShow.seatKey}:${voteToShow.startedAt}`)}
          />
        )}
        {takeoverRoles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {takeoverRoles.map((role) => (
              <BotSeatBadge key={role} variant="takeover" label={botTakeover.takeovers[role]?.originalName ?? "이탈"} />
            ))}
          </div>
        )}
        <ChessBoard
          state={gameState}
          viewerSeat={myRole}
          names={names}
          opponentConnected={opponentConnected}
          opponentIsBot={opponentIsBot}
          turnStartedAt={turnStartedAt}
          onAction={handleAction}
          onLeave={handleLeave}
          onRematch={handleRematch}
          onOpenRulebook={() => setShowRulebook(true)}
        />
      </>,
    );
  }

  return withGuard(null);
}
