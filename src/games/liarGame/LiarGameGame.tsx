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
  MODE_INFO,
  MAX_PLAYERS,
  MIN_PLAYERS,
  applyAction,
  chooseBotAction,
  computeRankings,
  pendingSeats,
  startGame,
  winnerSeats,
  type EngineAction,
  type GameOptions,
  type GameState,
  type Seat,
} from "./engine";
import { CATEGORIES, RANDOM_CATEGORY } from "./words";
import LiarGameBoard from "./LiarGameBoard";
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
import { withUniqueNames } from "@/games/shared/room/uniqueNames";
import { PHASE_DURATION_MS } from "./secure";
import { seatToken, startSecureMatch, storeMatchId, storedMatchId, useSecureMatch } from "@/lib/secureMatch/client";

/**
 * 라이어를 찾아라 온라인 대전 진입점 — 진실의 고개와 같은 락스텝 패턴(docs/cloud-sync.md).
 * 방장이 시드+옵션을 브로드캐스트하면 모든 기기가 `startGame`으로 같은 라운드 계획을
 * 재현하고, 이후 `EngineAction`만 주고받는다.
 *
 * 시간 제한: 각 기기가 "단계(stage)가 바뀐 걸 본 시각"부터 로컬로 재고, 방장 기기만
 * 시간이 다 되면 `TIMEOUT { stage }`를 보낸다(엔진이 옛 stage는 무시). 표시용 남은
 * 시간도 같은 기준이라 기기 간 시계 차이의 영향을 받지 않는다.
 *
 * 이탈/무응답 → 투표 기반 AI 봇 대체(botTakeover.ts). 무응답은 "연속 2번 시간 초과"
 * (엔진의 `idleStreak`)로 판단한다 — 이 게임은 단계마다 시간 제한이 있어서 다른 게임처럼
 * "차례가 45초 그대로"인 상황이 생기지 않기 때문.
 *
 * 🔒 서버 판정(secure.ts, src/lib/secureMatch): 서버가 준비돼 있고 모든 사람이 좌석 토큰
 * 해시를 갖고 있으면 시드를 뿌리지 않고 `/api/match`가 게임을 돌린다. 각 기기는 자기 좌석에
 * 보이는 상태만 받아서, 개발자도구로도 라이어·제시어·남의 설명을 볼 수 없다. 서버가
 * 준비 안 됐으면(503) 위의 락스텝으로 그대로 돌아간다.
 */
const IDLE_STREAK_FOR_VOTE = 2;

type Occupant = {
  deviceId: string;
  seat: Seat;
  name: string;
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
  /** 방장이 고른 버전 — 대기실에서 손님도 볼 수 있게 presence에 싣는다. */
  mode?: GameOptions["mode"];
  /** 서버 판정용 좌석 토큰의 SHA-256 — 토큰 자체는 이 기기에만 있다. */
  tokenHash?: string;
};

type Phase = "choose" | "enter-name" | "connecting" | "waiting" | "playing" | "post-game" | "room-full" | "supabase-missing" | "channel-error";

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredSeat(code: string): number | null {
  const v = window.localStorage.getItem(`liar-game-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`liar-game-seat-${code}`, String(seat));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

const ROUND_OPTIONS = [3, 5, 7, 10];

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
                ? "border-fuchsia-400/60 bg-fuchsia-400/10 text-fuchsia-100 light:text-fuchsia-700"
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

export default function LiarGameGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(5);
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [lockstepState, setGameState] = useState<GameState | null>(null);
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
  const [secureMatchId, setSecureMatchId] = useState<string | null>(null);
  const secureMatchIdRef = useRef<string | null>(null);
  const [seatTok, setSeatTok] = useState<{ token: string; hash: string } | null>(null);
  const secureRefreshRef = useRef<() => void>(() => {});
  function requestStateSync() {
    secureRefreshRef.current();
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
    const channel = supabase.channel(`liar-game-room-${roomCode}`, {
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
      secureMatchIdRef.current = null;
      setSecureMatchId(null);
      setGameState(startGame(playerCount, seed, roomOptions));
      setFinalWinners(null);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "match-start" }, ({ payload }) => {
      const matchId = payload?.matchId as string | undefined;
      if (!matchId) return;
      const fresh = secureMatchIdRef.current !== matchId;
      const roster = (payload?.botSeats as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      const takeover = payload?.botTakeover as BotTakeoverState | undefined;
      if (takeover || fresh) {
        botTakeoverRef.current = takeover ?? INITIAL_BOT_TAKEOVER_STATE;
        setBotTakeover(botTakeoverRef.current);
      }
      if (!fresh) return;
      secureMatchIdRef.current = matchId;
      setSecureMatchId(matchId);
      storeMatchId("liar-game", roomCode, `${Date.now()}|${matchId}`);
      setGameState(null);
      setFinalWinners(null);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "match-version" }, () => {
      secureRefreshRef.current();
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      if (secureMatchIdRef.current) return;
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
      if (secureMatchIdRef.current) {
        // 서버 판정 중엔 상태 대신 대전 id만 알려 준다 — 각자 자기 몫을 서버에서 받는다.
        channel.send({
          type: "broadcast",
          event: "match-start",
          payload: { matchId: secureMatchIdRef.current, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current, botTakeover: botTakeoverRef.current },
        });
      } else if (gameStateRef.current) {
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
      if (!state || secureMatchIdRef.current) return;
      // 이미 더 진행된 상태를 들고 있으면(재접속 응답이 늦게 온 경우) 덮어쓰지 않는다.
      const mine = gameStateRef.current;
      if (mine && mine.roundIndex === state.roundIndex && mine.stage > state.stage) return;
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
      setOccupants(withUniqueNames(Object.values(raw).flat()));
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
        const tok = await seatToken("liar-game", roomCode);
        setSeatTok(tok);
        // 새로고침 직후 남은 사람이 봇뿐이면 아무도 대전 id를 다시 알려 주지 않는다 — 이 기기 기록으로 이어 받는다.
        const stored = storedMatchId("liar-game", roomCode)?.split("|");
        if (stored?.length === 2 && Date.now() - Number(stored[0]) < 3 * 3600_000 && !secureMatchIdRef.current) {
          secureMatchIdRef.current = stored[1];
          setSecureMatchId(stored[1]);
          setPhase("playing");
        }
        await channel.track({
          deviceId,
          seat,
          name: myName,
          playerId: myPlayerId,
          ...(tok ? { tokenHash: tok.hash } : {}),
          ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current, mode: optionsRef.current.mode } : {}),
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
      ...(seatTok ? { tokenHash: seatTok.hash } : {}),
      ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current, mode: optionsRef.current.mode } : {}),
    } satisfies Occupant);
  }, [occupants, mySeat, phase, deviceId, roomCode, myName, myPlayerId, isHost, seatTok]);

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
    const legacyStart = () =>
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
    // 사람 좌석이 모두 토큰 해시를 갖고 있을 때만 서버 판정 — 옛 버전 탭이 섞이면 락스텝.
    const humans = occupantsRef.current.filter((o) => o.seat < count && !botSeatsRef.current.includes(o.seat));
    if (humans.length === 0 || humans.some((o) => !o.tokenHash)) {
      legacyStart();
      return;
    }
    const bots: Record<number, number> = {};
    botSeatsRef.current.forEach((seat, i) => {
      bots[seat] = botLevelsRef.current[i] ?? DEFAULT_BOT_LEVEL;
    });
    void startSecureMatch({
      game: "liar-game",
      playerCount: count,
      options: optionsRef.current,
      seatHashes: Object.fromEntries(humans.map((o) => [o.seat, o.tokenHash!])),
      bots,
    }).then((matchId) => {
      if (!matchId) {
        legacyStart();
        return;
      }
      channelRef.current?.send({
        type: "broadcast",
        event: "match-start",
        payload: { matchId, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current },
      });
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

  // 서버 판정: 마감·봇 차례를 서버에 먼저 알리는 순서 — 보통 첫 번째 사람만 보낸다.
  const humanRank = useMemo(() => {
    const seats = occupants
      .map((o) => o.seat)
      .filter((s) => !(String(s) in botTakeover.takeovers))
      .sort((a, b) => a - b);
    return Math.max(0, mySeat === null ? 0 : seats.indexOf(mySeat));
  }, [occupants, botTakeover, mySeat]);
  const secure = useSecureMatch<GameState>({
    matchId: secureMatchId,
    seat: mySeat,
    token: seatTok?.token ?? null,
    tickerRank: humanRank,
    announce: (version) => channelRef.current?.send({ type: "broadcast", event: "match-version", payload: { version } }),
  });
  useEffect(() => {
    secureRefreshRef.current = secure.refresh;
  }, [secure.refresh]);
  // 서버 판정이면 서버가 준 내 몫의 상태, 아니면 락스텝으로 직접 계산한 상태.
  const gameState = secureMatchId ? secure.view : lockstepState;
  useEffect(() => {
    gameStateRef.current = gameState;
    // 끝난 판은 새로고침해도 다시 열지 않는다(결과가 두 번 기록되지 않게).
    if (secureMatchId && gameState?.phase === "ended" && roomCode) storeMatchId("liar-game", roomCode, "");
  }, [gameState, secureMatchId, roomCode]);

  const secureAct = secure.act;
  const handleAction = useCallback(
    (action: EngineAction) => {
      if (secureMatchIdRef.current) secureAct(action);
      else channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action } });
    },
    [secureAct],
  );

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

  // 서버 판정 중 봇 대체/되찾기 — 봇은 서버가 돌리므로 바뀐 명단을 알린다(같은 명단이면 서버가 무시).
  const secureSetBots = secure.setBots;
  useEffect(() => {
    if (!secureMatchId) return;
    const bots: Record<number, number> = {};
    botSeatsRef.current.forEach((seat, i) => {
      bots[seat] = botLevelsRef.current[i] ?? DEFAULT_BOT_LEVEL;
    });
    for (const seat of takeoverSeats) bots[seat] = DEFAULT_BOT_LEVEL;
    secureSetBots(bots);
  }, [secureMatchId, takeoverSeats, secureSetBots]);

  // 동시 행동 단계(토론 준비·투표)가 있어서 "지금 결정할 봇"은 대기 좌석 중 첫 번째 봇이다.
  // 봇 한 명이 행동할 때마다 상태가 바뀌므로 다음 봇이 이어서 행동한다.
  const currentActor = useCallback((state: GameState): Seat | null => pendingSeats(state).find((s) => allBotSeatSet.has(s)) ?? null, [allBotSeatSet]);

  const chooseAction = useCallback((state: GameState, actor: Seat): EngineAction | null => {
    const idx = botSeatsRef.current.indexOf(actor);
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return chooseBotAction(state, actor, level);
  }, []);

  useBotAutoplay<GameState, EngineAction, Seat>({
    active: isHost && phase === "playing" && !secureMatchId,
    state: gameState,
    currentActor,
    botSeats: allBotSeatSet,
    chooseAction,
    dispatch: handleAction,
    minDelayMs: 1200,
    maxDelayMs: 3200,
  });

  // 단계 타이머 — 이 기기가 stage 변화를 본 시각 기준. 방장만 TIMEOUT을 보낸다.
  // 같은 인터벌에서 무응답(연속 시간 초과) 봇 대체 투표도 시작한다.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [stageSeen, setStageSeen] = useState<{ stage: number; round: number; at: number } | null>(null);
  const stageSeenRef = useRef<{ stage: number; round: number; at: number } | null>(null);
  const timeoutSentRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      const state = gameStateRef.current;
      if (!state) return;
      const seen = stageSeenRef.current;
      if (!seen || seen.stage !== state.stage || seen.round !== state.roundIndex) {
        const next = { stage: state.stage, round: state.roundIndex, at: now };
        stageSeenRef.current = next;
        setStageSeen(next);
        return;
      }
      const duration = PHASE_DURATION_MS[state.phase];
      if (isHost && !secureMatchIdRef.current && duration > 0 && now - seen.at >= duration && timeoutSentRef.current !== state.stage) {
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

  const deadlineMs = secureMatchId
    ? secure.deadlineMs
    : gameState && stageSeen && stageSeen.stage === gameState.stage && PHASE_DURATION_MS[gameState.phase] > 0
      ? stageSeen.at + PHASE_DURATION_MS[gameState.phase]
      : null;

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
        const asLiar = gameState.history.filter((h) => h.liarSeat === seat);
        const asCitizen = gameState.history.filter((h) => h.liarSeat !== seat);
        return {
          liarRounds: asLiar.length,
          liarEscapes: asLiar.filter((h) => h.reason === "wrongAccuse" || h.reason === "tie").length,
          liarGuesses: asLiar.filter((h) => h.reason === "guessed").length,
          citizenRounds: asCitizen.length,
          citizenWins: asCitizen.filter((h) => h.winner === "citizens").length,
          correctVotes: asCitizen.filter((h) => h.firstVotes[seat] === h.liarSeat).length,
          maxScore: gameState.scores[seat] ?? 0,
        };
      }),
      finishedAt: new Date().toISOString(),
    });
    setFinalWinners(winnerSeats(gameState));
    if (roomCode) storeMatchId("liar-game", roomCode, "");
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
    secureMatchIdRef.current = null;
    setSecureMatchId(null);
    setSeatTok(null);
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
    gameId: "liar-game",
    roomCode,
    isHost,
    isWaiting: phase === "waiting",
    isPlaying: phase === "playing",
    hostName: myName,
    playerCount: occupants.length,
    occupants,
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
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 text-center light:shadow-sm">
        <span className="text-3xl">⚠️</span>
        <h2 className="break-keep text-lg font-bold text-white light:text-slate-900">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm break-keep text-sm text-amber-100/80 light:text-amber-800">라이어를 찾아라는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.</p>
      </div>,
    );
  }

  if (phase === "room-full") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center light:shadow-sm">
        <span className="text-3xl">🚫</span>
        <h2 className="break-keep text-lg font-bold text-white light:text-slate-900">이미 다른 사람이 참여 중인 방이에요</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-fuchsia-600 px-5 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500">
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
        <button onClick={handleLeave} className="mt-2 rounded-full bg-fuchsia-600 px-5 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500">
          다시 시도
        </button>
      </div>,
    );
  }

  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId="liar-game"
        icon="🎭"
        title="라이어를 찾아라 온라인 대전"
        description={<p className="break-keep text-sm text-white/50 light:text-slate-500">3~10명이 각자 기기로 접속해 제시어를 설명하고 라이어를 찾아요. 🎭 라이어가 알고 시작하는 버전과 🤪 라이어도 모르고 시작하는 버전 중 골라요. 인원이 모자라면 AI 봇으로 채울 수 있어요.</p>}
        actions={
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => {
                setIntent("create");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl bg-fuchsia-600 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-500"
            >
              🎲 방 만들기
            </button>
            <button
              onClick={() => {
                setIntent("join");
                trackGameEvent("liar-game", "invite_click");
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-fuchsia-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400"
            />
          </label>
        )}
        {intent === "create" && (
          <>
            <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              게임 버전
              <div className="grid gap-2 sm:grid-cols-2">
                {(["classic", "fool"] as const).map((m) => {
                  const info = MODE_INFO[m];
                  const on = options.mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setOpt("mode", m)}
                      aria-pressed={on}
                      className={`flex flex-col gap-1 rounded-2xl border-2 p-3 text-left transition ${
                        on
                          ? m === "classic"
                            ? "border-rose-400/70 bg-rose-500/15 light:bg-rose-50"
                            : "border-amber-400/70 bg-amber-500/15 light:bg-amber-50"
                          : "border-white/10 hover:border-white/30 light:border-slate-200 light:hover:border-slate-400"
                      }`}
                    >
                      <span className="text-base font-black text-white light:text-slate-900">
                        {info.emoji} {info.name} {on && <span className="text-xs font-semibold text-fuchsia-300 light:text-fuchsia-700">✓ 선택됨</span>}
                      </span>
                      <span className="text-xs font-semibold text-white/70 light:text-slate-600">{info.short}</span>
                      <span className="break-keep text-[11px] leading-snug text-white/50 light:text-slate-500">{info.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              인원 수 ({MIN_PLAYERS}~{MAX_PLAYERS}명)
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
            <OptionRow label="라운드 수" value={options.rounds} options={ROUND_OPTIONS.map((r) => ({ value: r, label: `${r}라운드` }))} onChange={(v) => setOpt("rounds", v)} />
            <OptionRow
              label="설명 바퀴 수"
              value={options.laps}
              options={[
                { value: 1 as const, label: "1바퀴 (빠르게)" },
                { value: 2 as const, label: "2바퀴 (시민 유리)" },
              ]}
              onChange={(v) => setOpt("laps", v)}
            />
            <OptionRow
              label="라이어 정답 맞히기"
              value={options.guessMode}
              options={[
                { value: "choice" as const, label: "🔢 6지선다" },
                { value: "text" as const, label: "✍️ 직접 입력" },
              ]}
              onChange={(v) => setOpt("guessMode", v)}
            />
            <OptionRow
              label="카테고리"
              value={options.category}
              options={[{ value: RANDOM_CATEGORY, label: "🎲 랜덤" }, ...CATEGORIES.map((c) => ({ value: c.id, label: `${c.emoji} ${c.name}` }))]}
              onChange={(v) => setOpt("category", v)}
            />
          </>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 light:bg-rose-50 light:text-rose-700">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-fuchsia-600 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500">
            {intent === "create" ? "방 만들기" : "참여하기"}
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
            {(() => {
              const roomMode = (isHost ? options.mode : host?.mode) ?? null;
              return roomMode ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 light:border-slate-200 light:bg-slate-50">
                  <p className="text-lg font-black text-white light:text-slate-900">
                    {MODE_INFO[roomMode].emoji} {MODE_INFO[roomMode].name}
                  </p>
                  <p className="text-xs text-white/60 light:text-slate-500">{MODE_INFO[roomMode].short}</p>
                </div>
              ) : null;
            })()}
            {isHost && (
              <p className="break-keep text-xs text-white/40 light:text-slate-400">
                {options.rounds}라운드 · {options.laps}바퀴 · {options.guessMode === "choice" ? "6지선다" : "직접 입력"} ·{" "}
                {options.category === RANDOM_CATEGORY ? "랜덤 카테고리" : CATEGORIES.find((c) => c.id === options.category)?.name}
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
              <button onClick={sendGameStart} className="rounded-full bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white hover:bg-fuchsia-500">
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
        <LiarGameBoard
          state={gameState}
          viewerSeat={mySeat}
          names={names}
          connectedSeats={connectedSeats}
          deadlineMs={deadlineMs}
          nowMs={nowMs}
          onAction={handleAction}
          onGameEnd={handleGameEnd}
        />
      </>,
    );
  }

  if (phase === "post-game" && finalWinners) {
    return withGuard(
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center light:border-slate-200 light:bg-white light:shadow-sm">
        <span className="text-4xl">🏆</span>
        <p className="break-keep text-white/80 light:text-slate-700">{finalWinners.map((s) => names[s]).join(", ")}님의 우승으로 게임이 끝났어요.</p>
        <div className="flex gap-2">
          <button onClick={handleLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
            나가기
          </button>
          <button onClick={sendGameStart} className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500">
            다시하기
          </button>
        </div>
      </div>,
    );
  }

  return withGuard(null);
}
