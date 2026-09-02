"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import GameLeaveGuardModal from "@/components/GameLeaveGuardModal";
import { useGameLeaveGuard } from "@/hooks/useGameLeaveGuard";
import { useBackgroundResync } from "@/hooks/useBackgroundResync";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
import { BotTakeoverSelfBanner, BotTakeoverVoteModal } from "@/components/lobby/BotTakeoverVoteModal";
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
  chooseWormBotInput,
  computeRankings,
  MAX_PLAYERS,
  MIN_PLAYERS,
  sanitizeInput,
  seededRng,
  startGame,
  stepWorm,
  type RankedSeat,
  type SeatIndex,
  type SnakeInput,
  type WormState,
} from "./engine";
import WormCanvas from "./WormCanvas";

/**
 * Online-room multiplayer entry point.
 *
 * ⚠️ **Deliberately NOT this project's usual lockstep pattern** (see
 * engine.ts's module doc for why a continuous physics field doesn't fit
 * "replay the same discrete actions on every client"; full write-up in
 * docs/cloud-sync.md §5). Instead:
 *
 * - The room's **host is the sole authority**: only the host calls
 *   `stepWorm` (in a fixed-step accumulator loop driven by
 *   `requestAnimationFrame`) and broadcasts the resulting `WormState`
 *   snapshot at a throttled rate (`BROADCAST_INTERVAL_MS`). Every other
 *   client just renders whatever snapshot it last received — no local
 *   simulation, no reconciliation. This trades a little responsiveness for
 *   non-host players (bounded by one broadcast interval + realtime latency)
 *   for a much simpler, still-fully-synchronized mental model appropriate
 *   for a casual party-game scope.
 * - Every client (host included) broadcasts its own `{angle, boosting}`
 *   input on `player-input` whenever `WormCanvas` reports a change (already
 *   throttled there to ~14/sec). The host merges the latest known input per
 *   seat into each simulation tick; non-host clients ignore `player-input`
 *   entirely (only the host consumes it). The host also merges its OWN
 *   local input directly (bypassing the network round-trip) so its own
 *   snake never pays broadcast latency against itself.
 * - Room lifecycle (create/join, seat assignment + self-healing, `?room=`
 *   share links, reconnect via `state-request`/`state-sync`, room-full
 *   guard) is unchanged from every other game's protocol — none of that is
 *   specific to lockstep vs. host-authoritative, so it's reused verbatim.
 *
 * Known limitation (documented, not a bug): if the host's tab closes mid-
 * match, the simulation simply stops advancing for everyone (no host
 * migration) — same "known unresolved item" the project already tracks for
 * lobby-stage host loss (see docs/cloud-sync.md §4).
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

const TICK_MS = 50; // host's fixed simulation step (20Hz)
const BROADCAST_INTERVAL_MS = 90; // ~11 state snapshots/sec over the wire

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredSeat(code: string): number | null {
  const v = window.localStorage.getItem(`worm-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`worm-seat-${code}`, String(seat));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export default function WormGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(3);
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<WormState | null>(null);
  const [finalRankings, setFinalRankings] = useState<RankedSeat[] | null>(null);

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

  const gameStateRef = useRef<WormState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const occupantsRef = useRef<Occupant[]>([]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);

  // Mid-game "seat disconnected/unresponsive → AI bot" — see botTakeover.ts
  // for the vote/conversion state machine this mirrors. 2026-09-02 맵
  // 확장 세션: 지렁이는 그 기능의 원래 대상 6개 게임에 없었고(HANDOFF.md
  // 2026-08-29절) 사전 로비 봇 좌석 인프라(`botSeats`/`useBotAutoplay`)도
  // 애초에 없었으므로, 여기서는 오직 이 vote/takeover 상태 머신 + 호스트 tick
  // 루프에서 taken-over 좌석에 `chooseWormBotInput`(engine.ts)을 매 틱 대신
  // 계산해 넣어주는 것만 신규로 붙인다 — 난이도 티어는 재사용할 기존 설정이
  // 없어 단일 고정 휴리스틱.
  const [botTakeover, setBotTakeover] = useState<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  const botTakeoverRef = useRef<BotTakeoverState>(INITIAL_BOT_TAKEOVER_STATE);
  function applyBotTakeoverEvent(event: BotTakeoverEvent) {
    const next = reduceBotTakeover(botTakeoverRef.current, event);
    botTakeoverRef.current = next;
    setBotTakeover(next);
  }
  // Per-seat "last time we saw a `player-input` broadcast from them" — the
  // "무응답(idle)" takeover trigger's input, since worm has no discrete
  // `currentActor` (every seat acts every tick) to watch for stalling the
  // way the turn-based games do. A backgrounded/frozen tab's RAF loop stops
  // firing entirely, which stops its ~14/sec input broadcasts too — so a
  // stale timestamp here is a reasonable proxy for "not actually here"
  // without needing literal AFK/intent detection.
  const lastInputAtRef = useRef<Record<SeatIndex, number>>({});
  const matchStartedAtRef = useRef(0);
  const IDLE_VOTE_THRESHOLD_MS = 45_000;
  // A vote this client has already dismissed without voting — re-shown if a
  // *different* vote (different seat or restarted timer) comes in.
  const [dismissedVoteKey, setDismissedVoteKey] = useState<string | null>(null);

  // Latest input every seat is known to want — updated by `player-input`
  // broadcasts (host reads this every tick; non-host clients keep it around
  // harmlessly but never consume it).
  const inputsRef = useRef<Partial<Record<SeatIndex, SnakeInput>>>({});
  // This client's own latest local input — merged in directly by the host
  // loop for zero-latency self-control, and what gets broadcast out.
  const localInputRef = useRef<SnakeInput>({ angle: 0, boosting: false });
  // Seed used to seed the *continuing* simulation rng (food spawns after
  // the game starts) — distinct from the `startGame` seed so the initial
  // food layout and the ongoing spawn stream aren't the same sequence.
  const simSeedRef = useRef(0);
  const mySeatRef = useRef<SeatIndex | null>(null);
  useEffect(() => {
    mySeatRef.current = mySeat;
  }, [mySeat]);

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

  useEffect(() => {
    if (!roomCode) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const deviceId = getDeviceId();
    const channel = supabase.channel(`worm-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const playerCount = payload?.playerCount as number;
      playerCountRef.current = playerCount;
      simSeedRef.current = seed + 1;
      inputsRef.current = {};
      lastInputAtRef.current = {};
      matchStartedAtRef.current = Date.now();
      // A rematch is a fresh match — any takeover from the previous round
      // shouldn't silently carry a seat's control into this one.
      botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
      setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
      setGameState(startGame(playerCount, seed));
      setFinalRankings(null);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "state-snapshot" }, ({ payload }) => {
      if (isHost) return; // host is authoritative for itself, never overwritten by its own echo
      const state = payload?.state as WormState | undefined;
      if (state) setGameState(state);
    });

    channel.on("broadcast", { event: "player-input" }, ({ payload }) => {
      const seat = payload?.seat as SeatIndex | undefined;
      const input = sanitizeInput(payload?.input);
      if (seat === undefined || !input) return;
      inputsRef.current = { ...inputsRef.current, [seat]: input };
      lastInputAtRef.current = { ...lastInputAtRef.current, [seat]: Date.now() };
    });

    // Bot-takeover vote/conversion — see botTakeover.ts. Every client replays
    // the identical event stream through the same pure reducer; a client
    // whose own `vote-cast` (including its own) just crossed the majority
    // threshold is the one that fires `convert` — harmless if more than one
    // client does this in the same instant, since `convert` on an
    // already-converted seat only happens once.
    channel.on("broadcast", { event: "bot-takeover-event" }, ({ payload }) => {
      const event = payload?.event as BotTakeoverEvent | undefined;
      if (!event) return;
      applyBotTakeoverEvent(event);
      if (event.type !== "vote-cast") return;
      const vote = botTakeoverRef.current.votes[event.seatKey];
      if (!vote) return; // already converted/cancelled by a faster broadcast
      const takenOverSeats = new Set(Object.keys(botTakeoverRef.current.takeovers).map(Number));
      const eligible = occupantsRef.current.filter(
        (o) => o.seat !== Number(event.seatKey) && !takenOverSeats.has(o.seat),
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
          payload: { state: gameStateRef.current, botTakeover: botTakeoverRef.current },
        });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const state = payload?.state as WormState | undefined;
      if (!state) return;
      const takeover = (payload?.botTakeover as BotTakeoverState | undefined) ?? INITIAL_BOT_TAKEOVER_STATE;
      botTakeoverRef.current = takeover;
      setBotTakeover(takeover);
      setGameState(state);
      setFinalRankings(null);
      setPhase("playing");
    });

    // Real disconnect (tab closed, network dropped, or an explicit leave) —
    // fires identically on every connected client (Supabase Presence is
    // server-synced, not local-only). Only kicks off a takeover vote
    // mid-game. `leftPresences` still carries the leaving occupant's
    // `playerId`/`name` even though they're already gone from
    // `presenceState()` by the time anyone could look them up again.
    channel.on("presence", { event: "leave" }, ({ leftPresences }) => {
      if (phaseRef.current !== "playing") return;
      for (const p of leftPresences as unknown as Occupant[]) {
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
          const taken = new Set(existing.map((o) => o.seat));
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

  // "무응답(idle)" takeover trigger — runs off a plain interval (every
  // client independently, same "no host dependency" philosophy as the vote
  // machine itself) since worm has no discrete `currentActor` to watch for
  // stalling; see `lastInputAtRef`'s doc comment above for what "idle" means
  // here.
  useEffect(() => {
    if (phase !== "playing" || !roomCode) return;
    const interval = window.setInterval(() => {
      if (phaseRef.current !== "playing") return;
      const playerCount = gameStateRef.current?.playerCount ?? 0;
      for (const occ of occupantsRef.current) {
        if (occ.seat >= playerCount) continue;
        const seatKey = String(occ.seat);
        if (activeVoteFor(botTakeoverRef.current, seatKey) || isSeatTakenOver(botTakeoverRef.current, seatKey)) continue;
        const lastAt = lastInputAtRef.current[occ.seat] ?? matchStartedAtRef.current;
        if (Date.now() - lastAt < IDLE_VOTE_THRESHOLD_MS) continue;
        channelRef.current?.send({
          type: "broadcast",
          event: "bot-takeover-event",
          payload: {
            event: {
              type: "vote-start",
              seatKey,
              reason: "idle",
              startedAt: Date.now(),
              originalUserId: occ.playerId ?? `${roomCode}:${occ.seat}`,
              originalName: occ.name,
            },
          },
        });
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [phase, roomCode]);

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
    const taken = new Set(occupants.filter((o) => o.deviceId !== deviceId).map((o) => o.seat));
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
      payload: { seed: randomSeed(), playerCount: playerCountRef.current },
    });
  }

  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current) return;
    if (occupants.length >= knownTargetPlayerCount) {
      sendGameStart();
    }
  }, [occupants, phase, knownTargetPlayerCount, isHost]);

  // ---------------------------------------------------------------------
  // Host-only fixed-step simulation loop — see module doc for why this
  // exists instead of lockstep action replay. Deliberately NOT depending on
  // `gameState` (which changes every tick) — it seeds its local mutable
  // `sim` copy once from the state present when the match just started, then
  // owns it exclusively until the effect tears down.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!isHost || phase !== "playing" || !gameStateRef.current) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastBroadcast = 0;
    let sim = gameStateRef.current;
    const rng = seededRng(simSeedRef.current);

    function tick(now: number) {
      const dt = Math.min(now - last, 250);
      last = now;
      acc += dt;
      const seat = mySeatRef.current;
      // Always a fresh shallow copy (never `inputsRef.current` itself) — the
      // bot-takeover overrides below mutate this local object, and it must
      // never alias the ref that `player-input`'s handler owns.
      const inputs: Partial<Record<SeatIndex, SnakeInput>> = seat === null ? { ...inputsRef.current } : { ...inputsRef.current, [seat]: localInputRef.current };
      // Taken-over seats get a freshly computed steering input every tick
      // instead of whatever (now-stale) input they last broadcast — same
      // "recompute from the live state" spirit as a real player's mouse/
      // joystick angle, just synthesized instead of read from the network.
      // Computed from `sim` (this tick's about-to-advance state), not the
      // React `gameState` prop, so it's never a step behind.
      for (const seatKey of Object.keys(botTakeoverRef.current.takeovers)) {
        const botSeat = Number(seatKey);
        inputs[botSeat] = chooseWormBotInput(sim, botSeat);
      }
      while (acc >= TICK_MS && sim.phase !== "gameOver") {
        sim = stepWorm(sim, TICK_MS, inputs, rng);
        acc -= TICK_MS;
      }
      setGameState(sim);
      if (now - lastBroadcast >= BROADCAST_INTERVAL_MS) {
        lastBroadcast = now;
        channelRef.current?.send({ type: "broadcast", event: "state-snapshot", payload: { state: sim } });
      }
      if (sim.phase !== "gameOver") raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Intentionally NOT depending on `gameState` — this effect seeds its own
    // mutable `sim` copy once from `gameStateRef.current` at match-start and
    // then owns it exclusively; re-running per tick would restart the loop.
  }, [isHost, phase]);

  function handleInput(input: SnakeInput) {
    localInputRef.current = input;
    if (mySeat === null) return;
    channelRef.current?.send({ type: "broadcast", event: "player-input", payload: { seat: mySeat, input } });
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

  // See DalmutiGame.tsx's 2026-09-03 freeze-fix comment: depends on a
  // stable string key (not the whole `botTakeover` object) so an unrelated
  // seat's vote/convert broadcast can't produce a needless new reference
  // here (worm has no `useBotAutoplay` call to break, but this feeds
  // `connectedSeats` below, so the same stability fix still applies).
  const takeoverSeatKey = Object.keys(botTakeover.takeovers).sort().join(",");
  const takeoverSeats = useMemo(() => (takeoverSeatKey ? (takeoverSeatKey.split(",").map(Number) as SeatIndex[]) : []), [takeoverSeatKey]);

  // Other real, non-bot occupants besides `seat` — the eligible-voter
  // denominator for that seat's vote.
  function eligibleVoterCountFor(seatKey: string): number {
    const takenOverSeats = new Set(Object.keys(botTakeover.takeovers).map(Number));
    return occupants.filter((o) => o.seat !== Number(seatKey) && !takenOverSeats.has(o.seat)).length;
  }

  // A takeover seat's `originalUserId`/name wins over the live occupant
  // lookup — a genuinely disconnected player has already dropped out of
  // `occupants` entirely, but should still be credited for what the bot does
  // in their seat (reward/ranking) and still show as "themselves, now a bot"
  // rather than the generic "상대" fallback.
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
      map[seat] = seat === mySeat ? myName : (occ?.name ?? "상대");
    }
    return map;
  }, [occupants, mySeat, myName, gameState, knownTargetPlayerCount, botTakeover]);

  const connectedSeats = useMemo(
    () => new Set([...occupants.map((o) => o.seat), ...takeoverSeats]),
    [occupants, takeoverSeats],
  );

  function handleGameEnd() {
    const sim = gameStateRef.current;
    if (!sim || sim.phase !== "gameOver") return;
    const rankings = computeRankings(sim);
    onComplete({
      rankings: rankings.map((r) => ({ playerId: ids[r.seat], rank: r.rank })),
      finishedAt: new Date().toISOString(),
    });
    setFinalRankings(rankings);
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
    setFinalRankings(null);
    botTakeoverRef.current = INITIAL_BOT_TAKEOVER_STATE;
    setBotTakeover(INITIAL_BOT_TAKEOVER_STATE);
    setIdentity({ name: "" });
    setMyPlayerId(undefined);
    setCodeInput("");
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
          지렁이는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
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
        <button onClick={handleLeave} className="mt-2 rounded-full bg-lime-600 px-5 py-2 text-sm font-semibold text-white hover:bg-lime-500">
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
        <button onClick={handleLeave} className="mt-2 rounded-full bg-lime-600 px-5 py-2 text-sm font-semibold text-white hover:bg-lime-500">
          다시 시도
        </button>
      </div>
    );
  }

  if (phase === "choose") {
    return withGuard(
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">🪱</span>
        <h2 className="text-lg font-bold text-white">지렁이 실시간 대전</h2>
        <p className="text-sm text-white/50">
          {MIN_PLAYERS}~{MAX_PLAYERS}명이 각자 기기로 접속해서 Slither.io 스타일로 실시간 대전해요.
        </p>
        <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
          <button
            onClick={() => {
              setIntent("create");
              setPhase("enter-name");
            }}
            className="w-full rounded-xl bg-lime-600 py-3 text-sm font-semibold text-white transition hover:bg-lime-500"
          >
            🪱 방 만들기
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-lime-400 focus:outline-none"
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
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-lime-600 py-2.5 text-sm font-semibold text-white hover:bg-lime-500">
            {intent === "create" ? "방 만들기" : "참여하기"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "connecting" || phase === "waiting") {
    return withGuard(
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
              {occupants.length} / {knownTargetPlayerCount}명 참여 중
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {Array.from({ length: knownTargetPlayerCount }, (_, seat) => {
                const occ = occupants.find((o) => o.seat === seat);
                return (
                  <p key={seat} className="text-sm text-white/70">
                    {seat === mySeat ? "나" : `${seat + 1}번`}: {occ ? occ.name : <span className="text-white/30">대기 중...</span>}
                  </p>
                );
              })}
            </div>
            <p className="text-xs text-white/40">{knownTargetPlayerCount}명이 모이면 자동으로 게임이 시작됩니다.</p>
            {isHost && occupants.length >= 2 && occupants.length < knownTargetPlayerCount && (
              <button onClick={sendGameStart} className="rounded-full bg-lime-600 px-4 py-2 text-xs font-semibold text-white hover:bg-lime-500">
                지금 시작 ({occupants.length}명)
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  if (phase === "playing" && gameState && mySeat !== null) {
    const myVoteAsTarget = activeVoteFor(botTakeover, String(mySeat));
    const iAmTakenOver = isSeatTakenOver(botTakeover, String(mySeat));
    const voteToShow = Object.values(botTakeover.votes).find(
      (v) => v.seatKey !== String(mySeat) && `${v.seatKey}:${v.startedAt}` !== dismissedVoteKey,
    );
    return withGuard(
      <div className="flex flex-col gap-2">
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
        <WormCanvas
          state={gameState}
          viewerSeat={mySeat}
          names={names}
          connectedSeats={connectedSeats}
          onInput={handleInput}
          onGameEnd={handleGameEnd}
        />
      </div>
    );
  }

  if (phase === "post-game" && finalRankings) {
    return withGuard(
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ background: "linear-gradient(160deg,#1a2e05 0%,#101d03 55%,#070c01 100%)" }}
      >
        <span className="text-5xl">🏆</span>
        <h2 className="text-2xl font-bold text-lime-100">
          {names[finalRankings.find((r) => r.rank === 1)!.seat]}님 승리!
        </h2>
        <p className="text-xs text-white/50">제한 시간이 끝났습니다 — 누적 점수가 가장 높은 지렁이가 승리합니다.</p>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[380px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">최고 길이</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">점수</th>
              </tr>
            </thead>
            <tbody>
              {finalRankings.map(({ seat, rank, bestLength, score }) => (
                <tr key={seat} className={rank === 1 ? "bg-lime-400/10" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-lime-200">{rank === 1 ? "🏆 1" : rank}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                    {names[seat]}
                    {seat === mySeat && <span className="ml-1 text-lime-200">(나)</span>}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-lime-200">🪱 {bestLength}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-white/70">{score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2">
          <button onClick={handleLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30">
            나가기
          </button>
          <button onClick={handleRematch} className="rounded-xl bg-lime-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-lime-500">
            다시하기
          </button>
        </div>
      </div>
    );
  }

  return withGuard(null);
}
