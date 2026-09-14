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
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
import { applyAction, chooseBotAction, computeRankings, MIN_PLAYERS, startGame } from "./engine";
import type { CoinVisibility, EngineAction, GreatLegacyMode, GreatLegacyState, SeatIndex, TimeLimitMode } from "./types";
import GreatLegacyBoard from "./GreatLegacyBoard";
import { useBotAutoplay } from "@/games/shared/bot/useBotAutoplay";
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
import { AddBotButton, BotSeatBadge, FillEmptySeatsButton, RemoveBotButton } from "@/components/lobby/BotSeatControls";
import RulebookGate from "@/components/lobby/RulebookGate";
import { DEFAULT_BOT_LEVEL, type BotLevel } from "@/games/shared/bot/botDifficulty";

/**
 * Online-room multiplayer entry point, same lockstep pattern as
 * NoThanksGame/CoyoteGame: every connected client independently computes the
 * full `GreatLegacyState` (every seat's private purse) from a shared RNG
 * seed plus replayed `EngineAction`s broadcast over Supabase Realtime.
 *
 * Deliberately does NOT wire the vote-based bot-takeover system the other
 * ~28 games share (confirmed design decision — see HANDOFF.md): a
 * disconnected seat is simply left waiting for in "제한시간 없음" mode, or
 * auto-passed by the turn-timeout watchdog below in a timed mode. Both
 * behaviors apply identically to a slow-but-connected human and a genuinely
 * disconnected one — the timer doesn't distinguish them, per the confirmed
 * "시간초과 시 포기 처리" rule.
 */

const TIME_LIMIT_SECONDS: Record<TimeLimitMode, number | null> = { none: null, "15s": 15, "30s": 30 };

type Occupant = {
  deviceId: string;
  seat: SeatIndex;
  name: string;
  playerId?: string;
  isHost?: boolean;
  mode?: GreatLegacyMode;
  timeLimitMode?: TimeLimitMode;
  coinVisibility?: CoinVisibility;
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
  const v = window.localStorage.getItem(`great-legacy-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`great-legacy-seat-${code}`, String(seat));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function currentActor(state: GreatLegacyState): SeatIndex | null {
  return state.phase === "playing" && state.auction ? state.auction.activeSeat : null;
}

export default function GreatLegacyGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [mode, setMode] = useState<GreatLegacyMode>("4p");
  const [timeLimitMode, setTimeLimitMode] = useState<TimeLimitMode>("none");
  const [coinVisibility, setCoinVisibility] = useState<CoinVisibility>("secret");
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<GreatLegacyState | null>(null);
  const [finalResult, setFinalResult] = useState<{ winnerName: string; tied: boolean } | null>(null);

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

  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // Turn-timeout watchdog state (host-only, see the dedicated effect below):
  // tracks how long the current actor has been the same so a timed-mode
  // game can auto-pass them once their limit runs out.
  const lastActorRef = useRef<{ actor: SeatIndex | null; since: number }>({ actor: null, since: 0 });

  const channelRef = useRef<RealtimeChannel | null>(null);
  function requestStateSync() {
    const channel = channelRef.current;
    if (!channel) return;
    if (channel.state !== "joined") channel.subscribe();
    channel.send({ type: "broadcast", event: "state-request", payload: {} });
  }
  const startSentRef = useRef(false);
  const modeRef = useRef(mode);
  const timeLimitModeRef = useRef(timeLimitMode);
  const coinVisibilityRef = useRef(coinVisibility);
  const isHost = intent === "create";

  const gameStateRef = useRef<GreatLegacyState | null>(null);
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
    modeRef.current = mode;
    timeLimitModeRef.current = timeLimitMode;
    coinVisibilityRef.current = coinVisibility;
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
    const channel = supabase.channel(`great-legacy-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const startMode = (payload?.mode as GreatLegacyMode | undefined) ?? "4p";
      const startTimeLimit = (payload?.timeLimitMode as TimeLimitMode | undefined) ?? "none";
      const startCoinVisibility = (payload?.coinVisibility as CoinVisibility | undefined) ?? "secret";
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      modeRef.current = startMode;
      timeLimitModeRef.current = startTimeLimit;
      coinVisibilityRef.current = startCoinVisibility;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      setGameState(startGame(startMode, seed, startTimeLimit, startCoinVisibility));
      setFinalResult(null);
      setPhase("playing");
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

    channel.on("broadcast", { event: "state-request" }, () => {
      if (gameStateRef.current) {
        channel.send({
          type: "broadcast",
          event: "state-sync",
          payload: { state: gameStateRef.current, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current },
        });
      } else if (isHost) {
        channel.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: botSeatsRef.current, botLevels: botLevelsRef.current } });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const state = payload?.state as GreatLegacyState | undefined;
      if (!state) return;
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
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

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await Promise.race([firstSync, new Promise((resolve) => setTimeout(resolve, 800))]);
        let seat = getStoredSeat(roomCode);
        const targetCount = MIN_PLAYERS[modeRef.current];
        if (seat === null) {
          const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
          const existing = Object.values(raw).flat();
          const taken = new Set([...existing.map((o) => o.seat), ...botSeatsRef.current]);
          seat = 0;
          while (taken.has(seat)) seat++;
          const hostRecord = existing.find((o) => o.isHost);
          const hostTargetCount = hostRecord?.mode ? MIN_PLAYERS[hostRecord.mode] : targetCount;
          if (hostRecord && seat >= hostTargetCount) {
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
          ...(isHost ? { isHost: true, mode: modeRef.current, timeLimitMode: timeLimitModeRef.current, coinVisibility: coinVisibilityRef.current } : {}),
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
  const knownMode = host?.mode ?? mode;
  const knownTargetPlayerCount = MIN_PLAYERS[knownMode];
  const knownTimeLimitMode = host?.timeLimitMode ?? timeLimitMode;
  const knownCoinVisibility = host?.coinVisibility ?? coinVisibility;
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
      ...(isHost ? { isHost: true, mode: modeRef.current, timeLimitMode: timeLimitModeRef.current, coinVisibility: coinVisibilityRef.current } : {}),
    } satisfies Occupant);
  }, [occupants, mySeat, phase, deviceId, roomCode, myName, myPlayerId, isHost]);

  const sendGameStart = useCallback(() => {
    startSentRef.current = true;
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: {
        seed: randomSeed(),
        mode: modeRef.current,
        timeLimitMode: timeLimitModeRef.current,
        coinVisibility: coinVisibilityRef.current,
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
      const emptySeats = Array.from({ length: knownTargetPlayerCount }, (_, seat) => seat as SeatIndex).filter((seat) => !taken.has(seat));
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

  const names: Record<SeatIndex, string> = useMemo(() => {
    const map: Record<SeatIndex, string> = {};
    const count = gameState?.players.length ?? knownTargetPlayerCount;
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

  const ids: Record<SeatIndex, string> = useMemo(() => {
    const map: Record<SeatIndex, string> = {};
    const count = gameState?.players.length ?? knownTargetPlayerCount;
    for (let seat = 0; seat < count; seat++) {
      const occ = occupants.find((o) => o.seat === seat);
      map[seat] = occ?.playerId ?? `${roomCode}:${seat}`;
    }
    return map;
  }, [roomCode, gameState, knownTargetPlayerCount, occupants]);

  const connectedSeats = useMemo(() => new Set([...occupants.map((o) => o.seat), ...botSeats]), [occupants, botSeats]);

  const chooseAction = useCallback((state: GreatLegacyState, actor: SeatIndex): EngineAction | null => {
    const idx = botSeatsRef.current.indexOf(actor);
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return chooseBotAction(state, actor, level);
  }, []);

  useBotAutoplay<GreatLegacyState, EngineAction, SeatIndex>({
    active: isHost && phase === "playing",
    state: gameState,
    currentActor,
    botSeats: botSeatSet,
    chooseAction,
    dispatch: handleAction,
  });

  // Turn-timeout watchdog (host-only) — confirmed rule: "이탈한 경우는
  // 기다렸다가 진행 혹은 시간초과모드인 경우 시간초과시 포기, 패스로 해주세요".
  // "제한시간 없음" never force-passes anyone (a stuck human, connected or
  // not, is simply waited on); a timed mode auto-passes whoever's turn has
  // exceeded their limit, whether they're slow or genuinely disconnected —
  // the timer doesn't distinguish the two, by design.
  useEffect(() => {
    if (phase !== "playing" || !isHost) return;
    const limitSeconds = TIME_LIMIT_SECONDS[timeLimitModeRef.current];
    if (!limitSeconds) return;
    const interval = window.setInterval(() => {
      const state = gameStateRef.current;
      if (!state) return;
      const actor = currentActor(state);
      if (actor !== lastActorRef.current.actor) {
        lastActorRef.current = { actor, since: Date.now() };
        return;
      }
      if (actor === null) return;
      if (botSeatsRef.current.includes(actor)) return; // bots act through useBotAutoplay, not this watchdog
      if (Date.now() - lastActorRef.current.since < limitSeconds * 1000) return;
      channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action: { type: "pass", seat: actor } } });
      lastActorRef.current = { actor, since: Date.now() }; // avoid re-firing every tick if the broadcast round-trip is slow
    }, 1000);
    return () => window.clearInterval(interval);
  }, [phase, isHost]);

  function handleGameEnd() {
    if (!gameState || gameState.phase !== "gameOver") return;
    const rankings = computeRankings(gameState);
    const winners = rankings.filter((r) => r.rank === 1);
    onComplete({
      rankings: rankings.map((r) => ({ playerId: ids[r.seat], rank: r.rank })),
      finishedAt: new Date().toISOString(),
    });
    setFinalResult({ winnerName: names[winners[0].seat], tied: winners.length > 1 });
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
    setPhase("choose");
  }

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";

  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(roomCode !== null, handleLeave);
  useBackgroundResync(roomCode !== null, requestStateSync);
  useActiveRoomListing({
    gameId: "great-legacy",
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

  if (phase === "supabase-missing") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 light:border-amber-300 light:bg-amber-50 p-8 text-center">
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80 light:text-amber-800">위대한 유산은 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.</p>
      </div>,
    );
  }

  if (phase === "room-full") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 light:border-rose-300 light:bg-rose-50 p-8 text-center">
        <span className="text-3xl">🚫</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">이미 다른 사람이 참여 중인 방이에요</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
          처음으로
        </button>
      </div>,
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
      </div>,
    );
  }

  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId="great-legacy"
        icon="🏛️"
        title="위대한 유산 온라인 대전"
        description={<p className="text-sm text-white/50 light:text-slate-500">4인 또는 8인이 각자 기기로 접속해서 실시간 경매를 벌여요.</p>}
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
                setPhase("enter-name");
              }}
              className="w-full rounded-xl border border-white/15 light:border-slate-300 py-3 text-sm font-semibold text-white/80 light:text-slate-700 transition hover:border-white/30 light:hover:border-slate-400"
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
          <>
            <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              인원 모드
              <div className="flex gap-2">
                {(["4p", "8p"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`flex-1 rounded-xl border px-3 py-2 text-xs transition ${
                      mode === m
                        ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100 light:border-emerald-400 light:bg-emerald-50 light:text-emerald-700"
                        : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400"
                    }`}
                  >
                    <p className="font-semibold">{m === "4p" ? "👥 4인 (원작)" : "👥👥 8인 (리밸런싱)"}</p>
                    <p className="text-white/50 light:text-slate-500">{m === "4p" ? "140코인 · 22장 경매" : "110코인 · 25장 경매"}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              턴 제한시간
              <div className="flex gap-2">
                {(["none", "15s", "30s"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTimeLimitMode(t)}
                    className={`flex-1 rounded-xl border px-3 py-2 text-xs transition ${
                      timeLimitMode === t
                        ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100 light:border-emerald-400 light:bg-emerald-50 light:text-emerald-700"
                        : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400"
                    }`}
                  >
                    {t === "none" ? "제한 없음" : t === "15s" ? "15초" : "30초"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              코인 공개 모드
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCoinVisibility("secret")}
                  className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs transition ${
                    coinVisibility === "secret"
                      ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100 light:border-emerald-400 light:bg-emerald-50 light:text-emerald-700"
                      : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400"
                  }`}
                >
                  <p className="font-semibold">🔒 비밀 모드</p>
                  <p className="text-white/50 light:text-slate-500">내 코인만 나에게 보임</p>
                </button>
                <button
                  type="button"
                  onClick={() => setCoinVisibility("public")}
                  className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs transition ${
                    coinVisibility === "public"
                      ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100 light:border-emerald-400 light:bg-emerald-50 light:text-emerald-700"
                      : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400"
                  }`}
                >
                  <p className="font-semibold">👁️ 공개 모드</p>
                  <p className="text-white/50 light:text-slate-500">모두의 코인이 공개됨</p>
                </button>
              </div>
            </div>
          </>
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
      </div>,
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
              {occupants.length + botSeats.length} / {knownTargetPlayerCount}명 참여 중 ({knownMode === "4p" ? "4인 모드" : "8인 모드"})
            </p>
            {isHost && occupants.length + botSeats.length < knownTargetPlayerCount && (
              <FillEmptySeatsButton emptyCount={knownTargetPlayerCount - occupants.length - botSeats.length} onFill={fillEmptySeatsWithBots} />
            )}
            <p className="text-xs text-white/40 light:text-slate-400">
              {knownTimeLimitMode === "none" ? "⏱️ 제한시간 없음" : `⏱️ 턴당 ${TIME_LIMIT_SECONDS[knownTimeLimitMode]}초 제한`} ·{" "}
              {knownCoinVisibility === "public" ? "👁️ 공개 모드" : "🔒 비밀 모드"}
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {Array.from({ length: knownTargetPlayerCount }, (_, seat) => {
                const occ = occupants.find((o) => o.seat === seat);
                const botIdx = botSeats.indexOf(seat);
                const isBot = botIdx >= 0;
                return (
                  <div key={seat} className="flex items-center justify-between gap-3 text-sm text-white/70 light:text-slate-600">
                    <span className="flex items-center gap-1.5">
                      {occ && <Avatar size={20} />}
                      {seat === mySeat ? "나" : `${seat + 1}번`}:{" "}
                      {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30 light:text-slate-400">대기 중...</span>}
                    </span>
                    {isHost && seat !== mySeat && !occ && (isBot ? <RemoveBotButton onClick={() => removeBotAtSeat(seat)} /> : <AddBotButton onAddWithLevel={(level) => addBotAtSeat(seat, level)} />)}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-white/40 light:text-slate-400">{knownTargetPlayerCount}명이 모이면 자동으로 게임이 시작됩니다. AI 봇으로도 채울 수 있어요.</p>
          </>
        )}
      </div>,
    );
  }

  if (phase === "playing" && gameState && mySeat !== null) {
    return withGuard(
      <GreatLegacyBoard state={gameState} viewerSeat={mySeat} names={names} connectedSeats={connectedSeats} onAction={handleAction} onGameEnd={handleGameEnd} />,
    );
  }

  if (phase === "post-game" && finalResult) {
    return withGuard(
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white/90 light:shadow-sm p-8 text-center">
        <span className="text-4xl">🏆</span>
        <p className="text-white/80 light:text-slate-700">
          {finalResult.winnerName}
          {finalResult.tied ? " 님 외 공동 우승으로 게임이 끝났어요." : " 님 우승으로 게임이 끝났어요."}
        </p>
        <div className="flex gap-2">
          <button onClick={handleLeave} className="rounded-xl border border-white/15 light:border-slate-300 px-4 py-2.5 text-sm text-white/70 light:text-slate-600 hover:border-white/30 light:hover:border-slate-400">
            나가기
          </button>
          <button onClick={handleRematch} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
            다시하기
          </button>
        </div>
      </div>,
    );
  }

  return withGuard(null);
}
