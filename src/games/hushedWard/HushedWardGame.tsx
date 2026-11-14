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
import { BOT_LEVELS, DEFAULT_BOT_LEVEL, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { selfResult } from "@/games/shared/selfResult";
import { withUniqueNames } from "@/games/shared/room/uniqueNames";
import { botThink } from "./bot";
import { DEFAULT_OPTIONS, DIFFICULTIES, DIFFICULTY_INFO, GAME_ID, MAX_PLAYERS, MIN_PLAYERS, sanitizeOptions, talismansFor, type GameOptions } from "./data";
import { SnapBuffer, isSnap, makeSnap, stateFromSnap, type Snap } from "./net";
import { applyAct, applyReport, createHost, createMatch, hostStep, setAway, type GameEvent, type HostRuntime, type PlayerAct, type PosReport } from "./sim";
import { hushedWardStatDetails } from "./stats";
import HushedWardBoard from "./HushedWardBoard";

/**
 * 숨죽인 병동 온라인 방 (룰북 §9).
 *
 * 방 만들기·참여·좌석·초대 링크·봇 좌석은 다른 실시간 게임(살얼음 파티)과 같은 프로토콜.
 * 게임이 시작되면 **방장 기기가 판정(sim.ts)을** 돌리고 스냅샷을 10번/초 `snap`으로 보낸다.
 * 사람은 각자 기기에서 몸을 움직여 `pos`(10번/초)로 알리고, 문·약병·진정제는 `act`로 보낸다.
 *
 * 끊김 대응:
 * - 사람이 나가면 10초 뒤 그 자리를 AI 동료가 대신(🤖), 다시 들어오면 돌려받는다.
 * - **방장이 나가면** 3초 뒤 남은 사람 중 자리 번호가 가장 낮은 사람이 마지막 스냅샷으로 판을 이어받는다.
 * - 혼자 하기: 네트워크 없이 이 기기에서 (AI 동료 0~3명).
 */

const TICK_MS = 33;
const SNAP_MS = 100;
const LEAVE_GRACE_MS = 10_000;
const HOST_GRACE_MS = 3000;

type Occupant = {
  deviceId: string;
  seat: number;
  name: string;
  playerId?: string;
  isHost?: boolean;
  targetPlayerCount?: number;
  opts?: GameOptions;
};

type Phase = "choose" | "enter-name" | "practice" | "connecting" | "waiting" | "playing" | "post-game" | "room-full" | "supabase-missing" | "channel-error";

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getStoredSeat(code: string): number | null {
  try {
    const v = window.localStorage.getItem(`${GAME_ID}-seat-${code}`);
    if (v === null) return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

function storeSeat(code: string, seat: number) {
  try {
    window.localStorage.setItem(`${GAME_ID}-seat-${code}`, String(seat));
  } catch {
    /* 저장 못 해도 진행 */
  }
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
            className={`min-h-9 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              value === o.value ? "border-sky-400/70 bg-emerald-500/15 text-sky-100 light:text-sky-700" : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-500"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function GameOptionsForm({ options, setOptions }: { options: GameOptions; setOptions: (o: GameOptions) => void }) {
  return (
    <>
      <OptionRow label="난이도" value={options.difficulty} options={DIFFICULTIES.map((d) => ({ value: d, label: `${DIFFICULTY_INFO[d].emoji} ${DIFFICULTY_INFO[d].label}` }))} onChange={(v) => setOptions({ ...options, difficulty: v })} />
      <p className="-mt-2 text-xs break-keep text-white/45 light:text-slate-500">{DIFFICULTY_INFO[options.difficulty].desc}</p>
    </>
  );
}

export default function HushedWardGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });
  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join" | "practice">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(2);
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [practiceBots, setPracticeBots] = useState(0);
  const [practiceLevel, setPracticeLevel] = useState<BotLevel>(DEFAULT_BOT_LEVEL);
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

  /** 지금 이 기기가 판정(시뮬)을 돌리나 — 방 만든 사람, 연습, 또는 방장 승계 */
  const [amHost, setAmHost] = useState(false);
  const amHostRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [fresh, setFresh] = useState<{ events: GameEvent[]; seq: number }>({ events: [], seq: 0 });
  const [buf, setBuf] = useState<SnapBuffer>(() => new SnapBuffer());
  const bufRef = useRef<SnapBuffer>(buf);
  const hostRef = useRef<HostRuntime | null>(null);
  const seqRef = useRef(0);
  const freshSeq = useRef(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const playerCountRef = useRef(targetPlayerCount);
  const optionsRef = useRef(options);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const leftAtRef = useRef<Map<number, number>>(new Map());
  const hostGoneAtRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const practice = intent === "practice";

  const becomeHost = useCallback((v: boolean) => {
    amHostRef.current = v;
    setAmHost(v);
  }, []);

  /** 스냅샷 받기. 방장은 매 틱(33ms) 버퍼에 넣지만 화면(React)은 새 이벤트가 있거나 `render`일 때만 다시 그린다 — 3D는 버퍼를 직접 읽어 60fps로 움직인다. */
  const ingest = useCallback((s: Snap, render = true) => {
    const events = bufRef.current.push(s, performance.now());
    if (render || events.length > 0) setSnap(s);
    if (events.length > 0) setFresh({ events, seq: ++freshSeq.current });
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
    becomeHost(intent === "create");
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
      if (!isSnap(payload)) return;
      hostGoneAtRef.current = null;
      ingest(payload);
      if (phaseRef.current !== "playing" && (phaseRef.current !== "post-game" || payload.phase !== "gameOver")) {
        finishedRef.current = payload.phase === "gameOver" && phaseRef.current === "post-game";
        setPhase("playing");
      }
    });
    channel.on("broadcast", { event: "pos" }, ({ payload }) => {
      const rt = hostRef.current;
      if (!rt) return;
      applyReport(rt, Number(payload?.s), payload?.r as PosReport);
    });
    channel.on("broadcast", { event: "act" }, ({ payload }) => {
      const rt = hostRef.current;
      if (!rt) return;
      applyAct(rt, Number(payload?.s), payload?.a as PlayerAct);
    });
    channel.on("broadcast", { event: "bot-roster" }, ({ payload }) => {
      setBotSeats((payload?.botSeats as number[]) ?? []);
      setBotLevels((payload?.botLevels as BotLevel[]) ?? []);
    });
    channel.on("broadcast", { event: "state-request" }, () => {
      if (!amHostRef.current) return;
      channel.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: botSeatsRef.current, botLevels: botLevelsRef.current } });
      const rt = hostRef.current;
      if (rt) channel.send({ type: "broadcast", event: "snap", payload: makeSnap(rt.state, ++seqRef.current) });
    });

    let resolveFirst = () => {};
    const firstSync = new Promise<void>((r) => (resolveFirst = r));
    let saw = false;
    channel.on("presence", { event: "sync" }, () => {
      const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
      const list = withUniqueNames(Object.values(raw).flat());
      setOccupants(list);
      // 방장: 나갔던 사람이 돌아오면 AI에서 다시 사람으로
      const rt = hostRef.current;
      if (rt) {
        const here = new Set(list.map((o) => o.seat));
        for (const p of rt.state.players) {
          if (here.has(p.seat) && leftAtRef.current.has(p.seat)) leftAtRef.current.delete(p.seat);
          if (here.has(p.seat) && p.away) setAway(rt, p.seat, false);
        }
      }
      // 손님: 방장이 사라졌나
      if (!amHostRef.current) {
        if (list.some((o) => o.isHost)) hostGoneAtRef.current = null;
        else if (phaseRef.current === "playing" && hostGoneAtRef.current === null) hostGoneAtRef.current = Date.now();
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
        await channel.track({
          deviceId,
          seat,
          name: myName,
          playerId: myPlayerId,
          ...(amHostRef.current ? { isHost: true, targetPlayerCount: playerCountRef.current, opts: optionsRef.current } : {}),
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
  }, [roomCode, myName, myPlayerId, ingest]);

  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";
  const host = occupants.find((o) => o.isHost);
  const knownTarget = practice ? practiceBots + 1 : (host?.targetPlayerCount ?? targetPlayerCount);

  // 좌석 충돌 정리 (동시에 들어온 두 사람이 같은 자리)
  const reclaimRef = useRef(0);
  useEffect(() => {
    if (practice || mySeat === null || !roomCode || phase === "playing" || phase === "post-game" || phase === "room-full") return;
    const conflicting = occupants.filter((o) => o.seat === mySeat && o.deviceId !== deviceId);
    if (conflicting.length === 0 || !conflicting.some((o) => o.deviceId < deviceId)) return;
    if (reclaimRef.current++ >= 3) {
      // 대기실에서 자리를 계속 못 찾으면 꽉 찬 방으로 처리
      setPhase("room-full");
      return;
    }
    const taken = new Set([...occupants.filter((o) => o.deviceId !== deviceId).map((o) => o.seat), ...botSeatsRef.current]);
    let next = 0;
    while (taken.has(next)) next++;
    storeSeat(roomCode, next);
    setMySeat(next);
    channelRef.current?.track({ deviceId, seat: next, name: myName, playerId: myPlayerId, ...(amHostRef.current ? { isHost: true, targetPlayerCount: playerCountRef.current, opts: optionsRef.current } : {}) } satisfies Occupant);
  }, [occupants, mySeat, phase, deviceId, roomCode, myName, myPlayerId, practice]);

  // --- 방장: 시작 + 시뮬레이션 루프 ---------------------------------------
  const startGame = useCallback(() => {
    const isPractice = phaseRef.current === "practice" || intent === "practice";
    const humans = isPractice ? [0] : occupantsRef.current.map((o) => o.seat);
    const target = isPractice ? practiceBots + 1 : playerCountRef.current;
    // 연습은 고른 봇 수 그대로, 방은 실제로 찬 자리 수 (빈자리 유령 좌석 방지)
    const count = isPractice ? Math.min(MAX_PLAYERS, target) : Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.min(target, Math.max(humans.length + botSeatsRef.current.length, ...humans.map((s) => s + 1)))));
    const seats = Array.from({ length: count }, (_, s) => {
      if (isPractice) return s === 0 ? { bot: false, level: 5 } : { bot: true, level: practiceLevel };
      const bi = botSeatsRef.current.indexOf(s);
      if (bi >= 0) return { bot: true, level: botLevelsRef.current[bi] ?? DEFAULT_BOT_LEVEL };
      if (humans.includes(s)) return { bot: false, level: 5 };
      return { bot: true, level: DEFAULT_BOT_LEVEL };
    });
    const match = createMatch(Math.floor(Math.random() * 1e9), seats, isPractice ? options : optionsRef.current);
    hostRef.current = createHost(match, botThink);
    becomeHost(true);
    seqRef.current = 0;
    bufRef.current = new SnapBuffer();
    setBuf(bufRef.current);
    finishedRef.current = false;
    leftAtRef.current.clear();
    trackGameEvent(GAME_ID, "game_start");
    setPhase("playing");
  }, [intent, practiceBots, practiceLevel, options, becomeHost]);

  // 방장 루프 (방 만든 사람·연습·승계한 사람 모두)
  useEffect(() => {
    if (!amHost || (phase !== "playing" && phase !== "post-game")) return;
    let last = performance.now();
    let lastSnap = 0;
    let lastRender = 0;
    const id = window.setInterval(() => {
      const rt = hostRef.current;
      if (!rt) return;
      const now = performance.now();
      const dt = now - last;
      last = now;
      const before = rt.state.t;
      const beforePhase = rt.state.phase;
      hostStep(rt, dt);
      for (const [seat, at] of leftAtRef.current) {
        if (Date.now() - at > LEAVE_GRACE_MS && rt.state.players[seat] && !rt.state.players[seat].bot) setAway(rt, seat, true);
      }
      if (rt.state.t === before && rt.state.phase === beforePhase) return;
      const s = makeSnap(rt.state, ++seqRef.current);
      const render = now - lastRender >= 95;
      if (render) lastRender = now;
      ingest(s, render);
      if (channelRef.current && now - lastSnap >= SNAP_MS) {
        lastSnap = now;
        channelRef.current.send({ type: "broadcast", event: "snap", payload: s });
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [amHost, phase, ingest]);

  // 자동 시작: 자리가 다 차면
  useEffect(() => {
    if (phase !== "waiting" || !amHost || hostRef.current) return;
    // 자리가 다 찬 순간 한 번 시작 (startGame이 상태를 바꾸지만 hostRef로 다시 안 돈다)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (occupants.length + botSeats.length >= knownTarget) startGame();
  }, [occupants, botSeats, phase, knownTarget, amHost, startGame]);

  // 손님: 방장이 사라지면 승계
  useEffect(() => {
    if (practice || amHost || phase !== "playing" || mySeat === null) return;
    const id = window.setInterval(() => {
      const goneAt = hostGoneAtRef.current;
      const last = bufRef.current.latest();
      if (goneAt === null || !last || last.phase === "gameOver") {
        setNotice(null);
        return;
      }
      const left = HOST_GRACE_MS - (Date.now() - goneAt);
      const heirs = occupantsRef.current.filter((o) => !o.isHost && o.seat < last.seatCount).map((o) => o.seat);
      const heir = heirs.length ? Math.min(...heirs) : -1;
      if (left > 0) {
        setNotice("📡 방장 연결이 끊겼어요 — 잠깐만요…");
        return;
      }
      if (heir !== mySeat) {
        setNotice(heir >= 0 ? "📡 다른 사람이 판을 이어받는 중…" : "📡 방장을 기다리는 중…");
        return;
      }
      // 내가 이어받는다
      const state = stateFromSnap(last);
      const rt = createHost(state, botThink);
      const here = new Set(occupantsRef.current.map((o) => o.seat));
      for (const p of state.players) if (!p.bot && !here.has(p.seat)) setAway(rt, p.seat, true);
      hostRef.current = rt;
      seqRef.current = last.seq;
      hostGoneAtRef.current = null;
      leftAtRef.current.clear();
      becomeHost(true);
      setNotice("👑 방장이 나가서 내가 판을 이어받았어요");
      window.setTimeout(() => setNotice(null), 3500);
      channelRef.current?.track({ deviceId: getDeviceId(), seat: mySeat, name: myName, playerId: myPlayerId, isHost: true, targetPlayerCount: last.seatCount, opts: last.options } satisfies Occupant);
    }, 500);
    return () => window.clearInterval(id);
  }, [practice, amHost, phase, mySeat, myName, myPlayerId, becomeHost]);

  const rosterSend = (seats: number[], levels: BotLevel[]) => {
    setBotSeats(seats);
    setBotLevels(levels);
    botSeatsRef.current = seats;
    botLevelsRef.current = levels;
    channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: seats, botLevels: levels } });
  };
  const addBotAtSeat = (seat: number, level: BotLevel) => {
    if (!amHost || botSeats.includes(seat) || occupants.some((o) => o.seat === seat)) return;
    rosterSend([...botSeats, seat], [...botLevels, level]);
  };
  const fillEmpty = (level: BotLevel) => {
    if (!amHost) return;
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

  // --- 내 입력 보내기 -------------------------------------------------------
  const onReport = useCallback(
    (rep: PosReport) => {
      if (mySeat === null) return;
      const rt = hostRef.current;
      if (rt) applyReport(rt, mySeat, rep);
      else channelRef.current?.send({ type: "broadcast", event: "pos", payload: { s: mySeat, r: rep } });
    },
    [mySeat],
  );
  const onAct = useCallback(
    (act: PlayerAct) => {
      if (mySeat === null) return;
      const rt = hostRef.current;
      if (rt) applyAct(rt, mySeat, act);
      else channelRef.current?.send({ type: "broadcast", event: "act", payload: { s: mySeat, a: act } });
    },
    [mySeat],
  );

  // --- 이름 ----------------------------------------------------------------
  const names = useMemo(() => {
    const map: Record<number, string> = {};
    const count = snap?.seatCount ?? knownTarget;
    for (let s = 0; s < count; s++) {
      if (practice) {
        map[s] = s === 0 ? myName || "나" : botDisplayName(s - 1, practiceLevel);
        continue;
      }
      const occ = occupants.find((o) => o.seat === s);
      const bi = botSeats.indexOf(s);
      map[s] = s === mySeat ? myName : (occ?.name ?? (bi >= 0 ? botDisplayName(bi, botLevels[bi]) : snap?.players[s]?.bot ? `🤖 AI ${s + 1}` : `${s + 1}번`));
    }
    return map;
  }, [occupants, botSeats, botLevels, mySeat, myName, snap?.seatCount, snap?.players, knownTarget, practice, practiceLevel]);

  // --- 끝 -------------------------------------------------------------------
  useEffect(() => {
    if (!snap || snap.phase !== "gameOver" || finishedRef.current || mySeat === null) return;
    finishedRef.current = true;
    const ranks = snap.ranks ?? snap.players.map(() => 2);
    const rankings = snap.players.map((p) => ({ seat: p.seat, rank: ranks[p.seat] }));
    const ids = (seat: number) => (practice ? (seat === 0 ? "me" : `bot:${seat}`) : (occupants.find((o) => o.seat === seat)?.playerId ?? `${roomCode}:${seat}`));
    const t = window.setTimeout(() => {
      const lobbyBots = practice ? snap.players.filter((p) => p.bot).map((p) => p.seat) : botSeats;
      const lobbyLevels = practice ? lobbyBots.map(() => practiceLevel) : botLevels;
      const takeovers = Object.fromEntries(snap.players.filter((p) => p.away).map((p) => [String(p.seat), true]));
      onComplete({
        rankings: [...rankings].sort((a, b) => a.rank - b.rank).map((r) => ({ playerId: ids(r.seat), rank: r.rank })),
        self: selfResult(mySeat, rankings, { botSeats: lobbyBots, botLevels: lobbyLevels, takeovers }, (seat) => hushedWardStatDetails(snap, seat)),
        finishedAt: new Date().toISOString(),
      });
      setPhase("post-game");
    }, 3500);
    return () => window.clearTimeout(t);
  }, [snap, occupants, roomCode, mySeat, onComplete, practice, botSeats, botLevels, practiceLevel]);

  function handleLeave() {
    if (channelRef.current) getSupabase()?.removeChannel(channelRef.current);
    channelRef.current = null;
    hostRef.current = null;
    becomeHost(false);
    window.history.replaceState(null, "", window.location.pathname);
    setRoomCode(null);
    setMySeat(null);
    setOccupants([]);
    setSnap(null);
    setBotSeats([]);
    setBotLevels([]);
    setNotice(null);
    setIdentity({ name: "" });
    setCodeInput("");
    setIntent("create");
    setPhase("choose");
  }

  const shareUrl = typeof window !== "undefined" && roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";
  const inGame = roomCode !== null || (practice && (phase === "playing" || phase === "post-game"));
  const { exitConfirmOpen, cancelExit, confirmExit } = useGameLeaveGuard(inGame, handleLeave);
  useBackgroundResync(roomCode !== null, () => channelRef.current?.send({ type: "broadcast", event: "state-request", payload: {} }));
  useActiveRoomListing({
    gameId: GAME_ID,
    roomCode,
    isHost: amHost,
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
        <p className="text-sm text-white/60 light:text-slate-500">혼자 연습은 할 수 있어요.</p>
        <button onClick={() => setPhase("choose")} className="mt-2 rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-slate-900">
          처음으로
        </button>
      </div>,
    );
  if (phase === "room-full" || phase === "channel-error")
    return withGuard(
      <div className={`${box} border-rose-400/30 bg-rose-400/10`}>
        <span className="text-3xl">{phase === "room-full" ? "🚫" : "📡"}</span>
        <h2 className="text-lg font-bold text-white light:text-slate-900">{phase === "room-full" ? "이미 꽉 찬 방이에요" : "연결에 실패했습니다"}</h2>
        <button onClick={handleLeave} className="mt-2 rounded-full bg-amber-500 px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400">
          처음으로
        </button>
      </div>,
    );

  if (phase === "choose")
    return withGuard(
      <RulebookGate
        gameId={GAME_ID}
        icon="🔦"
        title="숨죽인 병동"
        description={
          <p className="break-keep text-sm text-white/50 light:text-slate-500">
            새벽 3시, 문 닫은 요양병원 3병동에 갇힌 1~4명이 손전등 하나씩 들고 빠져나가는 1인칭 3D 협동 공포 게임. 병동을 떠도는 청귀(聽鬼)는 눈이 멀어 <b>소리만</b> 들어요 — 걷는 소리, 문소리, 무서워서 뛰는 심장 소리까지. 앉아서 걷고, 벽에 붙어 숨을 참고, 약병을 던져 따돌리며 서랍 속 🧧 봉인 부적을 찾아 기도실 제단에 붙이면 현관이 열려요. 🔔 종이 세 번 울리면 멈추세요. 혼자서도, AI 동료(Lv.1~10)와도 할 수 있어요. 🔊 소리를 켜고 하세요.
          </p>
        }
        actions={
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => {
                setIntent("create");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-slate-900 transition hover:bg-emerald-400"
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
            <button
              onClick={() => {
                setIntent("practice");
                setPhase("practice");
              }}
              className="w-full rounded-xl border border-emerald-400/40 py-3 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300 light:text-emerald-700"
            >
              🔦 혼자 들어가기 (바로 시작)
            </button>
          </div>
        }
      />,
    );

  if (phase === "practice")
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 light:border-slate-200 light:bg-white light:shadow-sm">
        <h2 className="text-base font-bold text-white light:text-slate-900">🔦 혼자 들어가기</h2>
        <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} accent="emerald" />
        </div>
        <OptionRow label={`AI 동료 (봉인 부적 ${talismansFor(practiceBots + 1)}장 필요)`} value={practiceBots} options={[0, 1, 2, 3].map((n) => ({ value: n, label: n === 0 ? "없음 (혼자)" : `${n}명` }))} onChange={setPracticeBots} />
        {practiceBots > 0 && <OptionRow label="AI 동료 레벨" value={practiceLevel} options={BOT_LEVELS.map((lv) => ({ value: lv, label: `Lv.${lv}` }))} onChange={setPracticeLevel} />}
        <GameOptionsForm options={options} setOptions={setOptions} />
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
            뒤로
          </button>
          <button
            onClick={() => {
              setMyName(identity.name.trim() || "나");
              setMyPlayerId(identity.name.trim() ? identity.playerId : undefined);
              setMySeat(0);
              startGame();
            }}
            className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-slate-900 hover:bg-emerald-400"
          >
            시작
          </button>
        </div>
      </div>,
    );

  if (phase === "enter-name")
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white focus:border-emerald-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900"
            />
          </label>
        )}
        {intent === "create" && (
          <>
            <label className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              인원 수 ({MIN_PLAYERS}~{MAX_PLAYERS}명 · 봉인 부적 {talismansFor(targetPlayerCount)}장 필요)
              <div className="flex items-center gap-3">
                <button type="button" aria-label="인원 줄이기" onClick={() => setTargetPlayerCount((n) => Math.max(MIN_PLAYERS, n - 1))} className="h-9 w-9 rounded-full border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700">
                  −
                </button>
                <span className="w-8 text-center text-lg font-semibold text-white light:text-slate-900">{targetPlayerCount}</span>
                <button type="button" aria-label="인원 늘리기" onClick={() => setTargetPlayerCount((n) => Math.min(MAX_PLAYERS, n + 1))} className="h-9 w-9 rounded-full border border-white/15 text-white/80 light:border-slate-300 light:text-slate-700">
                  +
                </button>
              </div>
            </label>
            <GameOptionsForm options={options} setOptions={setOptions} />
          </>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-slate-900 hover:bg-emerald-400">
            {intent === "create" ? "방 만들기" : "참여하기"}
          </button>
        </div>
      </div>,
    );

  if (phase === "connecting" || phase === "waiting") {
    const filled = occupants.length + botSeats.length;
    const hostOpts = sanitizeOptions(amHost ? options : (host?.opts ?? options));
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
              {DIFFICULTY_INFO[hostOpts.difficulty].emoji} {DIFFICULTY_INFO[hostOpts.difficulty].label} · 봉인 부적 {talismansFor(knownTarget)}장 · 🔊 소리를 켜고 하세요
            </p>
            <p className="text-xs text-white/50 light:text-slate-500">
              {filled} / {knownTarget}명 참여 중
            </p>
            {amHost && filled < knownTarget && <FillEmptySeatsButton emptyCount={knownTarget - filled} onFill={fillEmpty} />}
            <div className="flex w-full max-w-sm flex-col gap-1.5">
              {Array.from({ length: knownTarget }, (_, seat) => {
                const occ = occupants.find((o) => o.seat === seat);
                const bi = botSeats.indexOf(seat);
                return (
                  <p key={seat} className="flex min-h-9 items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600">
                    <span>
                      {seat === mySeat ? "나" : `${seat + 1}번`}: {occ ? occ.name : bi >= 0 ? <BotSeatBadge label={botLabel(bi, botLevels[bi])} /> : <span className="text-white/30">대기 중...</span>}
                    </span>
                    {amHost && !occ && (bi >= 0 ? <RemoveBotButton onClick={() => removeBot(seat)} /> : <AddBotButton onAddWithLevel={(lv) => addBotAtSeat(seat, lv)} />)}
                  </p>
                );
              })}
            </div>
            {amHost && filled >= MIN_PLAYERS && filled < knownTarget && (
              <button onClick={startGame} className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-emerald-400">
                지금 시작 ({filled}명)
              </button>
            )}
            {amHost && filled < MIN_PLAYERS && <p className="text-xs text-white/40">최소 {MIN_PLAYERS}명이 필요해요.</p>}
            {!amHost && <p className="text-xs text-white/40">방장이 시작하면 바로 들어가요.</p>}
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
      <HushedWardBoard
        snap={snap}
        buf={buf}
        fresh={fresh}
        mySeat={mySeat}
        names={names}
        onReport={onReport}
        onAct={onAct}
        ended={phase === "post-game"}
        isHost={amHost}
        onRestart={amHost ? startGame : undefined}
        onLeave={handleLeave}
        practice={practice}
        notice={notice}
      />,
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
