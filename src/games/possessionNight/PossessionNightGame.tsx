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
import { DEFAULT_OPTIONS, DIFFICULTIES, DIFFICULTY_INFO, GAME_ID, MAX_PLAYERS, MIN_PLAYERS, cursesFor, sanitizeOptions, soulsFor, type GameOptions } from "./data";
import { SnapBuffer, isSnap, makeSnap, stateFromSnap, type Snap } from "./net";
import { applyAct, applyReport, createHost, createMatch, hostStep, rebuildSecrets, setAway, type GameEvent, type HostRuntime, type MatchState, type PlayerAct, type PosReport } from "./sim";
import { possessionNightStatDetails } from "./stats";
import PossessionNightBoard from "./PossessionNightBoard";

/**
 * 빙의의 밤 온라인 방 (룰북 §9).
 *
 * 방 만들기·참여·좌석·초대 링크·봇 좌석은 마네킹 백화점과 같은 프로토콜(그 방 셸을 복사).
 * **판정(sim.ts)은 원귀 자리의 기기가 돌린다** — 원귀의 위치를 그 기기만 알게 하려고. 방장이 판을 만들면
 * 원귀가 사람일 때 곧바로 `handoff`로 판정을 원귀 기기에 넘기고(받는 쪽이 원귀 자리·물건 자리를 새로 정한다),
 * 원귀가 봇이면 방장 기기가 그대로 돌린다(그때는 방장 기기만 원귀 위치를 안다).
 * 판정 기기는 presence에 `isHost`를 달고 스냅샷을 10번/초 `snap`으로 보낸다(원귀 좌표·숨은 물건은 지운 것).
 *
 * 끊김 대응:
 * - 사람이 나가면 10초 뒤 그 자리를 봇이 대신(🤖), 다시 들어오면 돌려받는다. 원귀가 돌아오면 판정도 돌려받는다.
 * - **판정 기기가 나가면** 3초 뒤 원귀 자리(있으면) 또는 자리 번호가 가장 낮은 사람이 마지막 스냅샷으로 이어받는다.
 * - 혼자 하기: 네트워크 없이 이 기기에서 (봇 2~5명, 내가 퇴마사 또는 원귀).
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
  /** 지금 판정을 돌리는 기기 (대기실에선 방 만든 사람) */
  isHost?: boolean;
  /** 방 만든 사람 (인원·옵션의 주인) */
  isOwner?: boolean;
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
              value === o.value ? "border-cyan-300/70 bg-cyan-500/15 text-cyan-100 light:text-cyan-700" : "border-white/15 text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-500"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DifficultyForm({ options, setOptions }: { options: GameOptions; setOptions: (o: GameOptions) => void }) {
  return (
    <>
      <OptionRow label="밤의 어둠 (난이도 — 퇴마사 기준)" value={options.difficulty} options={DIFFICULTIES.map((d) => ({ value: d, label: `${DIFFICULTY_INFO[d].emoji} ${DIFFICULTY_INFO[d].label}` }))} onChange={(v) => setOptions({ ...options, difficulty: v })} />
      <p className="-mt-2 text-xs break-keep text-white/45 light:text-slate-500">{DIFFICULTY_INFO[options.difficulty].desc}</p>
    </>
  );
}

function pickGhost(opt: GameOptions["ghost"], count: number): number {
  if (typeof opt === "number" && opt < count) return opt;
  return Math.floor(Math.random() * count);
}

export default function PossessionNightGame({ onComplete }: PlayableGameProps) {
  const [roomFromUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });
  const [phase, setPhase] = useState<Phase>(roomFromUrl ? "enter-name" : "choose");
  const [intent, setIntent] = useState<"create" | "join" | "practice">(roomFromUrl ? "join" : "create");
  const [identity, setIdentity] = useState<RoomIdentityValue>({ name: "" });
  const [codeInput, setCodeInput] = useState(roomFromUrl ?? "");
  const [targetPlayerCount, setTargetPlayerCount] = useState(4);
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [practiceBots, setPracticeBots] = useState(3);
  const [practiceLevel, setPracticeLevel] = useState<BotLevel>(DEFAULT_BOT_LEVEL);
  const [practiceRole, setPracticeRole] = useState<"hunter" | "ghost">("hunter");
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

  /** 방 만든 사람인가 (인원·옵션·다시 하기의 주인) */
  const [isOwner, setIsOwner] = useState(false);
  const isOwnerRef = useRef(false);
  /** 지금 이 기기가 판정을 돌리나 */
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
  const mySeatRef = useRef<number | null>(null);
  useEffect(() => {
    mySeatRef.current = mySeat;
  }, [mySeat]);
  const leftAtRef = useRef<Map<number, number>>(new Map());
  const hostGoneAtRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const practice = intent === "practice";

  const becomeHost = useCallback((v: boolean) => {
    amHostRef.current = v;
    setAmHost(v);
  }, []);

  /** 스냅샷 받기. 판정 기기는 매 틱(33ms) 버퍼에 넣지만 화면(React)은 새 이벤트가 있거나 `render`일 때만 다시 그린다. */
  const ingest = useCallback((s: Snap, render = true) => {
    const events = bufRef.current.push(s, performance.now());
    if (render || events.length > 0) setSnap(s);
    if (events.length > 0) setFresh({ events, seq: ++freshSeq.current });
  }, []);

  const trackMe = useCallback(
    (seat: number, host: boolean, extra?: Partial<Occupant>) => {
      channelRef.current?.track({
        deviceId: getDeviceId(),
        seat,
        name: myName,
        playerId: myPlayerId,
        ...(host ? { isHost: true } : {}),
        ...(isOwnerRef.current ? { isOwner: true, targetPlayerCount: playerCountRef.current, opts: optionsRef.current } : {}),
        ...extra,
      } satisfies Occupant);
    },
    [myName, myPlayerId],
  );

  /** 이 상태로 판정을 맡는다 (비밀이 지워진 것이면 새로 정한다) */
  const takeOver = useCallback(
    (state: MatchState, seq: number, msg: string | null) => {
      rebuildSecrets(state);
      const rt = createHost(state, botThink);
      const here = new Set(occupantsRef.current.map((o) => o.seat));
      const me = mySeatRef.current;
      for (const p of state.players) {
        if (p.bot) continue;
        setAway(rt, p.seat, !(here.has(p.seat) || p.seat === me));
      }
      hostRef.current = rt;
      seqRef.current = seq;
      hostGoneAtRef.current = null;
      leftAtRef.current.clear();
      becomeHost(true);
      if (me !== null) trackMe(me, true);
      if (msg) {
        setNotice(msg);
        window.setTimeout(() => setNotice(null), 3500);
      }
    },
    [becomeHost, trackMe],
  );

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
    isOwnerRef.current = intent === "create";
    setIsOwner(intent === "create");
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
    channel.on("broadcast", { event: "handoff" }, ({ payload }) => {
      // 판정을 원귀 기기에 넘긴다 — 받는 사람만 맡는다
      const snapIn = payload?.snap;
      if (!isSnap(snapIn) || Number(payload?.to) !== mySeatRef.current || hostRef.current) return;
      ingest(snapIn);
      takeOver(stateFromSnap(snapIn), snapIn.seq, null);
      if (phaseRef.current !== "playing") {
        finishedRef.current = false;
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
      if (isOwnerRef.current) channel.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: botSeatsRef.current, botLevels: botLevelsRef.current } });
      const rt = hostRef.current;
      if (rt) channel.send({ type: "broadcast", event: "snap", payload: makeSnap(rt.state, ++seqRef.current, false) });
    });

    let resolveFirst = () => {};
    const firstSync = new Promise<void>((r) => (resolveFirst = r));
    let saw = false;
    channel.on("presence", { event: "sync" }, () => {
      const raw = channel.presenceState() as RealtimePresenceState<Occupant>;
      const list = withUniqueNames(Object.values(raw).flat());
      setOccupants(list);
      // 판정 기기: 나갔던 사람이 돌아오면 봇에서 다시 사람으로
      const rt = hostRef.current;
      if (rt) {
        const here = new Set(list.map((o) => o.seat));
        for (const p of rt.state.players) {
          if (here.has(p.seat) && leftAtRef.current.has(p.seat)) leftAtRef.current.delete(p.seat);
          if (here.has(p.seat) && p.away) setAway(rt, p.seat, false);
        }
      }
      // 손님: 판정 기기가 사라졌나
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
          const owner = existing.find((o) => o.isOwner);
          if (owner && seat >= (owner.targetPlayerCount ?? MAX_PLAYERS)) {
            setPhase("room-full");
            return;
          }
          storeSeat(roomCode, seat);
        }
        setMySeat(seat);
        mySeatRef.current = seat;
        await channel.track({
          deviceId,
          seat,
          name: myName,
          playerId: myPlayerId,
          ...(amHostRef.current ? { isHost: true } : {}),
          ...(isOwnerRef.current ? { isOwner: true, targetPlayerCount: playerCountRef.current, opts: optionsRef.current } : {}),
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
  }, [roomCode, myName, myPlayerId, ingest, takeOver]);

  const deviceId = typeof window !== "undefined" ? getDeviceId() : "";
  const owner = occupants.find((o) => o.isOwner);
  const knownTarget = practice ? practiceBots + 1 : (owner?.targetPlayerCount ?? targetPlayerCount);
  const roomOpts = sanitizeOptions(isOwner ? options : (owner?.opts ?? options));

  // 좌석 충돌 정리 (동시에 들어온 두 사람이 같은 자리)
  const reclaimRef = useRef(0);
  useEffect(() => {
    if (practice || mySeat === null || !roomCode || phase === "playing" || phase === "post-game" || phase === "room-full") return;
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
    mySeatRef.current = next;
    trackMe(next, amHostRef.current);
  }, [occupants, mySeat, phase, deviceId, roomCode, practice, trackMe]);

  // --- 판 시작 (방 만든 사람·연습, 끝난 뒤엔 판정 기기) ----------------------
  const startGame = useCallback(() => {
    const isPractice = phaseRef.current === "practice" || intent === "practice";
    const last = bufRef.current.latest();
    const humans = isPractice ? [0] : occupantsRef.current.map((o) => o.seat);
    const ownerRec = occupantsRef.current.find((o) => o.isOwner);
    const target = isPractice ? practiceBots + 1 : (ownerRec?.targetPlayerCount ?? last?.seatCount ?? playerCountRef.current);
    const opts = isPractice ? options : sanitizeOptions(ownerRec?.opts ?? last?.options ?? optionsRef.current);
    const count = isPractice ? Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, target)) : Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.min(target, Math.max(humans.length + botSeatsRef.current.length, ...humans.map((s) => s + 1)))));
    const seats = Array.from({ length: count }, (_, s) => {
      if (isPractice) return s === 0 ? { bot: false, level: 5 } : { bot: true, level: practiceLevel };
      const bi = botSeatsRef.current.indexOf(s);
      if (bi >= 0) return { bot: true, level: botLevelsRef.current[bi] ?? DEFAULT_BOT_LEVEL };
      if (humans.includes(s)) return { bot: false, level: 5 };
      return { bot: true, level: DEFAULT_BOT_LEVEL };
    });
    const ghost = isPractice ? (practiceRole === "ghost" ? 0 : 1 + Math.floor(Math.random() * (count - 1))) : pickGhost(opts.ghost, count);
    const match = createMatch(Math.floor(Math.random() * 1e9), seats, ghost, opts);
    hostRef.current = createHost(match, botThink);
    becomeHost(true);
    seqRef.current = 0;
    bufRef.current = new SnapBuffer();
    setBuf(bufRef.current);
    finishedRef.current = false;
    leftAtRef.current.clear();
    trackGameEvent(GAME_ID, "game_start");
    setPhase("playing");
  }, [intent, practiceBots, practiceLevel, practiceRole, options, becomeHost]);

  // 판정 루프
  useEffect(() => {
    if (!amHost || (phase !== "playing" && phase !== "post-game")) return;
    let last = performance.now();
    let lastSnap = 0;
    let lastRender = 0;
    let handAt = 0;
    const id = window.setInterval(() => {
      const rt = hostRef.current;
      if (!rt) return;
      const now = performance.now();
      const dt = now - last;
      last = now;
      const s = rt.state;
      const me = mySeatRef.current;
      // 원귀가 사람이고 이 방에 있으면 판정을 원귀 기기로 넘긴다
      const gp = s.players[s.ghostSeat];
      if (!practice && me !== null && s.ghostSeat !== me && gp && !gp.bot && s.phase === "play" && now >= handAt && occupantsRef.current.some((o) => o.seat === s.ghostSeat) && channelRef.current) {
        handAt = now + 1500;
        const out = makeSnap(s, ++seqRef.current, false);
        channelRef.current.send({ type: "broadcast", event: "handoff", payload: { to: s.ghostSeat, snap: out } });
        hostRef.current = null;
        becomeHost(false);
        hostGoneAtRef.current = Date.now();
        trackMe(me, false);
        ingest(out);
        return;
      }
      const before = s.t;
      const beforePhase = s.phase;
      hostStep(rt, dt);
      for (const [seat, at] of leftAtRef.current) {
        if (Date.now() - at > LEAVE_GRACE_MS && s.players[seat] && !s.players[seat].bot) setAway(rt, seat, true);
      }
      if (s.t === before && s.phase === beforePhase) return;
      const seq = ++seqRef.current;
      const render = now - lastRender >= 95;
      if (render) lastRender = now;
      ingest(makeSnap(s, seq, me === s.ghostSeat), render);
      if (channelRef.current && now - lastSnap >= SNAP_MS) {
        lastSnap = now;
        channelRef.current.send({ type: "broadcast", event: "snap", payload: makeSnap(s, seq, false) });
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [amHost, phase, ingest, practice, becomeHost, trackMe]);

  // 자동 시작: 자리가 다 차면 (방 만든 사람)
  useEffect(() => {
    if (phase !== "waiting" || !isOwner || hostRef.current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (occupants.length + botSeats.length >= knownTarget) startGame();
  }, [occupants, botSeats, phase, knownTarget, isOwner, startGame]);

  // 손님: 판정 기기가 사라지면 승계 (원귀 자리가 있으면 원귀가, 아니면 자리 번호가 낮은 사람이)
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
      const seats = occupantsRef.current.filter((o) => !o.isHost && o.seat < last.seatCount).map((o) => o.seat);
      const heir = seats.includes(last.ghostSeat) ? last.ghostSeat : seats.length ? Math.min(...seats) : -1;
      if (left > 0) {
        setNotice("📡 판정하던 기기 연결이 끊겼어요 — 잠깐만요…");
        return;
      }
      if (heir !== mySeat) {
        setNotice(heir >= 0 ? "📡 다른 사람이 판을 이어받는 중…" : "📡 판정 기기를 기다리는 중…");
        return;
      }
      takeOver(stateFromSnap(last), last.seq, "👑 판정 기기가 나가서 내가 판을 이어받았어요");
    }, 500);
    return () => window.clearInterval(id);
  }, [practice, amHost, phase, mySeat, takeOver]);

  const rosterSend = (seats: number[], levels: BotLevel[]) => {
    setBotSeats(seats);
    setBotLevels(levels);
    botSeatsRef.current = seats;
    botLevelsRef.current = levels;
    channelRef.current?.send({ type: "broadcast", event: "bot-roster", payload: { botSeats: seats, botLevels: levels } });
  };
  const addBotAtSeat = (seat: number, level: BotLevel) => {
    if (!isOwner || botSeats.includes(seat) || occupants.some((o) => o.seat === seat)) return;
    rosterSend([...botSeats, seat], [...botLevels, level]);
  };
  const fillEmpty = (level: BotLevel) => {
    if (!isOwner) return;
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
  const setRoomGhost = (g: GameOptions["ghost"]) => {
    const next = { ...options, ghost: g };
    setOptions(next);
    optionsRef.current = next;
    if (mySeat !== null) trackMe(mySeat, amHostRef.current);
  };

  // --- 내 입력 보내기 -------------------------------------------------------
  const onReport = useCallback(
    (rep: PosReport) => {
      if (mySeat === null) return;
      const rt = hostRef.current;
      if (rt) {
        applyReport(rt, mySeat, rep);
        return;
      }
      // 원귀의 몸은 절대 밖으로 보내지 않는다 (판정을 넘겨받는 중이면 잠깐 멈춰 있을 뿐)
      const last = bufRef.current.latest();
      if (last && last.ghostSeat === mySeat) return;
      channelRef.current?.send({ type: "broadcast", event: "pos", payload: { s: mySeat, r: rep } });
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
        self: selfResult(mySeat, rankings, { botSeats: lobbyBots, botLevels: lobbyLevels, takeovers }, (seat) => possessionNightStatDetails(snap, seat)),
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
    isOwnerRef.current = false;
    setIsOwner(false);
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
    isHost: isOwner,
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
        <p className="text-sm text-white/60 light:text-slate-500">혼자 하기(봇과 함께)는 할 수 있어요.</p>
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
        icon="👻"
        title="빙의의 밤"
        description={
          <p className="break-keep text-sm text-white/50 light:text-slate-500">
            산골 고택에 원귀가 깨어났다! <b>한 명은 몸이 보이지 않는 👻 원귀</b>, 나머지 2~5명은 🧿 퇴마사가 되는 1인칭 3D 비대칭 공포 게임. 퇴마사는 방마다 숨은 🪆 저주받은 물건을 찾아 마당 화로에 태우고, 다 태우면 화로 곁에서 🔥 퇴마 의식을 마쳐야 해요. 원귀는 직접 때리지 못해요 — 🗣️ 속삭이고, 💥 장롱을 덜컹거리고, 🕯️ 불을 끄고, 👁️ 모습을 드러내 <b>공포</b>를 키운 뒤, 겁에 질려 혼자 남은 사람에게 👻 빙의해요. 혼을 다 빼앗거나 닭이 울 때까지 버티면 원귀 승리. 🔮 영기 탐지기와 💧 성수로 맞서고, 서로 곁을 지키세요. 혼자 하기(봇 Lv.1~10, 퇴마사·원귀 중 골라서)도 돼요.
          </p>
        }
        actions={
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              onClick={() => {
                setIntent("create");
                setPhase("enter-name");
              }}
              className="w-full rounded-xl bg-cyan-500 py-3 text-sm font-semibold text-slate-900 transition hover:bg-cyan-400"
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
              className="w-full rounded-xl border border-cyan-400/40 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300 light:text-cyan-700"
            >
              🏮 혼자 하기 (봇과 함께)
            </button>
          </div>
        }
      />,
    );

  if (phase === "practice")
    return withGuard(
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 light:border-slate-200 light:bg-white light:shadow-sm">
        <h2 className="text-base font-bold text-white light:text-slate-900">🏮 혼자 하기</h2>
        <div className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
          내 닉네임
          <RoomNicknameField value={identity} onChange={setIdentity} accent="emerald" />
        </div>
        <OptionRow
          label="내 역할"
          value={practiceRole}
          options={[
            { value: "hunter", label: "🧿 퇴마사 (봇 원귀와 맞선다)" },
            { value: "ghost", label: "👻 원귀 (봇 퇴마사를 겁준다)" },
          ]}
          onChange={setPracticeRole}
        />
        <OptionRow label={`봇 수 (모두 ${practiceBots + 1}명 · 물건 ${cursesFor(practiceBots)}개 · 혼 ${soulsFor(practiceBots)}개)`} value={practiceBots} options={[2, 3, 4, 5].map((n) => ({ value: n, label: `${n}명` }))} onChange={setPracticeBots} />
        <OptionRow label="봇 레벨" value={practiceLevel} options={BOT_LEVELS.map((lv) => ({ value: lv, label: `Lv.${lv}` }))} onChange={setPracticeLevel} />
        <DifficultyForm options={options} setOptions={setOptions} />
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
            뒤로
          </button>
          <button
            onClick={() => {
              setMyName(identity.name.trim() || "나");
              setMyPlayerId(identity.name.trim() ? identity.playerId : undefined);
              setMySeat(0);
              mySeatRef.current = 0;
              startGame();
            }}
            className="flex-1 rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-slate-900 hover:bg-cyan-400"
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
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] text-white focus:border-cyan-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900"
            />
          </label>
        )}
        {intent === "create" && (
          <>
            <label className="flex flex-col gap-1.5 text-sm text-white/70 light:text-slate-600">
              인원 수 ({MIN_PLAYERS}~{MAX_PLAYERS}명 · 원귀 1 + 퇴마사 {targetPlayerCount - 1} · 물건 {cursesFor(targetPlayerCount - 1)}개)
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
            <DifficultyForm options={options} setOptions={setOptions} />
          </>
        )}
        {formError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setPhase("choose")} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
            뒤로
          </button>
          <button onClick={enterRoom} className="flex-1 rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-slate-900 hover:bg-cyan-400">
            {intent === "create" ? "방 만들기" : "참여하기"}
          </button>
        </div>
      </div>,
    );

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
            <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/70 light:border-slate-300 light:text-slate-600">
              🔗 초대 링크 복사
            </button>
            <p className="text-xs text-white/40 light:text-slate-400">
              {DIFFICULTY_INFO[roomOpts.difficulty].emoji} {DIFFICULTY_INFO[roomOpts.difficulty].label} · 저주받은 물건 {cursesFor(knownTarget - 1)}개 · 원귀가 이기려면 혼 {soulsFor(knownTarget - 1)}개 · 👻 원귀: {roomOpts.ghost === "random" ? "🎲 무작위" : `${roomOpts.ghost + 1}번 자리`}
            </p>
            {isOwner && (
              <div className="flex flex-wrap justify-center gap-1.5 text-xs">
                <span className="self-center text-white/50">👻 원귀 정하기</span>
                {(["random", ...Array.from({ length: knownTarget }, (_, s) => s)] as GameOptions["ghost"][]).map((g) => (
                  <button
                    key={String(g)}
                    type="button"
                    onClick={() => setRoomGhost(g)}
                    className={`rounded-full border px-2.5 py-1 ${roomOpts.ghost === g ? "border-cyan-300/70 bg-cyan-500/15 text-cyan-100 light:text-cyan-700" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-500"}`}
                  >
                    {g === "random" ? "🎲 무작위" : `${g + 1}번`}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-white/50 light:text-slate-500">
              {filled} / {knownTarget}명 참여 중
            </p>
            {isOwner && filled < knownTarget && <FillEmptySeatsButton emptyCount={knownTarget - filled} onFill={fillEmpty} />}
            <div className="flex w-full max-w-sm flex-col gap-1.5">
              {Array.from({ length: knownTarget }, (_, seat) => {
                const occ = occupants.find((o) => o.seat === seat);
                const bi = botSeats.indexOf(seat);
                return (
                  <p key={seat} className="flex min-h-9 items-center justify-between gap-2 text-sm text-white/70 light:text-slate-600">
                    <span>
                      {roomOpts.ghost === seat ? "👻 " : ""}
                      {seat === mySeat ? "나" : `${seat + 1}번`}: {occ ? occ.name : bi >= 0 ? <BotSeatBadge label={botLabel(bi, botLevels[bi])} /> : <span className="text-white/30">대기 중...</span>}
                    </span>
                    {isOwner && !occ && (bi >= 0 ? <RemoveBotButton onClick={() => removeBot(seat)} /> : <AddBotButton onAddWithLevel={(lv) => addBotAtSeat(seat, lv)} />)}
                  </p>
                );
              })}
            </div>
            {isOwner && filled >= MIN_PLAYERS && filled < knownTarget && (
              <button onClick={startGame} className="rounded-full bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-cyan-400">
                지금 시작 ({filled}명)
              </button>
            )}
            {isOwner && filled < MIN_PLAYERS && <p className="text-xs text-white/40">최소 {MIN_PLAYERS}명이 필요해요 (빈자리는 봇으로 채울 수 있어요).</p>}
            {!isOwner && <p className="text-xs text-white/40">방장이 시작하면 바로 들어가요. 원귀는 시작할 때 정해져요.</p>}
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
      <PossessionNightBoard
        snap={snap}
        buf={buf}
        fresh={fresh}
        mySeat={mySeat}
        names={names}
        onReport={onReport}
        onAct={onAct}
        ended={phase === "post-game"}
        canRestart={amHost || practice}
        onRestart={startGame}
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
