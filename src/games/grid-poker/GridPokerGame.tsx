"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import GameLeaveGuardModal from "@/components/GameLeaveGuardModal";
import { useGameLeaveGuard } from "@/hooks/useGameLeaveGuard";
import { useBackgroundResync } from "@/hooks/useBackgroundResync";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { useGameBgm } from "@/lib/audio/useGameBgm";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
import {
  applyAction,
  chooseBotAction,
  startGame,
  DEFAULT_PLACING_SECONDS,
  DEFAULT_SUBMITTING_SECONDS,
  DEFAULT_TIMER_SETTINGS,
  LINE_LABELS,
  ROUND_RESULT_SECONDS,
  type EngineAction,
  type GridPokerState,
  type SeatIndex,
  type TimerMode,
  type TimerSettings,
} from "./engine";
import GridPokerBoard from "./GridPokerBoard";
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
import { v4 as uuid } from "uuid";
import type { ChatMessage, SendResult } from "@/lib/chat/types";
import { checkThrottle, recordSend, INITIAL_THROTTLE_STATE, type ThrottleState } from "@/lib/chat/throttle";
import { filterProfanity } from "@/lib/chat/profanity";
import { stripControlChars } from "@/lib/chat/sanitize";
import { loadRecentMessages, mergeHistoryIntoMessages, persistMessage } from "@/lib/chat/history";
import { formatBotTakeoverLog } from "@/lib/chat/systemLog";
import ChatDrawer from "@/components/chat/ChatDrawer";

/**
 * Pure system-log line formatter for the in-game chat system-log pilot (see
 * GameMeta.chatEnabled, PerudoGame.tsx/DalmutiGame.tsx) — deliberately takes
 * an already-resolved plain name + line label instead of importing anything
 * beyond `LINE_LABELS`, so the pure reducer in engine.ts stays untouched.
 * e.g. "지수님이 가로 3 라인을 제출했습니다" for a `submit-line` action, the
 * single most game-defining "showdown" declaration in Grid Poker.
 */
function formatGridPokerSubmitLog(name: string, lineLabel: string): string {
  return `${name}님이 ${lineLabel} 라인을 제출했습니다`;
}

/**
 * Whose decision `useBotAutoplay` should drive right now. Both "placing" and
 * "submitting" are simultaneous-by-rule (every seat acts independently each
 * round, no turn order) — so this returns the lowest-numbered seat that
 * still hasn't acted this round; bots seated after an un-acted human end up
 * waiting for that human first (documented simplification, same as
 * ForSale's Phase 2 — harmless for the all-bot simulation the tests cover).
 * Returns null while waiting on the host's `draw-common` (nobody's seat
 * decision) or once the match has ended.
 */
function gridPokerCurrentActor(state: GridPokerState): SeatIndex | null {
  if (state.phase === "placing") {
    if (!state.currentCard) return null;
    for (let s = 0; s < state.playerCount; s++) if (!state.placedThisRound[s]) return s;
    return null;
  }
  if (state.phase === "submitting") {
    for (let s = 0; s < state.playerCount; s++) if (state.submissions[s] === null) return s;
    return null;
  }
  return null;
}

/**
 * Online-room multiplayer entry point, same pattern as BangGame/HanamikojiGame:
 * every connected client independently computes the full `GridPokerState`
 * from replayed `EngineAction`s broadcast over Supabase Realtime — there is
 * no server-authoritative engine. See README for the accepted trust
 * trade-off (a technically inclined player could inspect their own client
 * state to see every board).
 *
 * Unlike Bang!'s turn-based actions, the "common card" draw during the
 * placing phase isn't tied to any one player's turn — so the host (seat 0)
 * is the one who broadcasts each `draw-common` action, triggered by an
 * effect that watches for `phase === "placing" && currentCard === null`.
 */

type Occupant = {
  deviceId: string;
  seat: SeatIndex;
  name: string;
  /** Real betting-system playerId, present only when this occupant joined by picking themselves from an active betting session's roster — see RoomNicknameField. */
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
  const v = window.localStorage.getItem(`grid-poker-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`grid-poker-seat-${code}`, String(seat));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

const PLACING_SECONDS_PRESETS = [20, 30, 40, 60];
const SUBMITTING_SECONDS_PRESETS = [10, 15, 20, 30];
const MIN_TIMER_SECONDS = 5;
const MAX_TIMER_SECONDS = 300;

function clampSeconds(n: number): number {
  if (!Number.isFinite(n)) return MIN_TIMER_SECONDS;
  return Math.min(MAX_TIMER_SECONDS, Math.max(MIN_TIMER_SECONDS, Math.round(n)));
}

type SecondsChoice = number | "custom";

/** Preset pill buttons + a "직접 입력" custom numeric field, used for both per-phase timer lengths on the room-create form. */
function TimerSecondsField({
  label,
  options,
  choice,
  onChoiceChange,
  customValue,
  onCustomChange,
}: {
  label: string;
  options: number[];
  choice: SecondsChoice;
  onChoiceChange: (v: SecondsChoice) => void;
  customValue: number;
  onCustomChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-white/70">
      {label}
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChoiceChange(opt)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              choice === opt
                ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-200"
                : "border-white/15 text-white/60 hover:border-white/30"
            }`}
          >
            {opt}초
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChoiceChange("custom")}
          className={`rounded-full border px-3 py-1 text-xs transition ${
            choice === "custom"
              ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-200"
              : "border-white/15 text-white/60 hover:border-white/30"
          }`}
        >
          직접 입력
        </button>
        {choice === "custom" && (
          <input
            type="number"
            min={MIN_TIMER_SECONDS}
            max={MAX_TIMER_SECONDS}
            value={customValue}
            onChange={(e) => onCustomChange(Number(e.target.value))}
            className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center text-xs text-white focus:border-emerald-400 focus:outline-none"
          />
        )}
      </div>
    </label>
  );
}

export default function GridPokerGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(2);
  // Room timer settings (host-only, chosen on the room-create form and
  // carried into `GridPokerState` by `startGame` — see engine.ts's
  // `TimerSettings` doc). Defaults match the spec: 40s to place, 30s to submit.
  const [timerMode, setTimerMode] = useState<TimerMode>("limited");
  const [placingChoice, setPlacingChoice] = useState<SecondsChoice>(DEFAULT_PLACING_SECONDS);
  const [placingCustom, setPlacingCustom] = useState(DEFAULT_PLACING_SECONDS);
  const [submittingChoice, setSubmittingChoice] = useState<SecondsChoice>(DEFAULT_SUBMITTING_SECONDS);
  const [submittingCustom, setSubmittingCustom] = useState(DEFAULT_SUBMITTING_SECONDS);
  const [formError, setFormError] = useState<string | null>(null);

  const timerSettings: TimerSettings = useMemo(
    () => ({
      mode: timerMode,
      placingSeconds: clampSeconds(placingChoice === "custom" ? placingCustom : placingChoice),
      submittingSeconds: clampSeconds(submittingChoice === "custom" ? submittingCustom : submittingChoice),
    }),
    [timerMode, placingChoice, placingCustom, submittingChoice, submittingCustom]
  );

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<GridPokerState | null>(null);
  const [finalResult, setFinalResult] = useState<{ winnerLabel: string } | null>(null);
  // Room chat + in-game system log (see GameMeta.chatEnabled, piloted in
  // PerudoGame.tsx/DalmutiGame.tsx). Shares this component's own room
  // channel instead of opening a second Realtime subscription.
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
  // for the vote/conversion state machine this mirrors (same lockstep
  // philosophy as `gameState`/`applyAction` above, no host dependency).
  const [botTakeover, setBotTakeover] = useState<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  const botTakeoverRef = useRef<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  function applyBotTakeoverEvent(event: BotTakeoverEvent) {
    const next = reduceBotTakeover(botTakeoverRef.current, event);
    botTakeoverRef.current = next;
    setBotTakeover(next);
  }
  // A vote this client has already dismissed without voting — re-shown if a
  // *different* vote (different seat or restarted timer) comes in.
  const [dismissedVoteKey, setDismissedVoteKey] = useState<string | null>(null);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // Tracks how long the current actor has been stuck, for the "idle/무응답"
  // vote trigger — see the dedicated interval effect below. `since: 0` is a
  // deliberately-stale placeholder (not `Date.now()`, an impure render-time
  // call) — the first interval tick always rebases it to "now".
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
  // Host's chosen timer settings, broadcast in the `game-start` payload so
  // every client's `startGame` (and therefore every client's countdown UI)
  // agrees on the exact same per-phase lengths. Mirrors `playerCountRef`'s
  // "latest value inside a ref for use in event handlers/effects" pattern.
  const timerSettingsRef = useRef<TimerSettings>(DEFAULT_TIMER_SETTINGS);
  const isHost = intent === "create";

  // Kept in sync so the `state-request` broadcast handler (registered once,
  // inside the channel-setup effect below) always sees the latest state
  // instead of the stale value it would otherwise close over.
  const gameStateRef = useRef<GridPokerState | null>(null);
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

  // Themed 딥 하우스 BGM plays only while an actual match is underway —
  // `useGameBgm` crossfades in on the "playing" transition and fades back to
  // silence on every path away (post-game, leaving, unmount), same as every
  // other hub game (2026-08-26 세션). Muting/volume is the shared
  // `audioSettings` store now, not a bespoke per-game flag.
  useGameBgm(phase === "playing" ? "gridPoker" : null);

  function enterRoom() {
    setFormError(null);
    // First user gesture in the flow — also a convenient place to unlock
    // the shared AudioContext ahead of the BGM/SFX that start once playing.
    getSoundEngine().unlock();
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
    timerSettingsRef.current = timerSettings;
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
    const channel = supabase.channel(`grid-poker-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    const chatChannel = `room:grid-poker:${roomCode}`;
    void loadRecentMessages(chatChannel).then((history) => {
      setChatMessages((prev) => mergeHistoryIntoMessages(prev, history));
    });

    channel.on("broadcast", { event: "chat-message" }, ({ payload }) => {
      const message = payload?.message as ChatMessage | undefined;
      if (!message) return;
      setChatMessages((prev) => [...prev, message]);
    });

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const playerCount = payload?.playerCount as number;
      const startTimerSettings = (payload?.timerSettings as TimerSettings | undefined) ?? DEFAULT_TIMER_SETTINGS;
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      playerCountRef.current = playerCount;
      timerSettingsRef.current = startTimerSettings;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      // A rematch is a fresh game — any takeover from the previous round
      // shouldn't silently carry a seat's control into this one.
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      setGameState(startGame(playerCount, startTimerSettings));
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
      if (action.type === "submit-line") {
        setChatMessages((prev) => [
          ...prev,
          {
            id: uuid(),
            channel: chatChannel,
            deviceId: "system",
            senderName: "시스템",
            body: formatGridPokerSubmitLog(namesRef.current[action.seat] ?? "상대", LINE_LABELS[action.lineIndex] ?? "알 수 없는"),
            type: "SYSTEM",
            createdAt: new Date().toISOString(),
          },
        ]);
      }
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    // Host-authoritative AI bot roster — broadcast whenever the host
    // adds/removes a bot seat in the waiting room (see `addBotAtSeat`/
    // `removeBotAtSeat` below), so every client renders the same
    // lobby/board without a server.
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
      const takenOverSeats = new Set(Object.keys(botTakeoverRef.current.takeovers).map(Number));
      const eligible = occupantsRef.current.filter(
        (o) => o.seat !== Number(event.seatKey) && !botSeatsRef.current.includes(o.seat) && !takenOverSeats.has(o.seat),
      ).length;
      if (voteThresholdMet(voteYesCount(botTakeoverRef.current, event.seatKey), eligible)) {
        channel.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "convert", seatKey: event.seatKey, at: Date.now() } } });
      }
    });

    // A client that (re)joins after the game already started never saw the
    // one-time `game-start` broadcast, so it would otherwise sit on the
    // waiting screen forever even though the game is live. Any peer that
    // already has state answers with a full snapshot; the requester adopts
    // it directly instead of replaying `startGame`.
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
          },
        });
      } else if (isHost) {
        channel.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: botSeatsRef.current, botLevels: botLevelsRef.current } });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const state = payload?.state as GridPokerState | undefined;
      if (!state) return;
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

    // Real disconnect (tab closed, network dropped, or an explicit leave) —
    // fires identically on every connected client (Supabase Presence is
    // server-synced, not local-only). Only kicks off a takeover vote
    // mid-game, for a seat that isn't already a bot; `leftPresences` still
    // carries the leaving occupant's `playerId`/`name` even though they're
    // already gone from `presenceState()` by the time anyone could look
    // them up again.
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
        await channel.track({
          deviceId,
          seat,
          name: myName,
          playerId: myPlayerId,
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

  function sendGameStart() {
    startSentRef.current = true;
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: { playerCount: playerCountRef.current, timerSettings: timerSettingsRef.current, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current },
    });
  }

  // A seat counts as "filled" whether it's a connected human or a bot the host added.
  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current) return;
    if (occupants.length + botSeats.length >= knownTargetPlayerCount) {
      sendGameStart();
    }
  }, [occupants, botSeats, phase, knownTargetPlayerCount, isHost]);

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

  function handleAction(action: EngineAction) {
    channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action } });
  }

  function castTakeoverVote(seatKey: string) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey, voterDeviceId: deviceId } } });
  }
  // Unified "yes" affordance — the vote target proving presence cancels the
  // pending vote; the same button after the seat has already converted
  // instead reclaims control.
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
        channel: `room:grid-poker:${roomCode}`,
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

  // The shared "common card" draw isn't any one player's turn — the host
  // broadcasts it whenever the placing phase is waiting on a fresh card.
  useEffect(() => {
    if (!isHost || phase !== "playing" || !gameState) return;
    if (gameState.phase === "placing" && gameState.currentCard === null) {
      handleAction({ type: "draw-common", seed: randomSeed() });
    }
  }, [isHost, phase, gameState]);

  // "round-result" (the round-win celebration overlay's on-the-clock pause —
  // see engine.ts's module doc and RoundResultOverlay.tsx) is the same
  // "shared clock, no one seat's move" shape as the draw-common effect right
  // above: the host alone broadcasts the advance once ROUND_RESULT_SECONDS
  // has elapsed, and every client (including the host) just renders the same
  // synced state in the meantime — the countdown bar each client shows
  // locally (GridPokerBoard.tsx) is cosmetic only, this timer is what
  // actually moves the game on. Keyed off `lastRoundResult`'s own
  // `roundNumber` (not the outer `roundNumber`, which has already ticked
  // forward for the *next* round by this point) so a mid-countdown rerender
  // never restarts the timer early.
  useEffect(() => {
    if (!isHost || phase !== "playing" || !gameState) return;
    if (gameState.phase !== "round-result") return;
    const id = setTimeout(() => {
      handleAction({ type: "advance-round-result" });
    }, ROUND_RESULT_SECONDS * 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed to the round-result episode itself, same pattern as the draw-common effect above
  }, [isHost, phase, gameState?.phase, gameState?.lastRoundResult?.roundNumber]);

  // Seats a takeover vote has actually converted — unioned with the lobby
  // `botSeats` roster wherever bot-seat membership matters (autoplay,
  // occupancy, display). See DalmutiGame.tsx for the fuller rationale.
  const takeoverSeats = useMemo(
    () => Object.keys(botTakeover.takeovers).map(Number) as SeatIndex[],
    [botTakeover],
  );
  const allBotSeatSet = useMemo(
    () => new Set([...botSeatSet, ...takeoverSeats]),
    [botSeatSet, takeoverSeats],
  );

  const chooseAction = useCallback((state: GridPokerState, actor: SeatIndex): EngineAction | null => {
    const idx = botSeatsRef.current.indexOf(actor);
    // A takeover seat has no per-seat lobby-chosen level (it was human-
    // controlled until now) — fall back to the room's default level.
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return chooseBotAction(state, actor, level);
  }, []);

  useBotAutoplay<GridPokerState, EngineAction, SeatIndex>({
    active: isHost && phase === "playing",
    state: gameState,
    currentActor: gridPokerCurrentActor,
    botSeats: allBotSeatSet,
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
      const actor = gridPokerCurrentActor(state);
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

  // Prefer the real betting-system playerId (present when that seat's
  // occupant joined by picking themselves from an active session's roster —
  // see RoomNicknameField) over the synthetic per-room id, so a finished
  // game's rankings actually land on the right betting participant instead
  // of an id the ledger has never seen before.
  const ids: Record<SeatIndex, string> = useMemo(() => {
    const map: Record<SeatIndex, string> = {};
    const count = gameState?.playerCount ?? knownTargetPlayerCount;
    for (let seat = 0; seat < count; seat++) {
      const occ = occupants.find((o) => o.seat === seat);
      // A takeover seat's `originalUserId` wins over the live occupant
      // lookup — see DalmutiGame.tsx's `ids` for why this matters for a
      // real disconnect (the player is gone from presence entirely).
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

  const connectedSeats = useMemo(
    () => new Set([...occupants.map((o) => o.seat), ...botSeats, ...takeoverSeats]),
    [occupants, botSeats, takeoverSeats],
  );

  // Other real, non-bot occupants besides `seat` — the eligible-voter
  // denominator for that seat's vote.
  function eligibleVoterCountFor(seatKey: string): number {
    const takenOverSeats = new Set(Object.keys(botTakeover.takeovers).map(Number));
    return occupants.filter((o) => o.seat !== Number(seatKey) && !botSeats.includes(o.seat) && !takenOverSeats.has(o.seat)).length;
  }

  function handleGameEnd() {
    if (!gameState || gameState.phase !== "game-end") return;
    const rankings = gameState.players.map((p) => {
      const higherCount = gameState.players.filter((o) => o.score > p.score).length;
      return { playerId: ids[p.seat], rank: higherCount + 1 };
    });
    onComplete({ rankings, finishedAt: new Date().toISOString() });
    const winner = gameState.winner;
    const winnerLabel =
      winner && winner.length === 1 ? `${names[winner[0]]}님 승리` : "동점 무승부";
    setFinalResult({ winnerLabel });
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
    setDismissedVoteKey(null);
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
          그리드 포커는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
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
          className="mt-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
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
          className="mt-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (phase === "choose") {
    return withGuard(
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">🃏</span>
        <h2 className="text-lg font-bold text-white">그리드 포커 온라인 대전</h2>
        <p className="text-sm text-white/50">2~6명이 각자 기기로 접속해서 실시간으로 플레이해요.</p>
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
          <RoomNicknameField value={identity} onChange={setIdentity} accent="emerald" />
        </div>
        {intent === "join" && (
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
            초대 코드 (4자리)
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="0000"
              inputMode="numeric"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-emerald-400 focus:outline-none"
            />
          </label>
        )}
        {intent === "create" && (
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
            인원 수 (2~8명)
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTargetPlayerCount((n) => Math.max(2, n - 1))}
                className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
              >
                −
              </button>
              <span className="w-8 text-center text-lg font-semibold text-white">{targetPlayerCount}</span>
              <button
                type="button"
                onClick={() => setTargetPlayerCount((n) => Math.min(8, n + 1))}
                className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
              >
                +
              </button>
            </div>
          </label>
        )}
        {intent === "create" && (
          <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <label className="flex flex-col gap-1.5 text-sm text-white/70">
              제한시간 모드
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTimerMode("limited")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    timerMode === "limited"
                      ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-200"
                      : "border-white/15 text-white/60 hover:border-white/30"
                  }`}
                >
                  ⏱️ 시간 제한 모드
                </button>
                <button
                  type="button"
                  onClick={() => setTimerMode("unlimited")}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    timerMode === "unlimited"
                      ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-200"
                      : "border-white/15 text-white/60 hover:border-white/30"
                  }`}
                >
                  ⏳ 시간 제한 없음
                </button>
              </div>
            </label>
            {timerMode === "limited" && (
              <>
                <TimerSecondsField
                  label="카드 배치 제한시간 (1인당 매 라운드)"
                  options={PLACING_SECONDS_PRESETS}
                  choice={placingChoice}
                  onChoiceChange={setPlacingChoice}
                  customValue={placingCustom}
                  onCustomChange={setPlacingCustom}
                />
                <TimerSecondsField
                  label="라인 제출(마지막 배팅) 제한시간"
                  options={SUBMITTING_SECONDS_PRESETS}
                  choice={submittingChoice}
                  onChoiceChange={setSubmittingChoice}
                  customValue={submittingCustom}
                  onCustomChange={setSubmittingCustom}
                />
              </>
            )}
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
            className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
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
            <div className="mt-2 flex flex-col gap-1.5">
              {Array.from({ length: knownTargetPlayerCount }, (_, seat) => {
                const occ = occupants.find((o) => o.seat === seat);
                const botIdx = botSeats.indexOf(seat);
                const isBot = botIdx >= 0;
                return (
                  <p key={seat} className="flex items-center justify-between gap-2 text-sm text-white/70">
                    <span>
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
            {isHost && occupants.length + botSeats.length >= 2 && occupants.length + botSeats.length < knownTargetPlayerCount && (
              <button
                onClick={sendGameStart}
                className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
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
      <GridPokerBoard
        state={gameState}
        viewerSeat={mySeat}
        names={names}
        connectedSeats={connectedSeats}
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
        <p className="text-white/80">{finalResult.winnerLabel}로 게임이 끝났어요.</p>
        <div className="flex gap-2">
          <button
            onClick={handleLeave}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30"
          >
            나가기
          </button>
          <button
            onClick={handleRematch}
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
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
