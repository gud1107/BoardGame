"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { getDeviceId } from "@/lib/identity/deviceId";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RoomNicknameField, { type RoomIdentityValue } from "@/components/identity/RoomNicknameField";
import type { PlayableGameProps } from "@/games/types";
import {
  applyAction,
  computeRankings,
  computeTeamRankings,
  defaultTeamAssignment,
  DEFAULT_TIMER_SECONDS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  startGame,
  type EngineAction,
  type SeatIndex,
  type SpotDifferenceState,
  type StageSource,
  type TeamId,
} from "./engine";
import { BUILTIN_SCENES } from "./scenes";
import SpotDifferenceBoard from "./SpotDifferenceBoard";

/**
 * Online-room multiplayer entry point, same lockstep pattern as every other
 * game here (NoThanksGame/AvalonGame/GridPokerGame): every connected client
 * independently computes the full `SpotDifferenceState` from a shared RNG
 * seed plus replayed `EngineAction`s broadcast over Supabase Realtime —
 * there is no server-authoritative engine.
 *
 * The one thing this game broadcasts that no other game here does is a
 * whole *image* (photo mode's uploaded picture, downscaled/compressed
 * client-side first) inside the one-time `game-start` payload — every
 * client then derives the identical diff-spot answer key and rendered
 * "modified" canvas purely from that image + the shared seed (see
 * engine.ts/PhotoStageCanvas.tsx), so nothing else needs to travel over the
 * wire. Known limitation: very large/detailed photos can exceed Supabase
 * Realtime's broadcast payload size after compression — see README.
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

type GameMode = "builtin" | "photo";

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredSeat(code: string): number | null {
  const v = window.localStorage.getItem(`spot-difference-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`spot-difference-seat-${code}`, String(seat));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

const TIMER_PRESETS = [60, 90, 120, 180];
const STAGE_COUNT_PRESETS = [1, 2, Math.min(3, BUILTIN_SCENES.length)];
const DIFF_COUNT_PRESETS = [5, 8, 10];
const MAX_PHOTO_DIMENSION = 900;
const MAX_PHOTO_BYTES = 170_000;

/** Downscales + JPEG-compresses an uploaded photo entirely client-side, so the resulting data URL stays small enough to broadcast over Supabase Realtime. */
async function compressImageToDataUrl(file: File): Promise<string> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    el.src = rawDataUrl;
  });
  const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이 브라우저는 이미지 편집을 지원하지 않습니다.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let quality = 0.8;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (out.length > MAX_PHOTO_BYTES * 1.4 && quality > 0.25) {
    quality -= 0.1;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}

export default function SpotDifferenceGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });

  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(4);

  // Host-only room settings, carried into `startGame` via the `game-start`
  // broadcast payload — same "ref snapshot -> payload -> state field"
  // pattern documented in grid-poker/engine.ts's `TimerSettings`.
  const [mode, setMode] = useState<GameMode>("builtin");
  const [stageCount, setStageCount] = useState(1);
  const [diffCount, setDiffCount] = useState(5);
  const [timerSeconds, setTimerSeconds] = useState(DEFAULT_TIMER_SECONDS);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<SeatIndex | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const [gameState, setGameState] = useState<SpotDifferenceState | null>(null);
  const [finalResult, setFinalResult] = useState<{ tied: boolean; winningTeam: TeamId } | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const startSentRef = useRef(false);
  const playerCountRef = useRef(targetPlayerCount);
  const sourceRef = useRef<StageSource>({ kind: "builtin" });
  const stageCountRef = useRef(stageCount);
  const diffCountRef = useRef(diffCount);
  const timerSecondsRef = useRef(timerSeconds);
  const isHost = intent === "create";

  const gameStateRef = useRef<SpotDifferenceState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    if (phase !== "playing") return;
    getSoundEngine().startBgm();
    return () => getSoundEngine().stopBgm();
  }, [phase]);

  async function handlePhotoSelected(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setPhotoDataUrl(dataUrl);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "사진을 처리하지 못했습니다.");
    } finally {
      setPhotoBusy(false);
    }
  }

  function enterRoom() {
    setFormError(null);
    getSoundEngine().unlock();
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
    if (intent === "create" && mode === "photo" && !photoDataUrl) {
      setFormError("먼저 사진을 업로드해주세요.");
      return;
    }
    playerCountRef.current = targetPlayerCount;
    sourceRef.current = mode === "photo" && photoDataUrl ? { kind: "photo", imageDataUrl: photoDataUrl } : { kind: "builtin" };
    stageCountRef.current = stageCount;
    diffCountRef.current = diffCount;
    timerSecondsRef.current = timerSeconds;
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
    const channel = supabase.channel(`spot-difference-room-${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: deviceId } },
    });
    channelRef.current = channel;
    startSentRef.current = false;

    channel.on("broadcast", { event: "game-start" }, ({ payload }) => {
      const seed = payload?.seed as number;
      const playerCount = payload?.playerCount as number;
      const source = (payload?.source as StageSource | undefined) ?? { kind: "builtin" };
      const stageCountPayload = payload?.stageCount as number | undefined;
      const diffCountPayload = payload?.diffCount as number | undefined;
      const timerSecondsPayload = payload?.timerSeconds as number | undefined;
      playerCountRef.current = playerCount;
      sourceRef.current = source;
      stageCountRef.current = stageCountPayload ?? 1;
      diffCountRef.current = diffCountPayload ?? 5;
      timerSecondsRef.current = timerSecondsPayload ?? DEFAULT_TIMER_SECONDS;
      setGameState(
        startGame(playerCount, seed, {
          source,
          stageCount: stageCountPayload,
          diffCount: diffCountPayload,
          timerSeconds: timerSecondsPayload,
        }),
      );
      setFinalResult(null);
      setPhase("playing");
    });

    channel.on("broadcast", { event: "game-action" }, ({ payload }) => {
      const action = payload?.action as EngineAction;
      setGameState((prev) => (prev ? applyAction(prev, action) : prev));
    });

    channel.on("broadcast", { event: "state-request" }, () => {
      if (gameStateRef.current) {
        channel.send({ type: "broadcast", event: "state-sync", payload: { state: gameStateRef.current } });
      }
    });

    channel.on("broadcast", { event: "state-sync" }, ({ payload }) => {
      const state = payload?.state as SpotDifferenceState | undefined;
      if (!state) return;
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
      payload: {
        seed: randomSeed(),
        playerCount: playerCountRef.current,
        source: sourceRef.current,
        stageCount: stageCountRef.current,
        diffCount: diffCountRef.current,
        timerSeconds: timerSecondsRef.current,
      },
    });
  }

  useEffect(() => {
    if (phase !== "waiting" || !isHost || startSentRef.current) return;
    if (occupants.length >= knownTargetPlayerCount) {
      sendGameStart();
    }
  }, [occupants, phase, knownTargetPlayerCount, isHost]);

  function handleAction(action: EngineAction) {
    channelRef.current?.send({ type: "broadcast", event: "game-action", payload: { action } });
  }

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
      map[seat] = seat === mySeat ? myName : (occ?.name ?? "상대");
    }
    return map;
  }, [occupants, mySeat, myName, gameState, knownTargetPlayerCount]);

  const connectedSeats = useMemo(() => new Set(occupants.map((o) => o.seat)), [occupants]);
  const previewTeamOf = useMemo(() => defaultTeamAssignment(knownTargetPlayerCount), [knownTargetPlayerCount]);

  function handleGameEnd() {
    if (!gameState || gameState.phase !== "gameOver") return;
    const rankings = computeRankings(gameState);
    const teamRanks = computeTeamRankings(gameState);
    const winningTeam = teamRanks[0].team;
    const tied = teamRanks.filter((r) => r.rank === 1).length > 1;
    onComplete({
      rankings: rankings.map((r) => ({ playerId: ids[r.seat], rank: r.rank })),
      finishedAt: new Date().toISOString(),
    });
    setFinalResult({ tied, winningTeam });
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
    setPhotoDataUrl(null);
    setPhotoError(null);
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
          틀린 그림 찾기는 실시간 온라인 대전 전용이라 Supabase 설정이 필요합니다.
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
          className="mt-2 rounded-full bg-fuchsia-600 px-5 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500"
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
          className="mt-2 rounded-full bg-fuchsia-600 px-5 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (phase === "choose") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <span className="text-4xl">🔍</span>
        <h2 className="text-lg font-bold text-white">틀린 그림 찾기 온라인 대전</h2>
        <p className="text-sm text-white/50">2~{MAX_PLAYERS}명이 두 팀으로 나뉘어 실시간으로 함께 찾아요.</p>
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white placeholder:text-white/20 focus:border-fuchsia-400 focus:outline-none"
            />
          </label>
        )}
        {intent === "create" && (
          <>
            <label className="flex flex-col gap-1.5 text-sm text-white/70">
              인원 수 (2~{MAX_PLAYERS}명, 팀은 자동으로 절반씩 나뉩니다)
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

            <div className="flex flex-col gap-1.5 text-sm text-white/70">
              게임 모드
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("builtin")}
                  className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs transition ${
                    mode === "builtin"
                      ? "border-fuchsia-400/60 bg-fuchsia-400/10 text-fuchsia-100"
                      : "border-white/15 text-white/60 hover:border-white/30"
                  }`}
                >
                  <p className="font-semibold">🖼️ 기본 스테이지</p>
                  <p className="text-white/50">준비된 그림 세트로 바로 시작</p>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("photo")}
                  className={`flex-1 rounded-xl border px-3 py-2 text-left text-xs transition ${
                    mode === "photo"
                      ? "border-fuchsia-400/60 bg-fuchsia-400/10 text-fuchsia-100"
                      : "border-white/15 text-white/60 hover:border-white/30"
                  }`}
                >
                  <p className="font-semibold">📸 내 사진으로 게임하기</p>
                  <p className="text-white/50">직접 업로드한 사진을 자동 변형</p>
                </button>
              </div>
            </div>

            {mode === "builtin" && (
              <label className="flex flex-col gap-1.5 text-sm text-white/70">
                스테이지 수 (스테이지당 차이 5개)
                <div className="flex gap-1.5">
                  {STAGE_COUNT_PRESETS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setStageCount(n)}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        stageCount === n
                          ? "border-fuchsia-400/60 bg-fuchsia-400/15 text-fuchsia-200"
                          : "border-white/15 text-white/60 hover:border-white/30"
                      }`}
                    >
                      {n}스테이지
                    </button>
                  ))}
                </div>
              </label>
            )}

            {mode === "photo" && (
              <div className="flex flex-col gap-1.5 text-sm text-white/70">
                사진 업로드
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handlePhotoSelected(e.target.files?.[0])}
                  className="text-xs text-white/60 file:mr-3 file:rounded-full file:border-0 file:bg-fuchsia-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-fuchsia-500"
                />
                {photoBusy && <p className="text-xs text-white/40">사진 처리 중...</p>}
                {photoError && <p className="text-xs text-rose-300">{photoError}</p>}
                {photoDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- client-only object/data URL preview, next/image would gain nothing here
                  <img src={photoDataUrl} alt="업로드한 사진 미리보기" className="mt-1 h-24 w-full rounded-lg object-cover" />
                )}
                <label className="mt-1 flex flex-col gap-1.5">
                  차이 개수
                  <div className="flex gap-1.5">
                    {DIFF_COUNT_PRESETS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setDiffCount(n)}
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          diffCount === n
                            ? "border-fuchsia-400/60 bg-fuchsia-400/15 text-fuchsia-200"
                            : "border-white/15 text-white/60 hover:border-white/30"
                        }`}
                      >
                        {n}곳
                      </button>
                    ))}
                  </div>
                </label>
              </div>
            )}

            <label className="flex flex-col gap-1.5 text-sm text-white/70">
              제한 시간
              <div className="flex flex-wrap gap-1.5">
                {TIMER_PRESETS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTimerSeconds(s)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      timerSeconds === s
                        ? "border-fuchsia-400/60 bg-fuchsia-400/15 text-fuchsia-200"
                        : "border-white/15 text-white/60 hover:border-white/30"
                    }`}
                  >
                    {s}초
                  </button>
                ))}
              </div>
            </label>
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
            disabled={photoBusy}
            className="flex-1 rounded-xl bg-fuchsia-600 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-40"
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
              {occupants.length} / {knownTargetPlayerCount}명 참여 중
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {Array.from({ length: knownTargetPlayerCount }, (_, seat) => {
                const occ = occupants.find((o) => o.seat === seat);
                const team = previewTeamOf[seat];
                return (
                  <p key={seat} className="text-sm text-white/70">
                    <span className={team === "A" ? "text-sky-300" : "text-rose-300"}>[{team}팀]</span>{" "}
                    {seat === mySeat ? "나" : `${seat + 1}번`}: {occ ? occ.name : <span className="text-white/30">대기 중...</span>}
                  </p>
                );
              })}
            </div>
            <p className="text-xs text-white/40">{knownTargetPlayerCount}명이 모이면 자동으로 게임이 시작됩니다.</p>
            {isHost && occupants.length >= MIN_PLAYERS && occupants.length < knownTargetPlayerCount && (
              <button
                onClick={sendGameStart}
                className="rounded-full bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white hover:bg-fuchsia-500"
              >
                지금 시작 ({occupants.length}명)
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  if (phase === "playing" && gameState && mySeat !== null) {
    return (
      <SpotDifferenceBoard
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
        <span className="text-4xl">{finalResult.tied ? "🤝" : "🏆"}</span>
        <p className="text-white/80">
          {finalResult.tied ? "두 팀이 비겼어요!" : `${finalResult.winningTeam === "A" ? "팀 A" : "팀 B"} 승리로 게임이 끝났어요.`}
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
            className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
          >
            다시하기
          </button>
        </div>
      </div>
    );
  }

  return null;
}
