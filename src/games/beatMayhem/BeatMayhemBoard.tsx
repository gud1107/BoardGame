"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { getBeatMayhemSound } from "./beatMayhemSound";
import {
  DIFFICULTY_INFO,
  GAUGE_MAX,
  GOOD_MS,
  JUDGES,
  JUDGE_INFO,
  LANES,
  LANE_COLORS,
  LANE_KEYS,
  PRANK_INFO,
  SEAT_COLORS,
  SEAT_SYMBOLS,
  SHIELD_COST,
  SPEEDS,
  accuracy,
  applyJudge,
  judgeOf,
  zeroTally,
  type Judge,
  type SpeedId,
  type Tally,
} from "./data";
import Highway2D from "./Highway2D";
import type { SnapBuffer, Snap } from "./net";
import RulebookModal from "./RulebookModal";
import type { GameEvent, PlayerInput } from "./sim";
import { STYLES, buildSong, sectionAt } from "./song";
import type { StageShared } from "./three/StageScene";

const StageScene = dynamic(() => import("./three/StageScene"), { ssr: false, loading: () => null });

/**
 * 박자 난장판 게임 화면 (룰북 §8~§10).
 *
 * 판정은 이 기기에서 한다: 곡 시각(= 내 시계로 흐르는 스냅샷 시계)에 맞춰 노트를 그리고, 키를 누른
 * 순간의 곡 시각으로 가장 가까운 노트를 판정한 뒤 누적 기록을 방장에게 보낸다. 곡 소리도 같은
 * 시각표로 오디오 시계에 예약한다. "판정 보정"은 소리보다 화면·판정을 늦추는(+) 값이다.
 */

export interface BeatMayhemBoardProps {
  snap: Snap;
  buf: SnapBuffer;
  fresh: { events: GameEvent[]; seq: number };
  mySeat: number;
  names: Record<number, string>;
  onInput: (inp: PlayerInput) => void;
  ended: boolean;
  isHost: boolean;
  onRestart?: () => void;
  onLeave: () => void;
  practice?: boolean;
  notice?: string | null;
}

type ViewMode = "3d" | "2d";
type Quality = "auto" | "high" | "low";
interface Prefs {
  mode: ViewMode;
  quality: Quality;
  speed: SpeedId;
  /** 판정 보정 (ms): + 면 노트가 소리보다 늦게 온다 */
  offset: number;
}
const PREF_KEY = "beat-mayhem:prefs";
const DEFAULT_PREFS: Prefs = { mode: "3d", quality: "auto", speed: "normal", offset: 0 };

function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(PREF_KEY) ?? "{}");
    return {
      mode: v.mode === "2d" ? "2d" : "3d",
      quality: v.quality === "high" || v.quality === "low" ? v.quality : "auto",
      speed: SPEEDS.some((s) => s.id === v.speed) ? v.speed : "normal",
      offset: Number.isFinite(v.offset) ? Math.max(-200, Math.min(200, Math.round(v.offset))) : 0,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* 저장 안 돼도 됨 */
  }
}

function webglOk(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

const KEY_LANE: Record<string, number> = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
const PRANK_KEYS = ["Space", "Enter"];

/** 이 기기에서 치고 있는 한 곡의 기록 */
interface LocalPlay {
  key: string;
  tally: Tally;
  /** 노트별: 0 아직 · 1 맞힘 · 2 놓침 */
  hit: Uint8Array;
  ptr: number;
  atk: number;
  dirty: boolean;
  lastSent: number;
}

interface JudgeFlash {
  id: number;
  judge: Judge;
  combo: number;
  /** 빨랐나(−) 늦었나(+) (ms) */
  delta: number;
}

interface Feed {
  id: number;
  text: ReactNode;
}

function SeatTag({ seat, names, me }: { seat: number; names: Record<number, string>; me: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: SEAT_COLORS[seat % 8] }}>
      <span aria-hidden>{SEAT_SYMBOLS[seat % 8]}</span>
      <span className="max-w-[7rem] truncate text-white light:text-slate-900">{seat === me ? "나" : (names[seat] ?? `${seat + 1}번`)}</span>
    </span>
  );
}

export default function BeatMayhemBoard({ snap, buf, fresh, mySeat, names, onInput, ended, isHost, onRestart, onLeave, practice, notice }: BeatMayhemBoardProps) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [canGl, setCanGl] = useState(true);
  const [touch, setTouch] = useState(false);
  const [lowFps, setLowFps] = useState(false);
  const [rulebook, setRulebook] = useState(false);
  const [settings, setSettings] = useState(false);
  const [flash, setFlash] = useState<JudgeFlash | null>(null);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [mine, setMine] = useState<Tally | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const sound = getBeatMayhemSound;

  useEffect(() => {
    // 저장된 설정·기기 종류는 마운트 뒤에 읽는다 (서버 렌더와 맞추기)
    /* eslint-disable react-hooks/set-state-in-effect */
    setPrefs(loadPrefs());
    setCanGl(webglOk());
    setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  const updatePrefs = (p: Prefs) => {
    setPrefs(p);
    savePrefs(p);
  };

  const song = useMemo(() => (snap.round > 0 ? buildSong(snap.seed, snap.round, snap.options.style, snap.options.difficulty) : null), [snap.seed, snap.round, snap.options.style, snap.options.difficulty]);
  const me = snap.players[mySeat];
  const playing = snap.phase === "play" || snap.phase === "countdown";
  const iPlay = !!me && !me.bot;

  // 최신 값들을 프레임 루프·키 핸들러가 읽을 수 있게 ref에 둔다
  const live = useRef({ snap, buf, song, prefs, onInput, mySeat, iPlay });
  useEffect(() => {
    live.current = { snap, buf, song, prefs, onInput, mySeat, iPlay };
  });

  const play = useRef<LocalPlay | null>(null);
  const shared = useRef<StageShared>({
    song: null,
    time: () => -1e9,
    hit: new Uint8Array(0),
    laneOf: () => 0,
    prank: null,
    lookahead: 1550,
    pressAt: [],
    bursts: [],
    dancers: [],
    over: false,
    winnerSeats: [],
  });

  const pushFeed = useCallback((text: ReactNode) => {
    const id = ++seq.current;
    setFeed((f) => [...f.slice(-3), { id, text }]);
    window.setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 4500);
  }, []);

  /** 지금 곡 시각 (판정 보정 반영) */
  const songTime = useCallback(() => {
    const l = live.current;
    return l.buf.songNow(performance.now()) - l.prefs.offset;
  }, []);

  /** 노트의 화면 줄: 내게 걸린 "뒤집기" 구간이면 좌우 반전 */
  const laneOf = useCallback((i: number) => {
    const l = live.current;
    const note = l.song?.notes[i];
    if (!note) return 0;
    for (const e of l.snap.effects) if (e.kind === "mirror" && e.to === l.mySeat && !e.blocked && note.beat >= e.b0 && note.beat < e.b1) return LANES - 1 - note.lane;
    return note.lane;
  }, []);

  // 곡이 바뀌면 내 기록을 새로 시작 (다시 들어온 경우엔 방장이 알고 있는 기록에서 이어서)
  const playKey = `${snap.seed}:${snap.round}`;
  useEffect(() => {
    const l = live.current;
    const total = l.song?.notes.length ?? 0;
    const lp: LocalPlay = { key: playKey, tally: zeroTally(), hit: new Uint8Array(total), ptr: 0, atk: 0, dirty: false, lastSent: 0 };
    const known = l.snap.players[l.mySeat];
    if (known && known.judged > 0 && l.song) {
      lp.tally = { score: known.score, combo: known.combo, maxCombo: known.maxCombo, judges: [...known.judges] as Tally["judges"], judged: known.judged, earned: known.earned };
      const now = l.buf.songNow(performance.now());
      while (lp.ptr < total && l.song.notes[lp.ptr].t < now - GOOD_MS) lp.hit[lp.ptr++] = 2;
      // 지나간 노트 수가 방장 기록보다 많으면 그만큼은 놓친 것
      while (lp.tally.judged < lp.ptr) applyJudge(lp.tally, "miss");
    }
    play.current = lp;
    const sh = shared.current;
    sh.song = l.song;
    sh.hit = lp.hit;
    sh.bursts = [];
    sh.pressAt = [];
    /* eslint-disable react-hooks/set-state-in-effect */
    setFlash(null);
    setMine(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [playKey]);

  useEffect(() => {
    const sh = shared.current;
    sh.time = songTime;
    sh.laneOf = laneOf;
    sh.lookahead = SPEEDS.find((s) => s.id === prefs.speed)?.ms ?? 1550;
    sh.over = snap.phase === "gameOver";
    sh.winnerSeats = snap.ranks ? snap.players.filter((p) => snap.ranks![p.seat] === 1).map((p) => p.seat) : [];
  }, [songTime, laneOf, prefs.speed, snap.phase, snap.ranks, snap.players]);

  const report = useCallback((force = false) => {
    const lp = play.current;
    const l = live.current;
    if (!lp || !l.iPlay) return;
    const now = performance.now();
    if (!force && (!lp.dirty || now - lp.lastSent < 150)) return;
    lp.dirty = false;
    lp.lastSent = now;
    const t = lp.tally;
    l.onInput({ r: l.snap.round, n: t.judged, sc: t.score, cb: t.combo, mc: t.maxCombo, j: [...t.judges], e: t.earned, atk: lp.atk });
  }, []);

  const judged = useCallback(
    (lane: number, judge: Judge, delta: number) => {
      const lp = play.current;
      if (!lp) return;
      const before = lp.tally.combo;
      applyJudge(lp.tally, judge);
      lp.dirty = true;
      const s = sound();
      if (judge === "miss") {
        s.play(before >= 10 ? "comboBreak" : "miss");
      } else {
        s.play("hit", JUDGES.indexOf(judge));
        shared.current.bursts.push({ lane, judge, at: performance.now() });
      }
      setFlash({ id: ++seq.current, judge, combo: lp.tally.combo, delta });
    },
    [sound],
  );

  const pressLane = useCallback(
    (lane: number) => {
      const l = live.current;
      const lp = play.current;
      shared.current.pressAt[lane] = performance.now();
      if (!lp || !l.song || !l.iPlay || l.snap.phase !== "play") return;
      const t = songTime();
      const notes = l.song.notes;
      for (let i = lp.ptr; i < notes.length; i++) {
        const dt = notes[i].t - t;
        if (dt > GOOD_MS) break;
        if (lp.hit[i] || laneOf(i) !== lane || Math.abs(dt) > GOOD_MS) continue;
        lp.hit[i] = 1;
        judged(lane, judgeOf(Math.abs(dt)), -dt);
        return;
      }
      sound().play("empty");
    },
    [songTime, laneOf, judged, sound],
  );

  const pressPrank = useCallback(() => {
    const l = live.current;
    const lp = play.current;
    if (!lp || !l.iPlay || l.snap.phase !== "play" || !l.snap.options.mayhem) return;
    const spent = l.snap.players[l.mySeat]?.spent ?? 0;
    if (lp.tally.earned - spent < GAUGE_MAX) return;
    lp.atk += 1;
    report(true);
  }, [report]);

  // 프레임 루프: 지나간 노트 = 미스, 장난 세기, 기록 보내기
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const l = live.current;
      const lp = play.current;
      const sh = shared.current;
      if (!lp || !l.song) return;
      const t = songTime();
      if (l.snap.phase === "play" && l.iPlay) {
        const notes = l.song.notes;
        while (lp.ptr < notes.length) {
          const i = lp.ptr;
          if (lp.hit[i]) {
            lp.ptr++;
            continue;
          }
          if (notes[i].t >= t - GOOD_MS) break;
          lp.hit[i] = 2;
          lp.ptr++;
          judged(laneOf(i), "miss", 0);
        }
        report(false);
      }
      // 내게 걸린 장난 (앞뒤 반 박자에 걸쳐 서서히)
      const beat = t / l.song.beatMs;
      let prank: StageShared["prank"] = null;
      for (const e of l.snap.effects) {
        if (e.to !== l.mySeat || e.blocked || e.kind === "mirror") continue;
        if (beat < e.b0 - 0.5 || beat >= e.b1 + 0.5) continue;
        prank = { kind: e.kind, k: Math.max(0, Math.min(1, (beat - (e.b0 - 0.5)) / 0.5, (e.b1 + 0.5 - beat) / 0.5)) };
      }
      sh.prank = prank;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, songTime, laneOf, judged, report]);

  // 곡 소리: 음표 목록을 오디오 시계에 0.22초 앞서 예약 (BGM을 꺼 두면 아무것도 안 만든다)
  useEffect(() => {
    if (!playing || !song) return;
    let cursor = 0;
    const id = window.setInterval(() => {
      const st = live.current.buf.songNow(performance.now());
      while (cursor < song.audio.length && song.audio[cursor].t < st - 40) cursor++;
      const s = sound();
      const clock = s.clock("bgm");
      if (clock === null) return;
      while (cursor < song.audio.length && song.audio[cursor].t < st + 220) {
        const ev = song.audio[cursor++];
        s.noteAt("bgm", ev.inst, ev.freq, clock + (ev.t - st) / 1000, ev.dur, ev.gain);
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [playing, song, sound]);
  useSuiteBgm(sound, snap.phase === "roundEnd" || (snap.phase === "gameOver" && !ended));

  // HUD를 10번/초 다시 그린다 (내 점수·게이지·곡 진행)
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setMine(play.current ? { ...play.current.tally } : null), 100);
    return () => window.clearInterval(id);
  }, [playing]);

  // 키보드
  useEffect(() => {
    if (ended) return;
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const lane = KEY_LANE[e.code];
      if (lane !== undefined) {
        e.preventDefault();
        if (!e.repeat) pressLane(lane);
      } else if (PRANK_KEYS.includes(e.code)) {
        e.preventDefault();
        if (!e.repeat) pressPrank();
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [ended, pressLane, pressPrank]);

  // 춤꾼 상태 (남은 스냅샷, 나는 내 기록)
  const lastCombo = useRef<Record<number, number>>({});
  const missAt = useRef<Record<number, number>>({});
  useEffect(() => {
    const beat = song ? (snap.t - snap.songAt) / song.beatMs : 0;
    const top = Math.max(...snap.players.map((p) => p.total));
    shared.current.dancers = snap.players.map((p) => {
      const combo = p.seat === mySeat && play.current ? play.current.tally.combo : p.combo;
      if ((lastCombo.current[p.seat] ?? 0) >= 5 && combo === 0) missAt.current[p.seat] = performance.now();
      lastCombo.current[p.seat] = combo;
      return { seat: p.seat, combo, pranked: snap.effects.some((e) => e.to === p.seat && !e.blocked && beat >= e.b0 && beat < e.b1), lead: p.total === top && top > 0, missAt: missAt.current[p.seat] ?? -1e9 };
    });
  }, [snap, song, mySeat]);

  // 새 이벤트 → 소리·알림
  const lastFresh = useRef(0);
  useEffect(() => {
    if (fresh.seq === lastFresh.current) return;
    lastFresh.current = fresh.seq;
    const s = sound();
    for (const ev of fresh.events) {
      switch (ev.k) {
        case "go":
          s.play("go");
          break;
        case "prank": {
          const info = PRANK_INFO[ev.kind];
          if (ev.from === mySeat) s.play("prankSend");
          if (ev.to === mySeat) s.play(ev.blocked ? "shield" : "prankWarn");
          pushFeed(
            <>
              <SeatTag seat={ev.from} names={names} me={mySeat} /> {info.emoji} → <SeatTag seat={ev.to} names={names} me={mySeat} /> {ev.blocked ? <b className="text-sky-300">🛡 막음!</b> : <span className="text-rose-300">{info.name}</span>}
            </>,
          );
          break;
        }
        case "combo":
          if (ev.s === mySeat) s.play("combo", ev.n);
          else pushFeed(
            <>
              <SeatTag seat={ev.s} names={names} me={mySeat} /> 🔥 {ev.n} 콤보
            </>,
          );
          break;
        case "end":
          s.play(ev.winners.includes(mySeat) ? "roundWin" : "roundLose");
          break;
        case "over":
          s.play(snap.ranks?.[mySeat] === 1 ? "victory" : "defeat");
          break;
        default:
          break;
      }
    }
  }, [fresh, snap.ranks, mySeat, names, pushFeed, sound]);

  // 카운트다운 3·2·1
  const countLeft = snap.phase === "countdown" ? Math.ceil((snap.phaseEnd - snap.t) / 1000) : 0;
  const lastCount = useRef(0);
  useEffect(() => {
    if (countLeft > 0 && countLeft <= 3 && countLeft !== lastCount.current) sound().play("tick");
    lastCount.current = countLeft;
  }, [countLeft, sound]);

  /* ── 화면에 쓸 값 ── */
  // 이 값들은 0.1초마다(setTick) 다시 계산된다 — 프레임 루프가 바꾸는 내 기록을 화면에 옮기는 곳
  const myTally = iPlay && mine ? mine : me;
  const myGauge = me ? Math.max(0, Math.min(GAUGE_MAX, (myTally?.earned ?? 0) - me.spent)) : 0;
  const myTotal = me ? me.prev + (myTally?.score ?? 0) : 0;
  const gaugeFull = myGauge >= GAUGE_MAX;
  const lastFull = useRef(false);
  useEffect(() => {
    if (gaugeFull && !lastFull.current && snap.options.mayhem) sound().play("gaugeFull");
    lastFull.current = gaugeFull;
  }, [gaugeFull, snap.options.mayhem, sound]);

  const st = song ? snap.t - snap.songAt : 0;
  const beatNow = song ? st / song.beatMs : 0;
  const myPranks = snap.effects.filter((e) => e.to === mySeat && !e.blocked);
  const incoming = myPranks.find((e) => beatNow < e.b0);
  const active = myPranks.find((e) => beatNow >= e.b0 && beatNow < e.b1);
  const activeKind = active?.kind ?? null;
  const lastActive = useRef<string | null>(null);
  useEffect(() => {
    if (activeKind && !lastActive.current) sound().play("prankStart");
    if (!activeKind && lastActive.current) sound().play("prankEnd");
    lastActive.current = activeKind;
  }, [activeKind, sound]);

  const board = useMemo(
    () =>
      snap.players
        .map((p) => (p.seat === mySeat && iPlay ? { ...p, total: myTotal, combo: myTally?.combo ?? p.combo, gauge: myGauge } : p))
        .sort((a, b) => b.total - a.total || a.seat - b.seat),
    [snap.players, mySeat, iPlay, myTotal, myTally?.combo, myGauge],
  );
  const myRankNow = board.findIndex((p) => p.seat === mySeat) + 1;
  const quality: "high" | "low" = prefs.quality === "auto" ? (touch || lowFps ? "low" : "high") : prefs.quality;
  const use3d = prefs.mode === "3d" && canGl;
  const style = STYLES[snap.style];
  const progress = song ? Math.max(0, Math.min(1, st / song.lengthMs)) : 0;
  const lastRound = snap.history[snap.history.length - 1];
  const uiClick = () => sound().play("ui");

  // 전체화면
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {});
    else if (full) setFull(false);
    else if (typeof el.requestFullscreen === "function" && document.fullscreenEnabled !== false) void el.requestFullscreen().catch(() => setFull(true));
    else setFull(true);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* 위 HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">
          🎵 {snap.round}/{snap.options.rounds}곡 · {style.emoji} {style.name}
          {practice && <span className="ml-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 light:text-emerald-700">연습</span>}
        </span>
        <span>
          {style.bpm} BPM · {DIFFICULTY_INFO[snap.options.difficulty].name}
          {song && snap.phase === "play" && <> · {sectionAt(song, st)}</>}
        </span>
        <span className="flex min-w-[6rem] flex-1 items-center gap-1.5" aria-label={`곡 진행 ${Math.round(progress * 100)}%`}>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15 light:bg-slate-200">
            <span className="block h-full bg-fuchsia-400" style={{ width: `${progress * 100}%` }} />
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={() => { uiClick(); setRulebook(true); }} className="rounded-full border border-white/15 px-2.5 py-1 light:border-slate-300">
            📖 룰북
          </button>
          <button type="button" onClick={() => { uiClick(); setSettings((v) => !v); }} className="rounded-full border border-white/15 px-2.5 py-1 light:border-slate-300" aria-expanded={settings} aria-label="설정">
            ⚙️
          </button>
        </span>
      </div>
      {settings && (
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70 light:border-slate-200 light:bg-white light:text-slate-600">
          <div className="flex flex-wrap items-center gap-2">
            보기
            {(["3d", "2d"] as ViewMode[]).map((m) => (
              <button key={m} type="button" disabled={m === "3d" && !canGl} onClick={() => { uiClick(); updatePrefs({ ...prefs, mode: m }); }} className={`rounded-full border px-2.5 py-1 ${prefs.mode === m ? "border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100 light:text-fuchsia-800" : "border-white/15 light:border-slate-300"}`}>
                {m === "3d" ? "🎥 3D" : "⬇️ 2D 낙하"}
              </button>
            ))}
            <span className="ml-2">화질</span>
            {(["auto", "high", "low"] as Quality[]).map((q) => (
              <button key={q} type="button" onClick={() => { uiClick(); updatePrefs({ ...prefs, quality: q }); }} className={`rounded-full border px-2.5 py-1 ${prefs.quality === q ? "border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100 light:text-fuchsia-800" : "border-white/15 light:border-slate-300"}`}>
                {q === "auto" ? "자동" : q === "high" ? "높음" : "낮음(빠름)"}
              </button>
            ))}
            <span className="ml-2">노트 빠르기</span>
            {SPEEDS.map((sp) => (
              <button key={sp.id} type="button" onClick={() => { uiClick(); updatePrefs({ ...prefs, speed: sp.id }); }} className={`rounded-full border px-2.5 py-1 ${prefs.speed === sp.id ? "border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100 light:text-fuchsia-800" : "border-white/15 light:border-slate-300"}`}>
                {sp.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            판정 보정
            <button type="button" aria-label="판정 보정 10ms 빠르게" onClick={() => updatePrefs({ ...prefs, offset: Math.max(-200, prefs.offset - 10) })} className="h-7 w-7 rounded-full border border-white/15 light:border-slate-300">
              −
            </button>
            <b className="w-14 text-center tabular-nums text-white light:text-slate-900">{prefs.offset > 0 ? `+${prefs.offset}` : prefs.offset}ms</b>
            <button type="button" aria-label="판정 보정 10ms 늦게" onClick={() => updatePrefs({ ...prefs, offset: Math.min(200, prefs.offset + 10) })} className="h-7 w-7 rounded-full border border-white/15 light:border-slate-300">
              +
            </button>
            <span className="break-keep text-white/50 light:text-slate-500">박자에 맞춰 쳤는데 계속 &quot;빠름&quot;이 뜨면 +, &quot;늦음&quot;이 뜨면 −. 블루투스 이어폰은 +100~200쯤.</span>
            {!canGl && <span className="text-amber-300">이 기기는 3D(WebGL)를 지원하지 않아 2D로 보여요</span>}
          </div>
        </div>
      )}

      {/* 점수판 */}
      <div className="flex flex-wrap gap-1.5">
        {board.map((p, i) => {
          const pranked = snap.effects.some((e) => e.to === p.seat && !e.blocked && beatNow >= e.b0 && beatNow < e.b1);
          return (
            <div key={p.seat} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${p.seat === mySeat ? "border-white/50 bg-white/10 light:border-slate-500 light:bg-slate-100" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"}`}>
              <b className="w-3 text-center text-white/60 light:text-slate-500">{i + 1}</b>
              <span aria-hidden className="text-sm leading-none" style={{ color: SEAT_COLORS[p.seat % 8] }}>
                {SEAT_SYMBOLS[p.seat % 8]}
              </span>
              <span className="max-w-[6rem] truncate font-semibold text-white light:text-slate-900">{p.seat === mySeat ? "나" : (names[p.seat] ?? `${p.seat + 1}번`)}</span>
              {p.bot && <span className="text-[10px] text-white/40 light:text-slate-400">{p.away ? "🤖대신" : "🤖"}</span>}
              <b className="tabular-nums text-fuchsia-200 light:text-fuchsia-700">{p.total.toLocaleString()}</b>
              {p.combo >= 10 && <span className="tabular-nums text-amber-300 light:text-amber-600">🔥{p.combo}</span>}
              {snap.options.mayhem && (
                <span className="inline-block h-1.5 w-8 overflow-hidden rounded-full bg-white/15 light:bg-slate-200" title={`장난 게이지 ${Math.round(p.gauge)}%`}>
                  <span className={`block h-full ${p.gauge >= GAUGE_MAX ? "bg-amber-300" : p.gauge >= SHIELD_COST ? "bg-sky-400" : "bg-white/50 light:bg-slate-400"}`} style={{ width: `${p.gauge}%` }} />
                </span>
              )}
              {snap.options.mayhem && p.gauge >= SHIELD_COST && <span aria-label="방패 있음">🛡</span>}
              {pranked && <span aria-label="장난에 걸림">😵</span>}
            </div>
          );
        })}
      </div>

      {/* 무대 */}
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020] select-none light:border-slate-200 ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen rounded-none border-0" : touch ? "h-[70svh] min-h-[380px]" : "aspect-[16/10] max-h-[76vh]"}`}
      >
        {use3d ? (
          <StageScene shared={shared} names={names} seats={snap.players.filter((p) => p.seat !== mySeat).map((p) => p.seat)} style={snap.style} quality={quality} onFps={(f) => f < 28 && !lowFps && setLowFps(true)} />
        ) : (
          <Highway2D shared={shared} />
        )}

        {/* 알림판 */}
        <div className="pointer-events-none absolute top-2 right-2 z-20 flex max-w-[62%] flex-col items-end gap-1">
          {feed.map((f) => (
            <div key={f.id} className="rounded-lg bg-black/60 px-2 py-1 text-[11px] text-white shadow">
              {f.text}
            </div>
          ))}
        </div>

        {/* 카운트다운 */}
        {snap.phase === "countdown" && (
          <div className="pointer-events-none absolute inset-x-0 top-[12%] z-20 flex flex-col items-center px-3">
            <span className="rounded-full bg-black/50 px-3 py-0.5 text-sm font-bold text-white">
              {snap.round}번째 곡 · {style.emoji} {style.name}
            </span>
            <span key={countLeft} className="animate-[bm-pop_0.5s_ease-out] text-7xl font-black text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.4)]">
              {Math.min(3, countLeft)}
            </span>
            <span className="mt-1 max-w-sm rounded-2xl bg-black/55 px-3 py-1.5 text-center text-xs leading-relaxed text-white">
              {touch ? "노트가 흰 선에 닿을 때 아래 네 칸을 톡!" : "노트가 흰 선에 닿을 때 D · F · J · K (또는 ← ↓ ↑ →)"}
              {snap.options.mayhem && (
                <>
                  <br />
                  게이지가 차면 {touch ? "⚡ 버튼" : "Space"}으로 바로 위 등수에게 장난 · {SHIELD_COST} 이상 남겨 두면 🛡 자동 방어
                </>
              )}
            </span>
          </div>
        )}

        {/* 판정 글자 + 콤보 */}
        {snap.phase === "play" && flash && (
          <div key={flash.id} className="pointer-events-none absolute inset-x-0 top-[34%] z-20 flex animate-[bm-judge_0.5s_ease-out_forwards] flex-col items-center">
            <span className="text-3xl font-black drop-shadow-[0_2px_0_rgba(0,0,0,0.5)]" style={{ color: JUDGE_INFO[flash.judge].color }}>
              {JUDGE_INFO[flash.judge].name}
            </span>
            {flash.judge !== "miss" && flash.judge !== "perfect" && <span className="text-[11px] font-bold text-white/80">{flash.delta < 0 ? "◀ 빠름" : "늦음 ▶"}</span>}
            {flash.combo >= 2 && <span className="text-xl font-black text-white tabular-nums drop-shadow">{flash.combo} 콤보</span>}
          </div>
        )}

        {/* 장난 예고·진행 (소리 없이도 보이게) */}
        {snap.phase === "play" && (incoming || active) && (
          <div className={`pointer-events-none absolute inset-x-2 top-[20%] z-20 mx-auto w-fit max-w-full rounded-2xl px-4 py-1.5 text-center text-sm font-black shadow-xl ${active ? "bg-rose-600 text-white" : "animate-pulse bg-amber-300 text-slate-900"}`}>
            {active ? (
              <>
                {PRANK_INFO[active.kind].emoji} {PRANK_INFO[active.kind].name}! <span className="text-xs font-semibold">남은 {Math.max(1, Math.ceil(active.b1 - beatNow))}박 · {names[active.from] ?? `${active.from + 1}번`}의 장난</span>
              </>
            ) : incoming ? (
              <>
                {PRANK_INFO[incoming.kind].emoji} {PRANK_INFO[incoming.kind].name} 예고 — {Math.max(1, Math.ceil(incoming.b0 - beatNow))}박 뒤 <span className="text-xs font-semibold">({PRANK_INFO[incoming.kind].desc})</span>
              </>
            ) : null}
          </div>
        )}

        {/* 내 점수·게이지 */}
        {playing && me && (
          <div className={`pointer-events-none absolute left-2 z-20 flex flex-col gap-1 rounded-xl bg-black/55 px-2.5 py-1.5 text-white ${touch ? "top-10" : "bottom-3"}`}>
            <span className="text-[11px] text-white/70">
              {myRankNow}등 · <b className="text-base tabular-nums text-fuchsia-200">{myTotal.toLocaleString()}</b>
            </span>
            {snap.options.mayhem && (
              <span className="flex items-center gap-1.5 text-[11px]">
                ⚡
                <span className="relative h-2.5 w-24 overflow-hidden rounded-full bg-white/20">
                  <span className={`block h-full ${gaugeFull ? "animate-pulse bg-amber-300" : "bg-sky-400"}`} style={{ width: `${myGauge}%` }} />
                  <span className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${SHIELD_COST}%` }} aria-hidden />
                </span>
                <span>{gaugeFull ? (touch ? "⚡ 버튼!" : "Space!") : myGauge >= SHIELD_COST ? "🛡 방어 가능" : `${Math.round(myGauge)}%`}</span>
              </span>
            )}
          </div>
        )}

        {/* 라운드 결과 */}
        {snap.phase === "roundEnd" && lastRound && (
          <div className="absolute inset-x-3 top-[8%] z-30 mx-auto max-h-[86%] max-w-md animate-[bm-pop_0.4s_ease-out] overflow-y-auto rounded-2xl border border-white/15 bg-slate-950/90 p-4 text-white shadow-2xl">
            <p className="text-center text-xs text-white/60">
              {lastRound.round}번째 곡 결과 · {STYLES[lastRound.style].emoji} {STYLES[lastRound.style].name} · 노트 {lastRound.notes}개
            </p>
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {[...snap.players]
                .sort((a, b) => lastRound.scores[b.seat] - lastRound.scores[a.seat] || a.seat - b.seat)
                .map((p) => (
                  <li key={p.seat} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${p.seat === mySeat ? "bg-white/10" : ""}`}>
                    <span className="flex items-center gap-1.5">
                      {lastRound.winners.includes(p.seat) ? "🏆" : <span className="w-4" />}
                      <SeatTag seat={p.seat} names={names} me={mySeat} />
                    </span>
                    <span className="text-xs text-white/70 tabular-nums">
                      {lastRound.acc[p.seat]}% · 🔥{lastRound.maxCombo[p.seat]} · <b className="text-sm text-fuchsia-200">+{lastRound.scores[p.seat].toLocaleString()}</b>
                    </span>
                  </li>
                ))}
            </ul>
            {me && (
              <p className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs">
                {JUDGES.map((j, i) => (
                  <span key={j} style={{ color: JUDGE_INFO[j].color }}>
                    {JUDGE_INFO[j].name} <b className="tabular-nums">{me.judges[i]}</b>
                  </span>
                ))}
              </p>
            )}
            <p className="mt-2 text-center text-[11px] text-white/50">{snap.round < snap.options.rounds ? `곧 ${snap.round + 1}번째 곡 — 점수는 이어져요` : "최종 결과로…"}</p>
          </div>
        )}

        {snap.phase === "gameOver" && <FinalPanel snap={snap} names={names} mySeat={mySeat} />}

        {notice && <div className="absolute inset-x-0 top-12 z-30 mx-auto w-fit rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-slate-900">{notice}</div>}

        <button type="button" onClick={() => { uiClick(); toggleFull(); }} className="absolute top-2 left-2 z-30 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white" aria-label={full ? "전체화면 끄기" : "전체화면"}>
          {full ? "↙ 작게" : "⛶ 크게"}
        </button>

        {/* 조작: 네 칸 (터치는 누르는 판, 키보드는 글자 안내) + ⚡ */}
        {playing && iPlay && !ended && (
          <>
            {snap.options.mayhem && (
              <button
                type="button"
                aria-label="장난 쏘기"
                disabled={!gaugeFull}
                onPointerDown={(e) => {
                  e.preventDefault();
                  pressPrank();
                }}
                className={`absolute right-2 z-30 flex h-14 w-14 touch-none flex-col items-center justify-center rounded-full border-2 text-white shadow-lg select-none ${touch ? "bottom-[27%]" : "bottom-16"} ${gaugeFull ? "animate-pulse border-amber-200 bg-amber-500" : "border-white/25 bg-black/40 text-white/40"}`}
              >
                <span className="text-xl leading-none">⚡</span>
                <span className="text-[9px] leading-none">{touch ? "장난" : "Space"}</span>
              </button>
            )}
            <div className={`absolute inset-x-0 bottom-0 z-20 mx-auto flex max-w-xl ${touch ? "h-[24%]" : "h-12 pointer-events-none"}`}>
              {Array.from({ length: LANES }, (_, l) => (
                <button
                  key={l}
                  type="button"
                  tabIndex={-1}
                  aria-label={`${l + 1}번 줄`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    pressLane(l);
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  className={`flex flex-1 touch-none items-end justify-center border-t-4 pb-2 text-sm font-black text-white select-none ${touch ? "bg-white/[0.06] active:bg-white/25" : ""}`}
                  style={{ borderColor: LANE_COLORS[l] }}
                >
                  <span className="rounded bg-black/50 px-1.5">{touch ? l + 1 : LANE_KEYS[l]}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {!touch && snap.phase !== "gameOver" && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/50 light:border-slate-200 light:bg-white light:text-slate-500">
          <b>D F J K</b> (또는 ← ↓ ↑ →) — 노트가 흰 판정선에 닿을 때 누르기{snap.options.mayhem && <> · <b>Space</b> — 게이지가 가득 찼을 때 장난 쏘기</>} · 소리가 꺼져 있으면 위쪽 🔇을 눌러 켜세요 (꺼도 플레이할 수 있어요)
        </div>
      )}

      {(ended || snap.phase === "gameOver") && (
        <div className="flex justify-center gap-2">
          <button type="button" onClick={onLeave} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 light:border-slate-300 light:text-slate-600">
            나가기
          </button>
          {isHost && onRestart && (
            <button type="button" onClick={onRestart} className="rounded-xl bg-fuchsia-400 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-fuchsia-300">
              다시하기
            </button>
          )}
        </div>
      )}

      {rulebook && <RulebookModal onClose={() => setRulebook(false)} />}
      <style>{`
        @keyframes bm-pop { 0% { transform: scale(0.6); opacity: 0 } 60% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes bm-judge { 0% { transform: scale(1.35); opacity: 1 } 30% { transform: scale(1); opacity: 1 } 100% { transform: translateY(-10px); opacity: 0 } }
      `}</style>
    </div>
  );
}

function FinalPanel({ snap, names, mySeat }: { snap: Snap; names: Record<number, string>; mySeat: number }) {
  const ranks = snap.ranks ?? snap.players.map(() => 1);
  const order = [...snap.players].sort((a, b) => ranks[a.seat] - ranks[b.seat] || a.seat - b.seat);
  const best = (f: (p: (typeof snap.players)[number]) => number) => {
    const max = Math.max(...snap.players.map(f));
    return { seats: max > 0 ? snap.players.filter((p) => f(p) === max).map((p) => p.seat) : [], max };
  };
  const perfect = best((p) => p.stats.perfects);
  const combo = best((p) => p.stats.maxCombo);
  const prank = best((p) => p.stats.pranksSent);
  const shield = best((p) => p.stats.pranksBlocked);
  const acc = best((p) => p.stats.bestAcc);
  const awards = [
    { icon: "🎯", title: "정확도 왕", seats: acc.seats, value: `${acc.max}%` },
    { icon: "✨", title: "퍼펙트 왕", seats: perfect.seats, value: `${perfect.max}개` },
    { icon: "🔥", title: "콤보 왕", seats: combo.seats, value: `${combo.max}콤보` },
    { icon: "⚡", title: "장난꾸러기", seats: prank.seats, value: `${prank.max}번` },
    { icon: "🛡", title: "철벽", seats: shield.seats, value: `${shield.max}번 막음` },
  ].filter((a) => a.seats.length > 0);
  const notes = snap.history.reduce((a, h) => a + h.notes, 0);
  return (
    <div className="absolute inset-x-3 top-[6%] z-30 mx-auto max-h-[88%] max-w-md overflow-y-auto rounded-2xl border border-fuchsia-300/30 bg-slate-950/90 p-4 text-white shadow-2xl">
      <p className="text-center text-xs text-white/60">최종 결과 · {snap.history.length}곡</p>
      <p className="mt-1 text-center text-2xl font-black">{ranks[mySeat] === 1 ? "🏆 우승!" : `${ranks[mySeat]}등`}</p>
      <ol className="mt-3 flex flex-col gap-1.5 text-sm">
        {order.map((p) => (
          <li key={p.seat} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${p.seat === mySeat ? "bg-white/10" : ""}`}>
            <span className="flex items-center gap-2">
              <b className="w-6 text-center">{ranks[p.seat] === 1 ? "🥇" : ranks[p.seat] === 2 ? "🥈" : ranks[p.seat] === 3 ? "🥉" : ranks[p.seat]}</b>
              <SeatTag seat={p.seat} names={names} me={mySeat} />
            </span>
            <span className="text-xs text-white/70 tabular-nums">
              {accuracy([p.stats.perfects, p.stats.greats, p.stats.goods, p.stats.misses], notes)}% · 🔥{p.stats.maxCombo} · <b className="text-sm text-fuchsia-200">{p.total.toLocaleString()}</b>
            </span>
          </li>
        ))}
      </ol>
      {awards.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
          {awards.map((a) => (
            <div key={a.title} className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
              <div className="font-bold">
                {a.icon} {a.title} <span className="text-white/50">{a.value}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {a.seats.map((s) => (
                  <SeatTag key={s} seat={s} names={names} me={mySeat} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-center text-[11px] text-white/50">동점이면 퍼펙트 수 → 최대 콤보 순</p>
    </div>
  );
}
