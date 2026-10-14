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
  BUILD_SECONDS_OPTIONS,
  DEFAULT_OPTIONS,
  MODE_INFO,
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROUND_OPTIONS,
  applyAction,
  botDelayMs,
  chooseBotWord,
  closedTopicOf,
  computeRankings,
  phaseDurationMs,
  reviewComplete,
  topicPool,
  minAnswersFor,
  fittingTopicCount,
  startGame,
  winnerSeats,
  type EngineAction,
  type GameOptions,
  type GameState,
  type Seat,
} from "./engine";
import WordTowerBoard from "./WordTowerBoard";
import { categoriesFor } from "./categories";
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
import { acceptSync, actingHostOf, judgeOrdered, type OrderedCursor } from "./actionOrder";

/**
 * 단어 마천루 온라인 대전 진입점 — 라이어를 찾아라와 같은 락스텝 패턴(docs/cloud-sync.md).
 * 방장이 시드+옵션을 브로드캐스트하면 모든 기기가 `startGame`으로 같은 주제 순서를
 * 재현하고, 이후 `EngineAction`만 주고받는다.
 *
 * 행동 순서는 방장이 정한다(actionOrder.ts): 손님은 `action-request`로 방장에게만 보내고,
 * 방장이 도착 순서대로 번호를 붙여 `game-action`으로 다시 방송한다. 모두가 번호 순서대로만
 * 적용하므로 정답 모으기의 선착순이 기기마다 어긋나지 않는다. 번호가 빠지면 상태를 다시 받는다.
 *
 * 방장 승계: 게임 중 방장(방을 만든 기기)이 나가면, 남은 사람 중 좌석 번호가 가장 낮은 기기가
 * "진행 담당"이 되어 번호 매기기·시간 초과·봇 단어를 이어받는다(`actingHostOf`, 모두가 같은 presence로
 * 같은 결론). 새 담당은 자기 상태를 `authoritative` 동기화로 한 번 뿌려 모두를 맞춘 뒤 이어 간다.
 * `game-action`에는 보낸 담당의 기기 id(`by`)가 실려, 지금 담당이 아닌 기기의 번호는 무시한다.
 *
 * 시간 제한: 각 기기가 "단계(stage)가 바뀐 걸 본 시각"부터 로컬로 재고, 방장 기기만
 * 시간이 다 되면 `TIMEOUT { stage }`를 보낸다(엔진이 옛 stage는 무시). 심사는 투표권 있는
 * 사람이 모두 투표하면 방장이 TIMEOUT을 앞당겨 보낸다.
 *
 * 봇: 쌓기 단계는 모두가 동시에 단어를 내므로 useBotAutoplay(한 번에 한 봇)가 아니라
 * 방장 기기의 타이머가 봇마다 "다음 단어 시각"을 따로 잰다. 심사에서 봇은 기권.
 *
 * 이탈/무응답 → 투표 기반 AI 봇 대체(botTakeover.ts). 무응답은 "2라운드 연속 단어 0개"
 * (엔진의 `idleStreak`)로 판단한다.
 */
const IDLE_STREAK_FOR_VOTE = 2;

type Occupant = {
  deviceId: string;
  seat: Seat;
  name: string;
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
  /** 방장이 고른 모드 — 대기실에서 손님도 볼 수 있게 presence에 싣는다. */
  mode?: GameOptions["mode"];
  categories?: readonly string[];
};

type Phase = "choose" | "enter-name" | "connecting" | "waiting" | "playing" | "post-game" | "room-full" | "supabase-missing" | "channel-error";

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredSeat(code: string): number | null {
  const v = window.localStorage.getItem(`word-tower-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`word-tower-seat-${code}`, String(seat));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
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

export default function WordTowerGame({ onComplete }: PlayableGameProps) {
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
  /** 방장: 다음에 붙일 번호. */
  const relaySeqRef = useRef(0);
  /** 모두: 이 판에서 마지막으로 적용한 방장 번호. */
  const cursorRef = useRef<OrderedCursor | null>(null);
  const lastGapSyncRef = useRef(0);
  /** 지금 진행 담당 기기 id(게임 중 방장 승계용). */
  const actingHostRef = useRef<string | null>(null);
  /** 담당에서 물러난 직후: 담당이 보내 주는 다음 동기화를 무조건 받는다. */
  const resyncFromHostRef = useRef(false);
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
    const channel = supabase.channel(`word-tower-room-${roomCode}`, {
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
      cursorRef.current = { game: seed, applied: 0 };
      relaySeqRef.current = 0;
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
      const cursor = cursorRef.current;
      if (!cursor) return;
      // 담당이 바뀌는 순간 옛 담당이 보낸 번호는 버린다(같은 번호에 다른 행동이 겹치지 않게).
      if (payload?.by !== undefined && actingHostRef.current !== null && payload.by !== actingHostRef.current) return;
      const verdict = judgeOrdered(cursor, payload?.game as number, payload?.seq as number);
      if (verdict === "gap") {
        // 중간 번호를 놓쳤다 — 순서가 어긋난 채 적용하지 말고 최신 상태를 다시 받는다.
        const now = Date.now();
        if (now - lastGapSyncRef.current > 1000) {
          lastGapSyncRef.current = now;
          channel.send({ type: "broadcast", event: "state-request", payload: {} });
        }
        return;
      }
      if (verdict !== "apply") return;
      cursor.applied += 1;
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    // 진행 담당만: 손님의 행동을 받은 순서대로 번호를 붙여 다시 방송
    channel.on("broadcast", { event: "action-request" }, ({ payload }) => {
      if (actingHostRef.current !== deviceId) return;
      const action = payload?.action as EngineAction | undefined;
      const cursor = cursorRef.current;
      if (!action || !cursor || payload?.game !== cursor.game) return;
      relaySeqRef.current = Math.max(relaySeqRef.current, cursor.applied) + 1;
      channel.send({ type: "broadcast", event: "game-action", payload: { action, game: cursor.game, seq: relaySeqRef.current, by: deviceId } });
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
            game: cursorRef.current?.game,
            seq: cursorRef.current?.applied ?? 0,
            from: deviceId,
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
      const game = payload?.game as number | undefined;
      const seq = (payload?.seq as number | undefined) ?? 0;
      if (game === undefined) return;
      // 새 진행 담당의 승계 동기화는 번호가 같거나 작아도 받는다(그 담당이 이제 기준).
      const fromHost = payload?.from !== undefined && payload.from === actingHostRef.current;
      const authoritative = fromHost && (payload?.authoritative === true || resyncFromHostRef.current);
      if (gameStateRef.current && !authoritative && !acceptSync(cursorRef.current, game, seq)) return;
      if (authoritative) resyncFromHostRef.current = false;
      cursorRef.current = { game, applied: seq };
      relaySeqRef.current = Math.max(relaySeqRef.current, seq);
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
          ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current, mode: optionsRef.current.mode, categories: optionsRef.current.categories } : {}),
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
  const hostCategories = host?.categories ?? [];
  const guestCategoryLabel = host?.mode
    ? categoriesFor(host.mode)
        .filter((c) => hostCategories.includes(c.id))
        .map((c) => `${c.emoji} ${c.name}`)
        .join(", ")
    : "";
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
      ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current, mode: optionsRef.current.mode, categories: optionsRef.current.categories } : {}),
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
    // 거의 동시에 들어온 두 사람이 같은 좌석을 잡으면(presence가 서로 아직 안 보일 때) 머릿수는 차도
    // 좌석은 모자란다 — 그대로 시작하면 한 명이 구경꾼이 된다. 좌석 번호가 모두 달라질 때까지 기다린다
    // (겹친 쪽은 좌석 다시 잡기 효과가 빈자리로 옮긴다).
    const seats = new Set([...occupants.map((o) => o.seat), ...botSeats]);
    if (seats.size === occupants.length + botSeats.length && seats.size >= knownTargetPlayerCount) {
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

  // 진행 담당: 게임 중엔 presence로 정한다(방장이 나가면 남은 사람 중 좌석 번호가 가장 낮은 기기).
  const actingHost = phase === "playing" ? (actingHostOf(occupants) ?? (isHost ? deviceId : null)) : isHost ? deviceId : null;
  const prevActingRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevActingRef.current;
    prevActingRef.current = actingHost;
    actingHostRef.current = actingHost;
    if (phase !== "playing" || prev === null || prev === actingHost) return;
    const channel = channelRef.current;
    const state = gameStateRef.current;
    const cursor = cursorRef.current;
    if (actingHost === deviceId && channel && state && cursor) {
      // 이어받았다 — 내 상태를 기준으로 모두를 맞춘다.
      channel.send({
        type: "broadcast",
        event: "state-sync",
        payload: { state, game: cursor.game, seq: cursor.applied, from: deviceId, authoritative: true, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current, botTakeover: botTakeoverRef.current },
      });
    } else if (prev === deviceId) {
      // 잠깐 담당이었다가 물러났다(presence가 잠시 어긋났던 경우) — 담당의 상태로 다시 맞춘다.
      resyncFromHostRef.current = true;
      requestStateSync();
    }
  }, [actingHost, phase, deviceId]);

  const handleAction = useCallback(
    (action: EngineAction) => {
      const cursor = cursorRef.current;
      if (!cursor) return;
      // 담당 자신의 행동도 손님과 똑같이 요청 → (서버를 거쳐 자기에게 돌아온 뒤) 번호 → 방송 경로를 탄다.
      // 바로 번호를 붙이면 담당의 답이 한 번 왕복만큼(실측 약 100ms) 빨라 선착순에서 유리해진다.
      channelRef.current?.send({ type: "broadcast", event: "action-request", payload: { action, game: cursor.game } });
    },
    [],
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

  const allBotSeatsRef = useRef<Set<Seat>>(allBotSeatSet);
  useEffect(() => {
    allBotSeatsRef.current = allBotSeatSet;
  }, [allBotSeatSet]);

  /** 심사에서 표를 낼 수 있는 사람 좌석(봇·봇 대체 자리 제외). */
  const voterSeats = useMemo(
    () => Array.from({ length: gameState?.seatCount ?? 0 }, (_, s) => s).filter((s) => !allBotSeatSet.has(s)),
    [gameState?.seatCount, allBotSeatSet],
  );
  const voterSeatsRef = useRef<Seat[]>(voterSeats);
  useEffect(() => {
    voterSeatsRef.current = voterSeats;
  }, [voterSeats]);

  // 단계 타이머 — 이 기기가 stage 변화를 본 시각 기준. 방장만 TIMEOUT을 보낸다.
  // 같은 인터벌에서 봇 단어 제출(방장만)과 무응답 봇 대체 투표도 처리한다.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [stageSeen, setStageSeen] = useState<{ stage: number; round: number; at: number } | null>(null);
  const stageSeenRef = useRef<{ stage: number; round: number; at: number } | null>(null);
  const timeoutSentRef = useRef<number | null>(null);
  /** 봇 좌석 → 다음 단어를 낼 시각. stage가 바뀌면 새로 잡는다. */
  const botClockRef = useRef<{ stage: number; next: Map<Seat, number> }>({ stage: -1, next: new Map() });
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
      const sendTimeout = () => {
        if (timeoutSentRef.current === state.stage) return;
        timeoutSentRef.current = state.stage;
        handleAction({ type: "TIMEOUT", stage: state.stage });
      };
      const duration = phaseDurationMs(state);
      const amHost = actingHostRef.current === getDeviceId();
      if (amHost && duration > 0 && now - seen.at >= duration) sendTimeout();
      if (amHost && state.phase === "review" && reviewComplete(state, voterSeatsRef.current) && now - seen.at >= 1200) sendTimeout();

      // 봇 단어 — 봇마다 따로 정한 시각이 되면 한 단어씩
      if (amHost && state.phase === "build") {
        const clock = botClockRef.current;
        if (clock.stage !== state.stage) {
          clock.stage = state.stage;
          clock.next = new Map();
        }
        for (const seat of allBotSeatsRef.current) {
          if (seat >= state.seatCount) continue;
          const idx = botSeatsRef.current.indexOf(seat);
          const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
          const at = clock.next.get(seat);
          if (at === undefined) {
            clock.next.set(seat, now + 600 + botDelayMs(level) * 0.6);
            continue;
          }
          if (now < at) continue;
          clock.next.set(seat, now + botDelayMs(level));
          const word = chooseBotWord(state, seat, level);
          if (word) handleAction({ type: "SUBMIT", seat, text: word });
        }
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
  }, [phase, roomCode, handleAction]);

  const deadlineMs = gameState && stageSeen && stageSeen.stage === gameState.stage && phaseDurationMs(gameState) > 0 ? stageSeen.at + phaseDurationMs(gameState) : null;

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
        const mine = gameState.history.flatMap((h) => h.entries.filter((e) => e.seat === seat));
        const closedRounds = gameState.history.filter((h) => closedTopicOf(h.topicId));
        return {
          roundWins: gameState.wins[seat] ?? 0,
          bestStreak: gameState.bestStreak[seat] ?? 0,
          maxHeight: Math.max(0, ...gameState.history.map((h) => h.heights[seat] ?? 0)),
          totalHeight: gameState.totals[seat] ?? 0,
          words: mine.filter((e) => !e.bonus && (e.status === "ok" || e.status === "approved")).length,
          approvedWords: mine.filter((e) => e.status === "approved").length,
          rejectedWords: mine.filter((e) => e.status === "rejected").length,
          completedTopics: closedRounds.filter((h) => h.entries.some((e) => e.seat === seat && e.bonus === true)).length,
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
    gameId: "word-tower",
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
        <p className="max-w-sm break-keep text-sm text-amber-100/80 light:text-amber-800">단어 마천루는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.</p>
      </div>,
    );
  }

  if (phase === "room-full") {
    return withGuard(
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-8 text-center light:shadow-sm">
        <span className="text-3xl">🚫</span>
        <h2 className="break-keep text-lg font-bold text-white light:text-slate-900">이미 다른 사람이 참여 중인 방이에요</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500">
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
        <button onClick={handleLeave} className="mt-2 rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500">
          다시 시도
        </button>
      </div>,
    );
  }

  if (phase === "choose") {
    return withGuard(
      <RulebookGate
        gameId="word-tower"
        icon="🏙️"
        title="단어 마천루 온라인 대전"
        description={<p className="break-keep text-sm text-white/50 light:text-slate-500">2~8명이 각자 기기로 접속해 주제에 맞는 단어를 동시에 쏟아내며 3D 탑을 쌓아요. 가장 높은 탑이 라운드 1등! 사전에 없는 단어는 다른 사람들이 투표로 심사해요. 인원이 모자라면 AI 봇으로 채울 수 있어요.</p>}
        actions={
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => {
                setIntent("create");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white transition hover:bg-sky-500"
            >
              🎲 방 만들기
            </button>
            <button
              onClick={() => {
                setIntent("join");
                trackGameEvent("word-tower", "invite_click");
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-sky-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400"
            />
          </label>
        )}
        {intent === "create" && (
          <>
            <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              게임 버전
              <div className="grid gap-2 sm:grid-cols-2">
                {(["open", "closed"] as const).map((m) => {
                  const info = MODE_INFO[m];
                  const on = options.mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setOptions((o) => ({ ...o, mode: m, buildSeconds: m === "closed" ? 45 : 60, categories: o.mode === m ? o.categories : [] }))}
                      aria-pressed={on}
                      className={`flex flex-col gap-1 rounded-2xl border-2 p-3 text-left transition ${
                        on
                          ? m === "open"
                            ? "border-sky-400/70 bg-sky-500/15 light:bg-sky-50"
                            : "border-amber-400/70 bg-amber-500/15 light:bg-amber-50"
                          : "border-white/10 hover:border-white/30 light:border-slate-200 light:hover:border-slate-400"
                      }`}
                    >
                      <span className="text-base font-black text-white light:text-slate-900">
                        {info.emoji} {info.name} {on && <span className="text-xs font-semibold text-sky-300 light:text-sky-700">✓ 선택됨</span>}
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
            <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              주제 카테고리 <span className="text-[11px] text-white/45 light:text-slate-400">여러 개 고를 수 있어요 · 고른 카테고리 안에서 주제가 무작위로 나와요</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setOpt("categories", [])}
                  aria-pressed={options.categories.length === 0}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${options.categories.length === 0 ? "border-sky-400/60 bg-sky-400/10 text-sky-100 light:text-sky-700" : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-500"}`}
                >
                  🎲 전체 랜덤
                </button>
                {categoriesFor(options.mode).map((c) => {
                  const on = options.categories.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setOpt("categories", on ? options.categories.filter((id) => id !== c.id) : [...options.categories, c.id])}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${on ? "border-sky-400/60 bg-sky-400/10 text-sky-100 light:text-sky-700" : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-500"}`}
                    >
                      {c.emoji} {c.name} <span className="opacity-60">{c.topicIds.length}</span>
                    </button>
                  );
                })}
              </div>
              {(() => {
                const pool = topicPool(options).length;
                return pool < options.rounds ? (
                  <span className="text-[11px] text-amber-300 light:text-amber-700">고른 카테고리의 주제가 {pool}개라 {pool}라운드로 진행해요</span>
                ) : (
                  <span className="text-[11px] text-white/45 light:text-slate-400">나올 수 있는 주제 {pool}개</span>
                );
              })()}
              {options.mode === "closed" && (
                <span className="break-keep text-[11px] text-amber-200/80 light:text-amber-700">
                  👥 {targetPlayerCount}명이면 정답이 <b>{minAnswersFor(targetPlayerCount)}개 이상</b>인 주제만 나와요 (해당 주제 {fittingTopicCount(options, targetPlayerCount)}개
                  {fittingTopicCount(options, targetPlayerCount) < Math.min(options.rounds, topicPool(options).length) ? " — 모자라면 정답이 많은 주제부터 채워요" : ""})
                </span>
              )}
            </div>
            <OptionRow label="라운드 수 (라운드마다 다른 주제)" value={options.rounds} options={ROUND_OPTIONS.map((r) => ({ value: r as number, label: `${r}라운드` }))} onChange={(v) => setOpt("rounds", v)} />
            <OptionRow label="쌓기 시간" value={options.buildSeconds} options={BUILD_SECONDS_OPTIONS.map((sec) => ({ value: sec as number, label: `${sec}초` }))} onChange={(v) => setOpt("buildSeconds", v)} />
          </>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 light:bg-rose-50 light:text-rose-700">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500">
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
            {!isHost && guestCategoryLabel && <p className="break-keep text-xs text-white/50 light:text-slate-500">주제: {guestCategoryLabel}</p>}
            {isHost && (
              <p className="break-keep text-xs text-white/40 light:text-slate-400">
                {Math.min(options.rounds, topicPool(options).length)}라운드 · 쌓기 {options.buildSeconds}초 ·{" "}
                {options.categories.length === 0 ? "전체 주제" : categoriesFor(options.mode).filter((c) => options.categories.includes(c.id)).map((c) => `${c.emoji} ${c.name}`).join(", ")}
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
              <button onClick={sendGameStart} className="rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500">
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
        <WordTowerBoard
          state={gameState}
          viewerSeat={mySeat}
          names={names}
          connectedSeats={connectedSeats}
          voterSeats={voterSeats}
          isHost={actingHost === deviceId}
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
          <button onClick={sendGameStart} className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500">
            다시하기
          </button>
        </div>
      </div>,
    );
  }

  return withGuard(null);
}
