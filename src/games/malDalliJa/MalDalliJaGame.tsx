"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import GameLeaveGuardModal from "@/components/GameLeaveGuardModal";
import { useGameLeaveGuard } from "@/hooks/useGameLeaveGuard";
import { useBackgroundResync } from "@/hooks/useBackgroundResync";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  chooseBotAction,
  isStateSyncStale,
  otherSeat,
  startGame,
  type EngineAction,
  type MalDalliJaState,
  type Seat,
} from "./engine";
import MalDalliJaBoard from "./MalDalliJaBoard";
import { useGameBgm } from "@/lib/audio/useGameBgm";
import { useBotAutoplay } from "@/games/shared/bot/useBotAutoplay";
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
import { AddBotButton, BotSeatBadge, RemoveBotButton } from "@/components/lobby/BotSeatControls";
import { BotTakeoverSelfBanner, BotTakeoverVoteModal } from "@/components/lobby/BotTakeoverVoteModal";
import { botTier, DEFAULT_BOT_LEVEL, type BotLevel } from "@/games/shared/bot/botDifficulty";
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
import {
  computeRoundDeltas,
  INITIAL_ROOM_BETTING_STATE,
  reduceRoomBetting,
  type RoomBettingEvent,
  type RoomBettingState,
} from "@/games/shared/betting/roomBetting";
import RoomBettingPanel from "@/games/shared/betting/RoomBettingPanel";
import { v4 as uuid } from "uuid";
import type { ChatMessage, SendResult } from "@/lib/chat/types";
import { checkThrottle, recordSend, INITIAL_THROTTLE_STATE, type ThrottleState } from "@/lib/chat/throttle";
import { filterProfanity } from "@/lib/chat/profanity";
import { stripControlChars } from "@/lib/chat/sanitize";
import { loadRecentMessages, mergeHistoryIntoMessages, persistMessage } from "@/lib/chat/history";
import { formatBotTakeoverLog } from "@/lib/chat/systemLog";
import ChatDrawer from "@/components/chat/ChatDrawer";

/** Whose decision `useBotAutoplay` should drive right now. */
function mddjCurrentActor(state: MalDalliJaState): Seat | null {
  if (state.phase !== "playing") return null;
  return state.activeSeat;
}

/**
 * Small local system-log formatter for the game's win condition (see
 * PerudoGame.tsx/DalmutiGame.tsx's `src/lib/chat/systemLog.ts` pattern —
 * kept local here per-game instead of adding to that shared file).
 * Replaces the earlier per-move "OO님이 말을 이동했습니다" log (2026-08-26
 * pilot rollout) — every-move chat spam was reported as a readability
 * problem, so the headline system-log event for this game is now the win
 * itself instead of each individual move. e.g. "지수님이 오아시스에
 * 도착해 승리했습니다".
 */
function formatMalDalliJaWinLog(name: string): string {
  return `${name}님이 오아시스에 도착해 승리했습니다`;
}

/**
 * Online-room multiplayer entry point — same lockstep pattern as every other
 * 2-player game in this project (see docs/cloud-sync.md, and
 * HanamikojiGame.tsx which this was modeled on): the host broadcasts a seed
 * (`startGame` only uses it to pick who moves first, per engine.ts) plus the
 * room's §5 turn-timer house-rule setting, both clients independently derive
 * the identical initial state, and every subsequent move replays as an
 * `EngineAction` broadcast through the same pure reducer. Only the seat
 * whose turn it is ever sends a `move`/`pass` action (single-writer
 * guarantee — see engine.ts's module doc for the `pass`/timer trust model).
 */

type Occupant = {
  deviceId: string;
  role: Seat;
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

/** §5 house rule: "턴당 30초~1분" — a discrete pick, off by default. */
const TIMER_OPTIONS: { label: string; value: number | null }[] = [
  { label: "제한 없음", value: null },
  { label: "30초", value: 30 },
  { label: "45초", value: 45 },
  { label: "60초", value: 60 },
];

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredRole(code: string): Seat | null {
  const v = window.localStorage.getItem(`mddj-role-${code}`);
  return v === "p1" || v === "p2" ? v : null;
}

function storeRole(code: string, role: Seat) {
  window.localStorage.setItem(`mddj-role-${code}`, role);
}

export default function MalDalliJaGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  // 빠른 오케스트라 레이싱 테마 BGM — 실제 대국 중에만 크로스페이드로 재생 (2026-08-26 세션).
  useGameBgm(phase === "playing" ? "malDalliJa" : null);
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [turnTimerChoice, setTurnTimerChoice] = useState<number | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Seat | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<MalDalliJaState | null>(null);
  const [turnTimerSec, setTurnTimerSec] = useState<number | null>(null);
  const [finalResult, setFinalResult] = useState<{ winnerId: string; winnerName: string } | null>(null);
  // Room chat + in-game system log (see PerudoGame.tsx/DalmutiGame.tsx —
  // GameMeta.chatEnabled). Shares this component's own room channel instead
  // of opening a second Realtime subscription.
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatCooldownUntil, setChatCooldownUntil] = useState<number | null>(null);
  const chatThrottleRef = useRef<ThrottleState>(INITIAL_THROTTLE_STATE);
  // Roles currently played by an AI bot instead of a human — host-controlled
  // (ARCHITECTURE.md §7), broadcast via "bot-roster" so every client renders
  // the same lobby/board without a server. `botLevels[i]` is the Level 1–10
  // difficulty for `botRoles[i]` (parallel arrays, same index).
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

  // Mid-game "seat disconnected/unresponsive → AI bot" — see botTakeover.ts
  // for the vote/conversion state machine this mirrors (same lockstep
  // philosophy as `gameState`/`applyAction` above, no host dependency). Only
  // 1 other role can ever exist to vote in this 2-player game, so a vote
  // "passes" the instant that one opponent votes yes — `voteThresholdMet(1, 1)`.
  const [botTakeover, setBotTakeover] = useState<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  const botTakeoverRef = useRef<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  function applyBotTakeoverEvent(event: BotTakeoverEvent) {
    const next = reduceBotTakeover(botTakeoverRef.current, event);
    botTakeoverRef.current = next;
    setBotTakeover(next);
  }
  const [dismissedVoteKey, setDismissedVoteKey] = useState<string | null>(null);
  // Cross-device room-linked betting ledger — see roomBetting.ts. Unlike
  // `botTakeover` above, this accumulates ACROSS rematches within one room's
  // lifetime, so it's only reset when leaving the room, never on
  // `game-start`/rematch.
  const [roomBetting, setRoomBetting] = useState<RoomBettingState>(INITIAL_ROOM_BETTING_STATE);
  const roomBettingRef = useRef<RoomBettingState>(INITIAL_ROOM_BETTING_STATE);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // Tracks how long the current actor has been stuck, for the "idle/무응답"
  // vote trigger — see the dedicated interval effect below. `since: 0` is a
  // deliberately-stale placeholder (not `Date.now()`, an impure render-time
  // call) — the first interval tick always rebases it to "now".
  const lastActorRef = useRef<{ actor: Seat | null; since: number }>({ actor: null, since: 0 });
  const IDLE_VOTE_THRESHOLD_MS = 45_000;
  const occupantsRef = useRef<Occupant[]>([]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);

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

  // Refs so the `state-request` handler (registered once per channel-open
  // effect run) always sees the latest state/timer setting instead of a
  // stale closure over the values from that render — see docs/cloud-sync.md
  // §2.3 (same pattern as every other online game here, e.g. CoyoteGame.tsx).
  const gameStateRef = useRef<MalDalliJaState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  const turnTimerRef = useRef<number | null>(null);
  useEffect(() => {
    turnTimerRef.current = turnTimerSec;
  }, [turnTimerSec]);

  // Kept in sync so the `game-action` broadcast handler (registered once,
  // inside the channel-setup effect below) can resolve a seat to its display
  // name for the system log without closing over a stale value.
  const namesRef = useRef<Record<Seat, string>>({ p1: "상대", p2: "상대" });

  // Roles a takeover vote has actually converted — unioned with the lobby
  // `botRoles` roster wherever bot-role membership matters (autoplay,
  // occupancy, display). See DalmutiGame.tsx for the fuller rationale.
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
  // Prefer the real betting-system playerId (present when that seat's
  // occupant joined by picking themselves from an active session's roster —
  // see RoomNicknameField) over the synthetic per-room id. A taken-over
  // role's `originalUserId` wins over both — see DalmutiGame.tsx's `ids` for
  // why this matters for a real disconnect (the player is gone from
  // presence entirely by then).
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
    const role: Seat = getStoredRole(code) ?? (intent === "create" ? "p1" : "p2");
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
    const channel = supabase.channel(`mal-dalli-ja-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    const chatChannel = `room:mal-dalli-ja:${roomCode}`;
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
      const timerSec = (payload?.turnTimerSec as number | null | undefined) ?? null;
      const roster = (payload?.botRoles as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botRolesRef.current = roster;
      setBotRoles(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      // A rematch is a fresh game — any takeover from the previous round
      // shouldn't silently carry a role's control into this one.
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      setGameState(startGame(seededRng(seed)));
      setTurnTimerSec(timerSec);
      setFinalResult(null);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      // System-log pilot (see GameMeta.chatEnabled / PerudoGame.tsx): every
      // connected client derives the same human-readable line independently
      // from the *post-action* state — no server round-trip, no change to
      // the pure reducer in engine.ts. Deliberately not persisted to
      // `chat_messages` (unlike user messages) — every client would
      // otherwise write a duplicate row, and it's trivially re-derivable
      // from the replayed action log anyway.
      //
      // Per-move "OO님이 말을 이동했습니다" logging (2026-08-26 pilot
      // rollout) was removed — every single slide/knight move spammed the
      // chat feed and drowned out actual conversation. The win itself is
      // the only headline event logged now, computed here (rather than off
      // `MalDalliJaBoard.tsx`'s win-banner "확인" click, which only fires
      // for the viewer who clicks it and would desync the two clients'
      // chat feeds) so both clients log it exactly once, in lockstep, the
      // instant the winning move is replayed.
      const prevState = gameStateRef.current;
      if (action.type === "move" && prevState && prevState.phase !== "gameOver") {
        const nextState = applyAction(prevState, action);
        if (nextState.phase === "gameOver" && nextState.winner) {
          const winnerSeat = nextState.winner;
          setChatMessages((prev) => [
            ...prev,
            {
              id: uuid(),
              channel: chatChannel,
              deviceId: "system",
              senderName: "시스템",
              body: formatMalDalliJaWinLog(namesRef.current[winnerSeat] ?? "상대"),
              type: "SYSTEM",
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      }
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    // Host-authoritative AI bot roster — broadcast whenever the host
    // adds/removes a bot role in the waiting room, so every client renders
    // the same lobby/board without a server.
    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      const roster = (payload?.botRoles as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botRolesRef.current = roster;
      setBotRoles(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
    });

    // Bot-takeover vote/conversion — see botTakeover.ts. Every client
    // replays the identical event stream through the same pure reducer; a
    // client whose own `vote-cast` (including its own) just crossed the
    // majority threshold is the one that fires `convert` — harmless if more
    // than one client does this in the same instant, since `convert` on an
    // already-converted role only happens once (the vote is gone by then on
    // every client that already processed the first `convert`).
    channel.on("broadcast", { event: "bot-takeover-event" }, ({ payload }) => {
      const event = payload?.event as BotTakeoverEvent | undefined;
      if (!event) return;
      // System-log line the instant a conversion actually lands — read the
      // about-to-be-consumed vote's `originalName` *before* applying the
      // event. `broadcast: { self: true }` means the client that sent
      // `convert` processes this same handler too, so this fires exactly
      // once per client either way, never duplicated.
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
      // Only ever 1 other role in this 2-player game — eligible = 1 if the
      // opponent role is a connected real (non-bot, non-taken-over) player.
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

    // Room-linked betting ledger — see roomBetting.ts. Same lockstep replay
    // pattern as `bot-takeover-event` above: `broadcast: { self: true }`
    // means the sender also receives its own event through this same
    // handler, so this is the one-and-only place `reduceRoomBetting` runs.
    channel.on("broadcast", { event: "room-betting-event" }, ({ payload }) => {
      const event = payload?.event as RoomBettingEvent | undefined;
      if (!event) return;
      roomBettingRef.current = reduceRoomBetting(roomBettingRef.current, event);
      setRoomBetting(roomBettingRef.current);
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
          turnTimerSec: turnTimerRef.current,
          botRoles: botRolesRef.current,
          botLevels: botLevelsRef.current,
          botTakeover: botTakeoverRef.current,
          roomBetting: roomBettingRef.current,
        },
      });
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const syncedState = payload?.state as MalDalliJaState | undefined;
      if (!syncedState) return;
      // 2026-08-25 fix ("슬라이드이동중 사라진 말과 출발지점에 하얀색말로
      // 바뀐부분" bug report) — see `isStateSyncStale`'s doc in engine.ts for
      // the full race analysis. Reject the whole payload if it's a stale
      // resync (roster/timer fields on it aren't versioned either, so
      // there's nothing worth salvaging from an otherwise-rejected snapshot).
      if (isStateSyncStale(gameStateRef.current, syncedState)) return;
      const roster = (payload?.botRoles as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      const takeover = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
      const betting = (payload?.roomBetting as RoomBettingState | undefined) ?? INITIAL_ROOM_BETTING_STATE;
      botRolesRef.current = roster;
      setBotRoles(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = takeover;
      setBotTakeover(takeover);
      roomBettingRef.current = betting;
      setRoomBetting(betting);
      setGameState(syncedState);
      setTurnTimerSec((payload?.turnTimerSec as number | null | undefined) ?? null);
      setPhase((p) => (p === "connecting" || p === "waiting" ? "playing" : p));
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
    // already gone from `presenceState()` by the time anyone could look
    // them up again.
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
        // Reconnect support (docs/cloud-sync.md §2.3): a no-op if the game
        // hasn't started anywhere yet.
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

  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";

  // Someone else is already occupying my seat in this room (rare code
  // collision, or a stale localStorage role from a different session).
  // Derived during render (not an effect) — same "compare and setState
  // during render" pattern used elsewhere, so it's a plain idempotent
  // one-extra-render bail-out instead of a setState-in-effect cascade.
  if (myRole && phase !== "room-full") {
    const deviceId = getDeviceId();
    const conflict = occupants.some((o) => o.role === myRole && o.deviceId !== deviceId);
    if (conflict) setPhase("room-full");
  }

  const isHost = myRole === "p1";

  // Host deals the opening position as soon as both seats are filled (a
  // role counts as "filled" whether it's a connected human or a bot the
  // host added).
  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current) return;
    const hasP1 = occupants.some((o) => o.role === "p1") || botRoles.includes("p1");
    const hasP2 = occupants.some((o) => o.role === "p2") || botRoles.includes("p2");
    if (hasP1 && hasP2) {
      startSentRef.current = true;
      channelRef.current?.send({
        type: "broadcast",
        event: "game-start",
        payload: {
          seed: Math.floor(Math.random() * 1_000_000_000),
          turnTimerSec: turnTimerChoice,
          botRoles: botRolesRef.current,
          botLevels: botLevelsRef.current,
        },
      });
    }
  }, [occupants, botRoles, phase, isHost, turnTimerChoice]);

  // Host-only: fill/empty an empty role with an AI bot (ARCHITECTURE.md §7).
  // Only ever offered for a role with no connected human — a real player is
  // never forcibly replaced. If a human later claims a role a bot was
  // occupying, the eviction logic below automatically drops the bot.
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

  // A human physically claiming a role always wins over a bot placeholder —
  // derived during render (not an effect), same "compare and setState
  // during render" pattern used elsewhere in this file.
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
        channel: `room:mal-dalli-ja:${roomCode}`,
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

  // Level 1-7 stay a cheap inline heuristic pass. Level 8-10 (expert tier)
  // runs iterative-deepening alpha-beta (see engine.ts) off the main thread
  // via the shared bot Worker so it never freezes the UI; `requestBotAction`
  // transparently falls back to this same synchronous call if a Worker
  // isn't available in this environment.
  const chooseAction = useCallback((state: MalDalliJaState, actor: Seat): EngineAction | null | Promise<EngineAction | null> => {
    const idx = botRolesRef.current.indexOf(actor);
    // A takeover role has no per-seat lobby-chosen level (it was human-
    // controlled until now) — fall back to the room's default level.
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    if (botTier(level) === "expert") {
      return requestBotAction<EngineAction>("malDalliJa", state, actor, level, Math.floor(Math.random() * 1_000_000_000), () =>
        chooseBotAction(state, actor, level),
      );
    }
    return chooseBotAction(state, actor, level);
  }, []);

  useBotAutoplay<MalDalliJaState, EngineAction, Seat>({
    active: isHost && phase === "playing",
    state: gameState,
    currentActor: mddjCurrentActor,
    botSeats: allBotRoleSet,
    chooseAction,
    dispatch: handleAction,
  });

  // "무응답(idle)" takeover trigger — see DalmutiGame.tsx for the full
  // rationale (runs off a plain interval since a *stuck* actor means
  // `gameState` itself stops changing).
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = window.setInterval(() => {
      const state = gameStateRef.current;
      if (!state) return;
      const actor = mddjCurrentActor(state);
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

  function handleGameEnd(winnerId: string) {
    if (!gameState || !myRole) return;
    const winnerSeat: Seat = winnerId === ids.p1 ? "p1" : "p2";
    const loserSeat: Seat = winnerSeat === "p1" ? "p2" : "p1";
    const loserId = winnerId === ids.p1 ? ids.p2 : ids.p1;
    if (roomBettingRef.current.active) {
      const ranksBySeat: Record<string, number> = { [winnerSeat]: 1, [loserSeat]: 2 };
      const deltas = computeRoundDeltas(ranksBySeat, [...roomBettingRef.current.payoutTable]);
      const namesAtRound: Record<string, string> = { p1: names.p1, p2: names.p2 };
      channelRef.current?.send({
        type: "broadcast",
        event: "room-betting-event",
        payload: {
          event: {
            type: "round-recorded",
            round: roomBettingRef.current.rounds.length + 1,
            deltas,
            namesAtRound,
            rankedSeats: Object.keys(ranksBySeat).sort((a, b) => ranksBySeat[a] - ranksBySeat[b]),
            playedAt: new Date().toISOString(),
          },
        },
      });
    }
    onComplete({
      rankings: [
        { playerId: winnerId, rank: 1 },
        { playerId: loserId, rank: 2 },
      ],
      finishedAt: new Date().toISOString(),
    });
    setFinalResult({ winnerId, winnerName: names[winnerSeat] });
    setPhase("post-game");
  }

  function handleRematch() {
    startSentRef.current = true;
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: { seed: Math.floor(Math.random() * 1_000_000_000), turnTimerSec, botRoles: botRolesRef.current, botLevels: botLevelsRef.current },
    });
    // Sender included — `broadcast: { self: true }` means this client also
    // processes its own "game-start" above (which resets `botTakeover`), so
    // any previous round's takeover doesn't silently carry into this one.
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
    setTurnTimerSec(null);
    setFinalResult(null);
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
    roomBettingRef.current = INITIAL_ROOM_BETTING_STATE;
    setRoomBetting(INITIAL_ROOM_BETTING_STATE);
    setChatMessages([]);
    setChatCooldownUntil(null);
    chatThrottleRef.current = INITIAL_THROTTLE_STATE;
    setPhase("choose");
  }

  const shareUrl =
    typeof window !== "undefined" && roomCode
      ? `${window.location.origin}${window.location.pathname}?room=${roomCode}`
      : "";

  // ---- Supabase not configured: online play literally cannot work. ----
  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(roomCode !== null, handleLeave);
  useBackgroundResync(roomCode !== null, requestStateSync);

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

  if (phase === "supabase-missing") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 text-center">
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80">
          말달리자는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
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
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1c0a0e] via-[#12080b] to-black p-8 text-center">
        <span className="text-4xl">🐎</span>
        <h2 className="text-lg font-bold text-white">말달리자 온라인 대전</h2>
        <p className="text-sm text-white/50">두 사람이 각자 기기로 접속해서 실시간으로 플레이해요.</p>
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
      </div>
    );
  }

  // ---- Nickname (+ code, if joining; + house rule, if creating). ----
  if (phase === "enter-name") {
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1c0a0e] via-[#12080b] to-black p-6">
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
        {intent === "create" && (
          <div className="flex flex-col gap-1.5 text-sm text-white/70">
            [하우스 룰] 턴 제한 시간 (§5, 선택)
            <div className="grid grid-cols-4 gap-1.5">
              {TIMER_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setTurnTimerChoice(opt.value)}
                  className={`rounded-lg border py-2 text-xs font-medium transition ${
                    turnTimerChoice === opt.value
                      ? "border-rose-400 bg-rose-500/20 text-rose-200"
                      : "border-white/10 text-white/60 hover:border-white/25"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
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
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1c0a0e] via-[#12080b] to-black p-8 text-center">
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
                  <p key={role} className="flex items-center justify-between gap-2 text-sm text-white/70">
                    <span>
                      {role === myRole ? "나" : role === "p1" ? "흑마" : "백마"}:{" "}
                      {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30">대기 중...</span>}
                    </span>
                    {isHost && !occ && (
                      <span>
                        {isBot ? (
                          <RemoveBotButton onClick={() => removeBotAtRole(role)} />
                        ) : (
                          <AddBotButton onAddWithLevel={(level) => addBotAtRole(role, level)} />
                        )}
                      </span>
                    )}
                  </p>
                );
              })}
            </div>
            <p className="text-xs text-white/40">2명이 모이면 자동으로 게임이 시작됩니다.</p>
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
      <MalDalliJaBoard
        state={gameState}
        viewerSeat={myRole}
        names={names}
        ids={ids}
        opponentConnected={opponentConnected}
        turnTimerSec={turnTimerSec}
        onAction={handleAction}
        onGameEnd={handleGameEnd}
      />
      <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="게임 채팅" />
      <RoomBettingPanel
        state={roomBetting}
        isHost={true}
        namesBySeat={names}
        participantCount={2}
        onStart={(payoutTable) => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "session-start", payoutTable } } })}
        onPayoutChange={(payoutTable) => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "payout-set", payoutTable } } })}
        onEnd={() => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "session-end" } } })}
        onMerge={(canonicalSeat, memberSeats) => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "merge", canonicalSeat, memberSeats } } })}
        onUnmerge={(canonicalSeat) => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "unmerge", canonicalSeat } } })}
      />
      </>
    );
  }

  // ---- Post-game. ----
  if (phase === "post-game" && finalResult) {
    return withGuard(
      <>
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1c0a0e] via-[#12080b] to-black p-8 text-center">
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
      <RoomBettingPanel
        state={roomBetting}
        isHost={true}
        namesBySeat={names}
        participantCount={2}
        onStart={(payoutTable) => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "session-start", payoutTable } } })}
        onPayoutChange={(payoutTable) => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "payout-set", payoutTable } } })}
        onEnd={() => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "session-end" } } })}
        onMerge={(canonicalSeat, memberSeats) => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "merge", canonicalSeat, memberSeats } } })}
        onUnmerge={(canonicalSeat) => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "unmerge", canonicalSeat } } })}
      />
      </>
    );
  }

  return withGuard(null);
}
