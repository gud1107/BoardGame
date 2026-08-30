"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import GameLeaveGuardModal from "@/components/GameLeaveGuardModal";
import Avatar from "@/components/common/Avatar";
import { useGameLeaveGuard } from "@/hooks/useGameLeaveGuard";
import { useBackgroundResync } from "@/hooks/useBackgroundResync";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
import { seededRng } from "@/lib/rng";
import { applyAction, calculateTotalScore, chooseBotAction, otherSeat, startGame, type EngineAction, type LostCitiesState, type Seat } from "./engine";
import LostCitiesBoard from "./LostCitiesBoard";
import LostCitiesRulebookModal from "./RulebookModal";
import { useBotAutoplay } from "@/games/shared/bot/useBotAutoplay";
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
import { AddBotButton, BotSeatBadge, RemoveBotButton } from "@/components/lobby/BotSeatControls";
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

/**
 * Online-room multiplayer entry point for 로스트 시티 — the same lockstep
 * pattern every 2-player game in this catalog uses (docs/cloud-sync.md),
 * modeled directly on `malDalliJa/MalDalliJaGame.tsx` and
 * `no-thanks/NoThanksGame.tsx` (bot-takeover pilot): the host broadcasts a
 * seed, both clients independently derive the identical initial deal
 * (`startGame`), and every move replays as an `EngineAction` broadcast
 * through the same pure reducer. Only the active seat ever sends a move —
 * single-writer guarantee, no simultaneous-action exception needed here.
 *
 * Deliberately NOT included (see engine.ts's module doc / HANDOFF.md for the
 * confirmed scope): room chat (`chatEnabled`) and room-linked betting
 * (`bettingRoomLinked`) — neither was part of the platform-common feature
 * list this task asked for, unlike bot takeover / mobile responsiveness /
 * back-guard / default avatar / result-skip, which all are and are wired in
 * below.
 */

type Occupant = {
  deviceId: string;
  role: Seat;
  name: string;
  /** Real betting-system playerId, present only when this occupant joined by picking themselves from an active betting session's roster — see RoomNicknameField. */
  playerId?: string;
};

type Phase = "choose" | "enter-name" | "connecting" | "waiting" | "playing" | "room-full" | "supabase-missing" | "channel-error";

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredRole(code: string): Seat | null {
  const v = window.localStorage.getItem(`lost-cities-role-${code}`);
  return v === "p1" || v === "p2" ? v : null;
}

function storeRole(code: string, role: Seat) {
  window.localStorage.setItem(`lost-cities-role-${code}`, role);
}

/** Whose decision `useBotAutoplay` should drive right now. */
function lcCurrentActor(state: LostCitiesState): Seat | null {
  if (state.phase !== "playing") return null;
  return state.activeSeat;
}

export default function LostCitiesGame({ onComplete }: PlayableGameProps) {
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
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<LostCitiesState | null>(null);

  // Host-controlled AI bot roster (ARCHITECTURE.md §7) — same shape as every
  // other online game here. `botLevels[i]` is the Level 1–10 difficulty for
  // `botRoles[i]` (parallel arrays, same index).
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

  // Mid-game "seat disconnected/unresponsive → AI bot" — see botTakeover.ts.
  // Only 1 other seat can ever exist to vote in this 2-player game, so a vote
  // "passes" the instant that one opponent votes yes (`voteThresholdMet(1,1)`).
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
  // "무응답(idle)" takeover trigger bookkeeping — see the interval effect below.
  const lastActorRef = useRef<{ actor: Seat | null; since: number }>({ actor: null, since: 0 });
  const IDLE_VOTE_THRESHOLD_MS = 45_000;
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
  // Guards `onComplete` firing more than once for the same finished game.
  const completedRef = useRef(false);

  const gameStateRef = useRef<LostCitiesState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

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
    const channel = supabase.channel(`lost-cities-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;
    completedRef.current = false;

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const roster = (payload?.botRoles as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botRolesRef.current = roster;
      setBotRoles(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      completedRef.current = false;
      setGameState(startGame(seededRng(seed)));
      setPhase("playing");
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      const roster = (payload?.botRoles as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botRolesRef.current = roster;
      setBotRoles(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
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
      const eligible = occupantsRef.current.some(
        (o) => o.role === otherRole && !botRolesRef.current.includes(o.role) && !takenOverRoles.has(o.role),
      )
        ? 1
        : 0;
      if (voteThresholdMet(voteYesCount(botTakeoverRef.current, event.seatKey), eligible)) {
        channel.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "convert", seatKey: event.seatKey, at: Date.now() } } });
      }
    });

    channel.on("broadcast", { event: "state-request" }, () => {
      if (!gameStateRef.current) {
        if (myRole === "p1") {
          channel.send({ type: "broadcast", event: "bot-roster", payload: { botRoles: botRolesRef.current, botLevels: botLevelsRef.current } });
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
        },
      });
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const syncedState = payload?.state as LostCitiesState | undefined;
      if (!syncedState) return;
      const roster = (payload?.botRoles as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      const takeover = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
      botRolesRef.current = roster;
      setBotRoles(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = takeover;
      setBotTakeover(takeover);
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
          payload: {
            event: {
              type: "vote-start",
              seatKey: p.role,
              reason: "disconnected",
              startedAt: Date.now(),
              originalUserId: p.playerId ?? `${roomCode}:${p.role}`,
              originalName: p.name,
            },
          },
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

  // Someone else is already occupying my seat in this room — derived during
  // render (not an effect), same "compare and setState during render"
  // pattern used elsewhere in this project.
  if (myRole && phase !== "room-full") {
    const deviceId = getDeviceId();
    const conflict = occupants.some((o) => o.role === myRole && o.deviceId !== deviceId);
    if (conflict) setPhase("room-full");
  }

  const isHost = myRole === "p1";

  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current) return;
    const hasP1 = occupants.some((o) => o.role === "p1") || botRoles.includes("p1");
    const hasP2 = occupants.some((o) => o.role === "p2") || botRoles.includes("p2");
    if (hasP1 && hasP2) {
      startSentRef.current = true;
      channelRef.current?.send({
        type: "broadcast",
        event: "game-start",
        payload: { seed: Math.floor(Math.random() * 1_000_000_000), botRoles: botRolesRef.current, botLevels: botLevelsRef.current },
      });
    }
  }, [occupants, botRoles, phase, isHost]);

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

  const handleAction = useCallback((action: EngineAction) => {
    channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action } });
  }, []);

  // Cheap synchronous heuristic (engine.ts's `scoreMove`/`chooseBotAction`) —
  // no search deep enough to warrant offloading to a Web Worker, unlike the
  // handful of games that route their expert tier through one.
  const chooseAction = useCallback((state: LostCitiesState, actor: Seat): EngineAction | null => {
    const idx = botRolesRef.current.indexOf(actor);
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return chooseBotAction(state, actor, level);
  }, []);

  useBotAutoplay<LostCitiesState, EngineAction, Seat>({
    active: isHost && phase === "playing",
    state: gameState,
    currentActor: lcCurrentActor,
    botSeats: allBotRoleSet,
    chooseAction,
    dispatch: handleAction,
  });

  // "무응답(idle)" takeover trigger.
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = window.setInterval(() => {
      const state = gameStateRef.current;
      if (!state) return;
      const actor = lcCurrentActor(state);
      if (actor !== lastActorRef.current.actor) {
        lastActorRef.current = { actor, since: Date.now() };
        return;
      }
      if (actor === null) return;
      if (botRolesRef.current.includes(actor)) return;
      if (activeVoteFor(botTakeoverRef.current, actor) || isSeatTakenOver(botTakeoverRef.current, actor)) return;
      if (Date.now() - lastActorRef.current.since < IDLE_VOTE_THRESHOLD_MS) return;
      const occ = occupantsRef.current.find((o) => o.role === actor);
      channelRef.current?.send({
        type: "broadcast",
        event: "bot-takeover-event",
        payload: {
          event: {
            type: "vote-start",
            seatKey: actor,
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

  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";

  function castTakeoverVote(seatKey: string) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey, voterDeviceId: deviceId } } });
  }
  function proveStillHereOrReclaim(seatKey: string) {
    const type = isSeatTakenOver(botTakeover, seatKey) ? "reclaim" : "vote-cancel";
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type, seatKey } } });
  }

  // Report the finished game up to the betting/history layer the instant
  // every client's replayed state reaches `gameOver` — independent of
  // whether that viewer has skipped the score-breakdown reveal animation yet
  // (LostCitiesBoard/ScoreBreakdownModal), so `onComplete` never depends on
  // a UI-only local timer.
  useEffect(() => {
    if (!gameState || gameState.phase !== "gameOver" || completedRef.current) return;
    completedRef.current = true;
    const p1Total = calculateTotalScore(gameState, "p1");
    const p2Total = calculateTotalScore(gameState, "p2");
    const rankings = gameState.isDraw
      ? [
          { playerId: ids.p1, rank: 1 },
          { playerId: ids.p2, rank: 1 },
        ]
      : [
          { playerId: p1Total > p2Total ? ids.p1 : ids.p2, rank: 1 },
          { playerId: p1Total > p2Total ? ids.p2 : ids.p1, rank: 2 },
        ];
    onComplete({ rankings, finishedAt: new Date().toISOString() });
  }, [gameState, ids, onComplete]);

  function handleRematch() {
    startSentRef.current = true;
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: { seed: Math.floor(Math.random() * 1_000_000_000), botRoles: botRolesRef.current, botLevels: botLevelsRef.current },
    });
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
    setPhase("choose");
  }

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";

  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(roomCode !== null, handleLeave);
  useBackgroundResync(roomCode !== null, requestStateSync);

  function withGuard(node: ReactNode) {
    return (
      <>
        {node}
        <GameLeaveGuardModal open={exitConfirmOpen} onCancel={cancelExit} onConfirm={confirmExit} />
        {showRulebook && <LostCitiesRulebookModal onClose={() => setShowRulebook(false)} />}
      </>
    );
  }

  if (phase === "supabase-missing") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 text-center">
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80">
          로스트 시티는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.{" "}
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">.env.local</code>
          에{" "}
          <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code> /{" "}
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>를 채워주세요 (README 참고).
        </p>
      </div>,
    );
  }

  if (phase === "room-full") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center">
        <span className="text-3xl">🚫</span>
        <h2 className="text-lg font-bold text-white">이미 다른 사람이 참여 중인 방이에요</h2>
        <p className="text-sm text-rose-100/80">코드를 다시 확인하거나 새로운 방을 만들어보세요.</p>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-400">
          처음으로
        </button>
      </div>,
    );
  }

  if (phase === "channel-error") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center">
        <span className="text-3xl">📡</span>
        <h2 className="text-lg font-bold text-white">연결에 실패했습니다</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-400">
          다시 시도
        </button>
      </div>,
    );
  }

  if (phase === "choose") {
    return withGuard(
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[#0c1b1a] via-[#0a1513] to-black p-8 text-center">
        <span className="text-4xl">🗺️</span>
        <h2 className="text-lg font-bold text-white">로스트 시티 온라인 대전</h2>
        <p className="text-sm text-white/50">두 사람이 각자 기기로 접속해서 실시간으로 플레이해요.</p>
        <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
          <button
            onClick={() => {
              setIntent("create");
              setPhase("enter-name");
            }}
            className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400"
          >
            🎲 방 만들기
          </button>
          <button
            onClick={() => {
              setIntent("join");
              setPhase("enter-name");
            }}
            className="w-full rounded-xl border border-white/15 py-3 text-sm font-semibold text-white/80 transition hover:border-white/30"
          >
            🔑 초대 코드로 참여
          </button>
          <button onClick={() => setShowRulebook(true)} className="w-full rounded-xl border border-white/10 py-2.5 text-xs text-white/50 transition hover:border-white/25">
            📖 룰북 보기
          </button>
        </div>
      </div>,
    );
  }

  if (phase === "enter-name") {
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[#0c1b1a] via-[#0a1513] to-black p-6">
        <h2 className="text-base font-bold text-white">{intent === "create" ? "방 만들기" : "초대 코드로 참여"}</h2>
        <div className="flex flex-col gap-1.5 text-sm text-white/70">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} onEnter={enterRoom} accent="emerald" />
        </div>
        {intent === "join" && (
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-emerald-400 focus:outline-none"
            />
          </label>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400">
            {intent === "create" ? "방 만들기" : "참여하기"}
          </button>
        </div>
      </div>,
    );
  }

  if (phase === "connecting" || phase === "waiting") {
    return withGuard(
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-gradient-to-b from-[#0c1b1a] via-[#0a1513] to-black p-8 text-center">
        {phase === "connecting" ? (
          <p className="text-sm text-white/50">연결하는 중...</p>
        ) : (
          <>
            <p className="text-sm text-white/50">초대 코드</p>
            <p className="text-4xl font-bold tracking-[0.3em] text-white">{roomCode}</p>
            <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70 hover:border-white/30">
              🔗 초대 링크 복사
            </button>
            <div className="mt-2 flex flex-col gap-1.5">
              {(["p1", "p2"] as const).map((role) => {
                const occ = occupants.find((o) => o.role === role);
                const botIdx = botRoles.indexOf(role);
                const isBot = botIdx >= 0;
                return (
                  <p key={role} className="flex items-center justify-between gap-2 text-sm text-white/70">
                    <span className="flex items-center gap-1.5">
                      {occ && <Avatar size={20} />}
                      {role === myRole ? "나" : role === "p1" ? "선공" : "후공"}:{" "}
                      {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30">대기 중...</span>}
                    </span>
                    {isHost && !occ && <span>{isBot ? <RemoveBotButton onClick={() => removeBotAtRole(role)} /> : <AddBotButton onAddWithLevel={(level) => addBotAtRole(role, level)} />}</span>}
                  </p>
                );
              })}
            </div>
            <p className="text-xs text-white/40">2명이 모이면 자동으로 게임이 시작됩니다.</p>
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
        <div className="mb-2 flex justify-end">
          <button onClick={() => setShowRulebook(true)} className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/50 hover:border-white/25">
            📖 룰북
          </button>
        </div>
        <LostCitiesBoard state={gameState} viewerSeat={myRole} names={names} opponentConnected={opponentConnected} onAction={handleAction} onLeave={handleLeave} onRematch={handleRematch} />
      </>,
    );
  }

  return withGuard(null);
}
