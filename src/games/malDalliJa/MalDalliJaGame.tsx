"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
import { seededRng } from "@/lib/rng";
import {
  applyAction,
  otherSeat,
  startGame,
  type EngineAction,
  type MalDalliJaState,
  type Seat,
} from "./engine";
import MalDalliJaBoard from "./MalDalliJaBoard";

/**
 * Online-room multiplayer entry point — same lockstep pattern as every other
 * 2-player game in this project (see docs/cloud-sync.md, and
 * HanamikojiGame.tsx which this was modeled on): the host broadcasts a seed
 * (`startGame` only uses it to pick who moves first, per engine.ts) plus the
 * room's §5 turn-timer house-rule setting, both clients independently derive
 * the identical initial state, and every subsequent move replays as an
 * `EngineAction` broadcast through the same pure reducer. Only the seat
 * whose turn it is ever sends a `move`/`pass` action (single-writer
 * guarantee — see engine.ts's module doc for the `pass`/timer trust model).
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

/** §5 house rule: "턴당 30초~1분" — a discrete pick, off by default. */
const TIMER_OPTIONS: { label: string; value: number | null }[] = [
  { label: "제한 없음", value: null },
  { label: "30초", value: 30 },
  { label: "45초", value: 45 },
  { label: "60초", value: 60 },
];

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredRole(code: string): Seat | null {
  const v = window.localStorage.getItem(`mddj-role-${code}`);
  return v === "p1" || v === "p2" ? v : null;
}

function storeRole(code: string, role: Seat) {
  window.localStorage.setItem(`mddj-role-${code}`, role);
}

export default function MalDalliJaGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [turnTimerChoice, setTurnTimerChoice] = useState<number | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Seat | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<MalDalliJaState | null>(null);
  const [turnTimerSec, setTurnTimerSec] = useState<number | null>(null);
  const [finalResult, setFinalResult] = useState<{ winnerId: string; winnerName: string } | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const startSentRef = useRef(false);

  // Refs so the `state-request` handler (registered once per channel-open
  // effect run) always sees the latest state/timer setting instead of a
  // stale closure over the values from that render — see docs/cloud-sync.md
  // §2.3 (same pattern as every other online game here, e.g. CoyoteGame.tsx).
  const gameStateRef = useRef<MalDalliJaState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  const turnTimerRef = useRef<number | null>(null);
  useEffect(() => {
    turnTimerRef.current = turnTimerSec;
  }, [turnTimerSec]);

  const opponentSeat = myRole ? otherSeat(myRole) : null;
  const names: Record<Seat, string> = useMemo(() => {
    const byRole = (r: Seat) => occupants.find((o) => o.role === r)?.name;
    return {
      p1: (myRole === "p1" ? myName : byRole("p1")) ?? "상대",
      p2: (myRole === "p2" ? myName : byRole("p2")) ?? "상대",
    };
  }, [occupants, myRole, myName]);
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
  const opponentConnected = opponentSeat ? occupants.some((o) => o.role === opponentSeat) : false;

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
    const channel = supabase.channel(`mal-dalli-ja-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const timerSec = (payload?.turnTimerSec as number | null | undefined) ?? null;
      setGameState(startGame(seededRng(seed)));
      setTurnTimerSec(timerSec);
      setFinalResult(null);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    channel.on("broadcast", { event: "state-request" }, () => {
      if (!gameStateRef.current) return;
      channel.send({
        type: "broadcast",
        event: "state-sync",
        payload: { state: gameStateRef.current, turnTimerSec: turnTimerRef.current },
      });
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const syncedState = payload?.state as MalDalliJaState | undefined;
      if (!syncedState) return;
      setGameState(syncedState);
      setTurnTimerSec((payload?.turnTimerSec as number | null | undefined) ?? null);
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

  // Host deals the opening position as soon as both seats are filled.
  useEffect(() => {
    if (phase !== "waiting" || myRole !== "p1" || startSentRef.current) return;
    const hasP1 = occupants.some((o) => o.role === "p1");
    const hasP2 = occupants.some((o) => o.role === "p2");
    if (hasP1 && hasP2) {
      startSentRef.current = true;
      channelRef.current?.send({
        type: "broadcast",
        event: "game-start",
        payload: { seed: Math.floor(Math.random() * 1_000_000_000), turnTimerSec: turnTimerChoice },
      });
    }
  }, [occupants, phase, myRole, turnTimerChoice]);

  function handleAction(action: EngineAction) {
    channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action } });
  }

  function handleGameEnd(winnerId: string) {
    if (!gameState || !myRole) return;
    const winnerSeat: Seat = winnerId === ids.p1 ? "p1" : "p2";
    const loserId = winnerId === ids.p1 ? ids.p2 : ids.p1;
    onComplete({
      rankings: [
        { playerId: winnerId, rank: 1 },
        { playerId: loserId, rank: 2 },
      ],
      finishedAt: new Date().toISOString(),
    });
    setFinalResult({ winnerId, winnerName: names[winnerSeat] });
    setPhase("post-game");
  }

  function handleRematch() {
    startSentRef.current = true;
    channelRef.current?.send({
      type: "broadcast",
      event: "game-start",
      payload: { seed: Math.floor(Math.random() * 1_000_000_000), turnTimerSec },
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
    setTurnTimerSec(null);
    setFinalResult(null);
    setIdentity({ name: "" });
    setMyPlayerId(undefined);
    setCodeInput("");
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
          말달리자는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
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
          className="mt-2 rounded-full bg-rose-500 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-400"
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
          className="mt-2 rounded-full bg-rose-500 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-400"
        >
          다시 시도
        </button>
      </div>
    );
  }

  // ---- Lobby: choose create vs join. ----
  if (phase === "choose") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1c0a0e] via-[#12080b] to-black p-8 text-center">
        <span className="text-4xl">🐎</span>
        <h2 className="text-lg font-bold text-white">말달리자 온라인 대전</h2>
        <p className="text-sm text-white/50">두 사람이 각자 기기로 접속해서 실시간으로 플레이해요.</p>
        <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
          <button
            onClick={() => {
              setIntent("create");
              setPhase("enter-name");
            }}
            className="w-full rounded-xl bg-rose-500 py-3 text-sm font-semibold text-white transition hover:bg-rose-400"
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

  // ---- Nickname (+ code, if joining; + house rule, if creating). ----
  if (phase === "enter-name") {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1c0a0e] via-[#12080b] to-black p-6">
        <h2 className="text-base font-bold text-white">
          {intent === "create" ? "방 만들기" : "초대 코드로 참여"}
        </h2>
        <div className="flex flex-col gap-1.5 text-sm text-white/70">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} accent="rose" />
        </div>
        {intent === "join" && (
          <label className="flex flex-col gap-1.5 text-sm text-white/70">
            초대 코드 (4자리)
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="0000"
              inputMode="numeric"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-rose-400 focus:outline-none"
            />
          </label>
        )}
        {intent === "create" && (
          <div className="flex flex-col gap-1.5 text-sm text-white/70">
            [하우스 룰] 턴 제한 시간 (§5, 선택)
            <div className="grid grid-cols-4 gap-1.5">
              {TIMER_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setTurnTimerChoice(opt.value)}
                  className={`rounded-lg border py-2 text-xs font-medium transition ${
                    turnTimerChoice === opt.value
                      ? "border-rose-400 bg-rose-500/20 text-rose-200"
                      : "border-white/10 text-white/60 hover:border-white/25"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
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
            className="flex-1 rounded-xl bg-rose-500 py-2.5 text-sm font-semibold text-white hover:bg-rose-400"
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
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1c0a0e] via-[#12080b] to-black p-8 text-center">
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
                return (
                  <p key={role} className="text-sm text-white/70">
                    {role === myRole ? "나" : role === "p1" ? "흑마" : "백마"}:{" "}
                    {occ ? occ.name : <span className="text-white/30">대기 중...</span>}
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
      <MalDalliJaBoard
        state={gameState}
        viewerSeat={myRole}
        names={names}
        ids={ids}
        opponentConnected={opponentConnected}
        turnTimerSec={turnTimerSec}
        onAction={handleAction}
        onGameEnd={handleGameEnd}
      />
    );
  }

  // ---- Post-game. ----
  if (phase === "post-game" && finalResult) {
    return (
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1c0a0e] via-[#12080b] to-black p-8 text-center">
        <span className="text-4xl">🏆</span>
        <p className="text-white/80">{finalResult.winnerName}님 승리로 게임이 끝났어요.</p>
        <div className="flex gap-2">
          <button
            onClick={handleLeave}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30"
          >
            나가기
          </button>
          <button
            onClick={handleRematch}
            className="rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-400"
          >
            다시하기
          </button>
        </div>
      </div>
    );
  }

  return null;
}
