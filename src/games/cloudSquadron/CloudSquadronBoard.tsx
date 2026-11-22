"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { DIFF, ENEMIES, MAX_POWER, PICK_MS, PILOTS, PILOT_IDS, SEAT_SYMBOLS, STAGES, type PilotId } from "./data";
import type { Snap, SnapBuffer } from "./net";
import { bossOf, canSkill, canUlt, type GameEvent, type PlayerInput, type PlayerState } from "./sim";
import { getCloudSquadronSound } from "./cloudSquadronSound";
import Portrait from "./Portrait";
import PlanePreview from "./PlanePreview";
import RulebookModal from "./RulebookModal";
import Sky, { type LocalControls } from "./Sky";

/**
 * 구름 편대 게임 화면 (룰북 §2·§9~§11): 세로 하늘 캔버스 + 편대 카드 + 보스 체력 + 배너 +
 * 조작(키보드·터치 드래그·스킬 버튼) + 조종사 고르기 + 결과. 방장이든 손님이든 같은 스냅샷 버퍼를 그린다.
 */

export interface CloudSquadronBoardProps {
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

type Banner = { id: number; text: string; sub?: string; tone: "info" | "warn" | "good" | "bad" | "combo" };
const QUALITY_KEY = "cloud-squadron:quality";

const KEYS = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  focus: ["ShiftLeft", "ShiftRight"],
  skill: ["Space", "KeyJ", "KeyQ"],
  ult: ["KeyE", "KeyK"],
};

function Hearts({ hp, max }: { hp: number; max: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`체력 ${hp}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} viewBox="0 0 10 9" width="10" height="9" aria-hidden="true">
          <path d="M5 8.5 L0.8 4.3 A2.3 2.3 0 0 1 5 1.6 A2.3 2.3 0 0 1 9.2 4.3 Z" fill={i < hp ? "#ff5d7a" : "none"} stroke={i < hp ? "#ffd0da" : "rgba(255,255,255,.35)"} strokeWidth="0.9" />
        </svg>
      ))}
    </span>
  );
}

function SquadCard({ p, name, me, t }: { p: PlayerState; name: string; me: boolean; t: number }) {
  if (!p.pilot) return null;
  const P = PILOTS[p.pilot];
  const skillFrac = t >= p.skillReadyAt ? 1 : 1 - (p.skillReadyAt - t) / P.skillCd;
  const down = p.st === "down";
  return (
    <div className={`flex min-w-0 items-center gap-2 rounded-xl border px-2 py-1.5 ${me ? "border-white/40 bg-white/10" : "border-white/10 bg-slate-950/60"}`} style={{ boxShadow: me ? `inset 0 0 0 1px ${P.color}55` : undefined }}>
      <Portrait id={p.pilot} size={34} dim={down} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1 text-[11px] font-bold text-white">
          <span style={{ color: P.color }}>{SEAT_SYMBOLS[p.seat]}</span>
          <span className="truncate">{name}</span>
          {p.away && <span className="rounded bg-white/15 px-1 text-[9px] text-white/70">🤖대신</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {down ? <span className="text-[10px] font-bold text-rose-300">🪂 SOS</span> : <Hearts hp={p.hp} max={P.maxHp} />}
          <span className="font-mono text-[10px] font-bold text-amber-200" aria-label={`파워 ${p.power}`}>
            P{p.power}
            {p.power >= MAX_POWER ? "★" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1" aria-hidden="true">
          <div className="h-1 flex-1 overflow-hidden rounded bg-white/10">
            <div className="h-full rounded" style={{ width: `${Math.round(skillFrac * 100)}%`, background: P.color }} />
          </div>
          <div className="h-1 flex-1 overflow-hidden rounded bg-white/10">
            <div className={`h-full rounded ${p.gauge >= 100 ? "animate-pulse" : ""}`} style={{ width: `${Math.round(p.gauge)}%`, background: "#ffcf3a" }} />
          </div>
        </div>
      </div>
      <span className="font-mono text-[11px] tabular-nums text-white/70">{p.score.toLocaleString()}</span>
    </div>
  );
}

export default function CloudSquadronBoard({ snap, buf, fresh, mySeat, names, onInput, ended, isHost, onRestart, onLeave, practice, notice }: CloudSquadronBoardProps) {
  const sound = getCloudSquadronSound;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const selfRef = useRef<PlayerState | null>(null);
  const controls = useRef<LocalControls>({ mx: 0, my: 0, focus: false, dragX: 0, dragY: 0 });
  const inputRef = useRef<PlayerInput>({ x: -1, y: -1, focus: false, skill: 0, ult: 0, hits: 0, grazes: 0, pick: null, ready: false, dx: 0, dy: -1 });
  const lastSent = useRef(0);
  const lastKey = useRef("");
  const [banners, setBanners] = useState<Banner[]>([]);
  const bannerSeq = useRef(0);
  const [rulebook, setRulebook] = useState(false);
  const [touch, setTouch] = useState(false);
  const [quality, setQuality] = useState<"auto" | "high" | "low">("auto");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [clock, setClock] = useState(0);
  const onInputRef = useRef(onInput);
  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? false);
    setReduceMotion(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    try {
      const q = window.localStorage.getItem(QUALITY_KEY);
      if (q === "high" || q === "low") setQuality(q);
    } catch {
      /* 없음 */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  // 고르기 타이머 등 HUD 시계 (4번/초)
  useEffect(() => {
    const id = window.setInterval(() => setClock(buf.simNow(performance.now())), 250);
    return () => window.clearInterval(id);
  }, [buf]);

  const low = quality === "auto" ? touch : quality === "low";
  const me = snap.players[mySeat];
  const boss = bossOf(snap);
  const bgmLevel = snap.phase === "play" && (snap.seg === "boss" || snap.seg === "mid" || snap.seg === "warn") ? 1 : 0;
  useSuiteBgm(sound, !ended && snap.phase !== "gameOver", bgmLevel);

  const send = useCallback((force = false) => {
    const inp = inputRef.current;
    const key = JSON.stringify(inp);
    const now = performance.now();
    if (!force && (key === lastKey.current || now - lastSent.current < 66)) return;
    lastKey.current = key;
    lastSent.current = now;
    onInputRef.current({ ...inp });
  }, []);

  const showBanner = useCallback((text: string, tone: Banner["tone"], sub?: string, ms = 1800) => {
    const id = ++bannerSeq.current;
    setBanners((b) => [...b.slice(-2), { id, text, tone, sub }]);
    window.setTimeout(() => setBanners((b) => b.filter((x) => x.id !== id)), ms);
  }, []);

  /* ── 이벤트 → 소리·배너 ── */
  const namesRef = useRef(names);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);
  useEffect(() => {
    const s = sound();
    let pops = 0;
    for (const e of fresh.events) {
      switch (e.k) {
        case "kill": {
          const big = ENEMIES[e.kind].score >= 500;
          if (big) s.play("boom");
          else if (pops++ < 3) s.play("pop");
          if (e.kind === "frigate") showBanner("중간 보스 격파!", "good", "폭풍 호위함", 1600);
          break;
        }
        case "bossDown":
          s.play("bossDown");
          break;
        case "hit":
          s.play(e.s === mySeat ? "hit" : "allyHit");
          break;
        case "phase":
          s.play("phase");
          break;
        case "down":
          s.play("down");
          if (e.s === mySeat) showBanner("🪂 격추!", "bad", "동료가 곁에 머물면 부활해요 (15초 뒤엔 스스로 복귀)", 2600);
          else showBanner(`🪂 ${namesRef.current[e.s] ?? ""} 격추!`, "bad", "곁으로 날아가 구해 주세요", 1800);
          break;
        case "revive":
          s.play("revive");
          if (e.by !== e.s && e.by >= 0) showBanner(`💚 ${namesRef.current[e.by] ?? ""} → ${namesRef.current[e.s] ?? ""} 부활`, "good", undefined, 1500);
          break;
        case "item":
          if (e.s === mySeat) s.play(e.kind === "power" ? "power" : e.kind === "heal" ? "heal" : "star");
          break;
        case "skill":
          s.play({ wind: "dash", iron: "shield", firefly: "drone", bolt: "charge", shadow: "stealth", flame: "napalm" }[e.pilot]);
          if (e.pilot === "bolt") window.setTimeout(() => sound().play("beam"), 600);
          break;
        case "ult":
          s.play("ult");
          if (e.pilot === "bolt") s.play("thunder");
          showBanner(`${PILOTS[e.pilot].ult.name}!`, "info", `${namesRef.current[e.s] ?? ""} · ${PILOTS[e.pilot].name}`, 1300);
          break;
        case "combo":
          s.play("combo");
          showBanner("✨ 합동 궁극기!", "combo", `${namesRef.current[e.a] ?? ""} × ${namesRef.current[e.b] ?? ""} — 피해 1.3배`, 1800);
          break;
        case "warn":
          s.play("warn");
          showBanner("⚠ WARNING", "warn", `${ENEMIES[e.kind].name} 접근 중`, 2600);
          break;
        case "midIn":
          showBanner("중간 보스", "warn", "폭풍 호위함 — 35초 안에 격파!", 2000);
          break;
        case "midGone":
          showBanner("호위함이 물러납니다", "info", undefined, 1500);
          break;
        case "lane":
          s.play("lane");
          break;
        case "bossPhase":
          s.play("phaseUp");
          showBanner(e.n === 2 ? "최종 단계!" : "보스가 분노했다!", "warn", "화면 탄 절반이 별이 됐어요", 1500);
          break;
        case "stage":
          s.play("stage");
          break;
        case "clear":
          s.play("clear");
          showBanner("STAGE CLEAR", "good", `${STAGES[e.stage]?.name ?? ""} 돌파 · 남은 체력 보너스`, 3200);
          break;
        case "continue":
          s.play("continue");
          showBanner("이어 하기", "info", `편대 전원 복귀 · 남은 이어 하기 ${e.left}번 · 점수 −20%`, 2600);
          break;
        case "over":
          s.play(e.result === "clear" ? "victory" : "defeat");
          break;
        case "pick":
          s.play("pick");
          break;
      }
    }
  }, [fresh, mySeat, sound, showBanner]);

  /* ── 보고 (Sky → 방장) ── */
  const graceRef = useRef(0);
  const onReport = useCallback(
    (r: { x: number; y: number; hit: boolean; grazes: number }) => {
      const inp = inputRef.current;
      inp.x = r.x;
      inp.y = r.y;
      inp.focus = controls.current.focus;
      if (r.hit) inp.hits++;
      if (r.grazes) {
        inp.grazes += r.grazes;
        const now = performance.now();
        if (now - graceRef.current > 90) {
          graceRef.current = now;
          sound().play("graze");
        }
      }
      send(r.hit);
    },
    [send, sound],
  );

  /* ── 스킬·궁극기 (내 화면에서 바로 예측) ── */
  const pressSkill = useCallback(() => {
    const latest = buf.latest();
    const self = selfRef.current;
    if (!latest || !self) return;
    const server = latest.players[mySeat];
    const t = buf.simNow(performance.now());
    if (!server || !canSkill(server, { phase: latest.phase, t })) {
      sound().play("denied");
      return;
    }
    const c = controls.current;
    let dx = c.mx;
    let dy = c.my;
    if (Math.hypot(c.dragX, c.dragY) > 4) {
      dx = c.dragX;
      dy = c.dragY;
    }
    const l = Math.hypot(dx, dy);
    if (l < 0.2) {
      dx = 0;
      dy = -1;
    } else {
      dx /= l;
      dy /= l;
    }
    if (server.pilot === "wind") Object.assign(self, { dashUntil: t + 350, dashX: dx, dashY: dy });
    const inp = inputRef.current;
    inp.skill++;
    inp.dx = Math.round(dx * 100) / 100;
    inp.dy = Math.round(dy * 100) / 100;
    send(true);
  }, [buf, mySeat, send, sound]);

  const pressUlt = useCallback(() => {
    const latest = buf.latest();
    const self = selfRef.current;
    if (!latest || !self) return;
    const server = latest.players[mySeat];
    const t = buf.simNow(performance.now());
    if (!server || !canUlt(server, { phase: latest.phase, t })) {
      sound().play("denied");
      return;
    }
    if (server.pilot === "iron") Object.assign(self, { ramStart: t, ramX: self.x, ramY0: self.y });
    inputRef.current.ult++;
    send(true);
  }, [buf, mySeat, send, sound]);

  /* ── 키보드 ── */
  useEffect(() => {
    if (ended) return;
    const held = new Set<string>();
    const update = () => {
      let mx = 0;
      let my = 0;
      if (KEYS.left.some((k) => held.has(k))) mx -= 1;
      if (KEYS.right.some((k) => held.has(k))) mx += 1;
      if (KEYS.up.some((k) => held.has(k))) my -= 1;
      if (KEYS.down.some((k) => held.has(k))) my += 1;
      const l = Math.hypot(mx, my) || 1;
      controls.current.mx = mx / l;
      controls.current.my = my / l;
      controls.current.focus = KEYS.focus.some((k) => held.has(k));
    };
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const all = Object.values(KEYS).flat();
      if (!all.includes(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      held.add(e.code);
      if (KEYS.skill.includes(e.code)) pressSkill();
      else if (KEYS.ult.includes(e.code)) pressUlt();
      update();
    };
    const up = (e: KeyboardEvent) => {
      if (!held.delete(e.code)) return;
      update();
    };
    const blur = () => {
      held.clear();
      update();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [ended, pressSkill, pressUlt]);

  /* ── 터치·마우스 드래그 (화면 어디서나, 손가락이 움직인 만큼) ── */
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const pointers = useRef(new Set<number>());
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (snap.phase === "pick" || snap.phase === "gameOver") return;
    if ((e.target as HTMLElement).closest("button")) return;
    pointers.current.add(e.pointerId);
    controls.current.focus = pointers.current.size >= 2;
    if (!drag.current) {
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const k = (640 / rect.height) * (e.pointerType === "mouse" ? 1 : 1.25);
    controls.current.dragX += (e.clientX - d.x) * k;
    controls.current.dragY += (e.clientY - d.y) * k;
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    controls.current.focus = pointers.current.size >= 2;
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  /* ── 조종사 고르기 ── */
  const [picking, setPicking] = useState<PilotId | null>(null);
  const shown = picking ?? me?.pilot ?? "wind";
  const pickPilot = (id: PilotId) => {
    setPicking(id);
    const taken = snap.players.some((p) => p.seat !== mySeat && p.pilot === id);
    if (taken) {
      sound().play("denied");
      return;
    }
    inputRef.current.pick = id;
    inputRef.current.ready = false;
    send(true);
  };
  const setReady = () => {
    if (!me?.pilot) return;
    inputRef.current.ready = true;
    sound().play("ready");
    send(true);
  };

  /* ── 전체화면 ── */
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
  const cycleQuality = () => {
    const next = quality === "auto" ? "high" : quality === "high" ? "low" : "auto";
    setQuality(next);
    try {
      window.localStorage.setItem(QUALITY_KEY, next);
    } catch {
      /* 저장 안 돼도 됨 */
    }
  };

  const t = clock || snap.t;
  const totalScore = snap.players.reduce((a, p) => a + p.score, 0);
  const stage = STAGES[snap.stage];
  const mvp = useMemo(() => [...snap.players].sort((a, b) => b.score - a.score)[0], [snap.players]);
  const skillReady = !!me && me.st === "fly" && t >= me.skillReadyAt;
  const ultReady = !!me && me.st === "fly" && me.gauge >= 100;
  const myPilot = me?.pilot ? PILOTS[me.pilot] : null;

  return (
    <div className="flex flex-col gap-2">
      {/* 위 HUD */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-white/80 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="font-bold text-white light:text-slate-900">
          ✈️ {snap.phase === "pick" ? "출격 준비" : `${stage?.name ?? ""} (${snap.stage + 1}/${snap.options.stages})`}
          {practice && <span className="ml-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-200 light:text-emerald-700">연습</span>}
          <span className="ml-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70 light:bg-slate-100 light:text-slate-600">{DIFF[snap.options.difficulty].label}</span>
        </span>
        <span className="flex items-center gap-2 tabular-nums">
          <span title="이어 하기">🔁 {snap.continues}</span>
          <span>편대 점수 {totalScore.toLocaleString()}</span>
        </span>
        <span className="flex gap-1">
          <button type="button" onClick={cycleQuality} className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/70 light:border-slate-300 light:text-slate-600" title="화질">
            ✨ {quality === "auto" ? "자동" : quality === "high" ? "고화질" : "저화질"}
          </button>
          <button type="button" onClick={() => setRulebook(true)} className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
          <button type="button" onClick={toggleFull} className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/70 light:border-slate-300 light:text-slate-600" aria-label="전체화면">
            ⛶
          </button>
        </span>
      </div>

      <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-start lg:justify-center">
        {/* 편대 카드 (넓은 화면은 왼쪽) */}
        <div className="grid grid-cols-2 gap-1.5 lg:order-1 lg:w-56 lg:grid-cols-1">
          {snap.players.map((p) => (
            <SquadCard key={p.seat} p={p} name={names[p.seat] ?? `${p.seat + 1}번`} me={p.seat === mySeat} t={t} />
          ))}
        </div>

        {/* 하늘 */}
        <div
          ref={stageRef}
          className={`relative mx-auto select-none overflow-hidden rounded-2xl border border-white/10 bg-[#0b1630] lg:order-2 ${full ? "fixed inset-0 z-[80] flex items-center justify-center rounded-none border-0 bg-black" : ""}`}
          style={full ? undefined : { width: "min(100%, calc((100dvh - 190px) * 9 / 16), 480px)", aspectRatio: "9 / 16" }}
        >
          <div
            className="relative touch-none"
            style={full ? { height: "100dvh", aspectRatio: "9 / 16", maxWidth: "100vw" } : { width: "100%", height: "100%" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <Sky buf={buf} mySeat={mySeat} selfRef={selfRef} controls={controls} fresh={fresh} onReport={onReport} names={names} low={low} reduceMotion={reduceMotion} />

            {/* 보스 체력 */}
            {boss && snap.phase === "play" && (
              <div className="pointer-events-none absolute inset-x-3 top-2 flex flex-col gap-0.5">
                <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-rose-100 [text-shadow:0_1px_2px_#000]">
                  <span>{ENEMIES[boss.kind].name}</span>
                  <span className="tabular-nums">{Math.ceil((boss.hp / boss.max) * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full border border-white/30 bg-black/50">
                  <div className="h-full bg-gradient-to-r from-rose-500 via-orange-400 to-amber-300 transition-[width] duration-200" style={{ width: `${(boss.hp / boss.max) * 100}%` }} />
                </div>
                {ENEMIES[boss.kind].boss && (
                  <div className="flex gap-1">
                    {[0.66, 0.33].map((m) => (
                      <span key={m} className={`h-1 flex-1 rounded ${boss.hp / boss.max > m ? "bg-white/20" : "bg-rose-400/70"}`} />
                    ))}
                    <span className="h-1 flex-1 rounded bg-white/20" />
                  </div>
                )}
              </div>
            )}

            {/* 스테이지 소개 */}
            {snap.phase === "intro" && stage && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-b from-transparent via-black/30 to-transparent">
                <span className="font-mono text-[11px] font-bold tracking-[0.3em] text-amber-200">{stage.sub}</span>
                <span className="text-4xl font-black tracking-tight text-white [text-shadow:0_3px_12px_rgba(0,0,0,.6)]">{stage.name}</span>
                <span className="mt-1 text-xs text-white/70">보스 · {ENEMIES[stage.boss].name}</span>
              </div>
            )}

            {/* 배너 */}
            <div className="pointer-events-none absolute inset-x-2 top-[30%] flex flex-col items-center gap-1.5">
              {banners.map((b) => (
                <div
                  key={b.id}
                  className={`rounded-xl border px-4 py-2 text-center shadow-lg backdrop-blur-sm ${
                    b.tone === "warn"
                      ? "border-rose-300/60 bg-rose-950/70 text-rose-50"
                      : b.tone === "good"
                        ? "border-emerald-300/50 bg-emerald-950/70 text-emerald-50"
                        : b.tone === "bad"
                          ? "border-orange-300/50 bg-orange-950/70 text-orange-50"
                          : b.tone === "combo"
                            ? "border-amber-200/70 bg-amber-900/70 text-amber-50"
                            : "border-sky-200/40 bg-slate-950/70 text-white"
                  }`}
                >
                  <div className={`font-black ${b.tone === "warn" ? "text-xl tracking-[0.2em]" : "text-base"}`}>{b.text}</div>
                  {b.sub && <div className="text-[11px] opacity-80">{b.sub}</div>}
                </div>
              ))}
            </div>

            {notice && <div className="pointer-events-none absolute inset-x-4 bottom-24 rounded-lg bg-black/70 px-3 py-2 text-center text-xs text-white">{notice}</div>}

            {/* 스킬·궁극기 버튼 */}
            {myPilot && snap.phase === "play" && (
              <div className="absolute right-2 bottom-2 flex flex-col items-end gap-2" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    pressUlt();
                  }}
                  className={`flex h-16 w-16 flex-col items-center justify-center rounded-full border-2 text-[10px] font-black shadow-lg ${ultReady ? "animate-pulse border-amber-200 bg-amber-500/80 text-slate-900" : "border-white/20 bg-slate-950/60 text-white/50"}`}
                  aria-label={`궁극기 ${myPilot.ult.name}`}
                >
                  <span className="text-lg leading-none">★</span>
                  <span className="max-w-14 truncate">{myPilot.ult.name}</span>
                  <span className="text-[9px] opacity-70">{touch ? "" : "E"}</span>
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    pressSkill();
                  }}
                  className="flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 text-[10px] font-black shadow-lg"
                  style={{ borderColor: skillReady ? myPilot.color : "rgba(255,255,255,.2)", background: skillReady ? `${myPilot.color}cc` : "rgba(2,6,23,.6)", color: skillReady ? "#0b1630" : "rgba(255,255,255,.5)" }}
                  aria-label={`스킬 ${myPilot.skill.name}`}
                >
                  <span className="max-w-12 truncate">{myPilot.skill.name}</span>
                  <span className="text-[9px] opacity-70">{touch ? "" : "Space"}</span>
                </button>
              </div>
            )}

            {/* 조종사 고르기 */}
            {snap.phase === "pick" && (
              <div className="absolute inset-0 flex flex-col gap-2 overflow-y-auto bg-[#08122a]/92 p-3 backdrop-blur-sm">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-lg font-black text-white">조종사 선택</h2>
                  <span className="font-mono text-xs text-amber-200 tabular-nums">{Math.max(0, Math.ceil((snap.phaseEnd - t) / 1000))}초</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {PILOT_IDS.map((id) => {
                    const P = PILOTS[id];
                    const owner = snap.players.find((p) => p.pilot === id);
                    const mine = owner?.seat === mySeat;
                    const takenByOther = !!owner && !mine;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => pickPilot(id)}
                        disabled={takenByOther}
                        className={`relative flex flex-col items-center gap-0.5 rounded-xl border p-1.5 text-center transition ${mine ? "bg-white/10" : shown === id ? "bg-white/5" : "bg-black/20"} ${takenByOther ? "opacity-45" : "hover:bg-white/10"}`}
                        style={{ borderColor: mine ? P.color : shown === id ? `${P.color}88` : "rgba(255,255,255,.1)" }}
                        aria-pressed={mine}
                      >
                        <Portrait id={id} size={58} dim={takenByOther} />
                        <span className="text-sm font-black" style={{ color: P.color }}>
                          {P.name}
                        </span>
                        <span className="text-[10px] text-white/60">{P.role}</span>
                        {owner && (
                          <span className="absolute top-1 right-1 max-w-[70%] truncate rounded bg-black/70 px-1 text-[9px] font-bold text-white">
                            {SEAT_SYMBOLS[owner.seat]} {names[owner.seat] ?? ""}
                            {owner.ready ? " ✓" : ""}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const P = PILOTS[shown];
                  return (
                    <div className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-black/30 p-2 text-white">
                      <div className="flex items-center gap-2">
                        <PlanePreview id={shown} size={64} still={reduceMotion} />
                        <div className="flex min-w-0 flex-col">
                          <span className="font-mono text-[10px] tracking-widest text-white/50">CALLSIGN · {P.call}</span>
                          <span className="text-base font-black" style={{ color: P.color }}>
                            {P.name} <span className="text-xs font-bold text-white/60">{P.role}</span>
                          </span>
                          <span className="text-[11px] text-white/70">“{P.quote}”</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-[10px] text-white/70">
                        {Object.entries(P.stats).map(([k, v]) => (
                          <div key={k} className="flex flex-col gap-0.5">
                            <span>{k}</span>
                            <span className="flex gap-0.5" aria-label={`${k} ${v}/5`}>
                              {[1, 2, 3, 4, 5].map((n) => (
                                <span key={n} className="h-1.5 flex-1 rounded-sm" style={{ background: n <= v ? P.color : "rgba(255,255,255,.12)" }} />
                              ))}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col gap-1 text-[11px] leading-snug">
                        <p>
                          <b className="text-white/90">🔫 {P.shot.name}</b> <span className="text-white/60">{P.shot.desc}</span>
                        </p>
                        <p>
                          <b style={{ color: P.color }}>⚡ {P.skill.name}</b> <span className="text-white/60">{P.skill.desc}</span>
                        </p>
                        <p>
                          <b className="text-amber-200">★ {P.ult.name}</b> <span className="text-white/60">{P.ult.desc}</span>
                        </p>
                        <p className="text-white/50">🤝 {P.pair}</p>
                      </div>
                    </div>
                  );
                })()}
                <button
                  type="button"
                  onClick={setReady}
                  disabled={!me?.pilot || me.ready}
                  className="rounded-xl bg-sky-400 py-2.5 text-sm font-black text-slate-900 transition hover:bg-sky-300 disabled:bg-white/15 disabled:text-white/50"
                >
                  {me?.ready ? "준비 완료 — 다른 사람을 기다려요" : me?.pilot ? `${PILOTS[me.pilot].name}(으)로 출격 준비` : "조종사를 골라 주세요"}
                </button>
                <p className="text-center text-[10px] text-white/40">{Math.round(PICK_MS / 1000)}초 안에 못 고르면 남은 조종사 중 무작위 · 같은 조종사는 한 명만</p>
              </div>
            )}

            {/* 결과 */}
            {snap.phase === "gameOver" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-[#08122a]/88 p-4 text-white backdrop-blur-sm">
                <span className="font-mono text-[11px] font-bold tracking-[0.3em] text-amber-200">{snap.result === "clear" ? "MISSION COMPLETE" : "MISSION FAILED"}</span>
                <h2 className="text-3xl font-black">{snap.result === "clear" ? "하늘을 되찾았다!" : "편대 전멸"}</h2>
                <p className="text-xs text-white/60">
                  {snap.result === "clear" ? `${snap.options.stages}개 스테이지 돌파` : `${STAGES[snap.stage]?.name ?? ""}에서 추락`} · 편대 점수 {totalScore.toLocaleString()}
                </p>
                <div className="flex w-full max-w-xs flex-col gap-1.5">
                  {[...snap.players]
                    .sort((a, b) => b.score - a.score)
                    .map((p) => (
                      <div key={p.seat} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-2 py-1.5">
                        {p.pilot && <Portrait id={p.pilot} size={36} />}
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-bold">
                            {p.seat === mvp?.seat && <span className="mr-1 rounded bg-amber-400 px-1 text-[10px] font-black text-slate-900">MVP</span>}
                            {names[p.seat] ?? ""}
                          </span>
                          <span className="text-[10px] text-white/60">
                            격추 {p.stats.kills} · 부활시킴 {p.stats.revives} · 스침 {p.stats.grazes} · 궁극기 {p.stats.ults} · 격추당함 {p.stats.downs}
                          </span>
                        </div>
                        <span className="font-mono text-sm font-bold tabular-nums">{p.score.toLocaleString()}</span>
                      </div>
                    ))}
                </div>
                <div className="flex gap-2">
                  {isHost && onRestart && (
                    <button type="button" onClick={onRestart} className="rounded-full bg-sky-400 px-5 py-2 text-sm font-bold text-slate-900 hover:bg-sky-300">
                      🔁 다시 출격
                    </button>
                  )}
                  <button type="button" onClick={onLeave} className="rounded-full border border-white/20 px-5 py-2 text-sm text-white/80">
                    나가기
                  </button>
                </div>
                {!isHost && <p className="text-[11px] text-white/40">방장이 다시 시작하면 같이 출격해요</p>}
              </div>
            )}
          </div>
        </div>

        {/* 조작 안내 (넓은 화면 오른쪽) */}
        <div className="hidden w-56 flex-col gap-2 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-[11px] text-white/70 lg:order-3 lg:flex">
          <b className="text-white">🎮 조작</b>
          <span>WASD / 방향키 — 이동 (사격은 자동)</span>
          <span>Shift — 정밀 비행 (느리게 · 판정점 크게 보임)</span>
          <span>Space / J — 스킬</span>
          <span>E / K — 궁극기 (노란 게이지 가득)</span>
          <span>마우스 드래그로도 움직일 수 있어요</span>
          <b className="mt-1 text-white">💡 팁</b>
          <span>판정점은 기체 가운데 작은 흰 점뿐 — 날개에 스친 탄은 안 맞아요. 아슬아슬하게 스치면 게이지가 빨리 차요.</span>
          <span>쓰러진 동료 곁에 2.6초 머물면 부활!</span>
          <span>두 사람이 2초 안에 궁극기를 쓰면 합동 궁극기 (피해 1.3배).</span>
          {myPilot && (
            <span className="mt-1 rounded-lg bg-white/5 p-2" style={{ borderLeft: `3px solid ${myPilot.color}` }}>
              <b style={{ color: myPilot.color }}>{myPilot.name}</b> · {myPilot.skill.name}: {myPilot.skill.desc}
            </span>
          )}
        </div>
      </div>

      {touch && snap.phase === "play" && <p className="text-center text-[11px] text-white/40">화면 아무 데나 대고 끌면 기체가 따라와요 · 두 손가락 = 정밀 비행</p>}
      {rulebook && <RulebookModal onClose={() => setRulebook(false)} />}
    </div>
  );
}
