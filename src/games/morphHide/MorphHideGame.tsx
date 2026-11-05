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
import { botDisplayName, botLabel } from "@/games/shared/bot/botNaming";
import { AddBotButton, BotSeatBadge, FillEmptySeatsButton, RemoveBotButton } from "@/components/lobby/BotSeatControls";
import RulebookGate from "@/components/lobby/RulebookGate";
import { DEFAULT_BOT_LEVEL, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { selfResult } from "@/games/shared/selfResult";
import { withUniqueNames } from "@/games/shared/room/uniqueNames";
import { DEFAULT_OPTIONS, MAX_PLAYERS, MIN_PLAYERS, type GameOptions } from "./data";
import { applyAct, applyPos, createHost, createMatch, hostStep, type Act, type HostRuntime, type PosReport } from "./sim";
import { SnapBuffer, makeSnap, type Snap } from "./net";
import type { FxItem } from "./three/World3D";
import MorphBoard from "./MorphBoard";

/**
 * 변신 숨바꼭질 온라인 방.
 *
 * 방 만들기·참여·좌석·초대 링크·봇 좌석은 다른 게임과 같은 프로토콜. 게임이 시작되면
 * **방장 기기가 시뮬레이션(sim.ts)을 20Hz로 돌리고** 스냅샷을 ~10번/초 `snap`으로 보낸다.
 * 다른 기기는 내 위치를 `pos`로(10번/초), 행동을 `act`로 보낸다(방장만 받는다).
 *
 * 알려진 한계: 방장이 창을 닫으면 판이 멈춘다(지렁이 게임과 같은 방식). 사람이 나가면
 * 10초 뒤 그 자리를 AI 봇이 이어받고, 다시 들어오면 돌려받는다.
 */

const GAME_ID = "morph-hide";
const TICK_MS = 50;
const SNAP_MS = 100;
const LEAVE_GRACE_MS = 10_000;

type Occupant = {
  deviceId: string;
  seat: number;
  name: string;
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
  opts?: GameOptions;
};

type Phase = "choose" | "enter-name" | "connecting" | "waiting" | "playing" | "post-game" | "room-full" | "supabase-missing" | "channel-error";

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredSeat(code: string): number | null {
  const v = window.localStorage.getItem(`${GAME_ID}-seat-${code}`);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function storeSeat(code: string, seat: number) {
  window.localStorage.setItem(`${GAME_ID}-seat-${code}`, String(seat));
}

function OptionRow<T extends string | number | boolean>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
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
              value === o.value ? "border-fuchsia-400/60 bg-fuchsia-400/10 text-fuchsia-100 light:text-fuchsia-700" : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-500"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MorphHideGame({ onComplete }: PlayableGameProps) {
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
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [myName, setMyName] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | undefined>(undefined);
  const [occupants, setOccupants] = useState<Occupant[]>([]);
  const occupantsRef = useRef<Occupant[]>([]);
  useEffect(() => {
    occupantsRef.current = occupants;
  }, [occupants]);

  const [botSeats, setBotSeats] = useState<number[]>([]);
  const [botLevels, setBotLevels] = useState<BotLevel[]>([]);
  const botSeatsRef = useRef<number[]>([]);
  const botLevelsRef = useRef<BotLevel[]>([]);
  useEffect(() => {
    botSeatsRef.current = botSeats;
    botLevelsRef.current = botLevels;
  }, [botSeats, botLevels]);

  const [snap, setSnap] = useState<Snap | null>(null);
  const [fx, setFx] = useState<FxItem[]>([]);
  const [buf, setBuf] = useState<SnapBuffer>(() => new SnapBuffer());
  const bufRef = useRef<SnapBuffer>(buf);
  const hostRef = useRef<HostRuntime | null>(null);
  const seqRef = useRef(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isHost = intent === "create";
  const playerCountRef = useRef(targetPlayerCount);
  const optionsRef = useRef(options);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const leftAtRef = useRef<Map<number, number>>(new Map());
  const finishedRef = useRef(false);

  const ingest = useCallback((s: Snap) => {
    const fresh = bufRef.current.push(s, performance.now());
    setSnap(s);
    if (fresh.length > 0) {
      const now = performance.now();
      setFx((prev) => [...prev.filter((f) => now - f.at < 6000), ...fresh.map((ev) => ({ ev, at: now }))]);
    }
  }, []);

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

  // --- 채널 ---------------------------------------------------------------
  useEffect(() => {
    if (!roomCode) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const deviceId = getDeviceId();
    const channel = supabase.channel(`${GAME_ID}-room-${roomCode}`, { config: { broadcast: { self: false }, presence: { key: deviceId } } });
    channelRef.current = channel;

    channel.on("broadcast", { event: "snap" }, ({ payload }) => {
      if (hostRef.current) return;
      const s = payload as Snap;
      if (!s || !Array.isArray(s.players)) return;
      ingest(s);
      if (phaseRef.current !== "playing" && (phaseRef.current !== "post-game" || s.phase !== "gameOver")) {
        finishedRef.current = s.phase === "gameOver" && phaseRef.current === "post-game";
        setPhase("playing");
      }
    });
    channel.on("broadcast", { event: "pos" }, ({ payload }) => {
      const rt = hostRef.current;
      if (!rt) return;
      applyPos(rt, Number(payload?.s), payload?.p as PosReport);
    });
    channel.on("broadcast", { event: "act" }, ({ payload }) => {
      const rt = hostRef.current;
      if (!rt) return;
      applyAct(rt, Number(payload?.s), payload?.a as Act);
    });
    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      setBotSeats((payload?.botSeats as number[]) ?? []);
      setBotLevels((payload?.botLevels as BotLevel[]) ?? []);
    });
    channel.on("broadcast", { event: "state-request" }, () => {
      if (!isHost) return;
      channel.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: botSeatsRef.current, botLevels: botLevelsRef.current } });
    });

    let resolveFirst = () => {};
    const firstSync = new Promise<void>((r) => (resolveFirst = r));
    let saw = false;
    channel.on("presence", { event: "sync" }, () => {
      const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
      const list = withUniqueNames(Object.values(raw).flat());
      setOccupants(list);
      // 방장: 나갔던 사람이 돌아오면 봇에서 다시 사람으로
      const rt = hostRef.current;
      if (rt) {
        const here = new Set(list.map((o) => o.seat));
        for (const p of rt.state.players) {
          if (here.has(p.seat) && leftAtRef.current.has(p.seat)) {
            leftAtRef.current.delete(p.seat);
            if (!botSeatsRef.current.includes(p.seat)) p.bot = false;
          }
        }
      }
      if (!saw) {
        saw = true;
        resolveFirst();
      }
    });
    channel.on("presence", { event: "leave" }, ({ leftPresences }) => {
      if (!hostRef.current) return;
      for (const p of leftPresences as unknown as Occupant[]) leftAtRef.current.set(p.seat, Date.now());
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await Promise.race([firstSync, new Promise((r) => setTimeout(r, 800))]);
        let seat = getStoredSeat(roomCode);
        if (seat === null) {
          const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
          const existing = Object.values(raw).flat();
          const taken = new Set([...existing.map((o) => o.seat), ...botSeatsRef.current]);
          seat = 0;
          while (taken.has(seat)) seat++;
          const hostRecord = existing.find((o) => o.isHost);
          if (hostRecord && seat >= (hostRecord.targetPlayerCount ?? MAX_PLAYERS)) {
            setPhase("room-full");
            return;
          }
          storeSeat(roomCode, seat);
        }
        setMySeat(seat);
        await channel.track({ deviceId, seat, name: myName, playerId: myPlayerId, ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current, opts: optionsRef.current } : {}) } satisfies Occupant);
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
  }, [roomCode, myName, myPlayerId, isHost, ingest]);

  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";
  const host = occupants.find((o) => o.isHost);
  const knownTarget = host?.targetPlayerCount ?? targetPlayerCount;

  // 좌석 충돌 정리 (동시에 들어온 두 사람이 같은 자리)
  const reclaimRef = useRef(0);
  useEffect(() => {
    if (mySeat === null || !roomCode || phase === "playing" || phase === "post-game" || phase === "room-full") return;
    const conflicting = occupants.filter((o) => o.seat === mySeat && o.deviceId !== deviceId);
    if (conflicting.length === 0 || !conflicting.some((o) => o.deviceId < deviceId)) return;
    if (reclaimRef.current++ >= 3) {
      setPhase("room-full");
      return;
    }
    const taken = new Set([...occupants.filter((o) => o.deviceId !== deviceId).map((o) => o.seat), ...botSeatsRef.current]);
    let next = 0;
    while (taken.has(next)) next++;
    storeSeat(roomCode, next);
    setMySeat(next);
    channelRef.current?.track({ deviceId, seat: next, name: myName, playerId: myPlayerId, ...(isHost ? { isHost: true, targetPlayerCount: playerCountRef.current, opts: optionsRef.current } : {}) } satisfies Occupant);
  }, [occupants, mySeat, phase, deviceId, roomCode, myName, myPlayerId, isHost]);

  // --- 방장: 시작 + 시뮬레이션 루프 ---------------------------------------
  const startGame = useCallback(() => {
    const humans = occupantsRef.current.map((o) => o.seat);
    const count = Math.max(MIN_PLAYERS, Math.min(playerCountRef.current, Math.max(humans.length + botSeatsRef.current.length, ...humans.map((s) => s + 1))));
    const seats = Array.from({ length: count }, (_, s) => {
      const bi = botSeatsRef.current.indexOf(s);
      if (bi >= 0) return { bot: true, level: botLevelsRef.current[bi] ?? DEFAULT_BOT_LEVEL };
      if (humans.includes(s)) return { bot: false, level: 5 };
      return { bot: true, level: DEFAULT_BOT_LEVEL };
    });
    const match = createMatch(Math.floor(Math.random() * 1e9), seats, optionsRef.current);
    hostRef.current = createHost(match);
    bufRef.current = new SnapBuffer();
    setBuf(bufRef.current);
    finishedRef.current = false;
    leftAtRef.current.clear();
    setFx([]);
    trackGameEvent(GAME_ID, "game_start");
    setPhase("playing");
  }, []);

  useEffect(() => {
    if (!isHost || phase !== "playing") return;
    let last = performance.now();
    let lastSnap = 0;
    const id = window.setInterval(() => {
      const rt = hostRef.current;
      if (!rt) return;
      const now = performance.now();
      let dt = now - last;
      last = now;
      // 탭이 잠깐 멈췄다 돌아와도 한 번에 너무 많이 건너뛰지 않게
      dt = Math.min(dt, 250);
      while (dt > 0) {
        const step = Math.min(TICK_MS, dt);
        hostStep(rt, step);
        dt -= step;
      }
      // 나간 사람 자리 → 봇
      for (const [seat, at] of leftAtRef.current) {
        if (Date.now() - at > LEAVE_GRACE_MS && rt.state.players[seat]) rt.state.players[seat].bot = true;
      }
      if (now - lastSnap >= SNAP_MS) {
        lastSnap = now;
        const s = makeSnap(rt.state, ++seqRef.current);
        ingest(s);
        channelRef.current?.send({ type: "broadcast", event: "snap", payload: s });
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [isHost, phase, ingest]);

  useEffect(() => {
    if (phase !== "waiting" || !isHost || hostRef.current) return;
    if (occupants.length + botSeats.length >= knownTarget) startGame();
  }, [occupants, botSeats, phase, knownTarget, isHost, startGame]);

  const rosterSend = (seats: number[], levels: BotLevel[]) => {
    setBotSeats(seats);
    setBotLevels(levels);
    botSeatsRef.current = seats;
    botLevelsRef.current = levels;
    channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: seats, botLevels: levels } });
  };
  const addBotAtSeat = (seat: number, level: BotLevel) => {
    if (!isHost || botSeats.includes(seat) || occupants.some((o) => o.seat === seat)) return;
    rosterSend([...botSeats, seat], [...botLevels, level]);
  };
  const fillEmpty = (level: BotLevel) => {
    if (!isHost) return;
    const taken = new Set([...occupants.map((o) => o.seat), ...botSeats]);
    const empty = Array.from({ length: knownTarget }, (_, s) => s).filter((s) => !taken.has(s));
    rosterSend([...botSeats, ...empty], [...botLevels, ...empty.map(() => level)]);
  };
  const removeBot = (seat: number) => {
    const i = botSeats.indexOf(seat);
    if (i < 0) return;
    rosterSend(
      botSeats.filter((_, j) => j !== i),
      botLevels.filter((_, j) => j !== i),
    );
  };

  // --- 내 위치·행동 보내기 -------------------------------------------------
  const onPos = useCallback(
    (p: PosReport) => {
      if (mySeat === null) return;
      const rt = hostRef.current;
      if (rt) applyPos(rt, mySeat, p);
      else channelRef.current?.send({ type: "broadcast", event: "pos", payload: { s: mySeat, p } });
    },
    [mySeat],
  );
  const onAct = useCallback(
    (a: Act) => {
      if (mySeat === null) return;
      const rt = hostRef.current;
      if (rt) applyAct(rt, mySeat, a);
      else channelRef.current?.send({ type: "broadcast", event: "act", payload: { s: mySeat, a } });
    },
    [mySeat],
  );

  // --- 이름 ----------------------------------------------------------------
  const names = useMemo(() => {
    const map: Record<number, string> = {};
    const count = snap?.seatCount ?? knownTarget;
    for (let s = 0; s < count; s++) {
      const occ = occupants.find((o) => o.seat === s);
      const bi = botSeats.indexOf(s);
      map[s] = s === mySeat ? myName : (occ?.name ?? (bi >= 0 ? botDisplayName(bi, botLevels[bi]) : snap?.players[s]?.bot ? `🤖 AI ${s + 1}` : `${s + 1}번`));
    }
    return map;
  }, [occupants, botSeats, botLevels, mySeat, myName, snap?.seatCount, snap?.players, knownTarget]);

  // --- 끝 -------------------------------------------------------------------
  useEffect(() => {
    if (!snap || snap.phase !== "gameOver" || finishedRef.current) return;
    finishedRef.current = true;
    const sorted = [...snap.players].sort((a, b) => b.score - a.score);
    let rank = 0;
    let last = Infinity;
    const rankings = sorted.map((p, i) => {
      if (p.score !== last) {
        rank = i + 1;
        last = p.score;
      }
      return { seat: p.s, rank };
    });
    const ids = (seat: number) => occupants.find((o) => o.seat === seat)?.playerId ?? `${roomCode}:${seat}`;
    const t = window.setTimeout(() => {
      onComplete({
        rankings: rankings.map((r) => ({ playerId: ids(r.seat), rank: r.rank })),
        self: selfResult(mySeat, rankings, { botSeats: snap.players.filter((p) => p.bot).map((p) => p.s), botLevels: [] }, (seat): Record<string, number> => {
          const p = snap.players[seat];
          const st = p.stats;
          return {
            score: p.score,
            maxScore: p.score,
            catches: st?.catches ?? 0,
            maxCatches: st?.maxCatches ?? 0,
            survives: st?.survives ?? 0,
            escapes: st?.escapes ?? 0,
            wrongHits: st?.wrongHits ?? 0,
            decoys: st?.decoys ?? 0,
            emotes: st?.emotes ?? 0,
            seekerWins: st?.seekerWins ?? 0,
          };
        }),
        finishedAt: new Date().toISOString(),
      });
      setPhase("post-game");
    }, 6000);
    return () => window.clearTimeout(t);
  }, [snap, occupants, roomCode, mySeat, onComplete]);

  function handleLeave() {
    if (channelRef.current) getSupabase()?.removeChannel(channelRef.current);
    channelRef.current = null;
    hostRef.current = null;
    window.history.replaceState(null, "", window.location.pathname);
    setRoomCode(null);
    setMySeat(null);
    setOccupants([]);
    setSnap(null);
    setFx([]);
    setBotSeats([]);
    setBotLevels([]);
    setIdentity({ name: "" });
    setCodeInput("");
    setPhase("choose");
  }

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";
  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(roomCode !== null, handleLeave);
  useBackgroundResync(roomCode !== null, () => channelRef.current?.send({ type: "broadcast", event: "state-request", payload: {} }));
  useActiveRoomListing({
    gameId: GAME_ID,
    roomCode,
    isHost,
    isWaiting: phase === "waiting",
    isPlaying: phase === "playing",
    hostName: myName,
    playerCount: occupants.length,
    occupants,
    maxPlayers: knownTarget,
    unlisted: false,
  });

  function withGuard(node: ReactNode) {
    return (
      <>
        {node}
        <GameLeaveGuardModal open={exitConfirmOpen} onCancel={cancelExit} onConfirm={confirmExit} />
      </>
    );
  }

  const box = "flex flex-col items-center gap-3 rounded-2xl border p-8 text-center light:shadow-sm";
  if (phase === "supabase-missing")
    return withGuard(
      <div className={`${box} border-amber-400/30 bg-amber-400/10`}>
        <span className="text-3xl">⚠️</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">온라인 방을 사용할 수 없어요</h2>
      </div>,
    );
  if (phase === "room-full" || phase === "channel-error")
    return withGuard(
      <div className={`${box} border-rose-400/30 bg-rose-400/10`}>
        <span className="text-3xl">{phase === "room-full" ? "🚫" : "📡"}</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">{phase === "room-full" ? "이미 꽉 찬 방이에요" : "연결에 실패했습니다"}</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-fuchsia-600 px-5 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500">
          처음으로
        </button>
      </div>,
    );

  if (phase === "choose")
    return withGuard(
      <RulebookGate
        gameId={GAME_ID}
        icon="🦎"
        title="변신 숨바꼭질"
        description={
          <p className="break-keep text-sm text-white/50 light:text-slate-500">
            숨는 사람은 카드 3장 중 하나를 골라 쓰레기통·벤치·행인·강아지·“술래인 척 점검원”으로 변신해 저택·골목·건널목·공원에 숨어요. 술래는 맨손에서 시작해 시간이 지날수록 뿅망치·권총·저격총으로 무기가 바뀌지만, 엉뚱한 걸 치면 체력이 깎여요. 자세 바꾸기·분신 만들기·감정표현·문/창문/보물상자·점프 파쿠르, 꼼꼼이(찜 장소) 모드까지. 2~8명, 빈자리는 AI 봇.
          </p>
        }
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
                trackGameEvent(GAME_ID, "invite_click");
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

  if (phase === "enter-name") {
    const setOpt = <K extends keyof GameOptions>(k: K, v: GameOptions[K]) => setOptions((o) => ({ ...o, [k]: v }));
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 light:border-slate-200 light:bg-white light:shadow-sm">
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white focus:border-fuchsia-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900"
            />
          </label>
        )}
        {intent === "create" && (
          <>
            <label className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              인원 수 ({MIN_PLAYERS}~{MAX_PLAYERS}명 · 6명부터 술래 2명)
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setTargetPlayerCount((n) => Math.max(MIN_PLAYERS, n - 1))} className="h-8 w-8 rounded-full border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700">
                  −
                </button>
                <span className="w-8 text-center text-lg font-semibold text-white light:text-slate-900">{targetPlayerCount}</span>
                <button type="button" onClick={() => setTargetPlayerCount((n) => Math.min(MAX_PLAYERS, n + 1))} className="h-8 w-8 rounded-full border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700">
                  +
                </button>
              </div>
            </label>
            <OptionRow
              label="술래 시간 (길수록 무기 단계가 잘게 나뉘어요)"
              value={options.huntSec}
              options={[
                { value: 180, label: "3분 · 무기 4단계" },
                { value: 300, label: "5분 · 5단계" },
                { value: 420, label: "7분 · 6단계" },
              ]}
              onChange={(v) => setOpt("huntSec", v)}
            />
            <OptionRow label="라운드 수 (매 라운드 술래가 바뀌어요)" value={options.rounds} options={[2, 3, 4, 6].map((n) => ({ value: n, label: `${n}라운드` }))} onChange={(v) => setOpt("rounds", v)} />
            <OptionRow
              label="게임 모드"
              value={options.goalMode}
              options={[
                { value: false, label: "🫣 숨바꼭질" },
                { value: true, label: "🏁 꼼꼼이 (찜 장소)" },
              ]}
              onChange={(v) => setOpt("goalMode", v)}
            />
            {options.goalMode && <p className="break-keep text-xs text-amber-200/80 light:text-amber-700">술래 시간이 절반 지나면 랜덤 장소에 🏁 찜 장소가 열려요. 숨는 사람이 그곳에 닿으면 탈출 성공(+4점)!</p>}
          </>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
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
    const hostOpts = host?.opts ?? options;
    return withGuard(
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center light:border-slate-200 light:bg-white light:shadow-sm">
        {phase === "connecting" ? (
          <p className="text-sm text-white/50 light:text-slate-500">연결하는 중...</p>
        ) : (
          <>
            <p className="text-sm text-white/50 light:text-slate-500">초대 코드</p>
            <p className="text-4xl font-bold tracking-[0.3em] text-white light:text-slate-900">{roomCode}</p>
            <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70 light:border-slate-300 light:text-slate-600">
              🔗 초대 링크 복사
            </button>
            <p className="text-xs text-white/40 light:text-slate-400">
              {hostOpts.goalMode ? "🏁 꼼꼼이" : "🫣 숨바꼭질"} · 술래 {hostOpts.huntSec / 60}분 · {hostOpts.rounds}라운드
            </p>
            <p className="text-xs text-white/50 light:text-slate-500">
              {filled} / {knownTarget}명 참여 중
            </p>
            {isHost && filled < knownTarget && <FillEmptySeatsButton emptyCount={knownTarget - filled} onFill={fillEmpty} />}
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: knownTarget }, (_, seat) => {
                const occ = occupants.find((o) => o.seat === seat);
                const bi = botSeats.indexOf(seat);
                return (
                  <p key={seat} className="flex items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600">
                    <span>
                      {seat === mySeat ? "나" : `${seat + 1}번`}: {occ ? occ.name : bi >= 0 ? <BotSeatBadge label={botLabel(bi, botLevels[bi])} /> : <span className="text-white/30">대기 중...</span>}
                    </span>
                    {isHost && !occ && <span>{bi >= 0 ? <RemoveBotButton onClick={() => removeBot(seat)} /> : <AddBotButton onAddWithLevel={(lv) => addBotAtSeat(seat, lv)} />}</span>}
                  </p>
                );
              })}
            </div>
            {isHost && filled >= MIN_PLAYERS && filled < knownTarget && (
              <button onClick={startGame} className="rounded-full bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white hover:bg-fuchsia-500">
                지금 시작 ({filled}명)
              </button>
            )}
            {!isHost && <p className="text-xs text-white/40">방장이 시작하면 바로 들어가요.</p>}
          </>
        )}
      </div>,
    );
  }

  if ((phase === "playing" || phase === "post-game") && snap && mySeat !== null) {
    if (mySeat >= snap.seatCount)
      return withGuard(
        <div className={`${box} border-white/10 bg-white/[0.03]`}>
          <p className="text-sm text-white/70">게임이 이미 {snap.seatCount}명으로 시작됐어요. 다음 판을 기다려 주세요.</p>
          <button onClick={handleLeave} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70">
            나가기
          </button>
        </div>,
      );
    return withGuard(
      <div className="flex flex-col gap-2">
        <MorphBoard snap={snap} buf={buf} mySeat={mySeat} names={names} fx={fx} onPos={onPos} onAct={onAct} />
        {phase === "post-game" && (
          <div className="flex justify-center gap-2">
            <button onClick={handleLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
              나가기
            </button>
            {isHost && (
              <button onClick={startGame} className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500">
                다시하기
              </button>
            )}
          </div>
        )}
      </div>,
    );
  }

  if (phase === "playing")
    return withGuard(
      <div className={`${box} border-white/10 bg-white/[0.03]`}>
        <p className="text-sm text-white/60">게임 화면을 불러오는 중…</p>
      </div>,
    );
  return withGuard(null);
}
