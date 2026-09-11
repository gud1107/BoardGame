"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import GameLeaveGuardModal from "@/components/GameLeaveGuardModal";
import { useGameLeaveGuard } from "@/hooks/useGameLeaveGuard";
import { useBackgroundResync } from "@/hooks/useBackgroundResync";
import { useActiveRoomListing } from "@/games/shared/room/useActiveRoomListing";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
import {
  applyAction,
  chooseBotAction,
  createInitialOwnership,
  other,
  seededRng,
  startRound,
  type EngineAction,
  type HanamikojiState,
  type Owner,
} from "./engine";
import HanamikojiBoard from "./HanamikojiBoard";
import { useBotAutoplay } from "@/games/shared/bot/useBotAutoplay";
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
import { AddBotButton, BotSeatBadge, RemoveBotButton } from "@/components/lobby/BotSeatControls";
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

/**
 * Which seat/role must act right now, for `useBotAutoplay` — mirrors
 * `getValidMoves`'s own phase gating exactly (see engine.ts), just without
 * enumerating the moves themselves.
 */
function hanamikojiCurrentActor(state: HanamikojiState): Owner | null {
  if (state.phase === "awaiting-draw" || state.phase === "awaiting-action") return state.activePlayer;
  if (state.phase === "awaiting-response" && state.pendingOffer) return other(state.pendingOffer.offeredBy);
  return null;
}

function hanamikojiChooseAction(state: HanamikojiState, actor: Owner, level: BotLevel): EngineAction | null {
  return chooseBotAction(state, actor, level);
}

/**
 * Pure system-log line formatter for the in-game chat system-log pilot (see
 * PerudoGame.tsx/DalmutiGame.tsx and `src/lib/chat/systemLog.ts`). Kept local
 * to this file per the rollout plan (other agents are editing other games'
 * formatters in parallel) — takes already-resolved plain values instead of
 * importing engine.ts. "compete" (경쟁) is Hanamikoji's most game-defining
 * action card: unlike secret/tradeoff/gift, it forces a 4-card split the
 * opponent must choose between, deciding a geisha's fate outright.
 */
function formatHanamikojiCompeteLog(name: string): string {
  return `${name}님이 "경쟁" 액션 카드를 냈습니다`;
}

/**
 * Online-room multiplayer entry point. Each of the two players is on their
 * own device; there is no shared local state anymore. The two clients stay
 * in sync purely by broadcasting `EngineAction`s over a Supabase Realtime
 * channel and replaying them through the exact same pure `applyAction`
 * reducer — since only the player whose turn it is may ever act, there's
 * never a write conflict to resolve, so no server-authoritative engine is
 * needed. See README for the trust trade-off this implies (a technically
 * inclined player could inspect their own client state to see the
 * opponent's hand — full anti-cheat would require a real server).
 */

type Occupant = {
  deviceId: string;
  role: Owner;
  name: string;
  /** Real betting-system playerId, present only when this occupant joined by picking themselves from an active betting session's roster — see RoomNicknameField. */
  playerId?: string;
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

function getStoredRole(code: string): Owner | null {
  const v = window.localStorage.getItem(`hnmk-role-${code}`);
  return v === "p1" || v === "p2" ? v : null;
}

function storeRole(code: string, role: Owner) {
  window.localStorage.setItem(`hnmk-role-${code}`, role);
}

export default function HanamikojiGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Owner | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<HanamikojiState | null>(null);
  const [finalResult, setFinalResult] = useState<{ winnerId: string; winnerName: string } | null>(null);
  // Room chat + in-game system log (see GameMeta.chatEnabled, piloted in
  // PerudoGame.tsx/DalmutiGame.tsx). Shares this component's own room
  // channel instead of opening a second Realtime subscription.
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatCooldownUntil, setChatCooldownUntil] = useState<number | null>(null);
  const chatThrottleRef = useRef<ThrottleState>(INITIAL_THROTTLE_STATE);
  // Roles currently played by an AI bot instead of a human — host-controlled
  // (see ARCHITECTURE.md §7), broadcast to every client via "bot-roster" so
  // everyone renders the same lobby/board without a server.
  const [botRoles, setBotRoles] = useState<Owner[]>([]);
  const botRolesRef = useRef<Owner[]>([]);
  useEffect(() => {
    botRolesRef.current = botRoles;
  }, [botRoles]);
  // `botLevels[i]` is the Level 1–10 difficulty for `botRoles[i]` (parallel arrays, same index).
  const [botLevels, setBotLevels] = useState<BotLevel[]>([]);
  const botLevelsRef = useRef<BotLevel[]>([]);
  useEffect(() => {
    botLevelsRef.current = botLevels;
  }, [botLevels]);

  // Mid-game "seat disconnected/unresponsive → AI bot" — see botTakeover.ts
  // for the vote/conversion state machine this mirrors (same wiring as
  // DalmutiGame.tsx/CoyoteGame.tsx). `Owner` ("p1"/"p2") is already a plain
  // string, so it doubles directly as botTakeover's `seatKey` — no
  // Number()/String() conversion needed here unlike the numeric-seat games.
  const [botTakeover, setBotTakeover] = useState<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  const botTakeoverRef = useRef<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  function applyBotTakeoverEvent(event: BotTakeoverEvent) {
    const next = reduceBotTakeover(botTakeoverRef.current, event);
    botTakeoverRef.current = next;
    setBotTakeover(next);
  }
  // A vote this client has already dismissed without voting — re-shown if a
  // *different* vote (different role or restarted timer) comes in.
  const [dismissedVoteKey, setDismissedVoteKey] = useState<string | null>(null);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // Tracks how long the current actor has been stuck, for the "idle/무응답"
  // vote trigger — see the dedicated interval effect below.
  const lastActorRef = useRef<{ actor: Owner | null; since: number }>({ actor: null, since: 0 });
  const IDLE_VOTE_THRESHOLD_MS = 45_000;

  const channelRef = useRef<RealtimeChannel | null>(null);
  // Shared by the initial post-subscribe sync and `useBackgroundResync`
  // (below) — see that hook's doc comment for why the `state !== "joined"`
  // check is enough of a fallback even though realtime-js's own reconnect
  // logic already covers the common case.
  function requestStateSync() {
    const channel = channelRef.current;
    if (!channel) return;
    if (channel.state !== "joined") channel.subscribe();
    channel.send({ type: "broadcast", event: "state-request", payload: {} });
  }
  const startSentRef = useRef(false);
  const isHost = myRole === "p1";

  // Kept in sync so the `game-action` broadcast handler (registered once,
  // inside the channel-setup effect below) can resolve a role to its display
  // name for the system log without closing over a stale value.
  const namesRef = useRef<Record<Owner, string>>({ p1: "상대", p2: "상대" });

  // Kept in sync so the `game-action` broadcast handler can read the
  // *pre-action* state (whose turn it was) for the system log — this ref is
  // only re-synced by the effect below after a render commits, so at the
  // moment that handler runs it still holds the prior snapshot.
  const gameStateRef = useRef<HanamikojiState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Read inside the channel-setup effect's broadcast handlers (registered
  // once, doesn't re-run on every `occupants` change) to avoid closing over
  // a stale snapshot — same reasoning as `gameStateRef`/`botRolesRef`.
  const occupantsRef = useRef<Occupant[]>([]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);

  const opponentRole = myRole ? other(myRole) : null;
  const botRoleSet = useMemo(() => new Set(botRoles), [botRoles]);
  const names: Record<Owner, string> = useMemo(() => {
    const byRole = (r: Owner) => occupants.find((o) => o.role === r)?.name;
    const botIndex = (r: Owner) => botRoles.indexOf(r);
    const forRole = (r: Owner) => {
      const takeover = botTakeover.takeovers[r];
      if (takeover) return `🤖 AI ${takeover.originalName}`;
      return (
        (myRole === r ? myName : byRole(r)) ?? (botIndex(r) >= 0 ? botDisplayName(botIndex(r), botLevels[botIndex(r)]) : "상대")
      );
    };
    return { p1: forRole("p1"), p2: forRole("p2") };
  }, [occupants, myRole, myName, botRoles, botLevels, botTakeover]);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);
  // Prefer the real betting-system playerId (present when that role's
  // occupant joined by picking themselves from an active session's roster —
  // see RoomNicknameField) over the synthetic per-room id. A takeover role's
  // `originalUserId` must win over the live occupant lookup — a real
  // disconnect means that role has no occupant record left at all.
  const ids: Record<Owner, string> = useMemo(() => {
    const byRole = (r: Owner) => botTakeover.takeovers[r]?.originalUserId ?? occupants.find((o) => o.role === r)?.playerId;
    return {
      p1: byRole("p1") ?? `${roomCode}:p1`,
      p2: byRole("p2") ?? `${roomCode}:p2`,
    };
  }, [roomCode, occupants, botTakeover]);
  const opponentConnected = opponentRole
    ? occupants.some((o) => o.role === opponentRole) || botRoleSet.has(opponentRole) || isSeatTakenOver(botTakeover, opponentRole)
    : false;

  function enterRoom() {
    setFormError(null);
    // Checked here (a user event handler) rather than in the connection
    // effect below, so there's nothing to synchronously setState over once
    // the effect runs — the effect only ever runs once this is guaranteed.
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
    const role: Owner = getStoredRole(code) ?? (intent === "create" ? "p1" : "p2");
    storeRole(code, role);
    window.history.replaceState(null, "", `${window.location.pathname}?room=${code}`);
    setMyName(name);
    setMyPlayerId(identity.name.trim() ? identity.playerId : undefined);
    setMyRole(role);
    setRoomCode(code);
    setPhase("connecting");
  }

  // Open (and tear down) the Realtime channel whenever we have a room to join.
  useEffect(() => {
    if (!roomCode || !myRole) return;
    const supabase = getSupabase();
    if (!supabase) return; // enterRoom() already guards this; nothing to recover here.
    const deviceId = getDeviceId();
    const channel = supabase.channel(`hanamikoji-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    const chatChannel = `room:hanamikoji:${roomCode}`;
    void loadRecentMessages(chatChannel).then((history) => {
      setChatMessages((prev) => mergeHistoryIntoMessages(prev, history));
    });

    channel.on("broadcast", { event: "chat-message" }, ({ payload }) => {
      const message = payload?.message as ChatMessage | undefined;
      if (!message) return;
      setChatMessages((prev) => [...prev, message]);
    });

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const roles = (payload?.botRoles as Owner[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botRolesRef.current = roles;
      setBotRoles(roles);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      // A rematch is a fresh game — any takeover from the previous round
      // shouldn't silently carry a role's control into this one.
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      setGameState(startRound(1, "p1", createInitialOwnership(), seededRng(seed)));
      setFinalResult(null);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      // System-log pilot (see GameMeta.chatEnabled): every connected client
      // derives the same human-readable line independently, exactly like it
      // independently derives `applyAction` below — no server round-trip, no
      // change to the pure reducer in engine.ts. Deliberately not persisted
      // to `chat_messages` (unlike user messages) — every client would
      // otherwise write a duplicate row, and this is trivially re-derivable
      // from the replayed action log anyway.
      if (action.type === "compete") {
        const actor = gameStateRef.current?.activePlayer;
        if (actor) {
          setChatMessages((prev) => [
            ...prev,
            {
              id: uuid(),
              channel: chatChannel,
              deviceId: "system",
              senderName: "시스템",
              body: formatHanamikojiCompeteLog(namesRef.current[actor] ?? "상대"),
              type: "SYSTEM",
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      }
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    // Host-authoritative AI bot roster — broadcast whenever the host
    // adds/removes a bot seat in the waiting room (see `addBot`/`removeBot`
    // below), so every client renders the same lobby/board without a server.
    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      const roles = (payload?.botRoles as Owner[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botRolesRef.current = roles;
      setBotRoles(roles);
      botLevelsRef.current = levels;
      setBotLevels(levels);
    });

    // `state-request`/`state-sync`: same resync protocol every other online
    // game's channel effect implements (see e.g. DalmutiGame.tsx) — used for
    // this session's mobile background-tab resync (`useBackgroundResync`
    // below) so a client whose channel missed broadcasts while backgrounded
    // can catch back up to the current `HanamikojiState`.
    // Bot-takeover vote/conversion — see botTakeover.ts. Every client
    // replays the identical event stream through the same pure reducer; a
    // client whose own `vote-cast` (including its own) just crossed the
    // majority threshold is the one that fires `convert`.
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
      if (!vote) return; // already converted/cancelled by a faster broadcast
      const takenOverRoles = new Set(Object.keys(botTakeoverRef.current.takeovers));
      const eligible = occupantsRef.current.filter(
        (o) => o.role !== event.seatKey && !botRolesRef.current.includes(o.role) && !takenOverRoles.has(o.role),
      ).length;
      if (voteThresholdMet(voteYesCount(botTakeoverRef.current, event.seatKey), eligible)) {
        channel.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "convert", seatKey: event.seatKey, at: Date.now() } } });
      }
    });

    channel.on("broadcast", { event: "state-request" }, () => {
      if (gameStateRef.current) {
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
      } else if (isHost) {
        channel.send({ type: "broadcast", event: "bot-roster", payload: { botRoles: botRolesRef.current, botLevels: botLevelsRef.current } });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const state = payload?.state as HanamikojiState | undefined;
      if (!state) return;
      const roles = (payload?.botRoles as Owner[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      const takeover = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
      botRolesRef.current = roles;
      setBotRoles(roles);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = takeover;
      setBotTakeover(takeover);
      setGameState(state);
      setFinalResult(null);
      setPhase("playing");
    });

    channel.on("presence", { event: "sync" }, () => {
      const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
      setOccupants(Object.values(raw).flat());
    });

    // Real disconnect (tab closed, network dropped, or an explicit leave) —
    // fires identically on every connected client (Supabase Presence is
    // server-synced, not local-only). Only kicks off a takeover vote
    // mid-game, for a role that isn't already a bot; `leftPresences` still
    // carries the leaving occupant's `playerId`/`name` even though they're
    // already gone from `presenceState()` by the time anyone could look them
    // up again.
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
  }, [roomCode, myRole, myName, myPlayerId, isHost]);

  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";

  // Someone else is already occupying my role in this room (rare code
  // collision, or a stale localStorage role from a different session).
  // Derived during render (not an effect) — same "compare and setState
  // during render" pattern used elsewhere, so it's a plain idempotent
  // one-extra-render bail-out instead of a setState-in-effect cascade.
  if (myRole && phase !== "room-full") {
    const deviceId = getDeviceId();
    const conflict = occupants.some((o) => o.role === myRole && o.deviceId !== deviceId);
    if (conflict) setPhase("room-full");
  }

  const sendGameStart = useCallback(() => {
    startSentRef.current = true;
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: {
        seed: Math.floor(Math.random() * 1_000_000_000),
        botRoles: botRolesRef.current,
        botLevels: botLevelsRef.current,
      },
    });
  }, []);

  // Host deals the first hand as soon as both seats are filled — a seat
  // counts as "filled" whether it's a connected human or a bot the host added.
  useEffect(() => {
    if (phase !== "waiting" || myRole !== "p1" || startSentRef.current) return;
    const hasP1 = occupants.some((o) => o.role === "p1");
    const hasP2 = occupants.some((o) => o.role === "p2") || botRoles.includes("p2");
    if (hasP1 && hasP2) sendGameStart();
  }, [occupants, phase, myRole, botRoles, sendGameStart]);

  // Host-only: fill/empty the p2 seat with an AI bot (§7 of ARCHITECTURE.md).
  // Only ever offered for an *empty* seat — a connected human is never
  // forcibly replaced. If a human later joins a seat a bot was occupying,
  // the eviction effect below automatically drops the bot for them.
  const addBot = useCallback(
    (level: BotLevel) => {
      if (!isHost || botRolesRef.current.includes("p2")) return;
      if (occupants.some((o) => o.role === "p2")) return;
      const nextRoles: Owner[] = [...botRolesRef.current, "p2"];
      const nextLevels: BotLevel[] = [...botLevelsRef.current, level];
      botRolesRef.current = nextRoles;
      setBotRoles(nextRoles);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      channelRef.current?.send({
        type: "broadcast",
        event: "bot-roster",
        payload: { botRoles: nextRoles, botLevels: nextLevels },
      });
    },
    [isHost, occupants],
  );

  const removeBot = useCallback(
    (role: Owner) => {
      if (!isHost) return;
      const idx = botRolesRef.current.indexOf(role);
      if (idx < 0) return;
      const nextRoles = botRolesRef.current.filter((_, i) => i !== idx);
      const nextLevels = botLevelsRef.current.filter((_, i) => i !== idx);
      botRolesRef.current = nextRoles;
      setBotRoles(nextRoles);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      channelRef.current?.send({
        type: "broadcast",
        event: "bot-roster",
        payload: { botRoles: nextRoles, botLevels: nextLevels },
      });
    },
    [isHost],
  );

  // A human physically claiming a seat always wins over a bot placeholder —
  // derived during render (not an effect), same "compare and setState during
  // render" pattern as the role-conflict check above: a plain idempotent
  // one-extra-render bail-out instead of a setState-in-effect cascade. Only
  // updates the HOST's own local roster (no broadcast needed here) — it's
  // exactly what gates the host-only auto-start/manual-start logic below,
  // and every other client already prefers a seat's real Presence occupant
  // over a stale bot badge when rendering names (see `names` above), so
  // nobody else needs to hear about this until the next `game-start`/
  // `bot-roster` broadcast picks up the corrected roster anyway.
  if (isHost && botRoles.length > 0) {
    const keepIdx = botRoles.map((r, i) => (occupants.some((o) => o.role === r) ? -1 : i)).filter((i) => i !== -1);
    // botRolesRef/botLevelsRef are re-synced by the effects above once this
    // commits — not updated here too, since refs (like state) must not be
    // written during render.
    if (keepIdx.length !== botRoles.length) {
      setBotRoles(keepIdx.map((i) => botRoles[i]));
      setBotLevels(keepIdx.map((i) => botLevels[i]));
    }
  }

  const handleAction = useCallback((action: EngineAction) => {
    channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action } });
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
        channel: `room:hanamikoji:${roomCode}`,
        deviceId,
        senderName: myName || "게스트",
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

  // Roles a takeover vote has actually converted — unioned with the lobby
  // `botRoles` roster wherever bot membership matters. Depending on a
  // stable, content-derived string key (rather than the whole `botTakeover`
  // object) means this only produces a new reference when the *set of
  // taken-over roles* itself actually changes — see DalmutiGame.tsx's
  // 2026-09-03 freeze-fix comment for why that matters for
  // `useBotAutoplay`'s watchdog.
  const takeoverRoleKey = Object.keys(botTakeover.takeovers).sort().join(",");
  const takeoverRoles = useMemo(
    () => (takeoverRoleKey ? (takeoverRoleKey.split(",") as Owner[]) : []),
    [takeoverRoleKey],
  );
  const allBotRoleSet = useMemo(
    () => new Set([...botRoleSet, ...takeoverRoles]),
    [botRoleSet, takeoverRoles],
  );

  const chooseAction = useCallback((state: HanamikojiState, actor: Owner) => {
    const idx = botRolesRef.current.indexOf(actor);
    // A takeover role has no per-role lobby-chosen level (it was human-
    // controlled until now) — fall back to the room's default level.
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return hanamikojiChooseAction(state, actor, level);
  }, []);

  useBotAutoplay<HanamikojiState, EngineAction, Owner>({
    active: isHost && phase === "playing",
    state: gameState,
    currentActor: hanamikojiCurrentActor,
    botSeats: allBotRoleSet,
    chooseAction,
    dispatch: handleAction,
  });

  // "무응답(idle)" takeover trigger: if the current actor hasn't changed in
  // IDLE_VOTE_THRESHOLD_MS while the game is playing, kick off a vote for
  // that role (unless it's already a bot or already mid-vote).
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = window.setInterval(() => {
      const state = gameStateRef.current;
      if (!state) return;
      const actor = hanamikojiCurrentActor(state);
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

  function castTakeoverVote(seatKey: string) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey, voterDeviceId: deviceId } } });
  }
  // Unified "yes" affordance — the vote target proving presence cancels the
  // pending vote; the same button after the role has already converted
  // instead reclaims control.
  function proveStillHereOrReclaim(seatKey: string) {
    const type = isSeatTakenOver(botTakeover, seatKey) ? "reclaim" : "vote-cancel";
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type, seatKey } } });
  }

  // Other real, non-bot occupants besides `role` — the eligible-voter
  // denominator for that role's vote (a 2-player game, so this is 0 or 1).
  function eligibleVoterCountFor(role: string): number {
    const takenOverRoles = new Set(Object.keys(botTakeover.takeovers));
    return occupants.filter((o) => o.role !== role && !botRoles.includes(o.role as Owner) && !takenOverRoles.has(o.role)).length;
  }

  function handleGameEnd(winnerId: string) {
    if (!gameState || !myRole) return;
    const winnerRole = winnerId === ids.p1 ? "p1" : "p2";
    const loserId = winnerId === ids.p1 ? ids.p2 : ids.p1;
    onComplete({
      rankings: [
        { playerId: winnerId, rank: 1 },
        { playerId: loserId, rank: 2 },
      ],
      finishedAt: new Date().toISOString(),
    });
    setFinalResult({ winnerId, winnerName: names[winnerRole] });
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
    setMyRole(null);
    setOccupants([]);
    setGameState(null);
    setFinalResult(null);
    setIdentity({ name: "" });
    setMyPlayerId(undefined);
    setCodeInput("");
    botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
    setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
    setDismissedVoteKey(null);
    setChatMessages([]);
    setChatCooldownUntil(null);
    chatThrottleRef.current = INITIAL_THROTTLE_STATE;
    setPhase("choose");
  }

  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(roomCode !== null, handleLeave);
  useBackgroundResync(roomCode !== null, requestStateSync);
  // Desktop lobby dashboard "실시간 활성 대기실" panel (src/app/page.tsx) —
  // best-effort, see useActiveRoomListing.ts.
  useActiveRoomListing({
    gameId: "hanamikoji",
    roomCode,
    isHost,
    isWaiting: phase === "waiting",
    hostName: myName,
    playerCount: occupants.length,
    maxPlayers: 2,
  });

  // Mobile back-gesture / browser back-button exit guard, and mobile
  // background-tab resync — both shared across every online game; see
  // `useGameLeaveGuard` / `useBackgroundResync` for the full explanation.
  function withGuard(node: ReactNode) {
    return (
      <>
        {node}
        <GameLeaveGuardModal open={exitConfirmOpen} onCancel={cancelExit} onConfirm={confirmExit} />
      </>
    );
  }

  const shareUrl =
    typeof window !== "undefined" && roomCode
      ? `${window.location.origin}${window.location.pathname}?room=${roomCode}`
      : "";

  // ---- Supabase not configured: online play literally cannot work. ----
  if (phase === "supabase-missing") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 text-center">
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80">
          하나미코지는 이제 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">.env.local</code>
          에 <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code> /
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">
            NEXT_PUBLIC_SUPABASE_ANON_KEY
          </code>
          를 채워주세요 (README 참고).
        </p>
      </div>
    );
  }

  if (phase === "room-full") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center">
        <span className="text-3xl">🚫</span>
        <h2 className="text-lg font-bold text-white">이미 다른 사람이 참여 중인 방이에요</h2>
        <p className="text-sm text-rose-100/80">코드를 다시 확인하거나 새로운 방을 만들어보세요.</p>
        <button
          onClick={handleLeave}
          className="mt-2 rounded-full bg-rose-500 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-400"
        >
          처음으로
        </button>
      </div>
    );
  }

  if (phase === "channel-error") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center">
        <span className="text-3xl">📡</span>
        <h2 className="text-lg font-bold text-white">연결에 실패했습니다</h2>
        <button
          onClick={handleLeave}
          className="mt-2 rounded-full bg-rose-500 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-400"
        >
          다시 시도
        </button>
      </div>
    );
  }

  // ---- Lobby: choose create vs join. ----
  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId="hanamikoji"
        icon="🌸"
        title="하나미코지 온라인 대전"
        description={<p className="text-sm text-white/50">두 사람이 각자 기기로 접속해서 실시간으로 플레이해요.</p>}
        actions={
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => {
                setIntent("create");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl bg-rose-500 py-3 text-sm font-semibold text-white transition hover:bg-rose-400"
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
          </div>
        }
      />
    );
  }

  // ---- Nickname (+ code, if joining) entry. ----
  if (phase === "enter-name") {
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-base font-bold text-white">
          {intent === "create" ? "방 만들기" : "초대 코드로 참여"}
        </h2>
        <div className="flex flex-col gap-1.5 text-sm text-white/70">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} onEnter={enterRoom} accent="rose" />
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-rose-400 focus:outline-none"
            />
          </label>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => setPhase("choose")}
            className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30"
          >
            뒤로
          </button>
          <button
            onClick={enterRoom}
            className="flex-1 rounded-xl bg-rose-500 py-2.5 text-sm font-semibold text-white hover:bg-rose-400"
          >
            {intent === "create" ? "방 만들기" : "참여하기"}
          </button>
        </div>
      </div>
    );
  }

  // ---- Connecting / waiting room. ----
  if (phase === "connecting" || phase === "waiting") {
    return withGuard(
      <>
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        {phase === "connecting" ? (
          <p className="text-sm text-white/50">연결하는 중...</p>
        ) : (
          <>
            <p className="text-sm text-white/50">초대 코드</p>
            <p className="text-4xl font-bold tracking-[0.3em] text-white">{roomCode}</p>
            <button
              onClick={() => navigator.clipboard?.writeText(shareUrl)}
              className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70 hover:border-white/30"
            >
              🔗 초대 링크 복사
            </button>
            <div className="mt-2 flex flex-col gap-1.5">
              {(["p1", "p2"] as const).map((role) => {
                const occ = occupants.find((o) => o.role === role);
                const botIdx = botRoles.indexOf(role);
                const isBot = botIdx >= 0;
                return (
                  <div key={role} className="flex items-center justify-between gap-3 text-sm text-white/70">
                    <span>
                      {role === myRole ? "나" : role === "p1" ? "1번" : "2번"}:{" "}
                      {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30">대기 중...</span>}
                    </span>
                    {isHost && role !== myRole && !occ && (
                      isBot ? <RemoveBotButton onClick={() => removeBot(role)} /> : <AddBotButton onAddWithLevel={addBot} />
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-white/40">2명이 모이면 자동으로 게임이 시작됩니다. AI 봇으로도 채울 수 있어요.</p>
          </>
        )}
      </div>
      <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="대기실 채팅" />
      </>
    );
  }

  // ---- Playing. ----
  if (phase === "playing" && gameState && myRole) {
    const myVoteAsTarget = activeVoteFor(botTakeover, myRole);
    const iAmTakenOver = isSeatTakenOver(botTakeover, myRole);
    const voteToShow = Object.values(botTakeover.votes).find(
      (v) => v.seatKey !== myRole && `${v.seatKey}:${v.startedAt}` !== dismissedVoteKey,
    );
    return withGuard(
      <>
      {myVoteAsTarget && (
        <BotTakeoverSelfBanner mode="prove-presence" onConfirm={() => proveStillHereOrReclaim(myRole)} />
      )}
      {!myVoteAsTarget && iAmTakenOver && (
        <BotTakeoverSelfBanner mode="reclaim" onConfirm={() => proveStillHereOrReclaim(myRole)} />
      )}
      {voteToShow && (
        <BotTakeoverVoteModal
          targetName={names[voteToShow.seatKey as Owner] ?? voteToShow.originalName}
          reason={voteToShow.reason}
          yesCount={voteToShow.yesVoterDeviceIds.length}
          eligibleVoterCount={eligibleVoterCountFor(voteToShow.seatKey)}
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
      <HanamikojiBoard
        state={gameState}
        viewerRole={myRole}
        names={names}
        ids={ids}
        opponentConnected={opponentConnected}
        onAction={handleAction}
        onGameEnd={handleGameEnd}
      />
      <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="게임 채팅" />
      </>
    );
  }

  // ---- Post-game. ----
  if (phase === "post-game" && finalResult) {
    return withGuard(
      <>
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">🏆</span>
        <p className="text-white/80">{finalResult.winnerName}님 승리로 게임이 끝났어요.</p>
        <div className="flex gap-2">
          <button
            onClick={handleLeave}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30"
          >
            나가기
          </button>
          <button
            onClick={handleRematch}
            className="rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-400"
          >
            다시하기
          </button>
        </div>
      </div>
      <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="게임 채팅" />
      </>
    );
  }

  return withGuard(null);
}
