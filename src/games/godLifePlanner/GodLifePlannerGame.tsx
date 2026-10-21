"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import {
  DEFAULT_OPTIONS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  applyAction,
  computeRankings,
  nonSleepHabits,
  pendingSeats,
  planHash,
  scoreBreakdown,
  startGame,
  winnerSeats,
  type EngineAction,
  type GameOptions,
  type GameState,
  type Plan,
  type Seat,
} from "./engine";
import { chooseBotAction, chooseBotPlan } from "./bot";
import GodLifePlannerBoard from "./GodLifePlannerBoard";
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
 * 갓생 플래너 온라인 대전 진입점 — 라이어를 찾아라와 같은 락스텝 패턴(docs/cloud-sync.md).
 * 방장이 시드+옵션을 브로드캐스트하면 모든 기기가 `startGame`으로 7일치 카드를 재현하고,
 * 이후 `EngineAction`만 주고받는다.
 *
 * 계획은 커밋-공개: 계획 확정 때 해시만 보내고(원문·솔트는 이 기기 localStorage에 보관),
 * 전원이 커밋해 `revealing` 단계가 되면 각 기기가 자기 원문을 자동으로 보낸다. 봇 계획은
 * 방장 기기 메모리(`botPlansRef`)에 같은 방식으로 보관한다.
 *
 * 시간 제한: 각 기기가 "단계(stage)가 바뀐 걸 본 시각"부터 로컬로 재고, 방장 기기만
 * `TIMEOUT { stage }`를 보낸다. 계획 시간이 끝나기 직전에는 보드가 지금까지 짠 계획을
 * 자동으로 확정한다. 이탈/무응답(연속 2번 계획 시간 초과) → 투표 기반 AI 봇 대체.
 */

function phaseDurationMs(state: GameState): number {
  switch (state.phase) {
    case "goalDraft":
      return 60_000;
    case "planning":
      return state.options.planSeconds > 0 ? state.options.planSeconds * 1000 : 0;
    case "revealing":
      return 12_000;
    case "dayResult":
      return 60_000;
    default:
      return 0;
  }
}
const IDLE_STREAK_FOR_VOTE = 2;
const PLAN_SECONDS = [60, 90, 120, 180, 0];

type Occupant = {
  deviceId: string;
  seat: Seat;
  name: string;
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
};

type Phase = "choose" | "enter-name" | "connecting" | "waiting" | "playing" | "post-game" | "room-full" | "supabase-missing" | "channel-error";

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredSeat(code: string): number | null {
  const v = window.localStorage.getItem(`god-life-planner-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`god-life-planner-seat-${code}`, String(seat));
}

function planKey(code: string, seat: number, day: number): string {
  return `god-life-planner-plan-${code}-${seat}-${day}`;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function randomSalt(): string {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function OptionRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
      {label}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              value === o.value
                ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100 light:text-emerald-700"
                : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-500 light:hover:border-slate-400"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function GodLifePlannerGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(4);
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [finalWinners, setFinalWinners] = useState<Seat[] | null>(null);

  const [botSeats, setBotSeats] = useState<Seat[]>([]);
  const botSeatsRef = useRef<Seat[]>([]);
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

  const channelRef = useRef<RealtimeChannel | null>(null);
  function requestStateSync() {
    const channel = channelRef.current;
    if (!channel) return;
    if (channel.state !== "joined") channel.subscribe();
    channel.send({ type: "broadcast", event: "state-request", payload: {} });
  }
  const startSentRef = useRef(false);
  const playerCountRef = useRef(targetPlayerCount);
  const optionsRef = useRef<GameOptions>(options);
  const isHost = intent === "create";

  const gameStateRef = useRef<GameState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const occupantsRef = useRef<Occupant[]>([]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);

  const namesRef = useRef<Record<Seat, string>>({});

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
    optionsRef.current = options;
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
    const channel = supabase.channel(`god-life-planner-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const playerCount = payload?.playerCount as number;
      const roomOptions = { ...DEFAULT_OPTIONS, ...((payload?.options as Partial<GameOptions> | undefined) ?? {}) };
      const roster = (payload?.botSeats as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      playerCountRef.current = playerCount;
      optionsRef.current = roomOptions;
      setOptions(roomOptions);
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      setGameState(startGame(playerCount, seed, roomOptions));
      setFinalWinners(null);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      const roster = (payload?.botSeats as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botSeatsRef.current = roster;
      setBotSeats(roster);
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
      const takenOverSeats = new Set(Object.keys(botTakeoverRef.current.takeovers).map(Number));
      const eligible = occupantsRef.current.filter(
        (o) => o.seat !== Number(event.seatKey) && !botSeatsRef.current.includes(o.seat) && !takenOverSeats.has(o.seat),
      ).length;
      if (voteThresholdMet(voteYesCount(botTakeoverRef.current, event.seatKey), eligible)) {
        channel.send({
          type: "broadcast",
          event: "bot-takeover-event",
          payload: { event: { type: "convert", seatKey: event.seatKey, at: Date.now() } },
        });
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
      const state = payload?.state as GameState | undefined;
      if (!state) return;
      // 이미 더 진행된 상태를 들고 있으면(재접속 응답이 늦게 온 경우) 덮어쓰지 않는다.
      const mine = gameStateRef.current;
      if (mine && mine.seed === state.seed && mine.stage > state.stage) return;
      const roster = (payload?.botSeats as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      const takeover = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      botTakeoverRef.current = takeover;
      setBotTakeover(takeover);
      optionsRef.current = state.options;
      setOptions(state.options);
      setGameState(state);
      setFinalWinners(null);
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
      ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current } : {}),
    } satisfies Occupant);
  }, [occupants, mySeat, phase, deviceId, roomCode, myName, myPlayerId, isHost]);

  const sendGameStart = useCallback(() => {
    startSentRef.current = true;
    // "지금 시작"으로 정원보다 적게 시작하면 실제 앉은 인원만큼만 좌석을 만든다. 중간에 비는
    // 좌석(누가 나갔다 등)은 기본 레벨 봇으로 채워 매 단계 시간 초과로 멈추지 않게 한다.
    const humanSeats = occupantsRef.current.map((o) => o.seat);
    const taken = new Set([...humanSeats, ...botSeatsRef.current]);
    const count = Math.max(MIN_PLAYERS, Math.min(playerCountRef.current, Math.max(taken.size, ...humanSeats.map((s) => s + 1))));
    const gaps = Array.from({ length: count }, (_, s) => s).filter((s) => !taken.has(s));
    if (gaps.length > 0) {
      botSeatsRef.current = [...botSeatsRef.current, ...gaps];
      botLevelsRef.current = [...botLevelsRef.current, ...gaps.map(() => DEFAULT_BOT_LEVEL)];
    }
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: {
        seed: randomSeed(),
        playerCount: count,
        options: optionsRef.current,
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
    (seat: Seat, level: BotLevel) => {
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
      const taken = new Set<Seat>([...occupants.map((o) => o.seat), ...botSeatsRef.current]);
      const emptySeats = Array.from({ length: knownTargetPlayerCount }, (_, seat) => seat as Seat).filter((seat) => !taken.has(seat));
      if (emptySeats.length === 0) return;
      const nextSeats = [...botSeatsRef.current, ...emptySeats];
      const nextLevels = [...botLevelsRef.current, ...emptySeats.map(() => level)];
      botSeatsRef.current = nextSeats;
      setBotSeats(nextSeats);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: nextSeats, botLevels: nextLevels } });
    },
    [isHost, occupants, knownTargetPlayerCount],
  );

  const removeBotAtSeat = useCallback(
    (seat: Seat) => {
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

  function castTakeoverVote(seatKey: string) {
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type: "vote-cast", seatKey, voterDeviceId: deviceId } } });
  }
  function proveStillHereOrReclaim(seatKey: string) {
    const type = isSeatTakenOver(botTakeover, seatKey) ? "reclaim" : "vote-cancel";
    channelRef.current?.send({ type: "broadcast", event: "bot-takeover-event", payload: { event: { type, seatKey } } });
  }
  function eligibleVoterCountFor(seatKey: string): number {
    const takenOverSeats = new Set(Object.keys(botTakeover.takeovers).map(Number));
    return occupants.filter((o) => o.seat !== Number(seatKey) && !botSeats.includes(o.seat) && !takenOverSeats.has(o.seat)).length;
  }

  const takeoverSeatKey = Object.keys(botTakeover.takeovers).sort().join(",");
  const takeoverSeats = useMemo(() => (takeoverSeatKey ? (takeoverSeatKey.split(",").map(Number) as Seat[]) : []), [takeoverSeatKey]);
  const allBotSeatSet = useMemo(() => new Set([...botSeatSet, ...takeoverSeats]), [botSeatSet, takeoverSeats]);

  // 동시 행동 게임이라 "지금 결정할 봇"은 대기 좌석 중 첫 번째 봇. 공개 단계에서 원문을 모르는
  // 봇(방장이 새로고침한 경우 등)은 건너뛴다 — 시간 초과로 기본 계획이 들어간다.
  const botPlansRef = useRef<Map<string, { plan: Plan; salt: string }>>(new Map());
  const currentActor = useCallback(
    (state: GameState): Seat | null =>
      pendingSeats(state).find((s) => allBotSeatSet.has(s) && (state.phase !== "revealing" || botPlansRef.current.has(`${state.seed}:${state.day}:${s}`))) ?? null,
    [allBotSeatSet],
  );

  const chooseAction = useCallback((state: GameState, actor: Seat): EngineAction | null => {
    const idx = botSeatsRef.current.indexOf(actor);
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    const key = `${state.seed}:${state.day}:${actor}`;
    if (state.phase === "planning") {
      const plan = chooseBotPlan(state, actor, level);
      const salt = randomSalt();
      botPlansRef.current.set(key, { plan, salt });
      return { type: "COMMIT_PLAN", seat: actor, day: state.day, hash: planHash(plan, salt) };
    }
    if (state.phase === "revealing") {
      const stored = botPlansRef.current.get(key);
      return stored ? { type: "REVEAL_PLAN", seat: actor, day: state.day, plan: stored.plan, salt: stored.salt } : null;
    }
    return chooseBotAction(state, actor, level);
  }, []);

  useBotAutoplay<GameState, EngineAction, Seat>({
    active: isHost && phase === "playing",
    state: gameState,
    currentActor,
    botSeats: allBotSeatSet,
    chooseAction,
    dispatch: handleAction,
    minDelayMs: 500,
    maxDelayMs: 1500,
  });

  // 단계 타이머 — 이 기기가 stage 변화를 본 시각 기준. 방장만 TIMEOUT을 보낸다.
  // 같은 인터벌에서 무응답(연속 시간 초과) 봇 대체 투표도 시작한다.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [stageSeen, setStageSeen] = useState<{ stage: number; at: number } | null>(null);
  const stageSeenRef = useRef<{ stage: number; at: number } | null>(null);
  const timeoutSentRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      const state = gameStateRef.current;
      if (!state) return;
      const seen = stageSeenRef.current;
      if (!seen || seen.stage !== state.stage) {
        const next = { stage: state.stage, at: now };
        stageSeenRef.current = next;
        setStageSeen(next);
        return;
      }
      const duration = phaseDurationMs(state);
      if (isHost && duration > 0 && now - seen.at >= duration && timeoutSentRef.current !== state.stage) {
        timeoutSentRef.current = state.stage;
        channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action: { type: "TIMEOUT", stage: state.stage } } });
      }
      for (let seat = 0; seat < state.seatCount; seat++) {
        if (state.idleStreak[seat] < IDLE_STREAK_FOR_VOTE) continue;
        if (botSeatsRef.current.includes(seat)) continue;
        const seatKey = String(seat);
        if (activeVoteFor(botTakeoverRef.current, seatKey) || isSeatTakenOver(botTakeoverRef.current, seatKey)) continue;
        const occ = occupantsRef.current.find((o) => o.seat === seat);
        channelRef.current?.send({
          type: "broadcast",
          event: "bot-takeover-event",
          payload: {
            event: {
              type: "vote-start",
              seatKey,
              reason: "idle",
              startedAt: now,
              originalUserId: occ?.playerId ?? `${roomCode}:${seat}`,
              originalName: occ?.name ?? namesRef.current[seat] ?? "상대",
            },
          },
        });
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [phase, isHost, roomCode]);

  const deadlineMs = gameState && stageSeen && stageSeen.stage === gameState.stage && phaseDurationMs(gameState) > 0 ? stageSeen.at + phaseDurationMs(gameState) : null;

  // 내 계획: 커밋(해시만 전송) → 공개 단계에서 자동 공개
  const myPlanMemRef = useRef<Map<string, { plan: Plan; salt: string }>>(new Map());
  const [myCommitted, setMyCommitted] = useState<{ key: string; plan: Plan } | null>(null);
  const commitPlan = useCallback(
    (plan: Plan) => {
      const state = gameStateRef.current;
      if (!state || mySeat === null || !roomCode || state.phase !== "planning" || state.commits[mySeat] !== null) return;
      const salt = randomSalt();
      myPlanMemRef.current.set(`${state.seed}:${state.day}`, { plan, salt });
      try {
        window.localStorage.setItem(planKey(roomCode, mySeat, state.day), JSON.stringify({ seed: state.seed, plan, salt }));
      } catch {
        // 저장 실패 — 이 탭이 살아 있는 동안은 메모리 사본으로 공개한다
      }
      setMyCommitted({ key: `${state.seed}:${state.day}`, plan });
      channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action: { type: "COMMIT_PLAN", seat: mySeat, day: state.day, hash: planHash(plan, salt) } } });
    },
    [mySeat, roomCode],
  );
  const revealSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gameState || mySeat === null || !roomCode || gameState.phase !== "revealing") return;
    if (gameState.commits[mySeat] === null || gameState.plans[mySeat] !== null) return;
    const tag = `${gameState.seed}:${gameState.day}:${gameState.stage}`;
    if (revealSentRef.current === tag) return;
    let stored = myPlanMemRef.current.get(`${gameState.seed}:${gameState.day}`) ?? null;
    if (!stored) {
      try {
        const raw = window.localStorage.getItem(planKey(roomCode, mySeat, gameState.day));
        const parsed = raw ? (JSON.parse(raw) as { seed: number; plan: Plan; salt: string }) : null;
        stored = parsed && parsed.seed === gameState.seed ? parsed : null;
      } catch {
        stored = null;
      }
    }
    if (!stored) return;
    revealSentRef.current = tag;
    channelRef.current?.send({
      type: "broadcast",
      event: "game-action",
      payload: { action: { type: "REVEAL_PLAN", seat: mySeat, day: gameState.day, plan: stored.plan, salt: stored.salt } },
    });
  }, [gameState, mySeat, roomCode]);
  const myCommittedPlan = gameState && myCommitted && myCommitted.key === `${gameState.seed}:${gameState.day}` ? myCommitted.plan : null;

  const ids: Record<Seat, string> = useMemo(() => {
    const map: Record<Seat, string> = {};
    const count = gameState?.seatCount ?? knownTargetPlayerCount;
    for (let seat = 0; seat < count; seat++) {
      const occ = occupants.find((o) => o.seat === seat);
      map[seat] = botTakeover.takeovers[seat]?.originalUserId ?? occ?.playerId ?? `${roomCode}:${seat}`;
    }
    return map;
  }, [roomCode, gameState, knownTargetPlayerCount, occupants, botTakeover]);

  const names: Record<Seat, string> = useMemo(() => {
    const map: Record<Seat, string> = {};
    const count = gameState?.seatCount ?? knownTargetPlayerCount;
    for (let seat = 0; seat < count; seat++) {
      const occ = occupants.find((o) => o.seat === seat);
      const botIdx = botSeats.indexOf(seat);
      const takeover = botTakeover.takeovers[seat];
      if (takeover) {
        map[seat] = `🤖 AI ${takeover.originalName}`;
      } else {
        map[seat] = seat === mySeat ? myName : (occ?.name ?? (botIdx >= 0 ? botDisplayName(botIdx, botLevels[botIdx]) : `${seat + 1}번`));
      }
    }
    return map;
  }, [occupants, mySeat, myName, gameState, knownTargetPlayerCount, botSeats, botLevels, botTakeover]);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);

  const connectedSeats = useMemo(() => new Set([...occupants.map((o) => o.seat), ...botSeats, ...takeoverSeats]), [occupants, botSeats, takeoverSeats]);

  function handleGameEnd() {
    if (!gameState || gameState.phase !== "ended") return;
    const rankings = computeRankings(gameState);
    onComplete({
      rankings: rankings.map((r) => ({ playerId: ids[r.seat], rank: r.rank })),
      self: selfResult(mySeat, rankings, { takeovers: botTakeover.takeovers, botSeats, botLevels }, (seat): Record<string, number> => {
        const b = scoreBreakdown(gameState, seat);
        const st = gameState.seats[seat];
        return {
          maxScore: b.total,
          goalsMet: b.goalMet ? 1 : 0,
          habitsFormed: st.habitsFormed,
          maxHabits: nonSleepHabits(st),
          collapses: st.collapses,
          flawlessWeeks: st.collapses === 0 && gameState.options.days === 7 ? 1 : 0,
          matches: st.matches,
          opportunities: st.oppWins,
          totalGrowth: b.growth,
        };
      }),
      finishedAt: new Date().toISOString(),
    });
    setFinalWinners(winnerSeats(gameState));
    setPhase("post-game");
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
    setFinalWinners(null);
    setIdentity({ name: "" });
    setMyPlayerId(undefined);
    setCodeInput("");
    botSeatsRef.current = [];
    setBotSeats([]);
    botLevelsRef.current = [];
    setBotLevels([]);
    botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
    setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
    setPhase("choose");
  }

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";

  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(roomCode !== null, handleLeave);
  useBackgroundResync(roomCode !== null, requestStateSync);
  useActiveRoomListing({
    gameId: "god-life-planner",
    roomCode,
    isHost,
    isWaiting: phase === "waiting",
    isPlaying: phase === "playing",
    hostName: myName,
    playerCount: occupants.length,
    occupants,
    maxPlayers: knownTargetPlayerCount,
    unlisted: knownTargetPlayerCount === 1,
  });

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
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 text-center light:shadow-sm">
        <span className="text-3xl">⚠️</span>
        <h2 className="break-keep text-lg font-bold text-white light:text-slate-900">온라인 방을 사용할 수 없어요</h2>
        <p className="max-w-sm break-keep text-sm text-amber-100/80 light:text-amber-800">갓생 플래너는 온라인 방 기반이라 Supabase 설정이 필요합니다.</p>
      </div>,
    );
  }

  if (phase === "room-full") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center light:shadow-sm">
        <span className="text-3xl">🚫</span>
        <h2 className="break-keep text-lg font-bold text-white light:text-slate-900">이미 다른 사람이 참여 중인 방이에요</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
          처음으로
        </button>
      </div>,
    );
  }

  if (phase === "channel-error") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center light:shadow-sm">
        <span className="text-3xl">📡</span>
        <h2 className="break-keep text-lg font-bold text-white light:text-slate-900">연결에 실패했습니다</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
          다시 시도
        </button>
      </div>,
    );
  }

  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId="god-life-planner"
        icon="📅"
        title="갓생 플래너"
        description={
          <p className="break-keep text-sm text-white/50 light:text-slate-500">
            1~6명이 일주일 동안 하루 8블록을 비공개로 계획하고 동시에 공개해요. 인원을 1명으로 정하면 혼자 하기, 모자란 자리는 AI 봇으로 채울 수 있어요.
          </p>
        }
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
                trackGameEvent("god-life-planner", "invite_click");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl border border-white/15 py-3 text-sm font-semibold text-white/80 transition hover:border-white/30 light:border-slate-300 light:text-slate-700"
            >
              🔑 초대 코드로 참여
            </button>
          </div>
        }
      />,
    );
  }

  if (phase === "enter-name") {
    const setOpt = <K extends keyof GameOptions>(key: K, value: GameOptions[K]) => setOptions((o) => ({ ...o, [key]: value }));
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 light:border-slate-200 light:bg-white light:shadow-sm">
        <h2 className="break-keep text-base font-bold text-white light:text-slate-900">{intent === "create" ? "방 만들기" : "초대 코드로 참여"}</h2>
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-emerald-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400"
            />
          </label>
        )}
        {intent === "create" && (
          <>
            <label className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              인원 수 ({MIN_PLAYERS}~{MAX_PLAYERS}명{targetPlayerCount === 1 ? " · 혼자 하기" : ""})
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
            <OptionRow
              label="기간"
              value={options.days}
              options={[
                { value: 7 as const, label: "📅 일주일 (월~일)" },
                { value: 5 as const, label: "⚡ 짧게 (월~금)" },
              ]}
              onChange={(v) => setOpt("days", v)}
            />
            <OptionRow
              label="계획 제한 시간"
              value={options.planSeconds}
              options={PLAN_SECONDS.map((sec) => ({ value: sec, label: sec === 0 ? "무제한" : `${sec}초` }))}
              onChange={(v) => setOpt("planSeconds", v)}
            />
            <OptionRow
              label="난이도"
              value={options.hard ? "hard" : options.easyHabit ? "easy" : "normal"}
              options={[
                { value: "easy", label: "🌱 쉬운 습관 (2일)" },
                { value: "normal", label: "📘 기본" },
                { value: "hard", label: "🔥 현실 모드" },
              ]}
              onChange={(v) => setOptions((o) => ({ ...o, hard: v === "hard", easyHabit: v === "easy" }))}
            />
            <OptionRow
              label="비교 지옥 (SNS 모드)"
              value={options.sns ? "on" : "off"}
              options={[
                { value: "off", label: "끄기" },
                { value: "on", label: "📸 켜기 — 그날 1등 멘탈 +1, 꼴찌 −1" },
              ]}
              onChange={(v) => setOpt("sns", v === "on")}
            />
          </>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 light:bg-rose-50 light:text-rose-700">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
            {intent === "create" ? (targetPlayerCount === 1 ? "혼자 시작하기" : "방 만들기") : "참여하기"}
          </button>
        </div>
      </div>,
    );
  }

  if (phase === "connecting" || phase === "waiting") {
    const filled = occupants.length + botSeats.length;
    return withGuard(
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
            {isHost && (
              <p className="break-keep text-xs text-white/40 light:text-slate-400">
                {options.days === 7 ? "일주일" : "월~금"} · 계획 {options.planSeconds === 0 ? "무제한" : `${options.planSeconds}초`} · {options.hard ? "🔥 현실 모드" : options.easyHabit ? "🌱 쉬운 습관" : "기본"}
                {options.sns ? " · 📸 비교 지옥" : ""}
              </p>
            )}
            <p className="text-xs text-white/50 light:text-slate-500">
              {filled} / {knownTargetPlayerCount}명 참여 중
            </p>
            {isHost && filled < knownTargetPlayerCount && <FillEmptySeatsButton emptyCount={knownTargetPlayerCount - filled} onFill={fillEmptySeatsWithBots} />}
            <div className="mt-2 flex flex-col gap-1.5">
              {Array.from({ length: knownTargetPlayerCount }, (_, seat) => {
                const occ = occupants.find((o) => o.seat === seat);
                const botIdx = botSeats.indexOf(seat);
                const isBot = botIdx >= 0;
                return (
                  <p key={seat} className="flex items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600">
                    <span className="break-keep">
                      {seat === mySeat ? "나" : `${seat + 1}번`}:{" "}
                      {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30 light:text-slate-400">대기 중...</span>}
                    </span>
                    {isHost && !occ && <span>{isBot ? <RemoveBotButton onClick={() => removeBotAtSeat(seat)} /> : <AddBotButton onAddWithLevel={(level) => addBotAtSeat(seat, level)} />}</span>}
                  </p>
                );
              })}
            </div>
            <p className="break-keep text-xs text-white/40 light:text-slate-400">{knownTargetPlayerCount}명이 모이면 자동으로 게임이 시작됩니다.</p>
            {isHost && filled >= MIN_PLAYERS && filled < knownTargetPlayerCount && (
              <button onClick={sendGameStart} className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500">
                지금 시작 ({filled}명)
              </button>
            )}
          </>
        )}
      </div>,
    );
  }

  if (phase === "playing" && gameState && mySeat !== null) {
    if (mySeat >= gameState.seatCount) {
      return withGuard(
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="break-keep text-sm text-white/70 light:text-slate-600">게임이 이미 {gameState.seatCount}명으로 시작됐어요. 다음 판을 기다려 주세요.</p>
          <button onClick={handleLeave} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70">
            나가기
          </button>
        </div>,
      );
    }
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
        <GodLifePlannerBoard
          state={gameState}
          viewerSeat={mySeat}
          names={names}
          connectedSeats={connectedSeats}
          deadlineMs={deadlineMs}
          phaseMs={phaseDurationMs(gameState)}
          nowMs={nowMs}
          committedPlan={myCommittedPlan}
          onAction={handleAction}
          onCommit={commitPlan}
          onGameEnd={handleGameEnd}
        />
      </>,
    );
  }

  if (phase === "post-game" && finalWinners) {
    return withGuard(
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center light:border-slate-200 light:bg-white light:shadow-sm">
        <span className="text-4xl">🏆</span>
        <p className="break-keep text-white/80 light:text-slate-700">
          {gameState?.seatCount === 1 ? "일주일을 마쳤어요. 수고했어요!" : `${finalWinners.map((s) => names[s]).join(", ")}님이 가장 갓생을 살았어요.`}
        </p>
        <div className="flex gap-2">
          <button onClick={handleLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
            나가기
          </button>
          {isHost && (
            <button onClick={sendGameStart} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
              다시하기
            </button>
          )}
        </div>
      </div>,
    );
  }

  return withGuard(null);
}
