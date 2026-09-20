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
  computeRankings,
  currentActor,
  DEFAULT_MAFIA_CONFIG,
  playerRangeForMode,
  startGame,
  type EngineAction,
  type MafiaGameConfig,
  type MafiaMode,
  type MafiaState,
  type SeatIndex,
  type Team,
} from "./engine";
import MafiaBoard from "./MafiaBoard";
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
import { v4 as uuid } from "uuid";
import type { ChatMessage, SendResult } from "@/lib/chat/types";
import { checkThrottle, recordSend, INITIAL_THROTTLE_STATE, type ThrottleState } from "@/lib/chat/throttle";
import { filterProfanity } from "@/lib/chat/profanity";
import { stripControlChars } from "@/lib/chat/sanitize";
import { loadRecentMessages, mergeHistoryIntoMessages, persistMessage } from "@/lib/chat/history";
import { formatBotTakeoverLog } from "@/lib/chat/systemLog";
import ChatDrawer from "@/components/chat/ChatDrawer";
import MobileChatCenterModal from "./MobileChatCenterModal";
import { chooseDiscussionLine, chooseSelfDefenseLine } from "./mafiaBotChat";

/**
 * Online-room multiplayer entry point — same lockstep pattern as every other
 * `<Game>Game.tsx` here (closest twin: avalon/AvalonGame.tsx, also a hidden-
 * role deduction game): every connected client independently computes the
 * full `MafiaState` (every seat's secret role, every private investigation
 * result) from a shared RNG seed plus replayed `EngineAction`s broadcast over
 * Supabase Realtime — there is no server-authoritative engine. This game
 * additionally has real-time phase TIMERS (밤/토론/투표 등); see engine.ts's
 * module doc for how `forceAdvance` keeps that deterministic across clients
 * without any one of them being a "host" for the clock.
 *
 * Ghost spectator pipeline (요청 ③): a dead seat keeps its socket connection
 * (never kicked from the room) and MafiaBoard renders every role to it
 * unconditionally. Ghosts get a SECOND, separate chat channel
 * (`room:mafia:ghost:${roomCode}`) that only dead seats render — same
 * UI-layer-only secrecy convention as hidden roles (see engine.ts's header).
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
  const v = window.localStorage.getItem(`mafia-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`mafia-seat-${code}`, String(seat));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** Whoever `useBotAutoplay` should currently drive — re-exported thin wrapper so this file doesn't need a second import name. */
const mafiaCurrentActor = currentActor;

export default function MafiaGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [mode, setMode] = useState<MafiaMode>("classic");
  const [targetPlayerCount, setTargetPlayerCount] = useState(6);
  const [revealRoleOnDeath, setRevealRoleOnDeath] = useState(true);
  const [doctorSelfHeal, setDoctorSelfHeal] = useState(false);
  const [discussionSeconds, setDiscussionSeconds] = useState<30 | 60 | 90>(60);
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<MafiaState | null>(null);
  const [finalResult, setFinalResult] = useState<{ winner: Team } | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatCooldownUntil, setChatCooldownUntil] = useState<number | null>(null);
  const chatThrottleRef = useRef<ThrottleState>(INITIAL_THROTTLE_STATE);
  // Ghost-only secret channel (요청 ③) — separate array/throttle from the
  // normal room chat above so a living seat never has to filter it out.
  const [ghostChatMessages, setGhostChatMessages] = useState<ChatMessage[]>([]);
  const [ghostChatCooldownUntil, setGhostChatCooldownUntil] = useState<number | null>(null);
  const ghostChatThrottleRef = useRef<ThrottleState>(INITIAL_THROTTLE_STATE);

  // 모바일 가상 키보드 가림 방지(2026-09-20 요청) — 채팅/유령채팅 둘 중 어느
  // 입력창이라도 포커스되어 있으면 true. `MafiaBoard`로 내려가 `RoleInspector`의
  // 모바일 edge-tab/드로어를 임시로 숨기는 데만 쓰인다.
  const [isChatInputFocused, setIsChatInputFocused] = useState(false);
  // 안정적인 참조로 고정(2026-09-20 "봇/다른 사람이 채팅치면 내 입력이 안
  // 되는 현상" 개선) — 인라인 화살표 함수를 그대로 넘기면 `chatMessages`가
  // 바뀔 때마다(다른 사람/봇 메시지 도착) 매번 새 함수가 생성되어
  // `ChatPanel.tsx`의 `Composer`(`React.memo`) 메모이제이션이 무력화되고,
  // 입력창까지 통째로 다시 렌더링되어 모바일 한글 조합이 끊기는 원인이 됐다.
  const handleChatInputFocus = useCallback(() => setIsChatInputFocused(true), []);
  const handleChatInputBlur = useCallback(() => setIsChatInputFocused(false), []);

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
  const configRef = useRef<MafiaGameConfig>(DEFAULT_MAFIA_CONFIG);
  const isHost = intent === "create";

  const gameStateRef = useRef<MafiaState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const namesRef = useRef<Record<SeatIndex, string>>({});
  const occupantsRef = useRef<Occupant[]>([]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);

  const range = playerRangeForMode(mode);

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
    configRef.current = { mode, discussionSeconds, revealRoleOnDeath, doctorSelfHeal };
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
    const channel = supabase.channel(`mafia-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    const chatChannel = `room:mafia:${roomCode}`;
    const ghostChatChannel = `room:mafia:ghost:${roomCode}`;
    void loadRecentMessages(chatChannel).then((history) => {
      setChatMessages((prev) => mergeHistoryIntoMessages(prev, history));
    });
    void loadRecentMessages(ghostChatChannel).then((history) => {
      setGhostChatMessages((prev) => mergeHistoryIntoMessages(prev, history));
    });

    channel.on("broadcast", { event: "chat-message" }, ({ payload }) => {
      const message = payload?.message as ChatMessage | undefined;
      if (!message) return;
      setChatMessages((prev) => [...prev, message]);
    });

    channel.on("broadcast", { event: "ghost-chat-message" }, ({ payload }) => {
      const message = payload?.message as ChatMessage | undefined;
      if (!message) return;
      setGhostChatMessages((prev) => [...prev, message]);
    });

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const playerCount = payload?.playerCount as number;
      const config = payload?.config as MafiaGameConfig;
      const atMs = payload?.atMs as number;
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      playerCountRef.current = playerCount;
      configRef.current = config;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      setGameState(startGame(playerCount, seed, config, atMs));
      setFinalResult(null);
      setGhostChatMessages([]);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
    });

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
      const state = payload?.state as MafiaState | undefined;
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
      configRef.current = state.config;
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
      payload: {
        seed: randomSeed(),
        playerCount: playerCountRef.current,
        config: configRef.current,
        atMs: Date.now(),
        botSeats: botSeatsRef.current,
        botLevels: botLevelsRef.current,
      },
    });
  }, []);

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

  // Autonomous phase guardian (요청 ②) — every client independently checks
  // its own clock against `phaseStartedAt + phaseDurationMs` and fires a
  // `forceAdvance`; safe if several clients race (see engine.ts's doc).
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = window.setInterval(() => {
      const state = gameStateRef.current;
      if (!state || state.phase === "gameOver") return;
      if (Date.now() - state.phaseStartedAt < state.phaseDurationMs) return;
      handleAction({ type: "forceAdvance", expectedPhase: state.phase, atMs: Date.now() });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [phase, handleAction]);

  function castTakeoverVote(seatKey: string) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey, voterDeviceId: deviceId } } });
  }
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
        channel: `room:mafia:${roomCode}`,
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

  const sendGhostChatMessage = useCallback(
    (rawBody: string): SendResult => {
      const now = Date.now();
      const check = checkThrottle(ghostChatThrottleRef.current, now);
      if (!check.ok) {
        setGhostChatCooldownUntil(check.lockedUntil ?? null);
        return { ok: false, lockedUntil: check.lockedUntil };
      }
      const trimmed = stripControlChars(rawBody);
      if (!trimmed) return { ok: false };
      const { clean } = filterProfanity(trimmed);

      ghostChatThrottleRef.current = recordSend(ghostChatThrottleRef.current, now);
      setGhostChatCooldownUntil(ghostChatThrottleRef.current.lockedUntil);

      const message: ChatMessage = {
        id: uuid(),
        channel: `room:mafia:ghost:${roomCode}`,
        deviceId,
        senderName: myName || "게스트",
        body: clean,
        type: "USER",
        createdAt: new Date(now).toISOString(),
      };
      channelRef.current?.send({ type: "broadcast", event: "ghost-chat-message", payload: { message } });
      void persistMessage(message);
      return { ok: true };
    },
    [roomCode, myName, deviceId],
  );

  const takeoverSeatKey = Object.keys(botTakeover.takeovers).sort().join(",");
  const takeoverSeats = useMemo(
    () => (takeoverSeatKey ? (takeoverSeatKey.split(",").map(Number) as SeatIndex[]) : []),
    [takeoverSeatKey],
  );
  const allBotSeatSet = useMemo(
    () => new Set([...botSeatSet, ...takeoverSeats]),
    [botSeatSet, takeoverSeats],
  );

  const chooseAction = useCallback((state: MafiaState, actor: SeatIndex): EngineAction | null => {
    const idx = botSeatsRef.current.indexOf(actor);
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return chooseBotAction(state, actor, level);
  }, []);

  useBotAutoplay<MafiaState, EngineAction, SeatIndex>({
    active: isHost && phase === "playing",
    state: gameState,
    currentActor: mafiaCurrentActor,
    botSeats: allBotSeatSet,
    chooseAction,
    dispatch: handleAction,
    // "인간적인 템포"(2026-09-21 요청) — 기본값(500~1500ms)보다 조금 더 느리게,
    // 밤 액션/투표 마다 실제로 고민하는 듯한 리듬감을 준다.
    minDelayMs: 1200,
    maxDelayMs: 2800,
  });

  // Bot chat participation (2026-09-20 후속 요청) — separate from the engine-
  // action autoplay above, since chat messages don't touch `MafiaState` at
  // all. Only the host ever sends these (same single-writer rule as every
  // other bot-driven broadcast here), so no lockstep purity concerns: line
  // text is picked with plain `Math.random()`.
  const sendBotChatMessage = useCallback(
    (seat: SeatIndex, rawBody: string) => {
      const trimmed = stripControlChars(rawBody);
      if (!trimmed) return;
      const { clean } = filterProfanity(trimmed);
      const message: ChatMessage = {
        id: uuid(),
        channel: `room:mafia:${roomCode}`,
        deviceId: `bot-${roomCode}-${seat}`,
        senderName: namesRef.current[seat] ?? `${seat + 1}번`,
        body: clean,
        type: "USER",
        createdAt: new Date().toISOString(),
      };
      channelRef.current?.send({ type: "broadcast", event: "chat-message", payload: { message } });
      void persistMessage(message);
    },
    [roomCode],
  );

  // Keyed by `${phaseStartedAt}:${seat}` (unique per phase instance) rather
  // than day/night numbers, so a re-render mid-phase never schedules the
  // same bot seat's line twice for the same phase.
  const botChatScheduledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isHost || phase !== "playing" || !gameState) return;
    const state = gameState;
    const phaseKey = String(state.phaseStartedAt);

    if (state.phase === "dayDiscuss") {
      for (const seat of allBotSeatSet) {
        const p = state.players[seat];
        if (!p?.alive) continue;
        const key = `${phaseKey}:${seat}`;
        if (botChatScheduledRef.current.has(key)) continue;
        botChatScheduledRef.current.add(key);
        const delay = 1500 + Math.random() * Math.max(500, state.phaseDurationMs - 4000);
        window.setTimeout(() => {
          const latest = gameStateRef.current;
          if (!latest || latest.phaseStartedAt !== state.phaseStartedAt) return; // phase already moved on
          sendBotChatMessage(seat, chooseDiscussionLine(latest, seat, namesRef.current));
        }, delay);
      }
    }

    if (state.phase === "defense" && state.suspect !== null && allBotSeatSet.has(state.suspect)) {
      const seat = state.suspect;
      const key = `${phaseKey}:${seat}`;
      if (!botChatScheduledRef.current.has(key)) {
        botChatScheduledRef.current.add(key);
        const delay = 1000 + Math.random() * 3000;
        window.setTimeout(() => {
          const latest = gameStateRef.current;
          if (!latest || latest.phaseStartedAt !== state.phaseStartedAt) return;
          sendBotChatMessage(seat, chooseSelfDefenseLine(latest, seat));
        }, delay);
      }
    }
  }, [isHost, phase, gameState, allBotSeatSet, sendBotChatMessage]);

  useEffect(() => {
    if (phase !== "playing") return;
    const interval = window.setInterval(() => {
      const state = gameStateRef.current;
      if (!state) return;
      const actor = mafiaCurrentActor(state);
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

  function eligibleVoterCountFor(seatKey: string): number {
    const takenOverSeats = new Set(Object.keys(botTakeover.takeovers).map(Number));
    return occupants.filter((o) => o.seat !== Number(seatKey) && !botSeats.includes(o.seat) && !takenOverSeats.has(o.seat)).length;
  }

  function handleGameEnd() {
    if (!gameState || !gameState.winner) return;
    const winner = gameState.winner;
    const rankings = computeRankings(gameState).map((r) => ({ playerId: ids[r.seat], rank: r.rank }));
    onComplete({ rankings, finishedAt: new Date().toISOString() });
    setFinalResult({ winner });
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
    setGhostChatMessages([]);
    setGhostChatCooldownUntil(null);
    ghostChatThrottleRef.current = INITIAL_THROTTLE_STATE;
    setPhase("choose");
  }

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";

  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(roomCode !== null, handleLeave);
  useBackgroundResync(roomCode !== null, requestStateSync);
  useActiveRoomListing({
    gameId: "mafia",
    roomCode,
    isHost,
    isWaiting: phase === "waiting",
    hostName: myName,
    playerCount: occupants.length,
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

  const myPlayer = gameState && mySeat !== null ? gameState.players[mySeat] : null;
  const iAmGhost = myPlayer !== null && !myPlayer.alive;

  if (phase === "supabase-missing") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 text-center light:border-amber-300 light:bg-amber-50">
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80 light:text-amber-700">
          마피아는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs light:bg-slate-200 light:text-slate-800">.env.local</code>
          에 <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs light:bg-slate-200 light:text-slate-800">NEXT_PUBLIC_SUPABASE_URL</code> /
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs light:bg-slate-200 light:text-slate-800">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
          를 채워주세요 (README 참고).
        </p>
      </div>,
    );
  }

  if (phase === "room-full") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center light:border-rose-300 light:bg-rose-50">
        <span className="text-3xl">🚫</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">이미 다른 사람이 참여 중인 방이에요</h2>
        <p className="text-sm text-rose-100/80 light:text-rose-700">코드를 다시 확인하거나 새로운 방을 만들어보세요.</p>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-slate-700 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-600">
          처음으로
        </button>
      </div>,
    );
  }

  if (phase === "channel-error") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center light:border-rose-300 light:bg-rose-50">
        <span className="text-3xl">📡</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">연결에 실패했습니다</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-slate-700 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-600">
          다시 시도
        </button>
      </div>,
    );
  }

  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId="mafia"
        icon="🎭"
        title="마피아 온라인 대전"
        description={
          <p className="text-sm text-white/50 light:text-slate-500">
            기본룰(4~8인) 또는 확장룰(6~12인) 중 골라 각자 기기로 접속해서 실시간으로 플레이해요.
          </p>
        }
        containerClassName="border-slate-700 bg-gradient-to-b from-[#14161c] to-[#0a0b0e] light:border-slate-200 light:bg-white light:from-white light:to-white"
        actions={
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => {
                setIntent("create");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl bg-rose-700 py-3 text-sm font-semibold text-white transition hover:bg-rose-600"
            >
              🕵️ 방 만들기
            </button>
            <button
              onClick={() => {
                setIntent("join");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl border border-white/15 py-3 text-sm font-semibold text-white/80 transition hover:border-white/30 light:border-slate-300 light:text-slate-700 light:hover:border-slate-400"
            >
              🔑 초대 코드로 참여
            </button>
          </div>
        }
      />,
    );
  }

  if (phase === "enter-name") {
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 light:border-slate-200 light:bg-white light:shadow-sm">
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-rose-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-300"
            />
          </label>
        )}
        {intent === "create" && (
          <>
            <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              룰 모드
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode("classic");
                    setTargetPlayerCount((n) => Math.min(Math.max(n, MIN_CLASSIC), MAX_CLASSIC));
                  }}
                  className={`rounded-xl border px-3 py-2.5 text-left text-xs transition ${
                    mode === "classic"
                      ? "border-rose-400/60 bg-rose-500/15 text-rose-100"
                      : "border-white/10 bg-white/5 text-white/60 hover:border-white/20"
                  }`}
                >
                  <p className="font-semibold">🎲 기본룰 (Classic)</p>
                  <p className="mt-0.5 text-[11px] opacity-80">4~8인 · 마피아/경찰/의사/시민</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("expansion");
                    setTargetPlayerCount((n) => Math.min(Math.max(n, MIN_EXPANSION), MAX_EXPANSION));
                  }}
                  className={`rounded-xl border px-3 py-2.5 text-left text-xs transition ${
                    mode === "expansion"
                      ? "border-rose-400/60 bg-rose-500/15 text-rose-100"
                      : "border-white/10 bg-white/5 text-white/60 hover:border-white/20"
                  }`}
                >
                  <p className="font-semibold">🃏 확장룰 (Expansion)</p>
                  <p className="mt-0.5 text-[11px] opacity-80">6~12인 · 스파이/군인/정치인/영매/테러리스트</p>
                </button>
              </div>
            </div>
            <label className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              인원 수 ({range.min}~{range.max}명)
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setTargetPlayerCount((n) => Math.max(range.min, n - 1))}
                  className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30 light:border-slate-300 light:text-slate-700"
                >
                  −
                </button>
                <span className="w-8 text-center text-lg font-semibold text-white light:text-slate-900">{targetPlayerCount}</span>
                <button
                  type="button"
                  onClick={() => setTargetPlayerCount((n) => Math.min(range.max, n + 1))}
                  className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30 light:border-slate-300 light:text-slate-700"
                >
                  +
                </button>
              </div>
            </label>
            <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70 light:border-slate-200 light:bg-slate-50 light:text-slate-600">
              <label className="flex items-center justify-between gap-2">
                <span>처형 시 직업 공개</span>
                <input type="checkbox" checked={revealRoleOnDeath} onChange={(e) => setRevealRoleOnDeath(e.target.checked)} className="h-4 w-4 accent-rose-500" />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span>의사 첫 실제 능력 밤 자가치료 허용</span>
                <input type="checkbox" checked={doctorSelfHeal} onChange={(e) => setDoctorSelfHeal(e.target.checked)} className="h-4 w-4 accent-rose-500" />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span>낮 토론 시간</span>
                <select
                  value={discussionSeconds}
                  onChange={(e) => setDiscussionSeconds(Number(e.target.value) as 30 | 60 | 90)}
                  className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-white light:border-slate-300 light:bg-white light:text-slate-900"
                >
                  <option value={30}>30초</option>
                  <option value={60}>60초</option>
                  <option value={90}>90초</option>
                </select>
              </label>
            </div>
          </>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 light:bg-rose-50 light:text-rose-700">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-rose-700 py-2.5 text-sm font-semibold text-white hover:bg-rose-600">
            {intent === "create" ? "방 만들기" : "참여하기"}
          </button>
        </div>
      </div>,
    );
  }

  if (phase === "connecting" || phase === "waiting") {
    return withGuard(
      <>
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center light:border-slate-200 light:bg-white light:shadow-sm">
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
                  <p key={seat} className="flex items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600">
                    <span>
                      {seat === mySeat ? "나" : `${seat + 1}번`}:{" "}
                      {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30 light:text-slate-400">대기 중...</span>}
                    </span>
                    {isHost && !occ && (
                      <span>
                        {isBot ? <RemoveBotButton onClick={() => removeBotAtSeat(seat)} /> : <AddBotButton onAddWithLevel={(level) => addBotAtSeat(seat, level)} />}
                      </span>
                    )}
                  </p>
                );
              })}
            </div>
            <p className="text-xs text-white/40 light:text-slate-400">{knownTargetPlayerCount}명이 모이면 자동으로 게임이 시작됩니다.</p>
            {isHost && occupants.length + botSeats.length >= range.min && occupants.length + botSeats.length < knownTargetPlayerCount && (
              <button onClick={sendGameStart} className="rounded-full bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-600">
                지금 시작 ({occupants.length + botSeats.length}명)
              </button>
            )}
          </>
        )}
      </div>
      <div className="hidden sm:block">
        <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="대기실 채팅" />
      </div>
      <div className="sm:hidden">
        <MobileChatCenterModal messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="대기실 채팅" />
      </div>
      </>,
    );
  }

  if (phase === "playing" && gameState && mySeat !== null && roomCode) {
    const myVoteAsTarget = activeVoteFor(botTakeover, String(mySeat));
    const iAmTakenOver = isSeatTakenOver(botTakeover, String(mySeat));
    const voteToShow = Object.values(botTakeover.votes).find(
      (v) => v.seatKey !== String(mySeat) && `${v.seatKey}:${v.startedAt}` !== dismissedVoteKey,
    );
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
      <MafiaBoard
        state={gameState}
        viewerSeat={mySeat}
        names={names}
        connectedSeats={connectedSeats}
        onAction={handleAction}
        onGameEnd={handleGameEnd}
        isChatInputFocused={isChatInputFocused}
        roomCode={roomCode}
      />
      <div className="hidden sm:block">
        <ChatDrawer
          messages={chatMessages}
          onSend={sendChatMessage}
          myDeviceId={deviceId}
          cooldownUntil={chatCooldownUntil}
          title="게임 채팅"
          onInputFocus={handleChatInputFocus}
          onInputBlur={handleChatInputBlur}
        />
        {iAmGhost && (
          <ChatDrawer
            messages={ghostChatMessages}
            onSend={sendGhostChatMessage}
            myDeviceId={deviceId}
            cooldownUntil={ghostChatCooldownUntil}
            title="👻 유령 전용 채팅"
            onInputFocus={handleChatInputFocus}
            onInputBlur={handleChatInputBlur}
          />
        )}
      </div>
      <div className="sm:hidden">
        <MobileChatCenterModal
          messages={chatMessages}
          onSend={sendChatMessage}
          myDeviceId={deviceId}
          cooldownUntil={chatCooldownUntil}
          title="게임 채팅"
          onInputFocus={handleChatInputFocus}
          onInputBlur={handleChatInputBlur}
        />
        {iAmGhost && (
          <MobileChatCenterModal
            messages={ghostChatMessages}
            onSend={sendGhostChatMessage}
            myDeviceId={deviceId}
            cooldownUntil={ghostChatCooldownUntil}
            title="👻 유령 전용 채팅"
            onInputFocus={handleChatInputFocus}
            onInputBlur={handleChatInputBlur}
            quickBarBottomOffsetRem={3.5}
          />
        )}
      </div>
      </>,
    );
  }

  if (phase === "post-game" && finalResult) {
    return withGuard(
      <>
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center light:border-slate-200 light:bg-white light:shadow-sm">
        <span className="text-4xl">🎭</span>
        <p className="text-white/80 light:text-slate-700">
          {finalResult.winner === "citizen" ? "시민 진영" : "마피아 진영"} 승리로 게임이 끝났어요.
        </p>
        <div className="flex gap-2">
          <button onClick={handleLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
            나가기
          </button>
          <button onClick={handleRematch} className="rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-600">
            다시하기
          </button>
        </div>
      </div>
      <div className="hidden sm:block">
        <ChatDrawer messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="게임 채팅" />
      </div>
      <div className="sm:hidden">
        <MobileChatCenterModal messages={chatMessages} onSend={sendChatMessage} myDeviceId={deviceId} cooldownUntil={chatCooldownUntil} title="게임 채팅" />
      </div>
      </>,
    );
  }

  return withGuard(null);
}

const MIN_CLASSIC = 4;
const MAX_CLASSIC = 8;
const MIN_EXPANSION = 6;
const MAX_EXPANSION = 12;
