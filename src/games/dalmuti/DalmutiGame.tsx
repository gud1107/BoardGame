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
import {
  applyAction,
  chooseBotAction,
  computeRankings,
  MAX_PLAYERS,
  MIN_PLAYERS,
  rankTitle,
  startGame,
  type DalmutiState,
  type EngineAction,
  type SeatIndex,
} from "./engine";
import DalmutiBoard from "./DalmutiBoard";
import { useGameBgm } from "@/lib/audio/useGameBgm";
import { useBotAutoplay } from "@/games/shared/bot/useBotAutoplay";
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
import { AddBotButton, BotSeatBadge, FillEmptySeatsButton, RemoveBotButton } from "@/components/lobby/BotSeatControls";
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
import { formatBotTakeoverLog, formatDalmutiTributeLog } from "@/lib/chat/systemLog";
import ChatDrawer from "@/components/chat/ChatDrawer";

/**
 * Whose decision `useBotAutoplay` should drive right now. `taxReturn` can
 * have up to two seats with an independent unresolved tribute to return at
 * once (왕 and 귀족), and `commonerExchange` (§5, 2026-08-25) can likewise
 * have several 평민 seats with an independent pending opt-in or card pick —
 * same "lowest seat among the undecided" workaround every other
 * simultaneous-decision phase in this project uses (see ARCHITECTURE.md
 * §7.2/§7.5 note on forSale/grid-poker).
 */
function dalmutiCurrentActor(state: DalmutiState): SeatIndex | null {
  if (state.phase === "revolutionOption") return state.pendingRevolution?.seat ?? null;
  if (state.phase === "taxReturn") {
    const unresolved = state.tributes.filter((t) => !t.resolved);
    if (unresolved.length === 0) return null;
    return Math.min(...unresolved.map((t) => t.toSeat));
  }
  if (state.phase === "commonerExchange") {
    const ex = state.commonerExchange;
    if (!ex) return null;
    const undecided = ex.participants.filter((p) => p.participate === null).map((p) => p.seat);
    if (undecided.length > 0) return Math.min(...undecided);
    const needsCard: SeatIndex[] = [];
    for (const pair of ex.pairs) {
      if (pair.resolved) continue;
      if (pair.cardIdA === null) needsCard.push(pair.seatA);
      if (pair.cardIdB === null) needsCard.push(pair.seatB);
    }
    return needsCard.length > 0 ? Math.min(...needsCard) : null;
  }
  if (state.phase === "trick") return state.activeSeat;
  return null;
}

/**
 * Online-room multiplayer entry point — same lockstep pattern as every other
 * `<Game>Game.tsx` in this project (closely modeled on
 * five-cucumbers/FiveCucumbersGame.tsx, see its header doc for the full
 * rationale): every connected client independently computes the full
 * `DalmutiState` (every seat's hand) from a shared RNG seed plus replayed
 * `EngineAction`s broadcast over Supabase Realtime — there is no
 * server-authoritative engine. See engine.ts and docs/architecture.md §2 for
 * the accepted trust trade-off; hands (secret by the physical rules) stay
 * hidden at the UI layer only (`DalmutiBoard.tsx`). No house-rule toggle
 * here — the rulebook (see engine.ts §0) has no optional variant to expose.
 */

type Occupant = {
  deviceId: string;
  seat: SeatIndex;
  name: string;
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
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
  const v = window.localStorage.getItem(`dalmuti-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`dalmuti-seat-${code}`, String(seat));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export default function DalmutiGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  // 중세풍 하프시코드 테마 BGM — 실제 대국 중에만 크로스페이드로 재생 (2026-08-26 세션).
  useGameBgm(phase === "playing" ? "dalmuti" : null);
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(4);
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<DalmutiState | null>(null);
  const [finalResult, setFinalResult] = useState<{ winnerName: string } | null>(null);
  // Room chat + in-game system log (piloted here and in PerudoGame.tsx —
  // see GameMeta.chatEnabled). Shares this component's own room channel
  // instead of opening a second Realtime subscription.
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatCooldownUntil, setChatCooldownUntil] = useState<number | null>(null);
  const chatThrottleRef = useRef<ThrottleState>(INITIAL_THROTTLE_STATE);
  // Seats currently played by an AI bot instead of a human — host-controlled
  // (ARCHITECTURE.md §7), broadcast via "bot-roster" so every client renders
  // the same lobby/board without a server. `botLevels[i]` is the Level 1–10
  // difficulty for `botSeats[i]` (parallel arrays, same index).
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

  // Mid-game "seat disconnected/unresponsive → AI bot" — see botTakeover.ts
  // for the vote/conversion state machine this mirrors. Every client
  // independently replays the same broadcast `BotTakeoverEvent`s, same
  // lockstep philosophy as `gameState`/`applyAction` above; no host
  // dependency (a deliberate departure from host-authoritative decisions —
  // see HANDOFF.md's bot takeover session).
  const [botTakeover, setBotTakeover] = useState<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  const botTakeoverRef = useRef<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  function applyBotTakeoverEvent(event: BotTakeoverEvent) {
    const next = reduceBotTakeover(botTakeoverRef.current, event);
    botTakeoverRef.current = next;
    setBotTakeover(next);
  }
  // Cross-device room-linked betting ledger (see roomBetting.ts) — same
  // lockstep replay pattern as `botTakeover` above, but deliberately NOT
  // reset on rematch/`game-start`: betting accumulates across rematches for
  // the room's whole lifetime, only cleared in `handleLeave`.
  const [roomBetting, setRoomBetting] = useState<RoomBettingState>(INITIAL_ROOM_BETTING_STATE);
  const roomBettingRef = useRef<RoomBettingState>(INITIAL_ROOM_BETTING_STATE);
  // A vote this client has already dismissed without voting — re-shown if a
  // *different* vote (different seat or restarted timer) comes in, keyed by
  // `${seatKey}:${startedAt}` so it's distinct per vote instance.
  const [dismissedVoteKey, setDismissedVoteKey] = useState<string | null>(null);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // Tracks how long the current actor has been stuck, for the "idle/무응답"
  // vote trigger — see the dedicated interval effect below. `since: 0` is a
  // deliberately-stale placeholder (not `Date.now()`, which would be an
  // impure render-time call) — the first interval tick always sees `actor`
  // differ from the initial `null` and immediately rebases it to "now".
  const lastActorRef = useRef<{ actor: SeatIndex | null; since: number }>({ actor: null, since: 0 });
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
  const playerCountRef = useRef(targetPlayerCount);
  const isHost = intent === "create";

  const gameStateRef = useRef<DalmutiState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Read inside the channel-setup effect's broadcast handlers (registered
  // once, doesn't re-run on every `occupants` change) to avoid closing over
  // a stale snapshot — same reasoning as `gameStateRef`/`botSeatsRef`.
  const occupantsRef = useRef<Occupant[]>([]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);

  // Kept in sync so the `game-action` broadcast handler (registered once,
  // inside the channel-setup effect below) can resolve a seat to its display
  // name for the system log without closing over a stale value.
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

  // Open (and tear down) the Realtime channel whenever we have a room to join.
  useEffect(() => {
    if (!roomCode) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const deviceId = getDeviceId();
    const channel = supabase.channel(`dalmuti-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    const chatChannel = `room:dalmuti:${roomCode}`;
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
      const playerCount = payload?.playerCount as number;
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      playerCountRef.current = playerCount;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      // A rematch is a fresh game — any takeover from the previous round
      // shouldn't silently carry a seat's control into this one.
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      setGameState(startGame(playerCount, seed));
      setFinalResult(null);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      // System-log pilot (see GameMeta.chatEnabled): every connected client
      // derives the same human-readable line independently from the
      // *pre-action* state (`gameStateRef.current`, not yet updated by the
      // `setGameState` call below) — no change to the pure reducer in
      // engine.ts. Deliberately not persisted to `chat_messages` (unlike
      // user messages), since every client would otherwise write a
      // duplicate row, and it's trivially re-derivable from the replayed
      // action log anyway.
      if (action.type === "returnTax") {
        const prevState = gameStateRef.current;
        const record = prevState?.tributes.find((t) => t.toSeat === action.seat && !t.resolved);
        if (prevState && record) {
          const fromTitle = rankTitle(prevState.rankOrder.indexOf(record.fromSeat), prevState.playerCount);
          const toTitle = rankTitle(prevState.rankOrder.indexOf(record.toSeat), prevState.playerCount);
          setChatMessages((prev) => [
            ...prev,
            {
              id: uuid(),
              channel: chatChannel,
              deviceId: "system",
              senderName: "시스템",
              body: formatDalmutiTributeLog(
                namesRef.current[record.fromSeat] ?? "상대",
                fromTitle,
                namesRef.current[record.toSeat] ?? "상대",
                toTitle,
              ),
              type: "SYSTEM",
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      }
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    // Host-authoritative AI bot roster — broadcast whenever the host
    // adds/removes a bot seat in the waiting room, so every client renders
    // the same lobby/board without a server.
    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
    });

    // Bot-takeover vote/conversion — see botTakeover.ts. Every client
    // replays the identical event stream through the same pure reducer; a
    // client whose own `vote-cast` (including its own) just crossed the
    // majority threshold is the one that fires `convert` — harmless if more
    // than one client does this in the same instant, since `convert` on an
    // already-converted seat only happens once (the vote is gone by then on
    // every client that already processed the first `convert`).
    channel.on("broadcast", { event: "bot-takeover-event" }, ({ payload }) => {
      const event = payload?.event as BotTakeoverEvent | undefined;
      if (!event) return;
      // System-log line the instant a conversion actually lands — read the
      // about-to-be-consumed vote's `originalName` *before* applying the
      // event (same "resolve from pre-update state" pattern as the
      // `returnTax` log above). `broadcast: { self: true }` means the client
      // that sent `convert` processes this same handler too, so this fires
      // exactly once per client either way, never duplicated.
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
      // Eligible voters = other connected real players whose own seat isn't
      // itself bot-controlled right now (lobby bot OR an earlier takeover).
      const takenOverSeats = new Set(Object.keys(botTakeoverRef.current.takeovers).map(Number));
      const eligible = occupantsRef.current.filter(
        (o) => o.seat !== Number(event.seatKey) && !botSeatsRef.current.includes(o.seat) && !takenOverSeats.has(o.seat),
      ).length;
      if (voteThresholdMet(voteYesCount(botTakeoverRef.current, event.seatKey), eligible)) {
        channel.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "convert", seatKey: event.seatKey, at: Date.now() } } });
      }
    });

    // Room-linked betting ledger (see roomBetting.ts) — every client replays
    // the identical event stream through the same pure reducer, same
    // `broadcast: { self: true }` "receive handler does the one-and-only
    // reduce+setState" pattern as the bot-takeover handler above.
    channel.on("broadcast", { event: "room-betting-event" }, ({ payload }) => {
      const event = payload?.event as RoomBettingEvent | undefined;
      if (!event) return;
      roomBettingRef.current = reduceRoomBetting(roomBettingRef.current, event);
      setRoomBetting(roomBettingRef.current);
    });

    // A client that (re)joins after the game already started never saw the
    // one-time `game-start` broadcast — same reconnect flow as every other
    // online game here.
    channel.on("broadcast", { event: "state-request" }, () => {
      if (gameStateRef.current) {
        channel.send({
          type: "broadcast",
          event: "state-sync",
          payload: {
            state: gameStateRef.current,
            botSeats: botSeatsRef.current,
            botLevels: botLevelsRef.current,
            botTakeover: botTakeoverRef.current,
            roomBetting: roomBettingRef.current,
          },
        });
      } else if (isHost) {
        channel.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: botSeatsRef.current, botLevels: botLevelsRef.current } });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const state = payload?.state as DalmutiState | undefined;
      if (!state) return;
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      const takeover = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
      const betting = (payload?.roomBetting as RoomBettingState | undefined) ?? INITIAL_ROOM_BETTING_STATE;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = takeover;
      setBotTakeover(takeover);
      roomBettingRef.current = betting;
      setRoomBetting(betting);
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

    // Real disconnect (tab closed, network dropped, or an explicit leave) —
    // fires identically on every connected client (Supabase Presence is
    // server-synced, not local-only), so whichever seat(s) left are known to
    // everyone at once. Only kicks off a takeover vote mid-game, for a seat
    // that isn't already a bot; `leftPresences` still carries the leaving
    // occupant's `playerId`/`name` even though they're already gone from
    // `presenceState()` by the time anyone could look them up again.
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

  // Two seats can genuinely collide when players join within the same
  // instant — same self-healing tie-break as every other online game here.
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
    const taken = new Set([
      ...occupants.filter((o) => o.deviceId !== deviceId).map((o) => o.seat),
      ...botSeatsRef.current,
    ]);
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
      payload: { seed: randomSeed(), playerCount: playerCountRef.current, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current },
    });
  }, []);

  // A seat counts as "filled" whether it's a connected human or a bot the host added.
  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current) return;
    if (occupants.length + botSeats.length >= knownTargetPlayerCount) {
      sendGameStart();
    }
  }, [occupants, botSeats, phase, knownTargetPlayerCount, isHost, sendGameStart]);

  // Host-only: fill/empty an empty seat with an AI bot (ARCHITECTURE.md §7).
  // Only ever offered for a seat with no connected human — a real player is
  // never forcibly replaced. If a human later claims a seat a bot was
  // occupying, the eviction logic below automatically drops the bot.
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

  // A human physically claiming a seat always wins over a bot placeholder —
  // derived during render (not an effect), same "compare and setState during
  // render" pattern the seat-conflict self-heal above uses.
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

  function castTakeoverVote(seatKey: string) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey, voterDeviceId: deviceId } } });
  }
  // Unified "yes" affordance (decision: one action for both) — the vote
  // target proving presence cancels the pending vote; the same button after
  // the seat has already converted instead reclaims control.
  function proveStillHereOrReclaim(seatKey: string) {
    const type = isSeatTakenOver(botTakeover, seatKey) ? "reclaim" : "vote-cancel";
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type, seatKey } } });
  }

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
        channel: `room:dalmuti:${roomCode}`,
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

  // Seats a takeover vote has actually converted — unioned with the lobby
  // `botSeats` roster below wherever bot-seat membership matters (autoplay,
  // occupancy, display). Kept separate from `botSeats`/`botLevels` (which
  // stay host-only lobby state) since takeover membership is derived
  // identically by every client from the replayed vote/convert broadcasts.
  //
  // 2026-09-03 freeze-fix (플레이어 퇴장/재접속 시 AI 봇 턴 정지 리포트):
  // this used to depend on the *whole* `botTakeover` object, so ANY
  // vote-start/vote-cast/vote-cancel/convert broadcast — even one for a
  // completely different seat — produced a brand-new array reference here,
  // which cascaded into `allBotSeatSet` getting a new `Set` identity too.
  // `useBotAutoplay`'s effect depends on that `Set`'s identity, so it kept
  // tearing down and re-scheduling an already-in-flight bot's pending
  // action timer every time an unrelated seat's takeover vote fired (e.g.
  // player2 leaving while an unrelated bot1 was mid-turn) — this, not a
  // lost server-side timer (there is no server — see docs/cloud-sync.md),
  // was the actual mechanism behind bots appearing to "freeze" around
  // disconnects/reconnects. Depending on a stable, content-derived string
  // key instead means this only produces a new reference when the *set of
  // taken-over seats* itself actually changes. Same fix applied to every
  // other game with bot takeover (lasVegas/grid-poker/no-thanks/
  // destinyWar39/hillOfTruth/ratATatCat/malDalliJa/worm) since they all
  // copy this exact pattern.
  const takeoverSeatKey = Object.keys(botTakeover.takeovers).sort().join(",");
  const takeoverSeats = useMemo(
    () => (takeoverSeatKey ? (takeoverSeatKey.split(",").map(Number) as SeatIndex[]) : []),
    [takeoverSeatKey],
  );
  const allBotSeatSet = useMemo(
    () => new Set([...botSeatSet, ...takeoverSeats]),
    [botSeatSet, takeoverSeats],
  );

  const chooseAction = useCallback((state: DalmutiState, actor: SeatIndex): EngineAction | null => {
    const idx = botSeatsRef.current.indexOf(actor);
    // A takeover seat has no per-seat lobby-chosen level (it was human-
    // controlled until now) — decision: fall back to the room's default
    // level rather than inventing a per-room difficulty dial.
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return chooseBotAction(state, actor, level);
  }, []);

  useBotAutoplay<DalmutiState, EngineAction, SeatIndex>({
    active: isHost && phase === "playing",
    state: gameState,
    currentActor: dalmutiCurrentActor,
    botSeats: allBotSeatSet,
    chooseAction,
    dispatch: handleAction,
  });

  // "무응답(idle)" takeover trigger: if the current actor hasn't changed in
  // IDLE_VOTE_THRESHOLD_MS while the game is playing, kick off a vote for
  // that seat (unless it's already a bot or already mid-vote). Runs off a
  // plain interval (not a `gameState`-keyed effect) because a *stuck* actor
  // means `gameState` itself stops changing — an effect keyed on it would
  // never re-fire to notice the elapsed time.
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = window.setInterval(() => {
      const state = gameStateRef.current;
      if (!state) return;
      const actor = dalmutiCurrentActor(state);
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
    const count = gameState?.playerCount ?? knownTargetPlayerCount;
    for (let seat = 0; seat < count; seat++) {
      const occ = occupants.find((o) => o.seat === seat);
      // A takeover seat's `originalUserId` must win over the live occupant
      // lookup — a real disconnect means `occ` is undefined here (the
      // player is gone from presence entirely), and without this the
      // reward/ranking map would silently fall back to a synthetic bot id,
      // losing the original player's credit for what the bot goes on to do.
      map[seat] = botTakeover.takeovers[seat]?.originalUserId ?? occ?.playerId ?? `${roomCode}:${seat}`;
    }
    return map;
  }, [roomCode, gameState, knownTargetPlayerCount, occupants, botTakeover]);

  const names: Record<SeatIndex, string> = useMemo(() => {
    const map: Record<SeatIndex, string> = {};
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

  // String-keyed view of `names` for RoomBettingPanel/room-betting-event
  // (seat keys there are plain strings, same convention as botTakeover.ts).
  const namesBySeat: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [seat, name] of Object.entries(names)) map[String(seat)] = name;
    return map;
  }, [names]);

  const connectedSeats = useMemo(
    () => new Set([...occupants.map((o) => o.seat), ...botSeats, ...takeoverSeats]),
    [occupants, botSeats, takeoverSeats],
  );

  // Other real, non-bot occupants besides `seat` — the eligible-voter
  // denominator for that seat's vote (mirrors the broadcast handler's own
  // threshold check above, kept in sync by construction since both read the
  // same `occupants`/`botSeats`/`botTakeover` inputs).
  function eligibleVoterCountFor(seatKey: string): number {
    const takenOverSeats = new Set(Object.keys(botTakeover.takeovers).map(Number));
    return occupants.filter((o) => o.seat !== Number(seatKey) && !botSeats.includes(o.seat) && !takenOverSeats.has(o.seat)).length;
  }

  function handleGameEnd() {
    if (!gameState || gameState.phase !== "gameOver") return;
    const rankings = computeRankings(gameState);
    const winner = rankings.find((r) => r.rank === 1)!;
    onComplete({
      rankings: rankings.map((r) => ({ playerId: ids[r.seat], rank: r.rank })),
      finishedAt: new Date().toISOString(),
    });
    if (roomBettingRef.current.active) {
      const ranksBySeat: Record<string, number> = {};
      for (const r of rankings) ranksBySeat[String(r.seat)] = r.rank;
      const deltas = computeRoundDeltas(ranksBySeat, [...roomBettingRef.current.payoutTable]);
      const namesAtRound: Record<string, string> = {};
      for (const [seat, name] of Object.entries(names)) namesAtRound[String(seat)] = name;
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
    setFinalResult({ winnerName: names[winner.seat] });
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
    roomBettingRef.current = INITIAL_ROOM_BETTING_STATE;
    setRoomBetting(INITIAL_ROOM_BETTING_STATE);
    setDismissedVoteKey(null);
    setChatMessages([]);
    setChatCooldownUntil(null);
    chatThrottleRef.current = INITIAL_THROTTLE_STATE;
    setPhase("choose");
  }

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";

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
          달무티는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">.env.local</code>
          에 <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code> /
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
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
        <button onClick={handleLeave} className="mt-2 rounded-full bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-500">
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
        <button onClick={handleLeave} className="mt-2 rounded-full bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-500">
          다시 시도
        </button>
      </div>
    );
  }

  if (phase === "choose") {
    return withGuard(
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">👑</span>
        <h2 className="text-lg font-bold text-white">달무티 온라인 대전</h2>
        <p className="text-sm text-white/50">
          {MIN_PLAYERS}~{MAX_PLAYERS}명이 각자 기기로 접속해서 실시간으로 플레이해요. (단판 승부)
        </p>
        <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
          <button
            onClick={() => {
              setIntent("create");
              setPhase("enter-name");
            }}
            className="w-full rounded-xl bg-amber-600 py-3 text-sm font-semibold text-white transition hover:bg-amber-500"
          >
            👑 방 만들기
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

  if (phase === "enter-name") {
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-base font-bold text-white">{intent === "create" ? "방 만들기" : "초대 코드로 참여"}</h2>
        <div className="flex flex-col gap-1.5 text-sm text-white/70">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} onEnter={enterRoom} accent="amber" />
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-amber-400 focus:outline-none"
            />
          </label>
        )}
        {intent === "create" && (
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
            인원 수 ({MIN_PLAYERS}~{MAX_PLAYERS}명)
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTargetPlayerCount((n) => Math.max(MIN_PLAYERS, n - 1))}
                className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
              >
                −
              </button>
              <span className="w-8 text-center text-lg font-semibold text-white">{targetPlayerCount}</span>
              <button
                type="button"
                onClick={() => setTargetPlayerCount((n) => Math.min(MAX_PLAYERS, n + 1))}
                className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
              >
                +
              </button>
            </div>
          </label>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-500">
            {intent === "create" ? "방 만들기" : "참여하기"}
          </button>
        </div>
      </div>
    );
  }

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
            <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70 hover:border-white/30">
              🔗 초대 링크 복사
            </button>
            <p className="text-xs text-white/50">
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
                  <p key={seat} className="flex items-center justify-between gap-2 text-sm text-white/70">
                    <span className="flex items-center gap-1.5">
                      {occ && <Avatar size={20} />}
                      {seat === mySeat ? "나" : `${seat + 1}번`}:{" "}
                      {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30">대기 중...</span>}
                    </span>
                    {isHost && !occ && (
                      <span>
                        {isBot ? (
                          <RemoveBotButton onClick={() => removeBotAtSeat(seat)} />
                        ) : (
                          <AddBotButton onAddWithLevel={(level) => addBotAtSeat(seat, level)} />
                        )}
                      </span>
                    )}
                  </p>
                );
              })}
            </div>
            <p className="text-xs text-white/40">{knownTargetPlayerCount}명이 모이면 자동으로 게임이 시작됩니다.</p>
            {isHost && occupants.length + botSeats.length >= MIN_PLAYERS && occupants.length + botSeats.length < knownTargetPlayerCount && (
              <button onClick={sendGameStart} className="rounded-full bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500">
                지금 시작 ({occupants.length + botSeats.length}명)
              </button>
            )}
          </>
        )}
      </div>
      <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="대기실 채팅" />
      </>
    );
  }

  if (phase === "playing" && gameState && mySeat !== null) {
    const myVoteAsTarget = activeVoteFor(botTakeover, String(mySeat));
    const iAmTakenOver = isSeatTakenOver(botTakeover, String(mySeat));
    const voteToShow = Object.values(botTakeover.votes).find(
      (v) => v.seatKey !== String(mySeat) && `${v.seatKey}:${v.startedAt}` !== dismissedVoteKey,
    );
    return withGuard(
      <>
      {myVoteAsTarget && (
        <BotTakeoverSelfBanner mode="prove-presence" onConfirm={() => proveStillHereOrReclaim(String(mySeat))} />
      )}
      {!myVoteAsTarget && iAmTakenOver && (
        <BotTakeoverSelfBanner mode="reclaim" onConfirm={() => proveStillHereOrReclaim(String(mySeat))} />
      )}
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
      <DalmutiBoard state={gameState} viewerSeat={mySeat} names={names} connectedSeats={connectedSeats} onAction={handleAction} onGameEnd={handleGameEnd} />
      <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="게임 채팅" />
      <RoomBettingPanel
        state={roomBetting}
        isHost={isHost}
        namesBySeat={namesBySeat}
        participantCount={knownTargetPlayerCount}
        onStart={(payoutTable) => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "session-start", payoutTable } } })}
        onPayoutChange={(payoutTable) => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "payout-set", payoutTable } } })}
        onEnd={() => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "session-end" } } })}
        onMerge={(canonicalSeat, memberSeats) => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "merge", canonicalSeat, memberSeats } } })}
        onUnmerge={(canonicalSeat) => channelRef.current?.send({ type: "broadcast", event: "room-betting-event", payload: { event: { type: "unmerge", canonicalSeat } } })}
      />
      </>
    );
  }

  if (phase === "post-game" && finalResult) {
    return withGuard(
      <>
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">👑</span>
        <p className="text-white/80">{finalResult.winnerName} 님이 진정한 왕이 되어 게임이 끝났어요.</p>
        <div className="flex gap-2">
          <button onClick={handleLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30">
            나가기
          </button>
          <button onClick={handleRematch} className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-500">
            다시하기
          </button>
        </div>
      </div>
      <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="게임 채팅" />
      <RoomBettingPanel
        state={roomBetting}
        isHost={isHost}
        namesBySeat={namesBySeat}
        participantCount={knownTargetPlayerCount}
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
