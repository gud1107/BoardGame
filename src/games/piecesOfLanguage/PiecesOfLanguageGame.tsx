"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
import { seededRng } from "@/lib/rng";
import { MAX_WORD_LENGTH, MIN_WORD_LENGTH } from "./words";
import {
  applyAction,
  chooseBotAction,
  otherSeat,
  startGame,
  type EngineAction,
  type PiecesOfLanguageState,
  type Seat,
} from "./engine";
import PiecesOfLanguageBoard from "./PiecesOfLanguageBoard";
import { useBotAutoplay } from "@/games/shared/bot/useBotAutoplay";
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
import { AddBotButton, BotSeatBadge, RemoveBotButton } from "@/components/lobby/BotSeatControls";
import { DEFAULT_BOT_LEVEL, type BotLevel } from "@/games/shared/bot/botDifficulty";

/** Whose decision `useBotAutoplay` should drive right now. */
function polCurrentActor(state: PiecesOfLanguageState): Seat | null {
  if (state.phase !== "playing") return null;
  return state.activeSeat;
}

/**
 * Online-room multiplayer entry point — same lockstep pattern as every other
 * 2-player game in this project (see docs/cloud-sync.md, modeled directly on
 * MalDalliJaGame.tsx): the host broadcasts a seed plus the room's
 * word-length + optional combined attempt-cap house rule; both clients
 * independently derive the identical initial state via `startGame` (which
 * also draws the shared random target word from that same seed — see
 * engine.ts), and every subsequent `guess` replays as an `EngineAction`
 * broadcast through the same pure reducer. `guess` actions are turn-gated
 * (only the active seat's guess has any effect) so they don't need to carry
 * their own seat.
 */

type Occupant = {
  deviceId: string;
  role: Seat;
  name: string;
  /** Real betting-system playerId, present only when this occupant joined by picking themselves from an active betting session's roster — see RoomNicknameField. */
  playerId?: string;
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

/** 공통 정답 단어의 글자 수: 2~5글자, 3글자가 표준 추천. */
const WORD_LENGTH_OPTIONS = Array.from(
  { length: MAX_WORD_LENGTH - MIN_WORD_LENGTH + 1 },
  (_, i) => MIN_WORD_LENGTH + i,
);

/** 최대 시도 횟수(선택, 양쪽 합산), 기본은 제한 없음. */
const ATTEMPT_CAP_OPTIONS: { label: string; value: number | null }[] = [
  { label: "제한 없음", value: null },
  { label: "6회", value: 6 },
  { label: "8회", value: 8 },
];

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredRole(code: string): Seat | null {
  const v = window.localStorage.getItem(`pol-role-${code}`);
  return v === "p1" || v === "p2" ? v : null;
}

function storeRole(code: string, role: Seat) {
  window.localStorage.setItem(`pol-role-${code}`, role);
}

export default function PiecesOfLanguageGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [wordLengthChoice, setWordLengthChoice] = useState(3);
  const [attemptCapChoice, setAttemptCapChoice] = useState<number | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Seat | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<PiecesOfLanguageState | null>(null);
  const [finalResult, setFinalResult] = useState<{ winnerId: string | null; winnerName: string; isDraw: boolean } | null>(null);
  // Roles currently played by an AI bot instead of a human — host-controlled
  // (ARCHITECTURE.md §7), broadcast via "bot-roster" so every client renders
  // the same lobby/board without a server. `botLevels[i]` is the Level 1–10
  // difficulty for `botRoles[i]` (parallel arrays, same index).
  const [botRoles, setBotRoles] = useState<Seat[]>([]);
  const botRolesRef = useRef<Seat[]>([]);
  useEffect(() => {
    botRolesRef.current = botRoles;
  }, [botRoles]);
  const [botLevels, setBotLevels] = useState<BotLevel[]>([]);
  const botLevelsRef = useRef<BotLevel[]>([]);
  useEffect(() => {
    botLevelsRef.current = botLevels;
  }, [botLevels]);
  const botRoleSet = useMemo(() => new Set(botRoles), [botRoles]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const startSentRef = useRef(false);

  // Refs so the `state-request` handler (registered once per channel-open
  // effect run) always sees the latest state instead of a stale closure —
  // see docs/cloud-sync.md §2.3 (same pattern as every other online game).
  const gameStateRef = useRef<PiecesOfLanguageState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const opponentSeat = myRole ? otherSeat(myRole) : null;
  const names: Record<Seat, string> = useMemo(() => {
    const byRole = (r: Seat) => occupants.find((o) => o.role === r)?.name;
    const botIdx = (r: Seat) => botRoles.indexOf(r);
    const fallback = (r: Seat) => {
      const idx = botIdx(r);
      return idx >= 0 ? botDisplayName(idx, botLevels[idx]) : "상대";
    };
    return {
      p1: (myRole === "p1" ? myName : byRole("p1")) ?? fallback("p1"),
      p2: (myRole === "p2" ? myName : byRole("p2")) ?? fallback("p2"),
    };
  }, [occupants, myRole, myName, botRoles, botLevels]);
  // Prefer the real betting-system playerId (present when that seat's
  // occupant joined by picking themselves from an active session's roster —
  // see RoomNicknameField) over the synthetic per-room id.
  const ids: Record<Seat, string> = useMemo(() => {
    const byRole = (r: Seat) => occupants.find((o) => o.role === r)?.playerId;
    return {
      p1: byRole("p1") ?? `${roomCode}:p1`,
      p2: byRole("p2") ?? `${roomCode}:p2`,
    };
  }, [roomCode, occupants]);
  const opponentIsBot = opponentSeat ? botRoles.includes(opponentSeat) : false;
  const opponentConnected = (opponentSeat ? occupants.some((o) => o.role === opponentSeat) : false) || opponentIsBot;

  function enterRoom() {
    setFormError(null);
    // Checked here (a user event handler) rather than in the connection
    // effect below, so there's nothing to synchronously setState over once
    // the effect runs — the effect only ever runs once this is guaranteed.
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
    const role: Seat = getStoredRole(code) ?? (intent === "create" ? "p1" : "p2");
    storeRole(code, role);
    window.history.replaceState(null, "", `${window.location.pathname}?room=${code}`);
    setMyName(name);
    setMyPlayerId(identity.name.trim() ? identity.playerId : undefined);
    setMyRole(role);
    setRoomCode(code);
    setPhase("connecting");
  }

  // Open (and tear down) the Realtime channel whenever we have a room to join.
  useEffect(() => {
    if (!roomCode || !myRole) return;
    const supabase = getSupabase();
    if (!supabase) return; // enterRoom() already guards this; nothing to recover here.
    const deviceId = getDeviceId();
    const channel = supabase.channel(`pieces-of-language-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const wordLength = (payload?.wordLength as number | undefined) ?? 3;
      const maxAttempts = (payload?.maxAttempts as number | null | undefined) ?? null;
      const roster = (payload?.botRoles as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botRolesRef.current = roster;
      setBotRoles(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      setGameState(startGame(wordLength, maxAttempts, seededRng(seed)));
      setFinalResult(null);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    // Host-authoritative AI bot roster — broadcast whenever the host
    // adds/removes a bot role in the waiting room, so every client renders
    // the same lobby/board without a server.
    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      const roster = (payload?.botRoles as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botRolesRef.current = roster;
      setBotRoles(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
    });

    channel.on("broadcast", { event: "state-request" }, () => {
      if (!gameStateRef.current) {
        if (myRole === "p1") {
          channel.send({ type: "broadcast", event: "bot-roster", payload: { botRoles: botRolesRef.current, botLevels: botLevelsRef.current } });
        }
        return;
      }
      channel.send({
        type: "broadcast",
        event: "state-sync",
        payload: { state: gameStateRef.current, botRoles: botRolesRef.current, botLevels: botLevelsRef.current },
      });
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const syncedState = payload?.state as PiecesOfLanguageState | undefined;
      if (!syncedState) return;
      const roster = (payload?.botRoles as Seat[] | undefined) ?? [];
      const levels = (payload?.botLevels as BotLevel[] | undefined) ?? [];
      botRolesRef.current = roster;
      setBotRoles(roster);
      botLevelsRef.current = levels;
      setBotLevels(levels);
      setGameState(syncedState);
      setPhase((p) => (p === "connecting" || p === "waiting" ? "playing" : p));
    });

    channel.on("presence", { event: "sync" }, () => {
      const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
      setOccupants(Object.values(raw).flat());
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ deviceId, role: myRole, name: myName, playerId: myPlayerId } satisfies Occupant);
        setPhase((p) => (p === "connecting" ? "waiting" : p));
        // Reconnect support (docs/cloud-sync.md §2.3): a no-op if the game
        // hasn't started anywhere yet.
        channel.send({ type: "broadcast", event: "state-request", payload: {} });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setPhase("channel-error");
      }
    });

    return () => {
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [roomCode, myRole, myName, myPlayerId]);

  // Someone else is already occupying my seat in this room (rare code
  // collision, or a stale localStorage role from a different session).
  // Derived during render (not an effect) — same "compare and setState
  // during render" pattern used elsewhere, so it's a plain idempotent
  // one-extra-render bail-out instead of a setState-in-effect cascade.
  if (myRole && phase !== "room-full") {
    const deviceId = getDeviceId();
    const conflict = occupants.some((o) => o.role === myRole && o.deviceId !== deviceId);
    if (conflict) setPhase("room-full");
  }

  const isHost = myRole === "p1";

  // Host deals the opening state as soon as both seats are filled (a role
  // counts as "filled" whether it's a connected human or a bot the host added).
  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current) return;
    const hasP1 = occupants.some((o) => o.role === "p1") || botRoles.includes("p1");
    const hasP2 = occupants.some((o) => o.role === "p2") || botRoles.includes("p2");
    if (hasP1 && hasP2) {
      startSentRef.current = true;
      channelRef.current?.send({
        type: "broadcast",
        event: "game-start",
        payload: {
          seed: Math.floor(Math.random() * 1_000_000_000),
          wordLength: wordLengthChoice,
          maxAttempts: attemptCapChoice,
          botRoles: botRolesRef.current,
          botLevels: botLevelsRef.current,
        },
      });
    }
  }, [occupants, botRoles, phase, isHost, wordLengthChoice, attemptCapChoice]);

  // Host-only: fill/empty an empty role with an AI bot (ARCHITECTURE.md §7).
  // Only ever offered for a role with no connected human — a real player is
  // never forcibly replaced. If a human later claims a role a bot was
  // occupying, the eviction logic below automatically drops the bot.
  const addBotAtRole = useCallback(
    (role: Seat, level: BotLevel) => {
      if (!isHost) return;
      if (botRolesRef.current.includes(role) || occupants.some((o) => o.role === role)) return;
      const nextRoles = [...botRolesRef.current, role];
      const nextLevels = [...botLevelsRef.current, level];
      botRolesRef.current = nextRoles;
      setBotRoles(nextRoles);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botRoles: nextRoles, botLevels: nextLevels } });
    },
    [isHost, occupants],
  );

  const removeBotAtRole = useCallback(
    (role: Seat) => {
      if (!isHost) return;
      const idx = botRolesRef.current.indexOf(role);
      if (idx === -1) return;
      const nextRoles = botRolesRef.current.filter((_, i) => i !== idx);
      const nextLevels = botLevelsRef.current.filter((_, i) => i !== idx);
      botRolesRef.current = nextRoles;
      setBotRoles(nextRoles);
      botLevelsRef.current = nextLevels;
      setBotLevels(nextLevels);
      channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botRoles: nextRoles, botLevels: nextLevels } });
    },
    [isHost],
  );

  // A human physically claiming a role always wins over a bot placeholder —
  // derived during render (not an effect), same "compare and setState
  // during render" pattern used elsewhere in this file.
  if (isHost && botRoles.length > 0) {
    const humanRoles = new Set(occupants.map((o) => o.role));
    const keepIdx = botRoles.map((r, i) => (humanRoles.has(r) ? -1 : i)).filter((i) => i !== -1);
    if (keepIdx.length !== botRoles.length) {
      setBotRoles(keepIdx.map((i) => botRoles[i]));
      setBotLevels(keepIdx.map((i) => botLevels[i]));
    }
  }

  const handleAction = useCallback((action: EngineAction) => {
    channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action } });
  }, []);

  const chooseAction = useCallback((state: PiecesOfLanguageState, actor: Seat): EngineAction | null => {
    const idx = botRolesRef.current.indexOf(actor);
    const level = idx >= 0 ? (botLevelsRef.current[idx] ?? DEFAULT_BOT_LEVEL) : DEFAULT_BOT_LEVEL;
    return chooseBotAction(state, actor, level);
  }, []);

  useBotAutoplay<PiecesOfLanguageState, EngineAction, Seat>({
    active: isHost && phase === "playing",
    state: gameState,
    currentActor: polCurrentActor,
    botSeats: botRoleSet,
    chooseAction,
    dispatch: handleAction,
  });

  function handleGameEnd(result: { winnerId: string | null; isDraw: boolean }) {
    if (!gameState) return;
    if (result.isDraw || !result.winnerId) {
      onComplete({
        rankings: [
          { playerId: ids.p1, rank: 1 },
          { playerId: ids.p2, rank: 1 },
        ],
        finishedAt: new Date().toISOString(),
      });
      setFinalResult({ winnerId: null, winnerName: "", isDraw: true });
    } else {
      const winnerSeat: Seat = result.winnerId === ids.p1 ? "p1" : "p2";
      const loserId = result.winnerId === ids.p1 ? ids.p2 : ids.p1;
      onComplete({
        rankings: [
          { playerId: result.winnerId, rank: 1 },
          { playerId: loserId, rank: 2 },
        ],
        finishedAt: new Date().toISOString(),
      });
      setFinalResult({ winnerId: result.winnerId, winnerName: names[winnerSeat], isDraw: false });
    }
    setPhase("post-game");
  }

  function handleRematch() {
    startSentRef.current = true;
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: {
        seed: Math.floor(Math.random() * 1_000_000_000),
        wordLength: gameState?.wordLength ?? wordLengthChoice,
        maxAttempts: gameState?.maxAttempts ?? attemptCapChoice,
        botRoles: botRolesRef.current,
        botLevels: botLevelsRef.current,
      },
    });
  }

  function handleLeave() {
    if (channelRef.current) {
      const supabase = getSupabase();
      supabase?.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    window.history.replaceState(null, "", window.location.pathname);
    setRoomCode(null);
    setMyRole(null);
    setOccupants([]);
    setGameState(null);
    setFinalResult(null);
    setIdentity({ name: "" });
    setMyPlayerId(undefined);
    setCodeInput("");
    botRolesRef.current = [];
    setBotRoles([]);
    botLevelsRef.current = [];
    setBotLevels([]);
    setPhase("choose");
  }

  const shareUrl =
    typeof window !== "undefined" && roomCode
      ? `${window.location.origin}${window.location.pathname}?room=${roomCode}`
      : "";

  // ---- Supabase not configured: online play literally cannot work. ----
  if (phase === "supabase-missing") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-8 text-center">
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white">온라인 대전을 사용할 수 없어요</h2>
        <p className="max-w-sm text-sm text-amber-100/80">
          언어의 조각은 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">.env.local</code>
          에 <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code> /
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">
            NEXT_PUBLIC_SUPABASE_ANON_KEY
          </code>
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
          className="mt-2 rounded-full bg-violet-500 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-400"
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
          className="mt-2 rounded-full bg-violet-500 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-400"
        >
          다시 시도
        </button>
      </div>
    );
  }

  // ---- Lobby: choose create vs join. ----
  if (phase === "choose") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[#140a1c] via-[#0c0715] to-black p-8 text-center">
        <span className="text-4xl">🧩</span>
        <h2 className="text-lg font-bold text-white">언어의 조각 온라인 대전</h2>
        <p className="text-sm text-white/50">두 사람이 각자 기기로 접속해서 실시간으로 플레이해요.</p>
        <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
          <button
            onClick={() => {
              setIntent("create");
              setPhase("enter-name");
            }}
            className="w-full rounded-xl bg-violet-500 py-3 text-sm font-semibold text-white transition hover:bg-violet-400"
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

  // ---- Nickname (+ code, if joining; + house rules, if creating). ----
  if (phase === "enter-name") {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[#140a1c] via-[#0c0715] to-black p-6">
        <h2 className="text-base font-bold text-white">
          {intent === "create" ? "방 만들기" : "초대 코드로 참여"}
        </h2>
        <div className="flex flex-col gap-1.5 text-sm text-white/70">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} accent="fuchsia" />
        </div>
        {intent === "join" && (
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
            초대 코드 (4자리)
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="0000"
              inputMode="numeric"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-violet-400 focus:outline-none"
            />
          </label>
        )}
        {intent === "create" && (
          <>
            <div className="flex flex-col gap-1.5 text-sm text-white/70">
              글자 수 (2~5, 3글자 추천)
              <div className="grid grid-cols-4 gap-1.5">
                {WORD_LENGTH_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setWordLengthChoice(n)}
                    className={`rounded-lg border py-2 text-xs font-medium transition ${
                      wordLengthChoice === n
                        ? "border-violet-400 bg-violet-500/20 text-violet-200"
                        : "border-white/10 text-white/60 hover:border-white/25"
                    }`}
                  >
                    {n}글자
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 text-sm text-white/70">
              최대 시도 횟수 — 양쪽 합산 (선택)
              <div className="grid grid-cols-3 gap-1.5">
                {ATTEMPT_CAP_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setAttemptCapChoice(opt.value)}
                    className={`rounded-lg border py-2 text-xs font-medium transition ${
                      attemptCapChoice === opt.value
                        ? "border-violet-400 bg-violet-500/20 text-violet-200"
                        : "border-white/10 text-white/60 hover:border-white/25"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </>
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
            className="flex-1 rounded-xl bg-violet-500 py-2.5 text-sm font-semibold text-white hover:bg-violet-400"
          >
            {intent === "create" ? "방 만들기" : "참여하기"}
          </button>
        </div>
      </div>
    );
  }

  // ---- Connecting / waiting room. ----
  if (phase === "connecting" || phase === "waiting") {
    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-gradient-to-b from-[#140a1c] via-[#0c0715] to-black p-8 text-center">
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
            <div className="mt-2 flex flex-col gap-1.5">
              {(["p1", "p2"] as const).map((role) => {
                const occ = occupants.find((o) => o.role === role);
                const botIdx = botRoles.indexOf(role);
                const isBot = botIdx >= 0;
                return (
                  <p key={role} className="flex items-center justify-between gap-2 text-sm text-white/70">
                    <span>
                      {role === myRole ? "나" : role === "p1" ? "1번" : "2번"}:{" "}
                      {occ ? occ.name : isBot ? <BotSeatBadge label={botLabel(botIdx, botLevels[botIdx])} /> : <span className="text-white/30">대기 중...</span>}
                    </span>
                    {isHost && !occ && (
                      <span>
                        {isBot ? (
                          <RemoveBotButton onClick={() => removeBotAtRole(role)} />
                        ) : (
                          <AddBotButton onAddWithLevel={(level) => addBotAtRole(role, level)} />
                        )}
                      </span>
                    )}
                  </p>
                );
              })}
            </div>
            <p className="text-xs text-white/40">2명이 모이면 자동으로 게임이 시작됩니다.</p>
          </>
        )}
      </div>
    );
  }

  // ---- Playing. ----
  if (phase === "playing" && gameState && myRole) {
    return (
      <PiecesOfLanguageBoard
        state={gameState}
        viewerSeat={myRole}
        names={names}
        ids={ids}
        opponentConnected={opponentConnected}
        onAction={handleAction}
        onGameEnd={handleGameEnd}
      />
    );
  }

  // ---- Post-game. ----
  if (phase === "post-game" && finalResult) {
    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-gradient-to-b from-[#140a1c] via-[#0c0715] to-black p-8 text-center">
        <span className="text-4xl">{finalResult.isDraw ? "🤝" : "🏆"}</span>
        <p className="text-white/80">
          {finalResult.isDraw ? "무승부로 게임이 끝났어요." : `${finalResult.winnerName}님 승리로 게임이 끝났어요.`}
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
            className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-400"
          >
            다시하기
          </button>
        </div>
      </div>
    );
  }

  return null;
}
