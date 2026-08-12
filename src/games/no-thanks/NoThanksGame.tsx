"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
import {
  applyAction,
  chooseBotAction,
  computeRankings,
  MIN_PLAYERS,
  startGame,
  type ChipVisibility,
  type EngineAction,
  type NoThanksState,
  type SeatIndex,
} from "./engine";
import NoThanksBoard from "./NoThanksBoard";
import { useBotAutoplay } from "@/games/shared/bot/useBotAutoplay";
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
import { AddBotButton, BotSeatBadge, RemoveBotButton } from "@/components/lobby/BotSeatControls";

/** Whose decision is pending, for `useBotAutoplay` — No Thanks has no sub-phase like Hanamikoji's response offers, so this is just the active seat. */
function noThanksCurrentActor(state: NoThanksState): SeatIndex | null {
  return state.phase === "playing" ? state.activeSeat : null;
}

function noThanksChooseAction(state: NoThanksState, actor: SeatIndex): EngineAction | null {
  return chooseBotAction(state, actor);
}

/**
 * Online-room multiplayer entry point, same lockstep pattern as
 * AvalonGame/BangGame/GridPokerGame: every connected client independently
 * computes the full `NoThanksState` (every seat's private chip count) from a
 * shared RNG seed plus replayed `EngineAction`s broadcast over Supabase
 * Realtime — there is no server-authoritative engine. See engine.ts and
 * README for the accepted trust trade-off (a technically inclined player
 * could inspect their own client state to see everyone's chip count).
 */

type Occupant = {
  deviceId: string;
  seat: SeatIndex;
  name: string;
  /** Real betting-system playerId, present only when this occupant joined by picking themselves from an active betting session's roster — see RoomNicknameField. */
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
  /** Host's choice, see engine.ts's `ChipVisibility` — shown to waiting joiners so they know which mode they're about to play. */
  chipVisibility?: ChipVisibility;
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
  const v = window.localStorage.getItem(`no-thanks-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`no-thanks-seat-${code}`, String(seat));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export default function NoThanksGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(4);
  // Rulebook §2 "게임 모드 설정" — host-only choice made once before the room
  // fills up, applies identically to every seat (unlike the board's separate
  // local-only practice-reveal toggle). Defaults to the official rule.
  const [chipVisibility, setChipVisibility] = useState<ChipVisibility>("secret");
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<NoThanksState | null>(null);
  const [finalResult, setFinalResult] = useState<{ winnerName: string; tied: boolean } | null>(null);
  // Seats currently played by an AI bot instead of a human — host-controlled
  // (ARCHITECTURE.md §7), broadcast via "bot-roster" so every client renders
  // the same lobby/board without a server.
  const [botSeats, setBotSeats] = useState<SeatIndex[]>([]);
  const botSeatsRef = useRef<SeatIndex[]>([]);
  useEffect(() => {
    botSeatsRef.current = botSeats;
  }, [botSeats]);
  const botSeatSet = useMemo(() => new Set(botSeats), [botSeats]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const startSentRef = useRef(false);
  const playerCountRef = useRef(targetPlayerCount);
  const chipVisibilityRef = useRef(chipVisibility);
  const isHost = intent === "create";

  // Kept in sync so the `state-request` broadcast handler (registered once,
  // inside the channel-setup effect below) always sees the latest state
  // instead of the stale value it would otherwise close over.
  const gameStateRef = useRef<NoThanksState | null>(null);
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
    chipVisibilityRef.current = chipVisibility;
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
    const channel = supabase.channel(`no-thanks-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const playerCount = payload?.playerCount as number;
      const visibility = (payload?.chipVisibility as ChipVisibility | undefined) ?? "secret";
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      playerCountRef.current = playerCount;
      chipVisibilityRef.current = visibility;
      botSeatsRef.current = roster;
      setBotSeats(roster);
      setGameState(startGame(playerCount, seed, visibility));
      setFinalResult(null);
      setPhase("playing");
    });

    // Host-authoritative AI bot roster — broadcast whenever the host
    // adds/removes a bot seat in the waiting room (see `addBot`/`removeBot`
    // below), so every client renders the same lobby/board without a server.
    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      botSeatsRef.current = roster;
      setBotSeats(roster);
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
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
          payload: { state: gameStateRef.current, botSeats: botSeatsRef.current },
        });
      } else if (isHost) {
        // Pre-game reconnect: no match state to hand over yet, but the host
        // still owns the bot roster and should re-announce it so a rejoining
        // client's waiting room shows the same bot seats.
        channel.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: botSeatsRef.current } });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const state = payload?.state as NoThanksState | undefined;
      if (!state) return;
      const roster = (payload?.botSeats as SeatIndex[] | undefined) ?? [];
      botSeatsRef.current = roster;
      setBotSeats(roster);
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
        await channel.track({
          deviceId,
          seat,
          name: myName,
          playerId: myPlayerId,
          ...(isHost
            ? { isHost: true, targetPlayerCount: playerCountRef.current, chipVisibility: chipVisibilityRef.current }
            : {}),
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
  const knownChipVisibility = host?.chipVisibility ?? chipVisibility;
  const reclaimAttemptsRef = useRef(0);

  // Two seats can genuinely collide when players join within the same
  // instant — same self-healing tie-break as BangGame.tsx/AvalonGame.tsx:
  // whichever device has the lexicographically larger id gives up the seat
  // and claims the next free one, up to a few attempts before falling back
  // to "room-full".
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
      ...(isHost
        ? { isHost: true, targetPlayerCount: playerCountRef.current, chipVisibility: chipVisibilityRef.current }
        : {}),
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
        chipVisibility: chipVisibilityRef.current,
        botSeats: botSeatsRef.current,
      },
    });
  }, []);

  // Host deals the first hand as soon as the target seat count is filled —
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
    (seat: SeatIndex) => {
      if (!isHost) return;
      if (botSeatsRef.current.includes(seat) || occupants.some((o) => o.seat === seat)) return;
      const next = [...botSeatsRef.current, seat];
      botSeatsRef.current = next;
      setBotSeats(next);
      channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: next } });
    },
    [isHost, occupants],
  );

  const removeBotAtSeat = useCallback(
    (seat: SeatIndex) => {
      if (!isHost) return;
      const next = botSeatsRef.current.filter((s) => s !== seat);
      botSeatsRef.current = next;
      setBotSeats(next);
      channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: next } });
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
    const stillBot = botSeats.filter((s) => !humanSeats.has(s));
    // botSeatsRef is re-synced by the effect above once this commits — not
    // updated here too, since refs (like state) must not be written during render.
    if (stillBot.length !== botSeats.length) setBotSeats(stillBot);
  }

  const handleAction = useCallback((action: EngineAction) => {
    channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action } });
  }, []);

  useBotAutoplay<NoThanksState, EngineAction, SeatIndex>({
    active: isHost && phase === "playing",
    state: gameState,
    currentActor: noThanksCurrentActor,
    botSeats: botSeatSet,
    chooseAction: noThanksChooseAction,
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
      map[seat] = seat === mySeat ? myName : (occ?.name ?? (botIdx >= 0 ? botDisplayName(botIdx) : "상대"));
    }
    return map;
  }, [occupants, mySeat, myName, gameState, knownTargetPlayerCount, botSeats]);

  const connectedSeats = useMemo(
    () => new Set([...occupants.map((o) => o.seat), ...botSeats]),
    [occupants, botSeats],
  );

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
          노땡스는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
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
          className="mt-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
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
          className="mt-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (phase === "choose") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">🙅</span>
        <h2 className="text-lg font-bold text-white">노땡스! 온라인 대전</h2>
        <p className="text-sm text-white/50">3~7명이 각자 기기로 접속해서 실시간으로 플레이해요.</p>
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
    return (
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
            인원 수 (3~7명)
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTargetPlayerCount((n) => Math.max(3, n - 1))}
                className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
              >
                −
              </button>
              <span className="w-8 text-center text-lg font-semibold text-white">{targetPlayerCount}</span>
              <button
                type="button"
                onClick={() => setTargetPlayerCount((n) => Math.min(7, n + 1))}
                className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
              >
                +
              </button>
            </div>
          </label>
        )}
        {intent === "create" && (
          <div className="flex flex-col gap-1.5 text-sm text-white/70">
            칩 공개 모드 (룰북 §2)
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setChipVisibility("secret")}
                className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs transition ${
                  chipVisibility === "secret"
                    ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100"
                    : "border-white/15 text-white/60 hover:border-white/30"
                }`}
              >
                <p className="font-semibold">🔒 비밀 모드</p>
                <p className="text-white/50">공식 룰 · 내 칩만 나에게 보임</p>
              </button>
              <button
                type="button"
                onClick={() => setChipVisibility("public")}
                className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs transition ${
                  chipVisibility === "public"
                    ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100"
                    : "border-white/15 text-white/60 hover:border-white/30"
                }`}
              >
                <p className="font-semibold">👁️ 공개 모드</p>
                <p className="text-white/50">커스텀 룰 · 모두의 칩이 공개됨</p>
              </button>
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
            className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
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
            <p className="text-xs text-white/40">
              {knownChipVisibility === "public" ? "👁️ 공개 모드 (모두의 칩이 보임)" : "🔒 비밀 모드 (내 칩만 나에게 보임)"}
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {Array.from({ length: knownTargetPlayerCount }, (_, seat) => {
                const occ = occupants.find((o) => o.seat === seat);
                const botIdx = botSeats.indexOf(seat);
                const isBot = botIdx >= 0;
                return (
                  <div key={seat} className="flex items-center justify-between gap-3 text-sm text-white/70">
                    <span>
                      {seat === mySeat ? "나" : `${seat + 1}번`}:{" "}
                      {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx)} /> : <span className="text-white/30">대기 중...</span>}
                    </span>
                    {isHost && seat !== mySeat && !occ && (
                      isBot ? (
                        <RemoveBotButton onClick={() => removeBotAtSeat(seat)} />
                      ) : (
                        <AddBotButton onClick={() => addBotAtSeat(seat)} />
                      )
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-white/40">
              {knownTargetPlayerCount}명이 모이면 자동으로 게임이 시작됩니다. AI 봇으로도 채울 수 있어요.
            </p>
            {isHost && occupants.length + botSeats.length >= MIN_PLAYERS && occupants.length + botSeats.length < knownTargetPlayerCount && (
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
    );
  }

  if (phase === "playing" && gameState && mySeat !== null) {
    return (
      <NoThanksBoard
        state={gameState}
        viewerSeat={mySeat}
        names={names}
        connectedSeats={connectedSeats}
        onAction={handleAction}
        onGameEnd={handleGameEnd}
      />
    );
  }

  if (phase === "post-game" && finalResult) {
    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">🏆</span>
        <p className="text-white/80">
          {finalResult.winnerName}
          {finalResult.tied ? " 님 외 공동 우승으로 게임이 끝났어요." : " 님 우승으로 게임이 끝났어요."}
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
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            다시하기
          </button>
        </div>
      </div>
    );
  }

  return null;
}
