"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
import { applyAction, chooseBotAction, startGame, type BangState, type EngineAction, type SeatIndex, type Team } from "./engine";
import BangBoard from "./BangBoard";
import { deriveCenterEvent, type CenterPlayEvent } from "./BangEffects";
import { useBotAutoplay } from "@/games/shared/bot/useBotAutoplay";
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
import { AddBotButton, BotSeatBadge, RemoveBotButton } from "@/components/lobby/BotSeatControls";
import { DEFAULT_BOT_LEVEL, type BotLevel } from "@/games/shared/bot/botDifficulty";

/**
 * Whose decision `useBotAutoplay` should drive right now. `pending`'s
 * "group" response (Bang/Gatling/Indians) can have several outstanding
 * responders at once — same "lowest still-undecided seat" workaround every
 * other simultaneous-decision phase in this project uses; duel/general-store
 * already track a single responder directly.
 */
function bangCurrentActor(state: BangState): SeatIndex | null {
  if (state.winner) return null;
  if (state.pending) {
    const pending = state.pending;
    if (pending.kind === "group") return pending.outstanding.length > 0 ? Math.min(...pending.outstanding) : null;
    if (pending.kind === "duel") return pending.turnToRespond;
    return pending.pickOrder[pending.nextPickIndex] ?? null; // general-store
  }
  if (state.turnPhase === "begin-turn" || state.turnPhase === "action") return state.turnSeat;
  return null;
}

/**
 * Online-room multiplayer entry point, generalizing HanamikojiGame's 2-seat
 * pattern to 4-8 seats. Same trust model: every client independently
 * computes the full `BangState` (all hands, all secret roles) from a shared
 * RNG seed plus replayed `EngineAction`s broadcast over Supabase Realtime —
 * there is no server-authoritative engine. See README for the accepted
 * trade-off (a technically inclined player could inspect their own client
 * state to see others' roles/hands).
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
  const v = window.localStorage.getItem(`bang-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`bang-seat-${code}`, String(seat));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export default function BangGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(5);
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<BangState | null>(null);
  const [finalResult, setFinalResult] = useState<{ winner: Team } | null>(null);
  // Queue of "a card was just played" flourishes for BangBoard's
  // CenterPlayBanner (see BangEffects.tsx's module doc) — appended to
  // whenever the "game-action" handler below sees a qualifying action, drained
  // one at a time by BangBoard as each banner finishes its ~1.8s display.
  // Reset on every fresh/resynced game so a stale banner never survives into
  // the next hand (see the "game-start"/"state-sync" handlers below).
  const [centerEvents, setCenterEvents] = useState<CenterPlayEvent[]>([]);
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

  const channelRef = useRef<RealtimeChannel | null>(null);
  const startSentRef = useRef(false);
  const playerCountRef = useRef(targetPlayerCount);
  const isHost = intent === "create";

  // Kept in sync so the `state-request` broadcast handler (registered once,
  // inside the channel-setup effect below) always sees the latest state
  // instead of the stale value it would otherwise close over.
  const gameStateRef = useRef<BangState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

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
    const channel = supabase.channel(`bang-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

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
      setGameState(startGame(playerCount, seed));
      setFinalResult(null);
      setCenterEvents([]);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      // Derived from the state as it was JUST BEFORE this action (gameStateRef
      // is only updated after a commit — see its own comment above — so at
      // the moment this broadcast callback runs it still holds the prior
      // snapshot, same trust already placed in it by the "state-request"
      // handler below).
      const prev = gameStateRef.current;
      if (prev) {
        const event = deriveCenterEvent(prev, action);
        // Cap the backlog at 3 so a burst of rapid-fire bot actions (see
        // useBotAutoplay's 500-1500ms "thinking" delay) can't queue up an
        // ever-growing trail of banners the viewer is still catching up on.
        if (event) setCenterEvents((q) => [...q.slice(-2), event]);
      }
      setGameState((p) => (p ? applyAction(p, action) : p));
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
          payload: { state: gameStateRef.current, botSeats: botSeatsRef.current, botLevels: botLevelsRef.current },
        });
      } else if (isHost) {
        channel.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: botSeatsRef.current, botLevels: botLevelsRef.current } });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const state = payload?.state as BangState | undefined;
      if (!state) return;
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botSeatsRef.current = roster;
      setBotSeats(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      setGameState(state);
      setFinalResult(null);
      setCenterEvents([]);
      setPhase("playing");
    });

    // Resolves the first time a presence "sync" fires, so seat-claiming below
    // can wait for at least one real snapshot instead of reading
    // `presenceState()` the instant SUBSCRIBED fires — that state is not
    // guaranteed to reflect earlier joiners yet, and claiming a seat from an
    // empty-but-stale snapshot is what let two near-simultaneous joiners both
    // claim seat 0 (a real bug caught by multi-tab testing, not a hypothetical).
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
        channel.send({ type: "broadcast", event: "state-request", payload: {} });
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
  // instant (presence sync isn't guaranteed to reflect an earlier joiner by
  // the time a later one claims its seat — see the comment on `firstSync`
  // above). Rather than immediately failing the room, self-heal with a
  // deterministic tie-break: whichever device has the lexicographically
  // larger id gives up the seat and claims the next free one. Only after a
  // few failed attempts (or once the game has actually started, when
  // reseating no longer makes sense) do we fall back to "room-full", which
  // is now reserved for the genuine case — a stale seat from an unrelated
  // past session in this same room code.
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

  // Host deals the first hand as soon as the target seat count is filled (a
  // seat counts as "filled" whether it's a connected human or a bot the
  // host added).
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

  const chooseAction = useCallback((state: BangState, actor: SeatIndex): EngineAction | null => {
    const idx = botSeatsRef.current.indexOf(actor);
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return chooseBotAction(state, actor, level);
  }, []);

  useBotAutoplay<BangState, EngineAction, SeatIndex>({
    active: isHost && phase === "playing",
    state: gameState,
    currentActor: bangCurrentActor,
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

  const connectedSeats = useMemo(
    () => new Set([...occupants.map((o) => o.seat), ...botSeats]),
    [occupants, botSeats],
  );

  function handleGameEnd() {
    if (!gameState || !gameState.winner) return;
    const winner = gameState.winner;
    const rankings = gameState.turnOrder.map((seat) => {
      const p = gameState.players[seat];
      const isWinner =
        winner === "renegade"
          ? p.role === "renegade" && p.alive
          : winner === "outlaw"
            ? p.role === "outlaw"
            : p.role === "sheriff" || p.role === "deputy";
      return { playerId: ids[seat], rank: isWinner ? 1 : 2 };
    });
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
    setCenterEvents([]);
    setIdentity({ name: "" });
    setMyPlayerId(undefined);
    setCodeInput("");
    botSeatsRef.current = [];
    setBotSeats([]);
    botLevelsRef.current = [];
    setBotLevels([]);
    setPhase("choose");
  }

  const shareUrl =
    typeof window !== "undefined" && roomCode
      ? `${window.location.origin}${window.location.pathname}?room=${roomCode}`
      : "";

  if (phase === "supabase-missing") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 text-center">
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80">
          뱅!은 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">.env.local</code>
          에 <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code> /
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
          를 채워주세요 (README 참고).
        </p>
      </div>
    );
  }

  if (phase === "room-full") {
    return (
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
    return (
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
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">🤠</span>
        <h2 className="text-lg font-bold text-white">뱅! 온라인 대전</h2>
        <p className="text-sm text-white/50">4~8명이 각자 기기로 접속해서 실시간으로 플레이해요.</p>
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
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-base font-bold text-white">{intent === "create" ? "방 만들기" : "초대 코드로 참여"}</h2>
        <div className="flex flex-col gap-1.5 text-sm text-white/70">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} accent="amber" />
        </div>
        {intent === "join" && (
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
            초대 코드 (4자리)
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="0000"
              inputMode="numeric"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-amber-400 focus:outline-none"
            />
          </label>
        )}
        {intent === "create" && (
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
            인원 수 (4~8명)
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTargetPlayerCount((n) => Math.max(4, n - 1))}
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
    return (
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
            {isHost && occupants.length + botSeats.length >= 4 && occupants.length + botSeats.length < knownTargetPlayerCount && (
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
    );
  }

  if (phase === "playing" && gameState && mySeat !== null) {
    return (
      <BangBoard
        state={gameState}
        viewerSeat={mySeat}
        names={names}
        connectedSeats={connectedSeats}
        onAction={handleAction}
        onGameEnd={handleGameEnd}
        centerEvents={centerEvents}
        onCenterEventDone={(id) => setCenterEvents((q) => q.filter((e) => e.id !== id))}
      />
    );
  }

  if (phase === "post-game" && finalResult) {
    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">🏆</span>
        <p className="text-white/80">
          {finalResult.winner === "law" ? "보안관 팀" : finalResult.winner === "outlaw" ? "무법자 팀" : "배신자"} 승리로
          게임이 끝났어요.
        </p>
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
    );
  }

  return null;
}
