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
import {
  applyAction,
  chooseBotAction,
  computeRankings,
  MAX_PLAYERS,
  MIN_PLAYERS,
  startGame,
  type EngineAction,
  type PerudoState,
  type SeatIndex,
} from "./engine";
import PerudoBoard from "./PerudoBoard";
import { colorwayById, nextAvailableColorwayId, playerColorwayForSeat, PLAYER_COLORWAYS, type DiceColorway } from "./dice/colorways";
import { useBotAutoplay } from "@/games/shared/bot/useBotAutoplay";
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
import { AddBotButton, BotSeatBadge, FillEmptySeatsButton, RemoveBotButton } from "@/components/lobby/BotSeatControls";
import { botTier, DEFAULT_BOT_LEVEL, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { requestBotAction } from "@/games/shared/bot/botWorkerClient";
import { v4 as uuid } from "uuid";
import type { ChatMessage, SendResult } from "@/lib/chat/types";
import { checkThrottle, recordSend, INITIAL_THROTTLE_STATE, type ThrottleState } from "@/lib/chat/throttle";
import { filterProfanity } from "@/lib/chat/profanity";
import { stripControlChars } from "@/lib/chat/sanitize";
import { loadRecentMessages, mergeHistoryIntoMessages, persistMessage } from "@/lib/chat/history";
import { formatPerudoRaiseLog } from "@/lib/chat/systemLog";
import ChatDrawer from "@/components/chat/ChatDrawer";

/** Whose decision is pending, for `useBotAutoplay` — just the active seat (Perudo has no separate response sub-phase). */
function perudoCurrentActor(state: PerudoState): SeatIndex | null {
  return state.phase === "playing" ? state.activeSeat : null;
}

/**
 * Levels 1-7 are one cheap heuristic pass — computed inline, same as
 * before. Level 8-10 (expert tier) runs ISMCTS-lite (100+ trials, see
 * engine.ts) off the main thread via the shared bot Worker so it never
 * freezes the UI; `requestBotAction` transparently falls back to the same
 * synchronous call if a Worker isn't available in this environment.
 */
function perudoChooseAction(state: PerudoState, actor: SeatIndex, level: BotLevel): EngineAction | null | Promise<EngineAction | null> {
  if (botTier(level) === "expert") {
    return requestBotAction<EngineAction>("perudo", state, actor, level, Math.floor(Math.random() * 1_000_000_000), () =>
      chooseBotAction(state, actor, level),
    );
  }
  return chooseBotAction(state, actor, level);
}

/**
 * Online-room multiplayer entry point, same lockstep pattern as
 * NoThanksGame/AvalonGame/BangGame/GridPokerGame: every connected client
 * independently computes the full `PerudoState` (every seat's hidden dice)
 * from a shared RNG seed plus replayed `EngineAction`s broadcast over
 * Supabase Realtime — there is no server-authoritative engine. See engine.ts
 * and README for the accepted trust trade-off (a technically inclined
 * player could inspect their own client state to see everyone's dice).
 */

type Occupant = {
  deviceId: string;
  seat: SeatIndex;
  name: string;
  /** Real betting-system playerId, present only when this occupant joined by picking themselves from an active betting session's roster — see RoomNicknameField. */
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
  /**
   * This occupant's chosen dice colorway id (`dice/colorways.ts`'s
   * `PLAYER_COLORWAYS`), 2026-09-04 색상 팔레트 확장/중복 방지 세션. Room-wide
   * synced via the same Presence `channel.track()` every other `Occupant`
   * field already uses — re-tracking with a new `colorwayId` (see
   * `handleColorwayChange` below) is how a color change propagates to every
   * other client, same mechanism, no new broadcast event needed. Optional
   * only for the brief window before the initial `track()` call resolves a
   * starting color (see the presence-subscribe block).
   */
  colorwayId?: string;
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
  const v = window.localStorage.getItem(`perudo-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`perudo-seat-${code}`, String(seat));
}

/** 2026-09-04 색상 확장 세션: same persistence pattern as `getStoredSeat`/`storeSeat` above — remembers the player's own last chosen colorway across reconnects/refreshes for this room code. The restored id is still re-validated against whoever else currently holds it before being trusted (see the presence-subscribe block) — someone else may have claimed it while this player was away. */
function getStoredColorway(code: string): string | null {
  return window.localStorage.getItem(`perudo-color-${code}`);
}

function storeColorway(code: string, colorwayId: string) {
  window.localStorage.setItem(`perudo-color-${code}`, colorwayId);
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export default function PerudoGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(4);
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  // My own chosen dice colorway id, room-synced via Presence (2026-09-04 색상
  // 확장/중복 방지 세션— see `Occupant.colorwayId`'s doc comment). Decided once
  // in the presence-subscribe block below (stored preference if still free,
  // else the next available color) and changed thereafter only via
  // `handleColorwayChange`.
  const [myColorwayId, setMyColorwayId] = useState<string | null>(null);
  const myColorwayIdRef = useRef<string | null>(null);
  useEffect(() => {
    myColorwayIdRef.current = myColorwayId;
  }, [myColorwayId]);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<PerudoState | null>(null);
  const [finalResult, setFinalResult] = useState<{ winnerName: string } | null>(null);
  // Room chat + in-game system log (piloted here and in DalmutiGame.tsx —
  // see GameMeta.chatEnabled). Shares this component's own room channel
  // instead of opening a second Realtime subscription.
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatCooldownUntil, setChatCooldownUntil] = useState<number | null>(null);
  const chatThrottleRef = useRef<ThrottleState>(INITIAL_THROTTLE_STATE);
  // Seats currently played by an AI bot instead of a human — host-controlled
  // (ARCHITECTURE.md §7), broadcast via "bot-roster" so every client renders
  // the same lobby/board without a server.
  const [botSeats, setBotSeats] = useState<SeatIndex[]>([]);
  const botSeatsRef = useRef<SeatIndex[]>([]);
  useEffect(() => {
    botSeatsRef.current = botSeats;
  }, [botSeats]);
  // `botLevels[i]` is the Level 1–10 difficulty for `botSeats[i]` (parallel arrays, same index).
  const [botLevels, setBotLevels] = useState<BotLevel[]>([]);
  const botLevelsRef = useRef<BotLevel[]>([]);
  useEffect(() => {
    botLevelsRef.current = botLevels;
  }, [botLevels]);
  const botSeatSet = useMemo(() => new Set(botSeats), [botSeats]);
  // `botColorwayIds[i]` is the dice colorway id for `botSeats[i]` — same
  // parallel-array shape/broadcast piggyback as `botLevels` (2026-09-04 색상
  // 확장 세션). Assigned once, automatically, whenever a bot seat is added
  // (see `addBotAtSeat`/`fillEmptySeatsWithBots`) via `nextAvailableColorwayId`
  // against every currently-taken color (human + bot) — no manual per-bot
  // color picker UI.
  const [botColorwayIds, setBotColorwayIds] = useState<string[]>([]);
  const botColorwayIdsRef = useRef<string[]>([]);
  useEffect(() => {
    botColorwayIdsRef.current = botColorwayIds;
  }, [botColorwayIds]);

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

  // Kept in sync so the `state-request` broadcast handler (registered once,
  // inside the channel-setup effect below) always sees the latest state
  // instead of the stale value it would otherwise close over.
  const gameStateRef = useRef<PerudoState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

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
    const channel = supabase.channel(`perudo-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    const chatChannel = `room:perudo:${roomCode}`;
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
      const colorwayIds = (payload?.botColorwayIds as string[] | undefined) ?? [];
      playerCountRef.current = playerCount;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botColorwayIdsRef.current = colorwayIds;
      setBotColorwayIds(colorwayIds);
      setGameState(startGame(playerCount, seed));
      setFinalResult(null);
      setPhase("playing");
    });

    // Host-authoritative AI bot roster — broadcast whenever the host
    // adds/removes a bot seat in the waiting room (see `addBotAtSeat`/
    // `removeBotAtSeat` below), so every client renders the same
    // lobby/board without a server.
    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      const colorwayIds = (payload?.botColorwayIds as string[] | undefined) ?? [];
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botColorwayIdsRef.current = colorwayIds;
      setBotColorwayIds(colorwayIds);
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
      if (action.type === "raise") {
        setChatMessages((prev) => [
          ...prev,
          {
            id: uuid(),
            channel: chatChannel,
            deviceId: "system",
            senderName: "시스템",
            body: formatPerudoRaiseLog(namesRef.current[action.seat] ?? "상대", action.quantity, action.face),
            type: "SYSTEM",
            createdAt: new Date().toISOString(),
          },
        ]);
      }
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    // A client that (re)joins after the game already started never saw the
    // one-time `game-start` broadcast, so it would otherwise sit on the
    // waiting screen forever even though the game is live. Any peer that
    // already has state answers with a full snapshot; the requester adopts
    // it directly instead of replaying `startGame` (which would require the
    // original seed and re-derive the same thing anyway).
    channel.on("broadcast", { event: "state-request" }, () => {
      if (gameStateRef.current) {
        channel.send({
          type: "broadcast",
          event: "state-sync",
          payload: {
            state: gameStateRef.current,
            botSeats: botSeatsRef.current,
            botLevels: botLevelsRef.current,
            botColorwayIds: botColorwayIdsRef.current,
          },
        });
      } else if (isHost) {
        // Pre-game reconnect: no match state to hand over yet, but the host
        // still owns the bot roster and should re-announce it so a rejoining
        // client's waiting room shows the same bot seats.
        channel.send({
          type: "broadcast",
          event: "bot-roster",
          payload: { botSeats: botSeatsRef.current, botLevels: botLevelsRef.current, botColorwayIds: botColorwayIdsRef.current },
        });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const state = payload?.state as PerudoState | undefined;
      if (!state) return;
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      const colorwayIds = (payload?.botColorwayIds as string[] | undefined) ?? [];
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botColorwayIdsRef.current = colorwayIds;
      setBotColorwayIds(colorwayIds);
      setGameState(state);
      setFinalResult(null);
      setPhase("playing");
    });

    // Resolves the first time a presence "sync" fires, so seat-claiming below
    // can wait for at least one real snapshot instead of reading
    // `presenceState()` the instant SUBSCRIBED fires — that state is not
    // guaranteed to reflect earlier joiners yet (same race BangGame.tsx guards
    // against with this exact pattern).
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
          const taken = new Set([...existing.map((o) => o.seat), ...botSeatsRef.current]);
          seat = 0;
          while (taken.has(seat)) seat++;
          // Reject once the room's own declared target is full — only
          // checked when we can actually see the host's presence record
          // (an unknown target must never block the legitimate case of the
          // host being the very first person to claim a seat).
          const hostRecord = existing.find((o) => o.isHost);
          if (hostRecord && seat >= hostRecord.targetPlayerCount!) {
            setPhase("room-full");
            return;
          }
          storeSeat(roomCode, seat);
        }
        setMySeat(seat);

        // Decide a starting colorway: the stored preference for this room
        // (see `getStoredColorway`), but only if nobody else already holds
        // it (someone may have claimed it while this player was away) —
        // otherwise the next free color in palette order. Computed fresh
        // here (not reused from the `seat === null` branch above, which
        // only runs for a brand-new seat claim) so a *reconnecting* player
        // with an already-stored seat still gets a validated color.
        const rawForColor = channel.presenceState() as RealtimePresenceState<Occupant>;
        const othersForColor = Object.values(rawForColor)
          .flat()
          .filter((o) => o.deviceId !== deviceId);
        const takenColors = new Set<string>([
          ...othersForColor.map((o) => o.colorwayId).filter((id): id is string => !!id),
          ...botColorwayIdsRef.current,
        ]);
        const storedColorway = getStoredColorway(roomCode);
        const colorwayId =
          storedColorway && !takenColors.has(storedColorway) ? storedColorway : nextAvailableColorwayId(takenColors, seat);
        storeColorway(roomCode, colorwayId);
        setMyColorwayId(colorwayId);
        myColorwayIdRef.current = colorwayId;

        await channel.track({
          deviceId,
          seat,
          name: myName,
          playerId: myPlayerId,
          colorwayId,
          ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current } : {}),
        } satisfies Occupant);
        // Ask any already-in-game peer for a state snapshot in case this is
        // a reconnect (see the `state-request`/`state-sync` handlers above).
        // A no-op when the game hasn't started yet — nobody has state to answer with.
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
  // instant — same self-healing tie-break as BangGame.tsx/AvalonGame.tsx/
  // NoThanksGame.tsx: whichever device has the lexicographically larger id
  // gives up the seat and claims the next free one, up to a few attempts
  // before falling back to "room-full".
  useEffect(() => {
    if (mySeat === null || !roomCode || phase === "playing" || phase === "post-game" || phase === "room-full") return;
    const conflicting = occupants.filter((o) => o.seat === mySeat && o.deviceId !== deviceId);
    if (conflicting.length === 0) {
      reclaimAttemptsRef.current = 0;
      return;
    }
    const iShouldMove = conflicting.some((o) => o.deviceId < deviceId);
    if (!iShouldMove) return; // the other device(s) will move instead
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
      colorwayId: myColorwayIdRef.current ?? undefined,
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
        botColorwayIds: botColorwayIdsRef.current,
      },
    });
  }, []);

  // Host deals the first round as soon as the target seat count is filled —
  // a seat counts as "filled" whether it's a connected human or a bot the
  // host added.
  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current) return;
    if (occupants.length + botSeats.length >= knownTargetPlayerCount) {
      sendGameStart();
    }
  }, [occupants, botSeats, phase, knownTargetPlayerCount, isHost, sendGameStart]);

  // Host-only: fill/empty an empty seat with an AI bot (ARCHITECTURE.md §7).
  // Only ever offered for a seat with no connected human — a real player is
  // never forcibly replaced. If a human later claims a seat a bot was
  // occupying, the eviction effect below automatically drops the bot.
  const addBotAtSeat = useCallback(
    (seat: SeatIndex, level: BotLevel) => {
      if (!isHost) return;
      if (botSeatsRef.current.includes(seat) || occupants.some((o) => o.seat === seat)) return;
      const nextSeats = [...botSeatsRef.current, seat];
      const nextLevels = [...botLevelsRef.current, level];
      // Auto-assign the next free colorway (2026-09-04 색상 확장 세션) — taken
      // = every human's current pick + every already-placed bot's pick. No
      // manual per-bot color picker UI, per user request.
      const taken = new Set<string>([
        ...occupants.map((o) => o.colorwayId).filter((id): id is string => !!id),
        ...botColorwayIdsRef.current,
      ]);
      const nextColorwayIds = [...botColorwayIdsRef.current, nextAvailableColorwayId(taken, seat)];
      botSeatsRef.current = nextSeats;
      setBotSeats(nextSeats);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      botColorwayIdsRef.current = nextColorwayIds;
      setBotColorwayIds(nextColorwayIds);
      channelRef.current?.send({
        type: "broadcast",
        event: "bot-roster",
        payload: { botSeats: nextSeats, botLevels: nextLevels, botColorwayIds: nextColorwayIds },
      });
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
      // Assign each new bot the next free color IN SEQUENCE, growing the
      // taken-set as we go so multiple bots added in this same batch never
      // collide with each other (2026-09-04 색상 확장 세션).
      const takenColors = new Set<string>([
        ...occupants.map((o) => o.colorwayId).filter((id): id is string => !!id),
        ...botColorwayIdsRef.current,
      ]);
      const newColorwayIds = emptySeats.map((seat) => {
        const id = nextAvailableColorwayId(takenColors, seat);
        takenColors.add(id);
        return id;
      });
      const nextColorwayIds = [...botColorwayIdsRef.current, ...newColorwayIds];
      botSeatsRef.current = nextSeats;
      setBotSeats(nextSeats);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      botColorwayIdsRef.current = nextColorwayIds;
      setBotColorwayIds(nextColorwayIds);
      channelRef.current?.send({
        type: "broadcast",
        event: "bot-roster",
        payload: { botSeats: nextSeats, botLevels: nextLevels, botColorwayIds: nextColorwayIds },
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
      const nextColorwayIds = botColorwayIdsRef.current.filter((_, i) => i !== idx);
      botSeatsRef.current = nextSeats;
      setBotSeats(nextSeats);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      botColorwayIdsRef.current = nextColorwayIds;
      setBotColorwayIds(nextColorwayIds);
      channelRef.current?.send({
        type: "broadcast",
        event: "bot-roster",
        payload: { botSeats: nextSeats, botLevels: nextLevels, botColorwayIds: nextColorwayIds },
      });
    },
    [isHost],
  );

  // A human physically claiming a seat always wins over a bot placeholder —
  // derived during render (not an effect), same "compare and setState during
  // render" pattern the seat-conflict self-heal above uses: a plain
  // idempotent one-extra-render bail-out instead of a setState-in-effect
  // cascade. Only updates the HOST's own local roster (no broadcast needed
  // here) — it's exactly what gates the host-only auto-start/manual-start
  // logic below, and every other client already prefers a seat's real
  // Presence occupant over a stale bot badge when rendering names (see
  // `names` above), so nobody else needs to hear about this until the next
  // `game-start`/`bot-roster` broadcast picks up the corrected roster anyway.
  if (isHost && botSeats.length > 0) {
    const humanSeats = new Set(occupants.map((o) => o.seat));
    const keepIdx = botSeats.map((s, i) => (humanSeats.has(s) ? -1 : i)).filter((i) => i !== -1);
    // botSeatsRef/botLevelsRef/botColorwayIdsRef are re-synced by the effects
    // above once this commits — not updated here too, since refs (like
    // state) must not be written during render.
    if (keepIdx.length !== botSeats.length) {
      setBotSeats(keepIdx.map((i) => botSeats[i]));
      setBotLevels(keepIdx.map((i) => botLevels[i]));
      setBotColorwayIds(keepIdx.map((i) => botColorwayIds[i]));
    }
  }

  const handleAction = useCallback((action: EngineAction) => {
    channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action } });
  }, []);

  // Change my own dice colorway — usable from the waiting-room swatch picker
  // AND from the in-game one (`PerudoBoard`'s `onColorwayChange` prop), same
  // callback either way (2026-09-04 색상 확장/중복 방지 세션). Re-tracking
  // Presence with the new `colorwayId` is the entire sync mechanism — every
  // other client's `occupants` state updates on the next "sync" event, no
  // separate broadcast event needed. Defensively re-checks the color isn't
  // already taken (the picker UI already disables taken swatches, but a
  // race — someone else grabs it a moment earlier — is still possible).
  const handleColorwayChange = useCallback(
    (colorwayId: string) => {
      if (!roomCode || mySeat === null) return;
      const takenByOthers = new Set<string>([
        ...occupants.filter((o) => o.deviceId !== deviceId).map((o) => o.colorwayId).filter((id): id is string => !!id),
        ...botColorwayIdsRef.current,
      ]);
      if (takenByOthers.has(colorwayId)) return;
      storeColorway(roomCode, colorwayId);
      setMyColorwayId(colorwayId);
      myColorwayIdRef.current = colorwayId;
      channelRef.current?.track({
        deviceId,
        seat: mySeat,
        name: myName,
        playerId: myPlayerId,
        colorwayId,
        ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current } : {}),
      } satisfies Occupant);
    },
    [roomCode, mySeat, myName, myPlayerId, isHost, occupants, deviceId],
  );

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
        channel: `room:perudo:${roomCode}`,
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

  const chooseAction = useCallback((state: PerudoState, actor: SeatIndex): EngineAction | null | Promise<EngineAction | null> => {
    const idx = botSeatsRef.current.indexOf(actor);
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return perudoChooseAction(state, actor, level);
  }, []);

  useBotAutoplay<PerudoState, EngineAction, SeatIndex>({
    active: isHost && phase === "playing",
    state: gameState,
    currentActor: perudoCurrentActor,
    botSeats: botSeatSet,
    chooseAction,
    dispatch: handleAction,
  });

  // Prefer the real betting-system playerId (present when that seat's
  // occupant joined by picking themselves from an active session's roster —
  // see RoomNicknameField) over the synthetic per-room id.
  const ids: Record<SeatIndex, string> = useMemo(() => {
    const map: Record<SeatIndex, string> = {};
    const count = gameState?.playerCount ?? knownTargetPlayerCount;
    for (let seat = 0; seat < count; seat++) {
      const occ = occupants.find((o) => o.seat === seat);
      map[seat] = occ?.playerId ?? `${roomCode}:${seat}`;
    }
    return map;
  }, [roomCode, gameState, knownTargetPlayerCount, occupants]);

  const names: Record<SeatIndex, string> = useMemo(() => {
    const map: Record<SeatIndex, string> = {};
    const count = gameState?.playerCount ?? knownTargetPlayerCount;
    for (let seat = 0; seat < count; seat++) {
      const occ = occupants.find((o) => o.seat === seat);
      const botIdx = botSeats.indexOf(seat);
      map[seat] = seat === mySeat ? myName : (occ?.name ?? (botIdx >= 0 ? botDisplayName(botIdx, botLevels[botIdx]) : "상대"));
    }
    return map;
  }, [occupants, mySeat, myName, gameState, knownTargetPlayerCount, botSeats, botLevels]);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);

  // Room-synced dice colorway per seat (2026-09-04 색상 확장/중복 방지 세션) —
  // same "seat → value" shape as `names`, feeding both the waiting-room
  // swatch picker/roster dots and `PerudoBoard`'s in-game rendering. My own
  // seat prefers the locally-tracked `myColorwayId` (updates instantly on my
  // own pick, no round-trip through `occupants` needed); every other seat
  // reads the synced `Occupant.colorwayId`/`botColorwayIds` and falls back to
  // the deterministic `playerColorwayForSeat` default only for a seat that
  // hasn't announced a color yet (e.g. the brief window before its first
  // `track()` resolves).
  const colorways: Record<SeatIndex, DiceColorway> = useMemo(() => {
    const map: Record<SeatIndex, DiceColorway> = {};
    const count = gameState?.playerCount ?? knownTargetPlayerCount;
    for (let seat = 0; seat < count; seat++) {
      const botIdx = botSeats.indexOf(seat);
      const id =
        seat === mySeat
          ? myColorwayId
          : botIdx >= 0
            ? botColorwayIds[botIdx]
            : occupants.find((o) => o.seat === seat)?.colorwayId;
      map[seat] = colorwayById(id) ?? playerColorwayForSeat(seat);
    }
    return map;
  }, [occupants, mySeat, myColorwayId, gameState, knownTargetPlayerCount, botSeats, botColorwayIds]);

  // Waiting-room-only variant: WHO (seat + display label) currently holds
  // each taken color, built strictly from real occupants/bots — unlike
  // `colorways` above, this must NOT fall back to a deterministic default
  // for an empty seat (an unfilled lobby seat holds no color at all, so its
  // swatch must never read as "taken"). Only meaningful before the game
  // starts; `PerudoBoard`'s in-game picker instead derives "taken" straight
  // from the `colorways` prop, since every seat is guaranteed filled by then.
  const lobbyTakenColorways = useMemo(() => {
    const map = new Map<string, { seat: SeatIndex; label: string }>();
    occupants.forEach((o) => {
      if (o.colorwayId && o.seat !== mySeat) map.set(o.colorwayId, { seat: o.seat, label: o.name });
    });
    botSeats.forEach((seat, i) => {
      const id = botColorwayIds[i];
      if (id) map.set(id, { seat, label: botLabel(i, botLevels[i]) });
    });
    return map;
  }, [occupants, mySeat, botSeats, botColorwayIds, botLevels]);

  const connectedSeats = useMemo(
    () => new Set([...occupants.map((o) => o.seat), ...botSeats]),
    [occupants, botSeats],
  );

  function handleGameEnd() {
    if (!gameState || gameState.phase !== "gameOver") return;
    const rankings = computeRankings(gameState);
    onComplete({
      rankings: rankings.map((r) => ({ playerId: ids[r.seat], rank: r.rank })),
      finishedAt: new Date().toISOString(),
    });
    setFinalResult({ winnerName: names[rankings[0].seat] });
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
    setMyColorwayId(null);
    myColorwayIdRef.current = null;
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
    botColorwayIdsRef.current = [];
    setBotColorwayIds([]);
    setChatMessages([]);
    setChatCooldownUntil(null);
    chatThrottleRef.current = INITIAL_THROTTLE_STATE;
    setPhase("choose");
  }

  const shareUrl =
    typeof window !== "undefined" && roomCode
      ? `${window.location.origin}${window.location.pathname}?room=${roomCode}`
      : "";

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
          페루도는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
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
        <button
          onClick={handleLeave}
          className="mt-2 rounded-full bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-500"
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
          className="mt-2 rounded-full bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-500"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (phase === "choose") {
    return withGuard(
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">🎲</span>
        <h2 className="text-lg font-bold text-white">페루도 온라인 대전</h2>
        <p className="text-sm text-white/50">
          {MIN_PLAYERS}~{MAX_PLAYERS}명이 각자 기기로 접속해서 실시간으로 플레이해요.
        </p>
        <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
          <button
            onClick={() => {
              setIntent("create");
              setPhase("enter-name");
            }}
            className="w-full rounded-xl bg-amber-600 py-3 text-sm font-semibold text-white transition hover:bg-amber-500"
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
          <button
            onClick={() => setPhase("choose")}
            className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30"
          >
            뒤로
          </button>
          <button
            onClick={enterRoom}
            className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-500"
          >
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
            <button
              onClick={() => navigator.clipboard?.writeText(shareUrl)}
              className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70 hover:border-white/30"
            >
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
                // Only render a color dot once the seat actually holds
                // someone — an empty seat has no colorway at all yet.
                const seatColorway = occ || isBot ? colorways[seat] : undefined;
                return (
                  <div key={seat} className="flex items-center justify-between gap-3 text-sm text-white/70">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {seatColorway && (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/30"
                          style={{ backgroundColor: seatColorway.body }}
                          title={`${seatColorway.label} 주사위`}
                        />
                      )}
                      <span className="[overflow-wrap:normal] break-keep">
                        {seat === mySeat ? "나" : `${seat + 1}번`}:{" "}
                        {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30">대기 중...</span>}
                      </span>
                    </span>
                    {isHost && seat !== mySeat && !occ && (
                      isBot ? (
                        <RemoveBotButton onClick={() => removeBotAtSeat(seat)} />
                      ) : (
                        <AddBotButton onAddWithLevel={(level) => addBotAtSeat(seat, level)} />
                      )
                    )}
                  </div>
                );
              })}
            </div>
            {/* 대기실 주사위 색상 피커 (2026-09-04 색상 확장/중복 방지 세션) —
                `mySeat`가 확정된 뒤(=presence track 완료 후)에만 렌더링. 다른
                사람/봇이 이미 쓰는 색은 잠금 오버레이+배지로 비활성화하고,
                실시간으로 색을 바꾸면 `handleColorwayChange`가 Presence
                재-track으로 즉시 방 전체에 동기화한다. */}
            {mySeat !== null && myColorwayId && (
              <div className="mt-1 flex flex-col items-center gap-2">
                <p className="text-xs font-semibold text-white/50 break-keep">🎨 내 주사위 색상</p>
                <div className="flex flex-wrap items-center justify-center gap-1.5 px-2">
                  {PLAYER_COLORWAYS.map((c) => {
                    const holder = lobbyTakenColorways.get(c.id);
                    const isMine = c.id === myColorwayId;
                    const isTaken = !!holder && !isMine;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={isTaken}
                        onClick={() => handleColorwayChange(c.id)}
                        title={isTaken ? `${holder!.label}님이 사용 중` : c.label}
                        aria-label={`주사위 색상: ${c.label}`}
                        className={`h-7 w-7 rounded-full border-2 transition ${
                          isMine
                            ? "scale-110 border-white"
                            : isTaken
                              ? "cursor-not-allowed border-white/10 opacity-35"
                              : "border-white/25 hover:border-white/60"
                        }`}
                        style={{ backgroundColor: c.body }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
            <p className="text-xs text-white/40 break-keep">
              {knownTargetPlayerCount}명이 모이면 자동으로 게임이 시작됩니다. AI 봇으로도 채울 수 있어요.
            </p>
            {isHost && occupants.length + botSeats.length >= MIN_PLAYERS && occupants.length + botSeats.length < knownTargetPlayerCount && (
              <button
                onClick={sendGameStart}
                className="rounded-full bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500"
              >
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
    return withGuard(
      <>
      <PerudoBoard
        state={gameState}
        viewerSeat={mySeat}
        names={names}
        connectedSeats={connectedSeats}
        colorways={colorways}
        onColorwayChange={handleColorwayChange}
        onAction={handleAction}
        onGameEnd={handleGameEnd}
      />
      <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="게임 채팅" />
      </>
    );
  }

  if (phase === "post-game" && finalResult) {
    return withGuard(
      <>
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">🏆</span>
        <p className="text-white/80">{finalResult.winnerName} 님 우승으로 게임이 끝났어요.</p>
        <div className="flex gap-2">
          <button
            onClick={handleLeave}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30"
          >
            나가기
          </button>
          <button
            onClick={handleRematch}
            className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-500"
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
