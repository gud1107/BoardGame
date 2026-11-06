"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AREAS, CHEST_SLOTS, GOAL_SLOTS, ROOMS, STATIC_SOLIDS, placeName, slotY } from "./map";
import { DISGUISES, EMOTES, POSES, SEEKER_HP, SPAM_STEP, WEAPONS, disguise, secsToNextTier, weaponSchedule } from "./data";
import type { Act, PosReport } from "./sim";
import type { Snap, SnapBuffer } from "./net";
import { freshControls, type Controls, type FxItem, type NearInfo, type SelfInfo } from "./three/World3D";
import { falloff, isMuted, play, setMuted, speak } from "./sound";

const World3D = dynamic(() => import("./three/World3D"), { ssr: false });
const PickPreview = dynamic(() => import("./three/PickPreview"), { ssr: false });

/**
 * 변신 숨바꼭질 플레이 화면 — 3D 월드 위에 HUD·조작 버튼·지도·변신 카드.
 *
 * 조작
 * - PC: WASD/방향키 이동 · Shift 달리기 · Space 점프 · E 상호작용 · C 자세 · G 분신 · 1~4 감정표현
 *   · M 지도 · 마우스 드래그(또는 우클릭으로 시점 고정) 둘러보기 · 클릭한 곳으로 걷기
 *   · 술래: 좌클릭/F 공격, 우클릭 꾹 조준(저격총 확대)
 * - 휴대폰: 왼쪽 조이스틱(끝까지 밀면 달리기) · 오른쪽 점프 · 화면 드래그로 시점 · 터치한 곳으로 걷기
 */

export interface MorphBoardProps {
  snap: Snap;
  buf: SnapBuffer;
  mySeat: number;
  names: Record<number, string>;
  fx: FxItem[];
  onPos: (p: PosReport) => void;
  onAct: (a: Act) => void;
}

const TOUCH_QUERY = "(hover: none), (pointer: coarse)";

function useIsTouch() {
  const [touch, setTouch] = useState(() => typeof window !== "undefined" && window.matchMedia(TOUCH_QUERY).matches);
  useEffect(() => {
    const m = window.matchMedia(TOUCH_QUERY);
    const f = () => setTouch(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return touch;
}

function useLowDetail() {
  const [low] = useState(() => {
    if (typeof window === "undefined") return false;
    const nav = navigator as Navigator & { deviceMemory?: number };
    return (nav.deviceMemory ?? 8) <= 4 || window.innerWidth < 640;
  });
  return low;
}

function Key({ k, dark }: { k: string; dark?: boolean }) {
  return <kbd className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md border px-1 font-sans text-[10px] font-semibold ${dark ? "border-slate-900/30 bg-slate-900/10 text-slate-900" : "border-white/25 bg-white/10 text-white/90"}`}>{k}</kbd>;
}

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.floor(sec % 60))).padStart(2, "0")}`;

export default function MorphBoard({ snap, buf, mySeat, names, fx, onPos, onAct }: MorphBoardProps) {
  const me = snap.players[mySeat];
  const touch = useIsTouch();
  const lowDetail = useLowDetail();
  const controls = useRef<Controls>(freshControls());
  const selfRef = useRef<SelfInfo>({ x: me?.x ?? 0, y: 0, z: me?.z ?? 0, yaw: 0, camYaw: Math.PI });
  const [near, setNear] = useState<NearInfo | null>(null);
  const [full, setFull] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [mutedUi, setMutedUi] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [freeLookUi, setFreeLookUi] = useState(false);
  const [settings, setSettings] = useState<ViewSettings>(() => loadSettings());
  function updateSettings(next: ViewSettings) {
    setSettings(next);
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // 저장 못 해도 이번 판엔 적용된다
    }
  }
  useEffect(() => {
    controls.current.sens = settings.sens;
  }, [settings.sens]);
  const [poseState, setPoseState] = useState<{ key: string; pose: number }>({ key: "", pose: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const [nowPerf, setNowPerf] = useState(() => performance.now());
  const [place, setPlace] = useState(() => placeName(0, 0, 9));

  // 남은 시간·지금 위치 표시용 4번/초 다시 그리기
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowPerf(performance.now());
      const s = selfRef.current;
      const p = placeName(s.x, s.y, s.z);
      setPlace((old) => (old.name === p.name ? old : p));
    }, 250);
    return () => window.clearInterval(id);
  }, []);
  const simNow = buf.simNow(nowPerf);
  const left = Math.max(0, (snap.phaseEnd - simNow) / 1000);
  const elapsed = Math.max(0, (simNow - snap.phaseStart) / 1000);

  const isSeeker = me?.role === "seeker";
  const visible = me ? (isSeeker ? me.alive : me.alive && !me.escaped && !!me.dg) : false;
  const dead = !!me && !visible && snap.phase !== "pick";
  const def = disguise(me?.dg);
  const sched = weaponSchedule(snap.options.huntSec);
  const weapon = WEAPONS[sched[snap.phase === "hunt" ? snap.tier : 0]];

  // 잡히면 같은 편 아무나 따라본다
  const [spectate, setSpectate] = useState<number | null>(null);
  const alivePeople = snap.players.filter((p) => p.s !== mySeat && (p.role === "seeker" ? p.alive : p.alive && !p.escaped && !!p.dg)).map((p) => p.s);
  const specSeat = dead ? (spectate !== null && alivePeople.includes(spectate) ? spectate : (alivePeople[0] ?? null)) : null;

  // 자세 템플릿 (자세 바꾸기 → 다음 자세)
  const poseList = def ? POSES[def.form] : [];
  const poseKey = `${snap.round}:${me?.dg ?? ""}`;
  const pose = poseState.key === poseKey ? poseState.pose : 0;
  function cyclePose() {
    if (!def) return;
    const next = (pose + 1) % poseList.length;
    controls.current.pose = next;
    setPoseState({ key: poseKey, pose: next });
  }
  useEffect(() => {
    controls.current.pose = 0;
  }, [poseKey]);

  // --- 효과음 (새 이벤트만) ------------------------------------------------
  const soundedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const self = selfRef.current;
    for (const { ev } of fx) {
      if (soundedRef.current.has(ev.id)) continue;
      soundedRef.current.add(ev.id);
      const at = (x: number, z: number) => falloff(Math.hypot(x - self.x, z - self.z));
      const seatPos = (s: number) => {
        const p = snap.players[s];
        return p ? at(p.x, p.z) : 0.4;
      };
      switch (ev.type) {
        case "shot":
          play(ev.weapon === "sniper" ? "sniper" : ev.weapon === "shotgun" ? "shotgun" : "shot", Math.max(0.25, at(ev.from[0], ev.from[2])));
          break;
        case "swing":
          play("swing", seatPos(ev.by));
          break;
        case "catch":
          play("catch", ev.target === mySeat || ev.by === mySeat ? 1 : 0.6);
          if (ev.target === mySeat && navigator.vibrate) navigator.vibrate([80, 40, 160]);
          break;
        case "wrong":
          play("wrong", ev.by === mySeat ? 1 : at(ev.x, ev.z));
          break;
        case "door":
        case "window":
          play(ev.type, 0.6);
          break;
        case "chest":
          play("chest", ev.seat === mySeat ? 1 : 0.3);
          break;
        case "tier":
          if (ev.tier > 0) play("tier", isSeeker ? 1 : 0.6);
          break;
        case "goalOpen":
          play("goal", 1);
          break;
        case "escape":
          play("escape", 0.8);
          break;
        case "decoy":
          if (ev.seat === mySeat) play("decoy", 1);
          break;
        case "seekerDown":
          play("seekerDown", 0.9);
          break;
        case "emote": {
          const em = EMOTES.find((e) => e.id === ev.emote);
          const v = ev.seat === mySeat ? 1 : seatPos(ev.seat);
          if (em) speak(em.line, v);
          break;
        }
        case "phase":
          if (ev.phase === "hunt") play("start", 1);
          break;
      }
    }
    if (soundedRef.current.size > 500) soundedRef.current = new Set(fx.map((f) => f.ev.id));
  }, [fx, mySeat, isSeeker, snap.players]);
  // 술래 출발 3초 전 째깍
  const lastTickRef = useRef(-1);
  useEffect(() => {
    if ((snap.phase === "hide" || snap.phase === "pick") && left <= 3.5 && left > 0) {
      const s = Math.ceil(left);
      if (s !== lastTickRef.current) {
        lastTickRef.current = s;
        play("tick", 0.7);
      }
    }
  });

  // --- 전체 화면 ---------------------------------------------------------
  function toggleFull() {
    if (!full) {
      setFull(true);
      stageRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      setFull(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // --- 포인터 잠금 (마우스 시점) -----------------------------------------
  useEffect(() => {
    const onChange = () => setLocked(document.pointerLockElement === stageRef.current);
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== stageRef.current) return;
      controls.current.lookDX += e.movementX;
      controls.current.lookDY += e.movementY;
    };
    document.addEventListener("pointerlockchange", onChange);
    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("pointerlockchange", onChange);
      document.removeEventListener("mousemove", onMove);
    };
  }, []);

  // --- 키보드 ------------------------------------------------------------
  const keys = useRef(new Set<string>());
  const actRef = useRef({ cyclePose, decoy: () => onAct({ t: "decoy" }), emote: (id: string) => onAct({ t: "emote", id }) });
  useEffect(() => {
    actRef.current = { cyclePose, decoy: () => onAct({ t: "decoy" }), emote: (id: string) => onAct({ t: "emote", id }) };
  });
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const sync = () => {
      const k = keys.current;
      const x = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
      const z = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
      if (!joyActive.current) {
        controls.current.mx = x;
        controls.current.mz = z;
      }
      controls.current.run = k.has("shift");
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift", "tab", "alt"].includes(k)) e.preventDefault();
      if (e.repeat) return;
      keys.current.add(k);
      if (k === " ") controls.current.jump = true;
      else if (k === "r") controls.current.turn = true;
      else if (k === "alt" || k === "v") {
        controls.current.freeLook = true;
        setFreeLookUi(true);
      }
      else if (k === "e") controls.current.use = true;
      else if (k === "f") controls.current.attack = true;
      else if (k === "c") actRef.current.cyclePose();
      else if (k === "g") actRef.current.decoy();
      else if (k === "m") setShowMap((v) => !v);
      else if (k === "tab") setShowBoard(true);
      else if (["1", "2", "3", "4"].includes(k)) actRef.current.emote(EMOTES[Number(k) - 1].id);
      sync();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.current.delete(k);
      if (k === "tab") setShowBoard(false);
      if (k === "alt" || k === "v") {
        e.preventDefault();
        controls.current.freeLook = false;
        setFreeLookUi(false);
      }
      sync();
    };
    const blur = () => {
      keys.current.clear();
      controls.current.freeLook = false;
      setFreeLookUi(false);
      sync();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // --- 마우스/터치 드래그로 시점 -------------------------------------------
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const joyActive = useRef(false);
  function onStageDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-hud]")) return;
    // 배그식: 화면을 누르면 마우스 시점 고정
    if (e.pointerType === "mouse" && !locked && settings.mode === "pubg" && (e.button === 0 || e.button === 2)) {
      stageRef.current?.requestPointerLock?.();
      return;
    }
    if (e.pointerType === "mouse" && e.button === 2) {
      // 우클릭: 마우스 시점 고정 (ESC로 해제) / 이미 고정이면 조준
      if (locked) controls.current.aim = true;
      else stageRef.current?.requestPointerLock?.();
      return;
    }
    if (e.pointerType === "mouse" && locked && e.button === 0) {
      controls.current.attack = true;
      return;
    }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  }
  function onStageMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    controls.current.lookDX += dx * (e.pointerType === "touch" ? 1.5 : 1.1);
    controls.current.lookDY += dy * (e.pointerType === "touch" ? 1.3 : 1.1);
    d.x = e.clientX;
    d.y = e.clientY;
  }
  function onStageUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button === 2) controls.current.aim = false;
    if (drag.current?.id === e.pointerId) drag.current = null;
  }

  const myName = names[mySeat] ?? "나";
  const hidersLeft = snap.players.filter((p) => p.role === "hider" && p.alive && !p.escaped).length;
  const hidersTotal = snap.players.filter((p) => p.role === "hider").length;
  const nextTier = snap.phase === "hunt" ? secsToNextTier(snap.options.huntSec, elapsed) : null;
  const chestPulse = [...fx].reverse().find((f) => f.ev.type === "chest" && f.ev.seat === mySeat && f.ev.reward === "pulse" && nowPerf - f.at < 4000);
  const hit = [...fx].reverse().find((f) => (f.ev.type === "catch" || f.ev.type === "wrong") && f.ev.by === mySeat && nowPerf - f.at < 450);
  const playing = visible && (snap.phase === "hide" || snap.phase === "hunt") && !(isSeeker && snap.phase === "hide");

  const phaseLabel = snap.phase === "pick" ? "변신 고르기" : snap.phase === "hide" ? "숨는 시간" : snap.phase === "hunt" ? "술래 시간" : snap.phase === "roundEnd" ? "라운드 결과" : "게임 끝";
  const urgent = left < 10 && (snap.phase === "hunt" || snap.phase === "hide");

  return (
    <div className="flex flex-col gap-2">
      {!full && <RuleStrip />}
      <div
        ref={stageRef}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={onStageDown}
        onPointerMove={onStageMove}
        onPointerUp={onStageUp}
        onPointerCancel={onStageUp}
        onWheel={(e) => {
          controls.current.zoom = Math.max(0.7, Math.min(1.6, controls.current.zoom * (e.deltaY > 0 ? 1.06 : 0.94)));
        }}
        className={`select-none overflow-hidden bg-[#1d2a5c] font-sans ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen" : "relative h-[clamp(400px,74vh,780px)] rounded-3xl border border-white/10 shadow-2xl shadow-black/40"}`}
        style={{ touchAction: "none" }}
      >
        <World3D
          buf={buf}
          snap={snap}
          mySeat={mySeat}
          names={names}
          controlsRef={controls}
          onPos={onPos}
          onAct={onAct}
          onNear={setNear}
          selfRef={selfRef}
          spectate={specSeat}
          fx={fx}
          lowDetail={lowDetail}
          clickMove={!locked && (touch || settings.mode === "click")}
        />

        {/* 위 가운데: 나침반 + 단계·시간 */}
        <div data-hud className="pointer-events-none absolute left-1/2 top-[3.3rem] flex -translate-x-1/2 flex-col items-center gap-1.5 sm:top-2">
          {playing && (
            <div className="hidden sm:block">
              <Compass selfRef={selfRef} width={300} />
            </div>
          )}
          <div className={`flex items-center gap-2.5 rounded-full px-3.5 py-1 ${GLASS} ${urgent ? "ring-1 ring-rose-400/60" : ""}`}>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">{phaseLabel}</span>
            <span className={`text-base font-black tabular-nums leading-none sm:text-lg ${urgent ? "text-rose-300" : "text-white"}`}>{fmt(left)}</span>
            <span className="text-[10px] font-semibold tabular-nums text-white/45">
              R{snap.round}/{snap.options.rounds}
            </span>
          </div>
          {snap.phase === "hunt" && (
            <div className="flex flex-wrap justify-center gap-1">
              <Chip>
                🫣 <b className="tabular-nums">{hidersLeft}</b>
                <span className="text-white/45">/{hidersTotal}</span>
              </Chip>
              {snap.goal?.open && <Chip tone="gold">🏁 {GOAL_SLOTS[snap.goal.slot].name}</Chip>}
              {snap.goal && !snap.goal.open && <Chip tone="gold">🏁 {fmt(Math.max(0, snap.options.huntSec * 0.5 - elapsed))}</Chip>}
            </div>
          )}
        </div>

        {/* 왼쪽 위: 나 */}
        {me && (
          <div data-hud className={`pointer-events-none absolute left-2 top-2 max-w-[38%] rounded-2xl px-3 py-2 text-[11px] leading-snug text-white/90 sm:max-w-[26%] ${GLASS}`}>
            <div className="flex items-center gap-1.5">
              <span className={`rounded-md px-1.5 py-px text-[9px] font-bold tracking-wide ${isSeeker ? "bg-sky-400/20 text-sky-200" : "bg-emerald-400/20 text-emerald-200"}`}>{isSeeker ? "SEEKER" : "HIDER"}</span>
              <span className="truncate font-semibold">{myName}</span>
            </div>
            <div className="mt-1 truncate text-[10px] text-white/55">
              {place.icon} {place.name}
            </div>
            {/* 휴대폰: 아래 패널 대신 여기에 */}
            <div className="sm:hidden">
              {isSeeker && snap.phase === "hunt" && (
                <div className="mt-1">
                  <div className="flex items-center gap-1 font-semibold">
                    {weapon.icon} {weapon.name}
                    {weapon.kind === "ray" && <span className="tabular-nums text-amber-200">· {me.ammo}</span>}
                  </div>
                  <HpBar hp={me.hp} w="w-24" />
                </div>
              )}
              {!isSeeker && def && (
                <div className="mt-1 text-[10px] text-white/75">
                  {def.icon} {def.name} · 👯 {me.dc}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 오른쪽 위: 버튼 + 미니맵 */}
        <div data-hud className="absolute right-2 top-2 flex flex-col items-end gap-1.5">
          <div className="flex gap-1">
            <HudBtn onClick={() => setShowSettings((v) => !v)} label="설정" icon="⚙️" />
            <HudBtn onClick={() => setShowBoard((v) => !v)} label="점수" icon="🏆" />
            <HudBtn
              onClick={() => {
                setMuted(!isMuted());
                setMutedUi(!mutedUi);
              }}
              label="소리"
              icon={mutedUi ? "🔇" : "🔊"}
            />
            <HudBtn onClick={toggleFull} label={full ? "나가기" : "전체 화면"} icon={full ? "✕" : "⛶"} />
          </div>
          <button type="button" onClick={() => setShowMap(true)} aria-label="지도 크게 보기" className={`overflow-hidden rounded-2xl p-1 ${GLASS}`}>
            <MiniMap snap={snap} buf={buf} mySeat={mySeat} selfRef={selfRef} size={touch ? 92 : 132} />
          </button>
          {showSettings && <SettingsPanel settings={settings} onChange={updateSettings} touch={touch} />}
        </div>

        {/* 킬피드 */}
        <KillFeed fx={fx} names={names} mySeat={mySeat} now={nowPerf} />

        {freeLookUi && playing && (
          <div className={`pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 rounded-full px-3 py-1 text-[11px] text-white/90 ${GLASS}`}>👁 둘러보는 중 — 몸·자세는 그대로</div>
        )}

        {/* 조준점 (배그식: 가는 십자 + 가운데 점) */}
        {isSeeker && snap.phase === "hunt" && visible && <Crosshair melee={weapon.kind === "melee"} />}
        {hit && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className={`grid h-10 w-10 place-items-center text-3xl font-light leading-none drop-shadow ${hit.ev.type === "catch" ? "text-white" : "text-rose-400"}`}>✕</div>
          </div>
        )}

        {/* 상호작용 프롬프트 */}
        {near && visible && (
          <div data-hud className="absolute bottom-44 left-1/2 -translate-x-1/2 sm:bottom-32">
            <button type="button" onClick={() => (controls.current.use = true)} className={`flex min-h-11 items-center gap-2.5 rounded-2xl px-4 text-sm font-semibold text-white ${GLASS} ring-1 ring-cyan-300/50`}>
              {!touch && <Key k="E" />} {near.label}
            </button>
          </div>
        )}

        {chestPulse && chestPulse.ev.type === "chest" && (
          <div className={`pointer-events-none absolute left-1/2 top-28 -translate-x-1/2 rounded-2xl px-4 py-2 text-sm font-semibold text-sky-100 ${GLASS} ring-1 ring-sky-300/50`}>📡 반경 12m 안에 숨은 사람 {chestPulse.ev.count}명</div>
        )}

        {/* 아래 가운데 (PC): 무기·체력 / 변신 */}
        {playing && me && (
          <div data-hud className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 sm:block">
            {isSeeker ? (
              <div className={`flex items-center gap-3 rounded-2xl px-4 py-2 ${GLASS}`}>
                <div className="text-2xl">{weapon.icon}</div>
                <div className="min-w-44">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-white">{weapon.name}</span>
                    <span className="text-lg font-black tabular-nums text-white">{weapon.kind === "ray" ? me.ammo : "∞"}</span>
                  </div>
                  <HpBar hp={me.hp} w="w-full" />
                  <div className="mt-0.5 flex justify-between text-[10px] text-white/50">
                    <span className={me.wr > 0 ? "text-amber-200" : ""}>헛치면 −{Math.round(weapon.penalty * (1 + SPAM_STEP * me.wr))}{me.wr > 0 ? " (연속)" : ""}</span>
                    {nextTier !== null && (
                      <span className="text-sky-200/80">
                        다음 {WEAPONS[sched[snap.tier + 1]].icon} {fmt(nextTier)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : def ? (
              <div className={`flex items-center gap-3 rounded-2xl px-4 py-2 ${GLASS}`}>
                <div className="text-2xl">{def.icon}</div>
                <div>
                  <div className="text-sm font-semibold text-white">{def.name}</div>
                  <div className="text-[11px] text-white/55">
                    자세 {poseList[pose % Math.max(1, poseList.length)]?.name ?? "기본"} · 👯 분신 {me.dc}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* 조작 */}
        {playing && (
          <ControlPad
            touch={touch}
            isSeeker={isSeeker}
            hunt={snap.phase === "hunt"}
            weaponName={`${weapon.icon} ${weapon.name}`}
            canAim={weapon.kind === "ray"}
            decoys={me?.dc ?? 0}
            poseName={poseList[(pose + 1) % Math.max(1, poseList.length)]?.name ?? ""}
            controlsRef={controls}
            joyActive={joyActive}
            onPose={cyclePose}
            onDecoy={() => onAct({ t: "decoy" })}
            onEmote={() => setEmoteOpen((v) => !v)}
            onFreeLook={setFreeLookUi}
            locked={locked}
          />
        )}
        {emoteOpen && (
          <div data-hud className="absolute bottom-44 right-3 flex flex-col gap-1.5 sm:bottom-32">
            {EMOTES.map((em, i) => (
              <button
                key={em.id}
                type="button"
                onClick={() => {
                  onAct({ t: "emote", id: em.id });
                  setEmoteOpen(false);
                }}
                className={`flex min-h-10 items-center gap-2 rounded-full px-3.5 text-xs font-semibold text-white ${GLASS} hover:bg-white/15`}
              >
                {!touch && <Key k={String(i + 1)} />} {em.icon} {em.name}
              </button>
            ))}
          </div>
        )}

        {/* 술래 눈가림 */}
        {isSeeker && (snap.phase === "hide" || snap.phase === "pick") && (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-[#0b1026]/95 via-black/95 to-[#0b1026]/95">
            <div className="px-6 text-center text-white">
              <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/45">Blindfolded</div>
              <div className="mt-2 text-lg font-bold">눈을 가리고 열을 세는 중</div>
              <div className="mt-2 text-6xl font-black tabular-nums text-white">{Math.ceil(left + (snap.phase === "pick" ? 30 : 0))}</div>
              <p className="mx-auto mt-4 max-w-xs break-keep text-xs leading-relaxed text-white/55">움직이는 물건, 신호를 안 지키는 행인, 손을 안 내미는 점검원을 찾아내세요.</p>
              <div className="mx-auto mt-4 flex max-w-sm flex-wrap justify-center gap-1.5">
                {sched.map((w, i) => (
                  <span key={w} className={`rounded-full px-2.5 py-1 text-[11px] ${GLASS}`}>
                    <span className="text-white/40">{i + 1}</span> {WEAPONS[w].icon} {WEAPONS[w].name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 변신 고르기 */}
        {!isSeeker && snap.phase === "pick" && me && <PickCards snap={snap} mySeat={mySeat} left={left} onAct={onAct} />}
        {!isSeeker && snap.phase === "hide" && def && (
          <div className={`pointer-events-none absolute left-1/2 top-[32%] -translate-x-1/2 rounded-2xl px-4 py-2 text-center ${GLASS}`}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Hide</div>
            <div className="text-sm text-white">
              {def.icon} <b>{def.name}</b>(으)로 변신 — <span className="tabular-nums">{Math.ceil(left)}</span>초 안에 숨으세요
            </div>
          </div>
        )}

        {/* 탈락/관전 */}
        {dead && snap.phase === "hunt" && (
          <div data-hud className={`absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-white ${GLASS}`}>
            <span>{me?.escaped ? "🏁 찜 성공 · 관전 중" : isSeeker ? "😵 체력 소진 · 관전 중" : "💥 잡혔어요 · 관전 중"}</span>
            {specSeat !== null && (
              <button type="button" className="rounded-full bg-white/10 px-2.5 py-0.5 hover:bg-white/20" onClick={() => setSpectate(alivePeople[(alivePeople.indexOf(specSeat) + 1) % alivePeople.length] ?? null)}>
                {names[specSeat]} ›
              </button>
            )}
          </div>
        )}

        {snap.phase === "roundEnd" && <RoundResult snap={snap} names={names} mySeat={mySeat} />}
        {(showBoard || snap.phase === "gameOver") && <ScoreBoard snap={snap} names={names} mySeat={mySeat} onClose={() => setShowBoard(false)} />}
        {showMap && <BigMap snap={snap} buf={buf} mySeat={mySeat} selfRef={selfRef} onClose={() => setShowMap(false)} />}
        {!touch && !locked && playing && settings.mode === "pubg" && (
          <div className={`pointer-events-none absolute left-1/2 top-1/2 mt-10 -translate-x-1/2 rounded-full px-3.5 py-1.5 text-[11px] text-white/85 ${GLASS}`}>🖱️ 화면을 클릭하면 마우스로 둘러봐요 · ESC 해제</div>
        )}
      </div>
    </div>
  );
}

const GLASS = "border border-white/10 bg-slate-950/45 shadow-lg shadow-black/25 backdrop-blur-md";

function Chip({ children, tone }: { children: ReactNode; tone?: "gold" }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${GLASS} ${tone === "gold" ? "text-amber-200" : "text-white/85"}`}>{children}</span>;
}

function HpBar({ hp, w }: { hp: number; w: string }) {
  return (
    <div className={`mt-1 h-1.5 ${w} overflow-hidden rounded-full bg-white/12`}>
      <div className={`h-full rounded-full transition-[width] duration-300 ${hp > SEEKER_HP * 0.5 ? "bg-white/90" : hp > SEEKER_HP * 0.25 ? "bg-amber-300" : "bg-rose-500"}`} style={{ width: `${(hp / SEEKER_HP) * 100}%` }} />
    </div>
  );
}

function Crosshair({ melee }: { melee: boolean }) {
  const gap = melee ? 7 : 5;
  const len = melee ? 5 : 7;
  const bar = "absolute bg-white/95 shadow-[0_0_2px_rgba(0,0,0,0.9)]";
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0">
      <span className={bar} style={{ left: -1, top: -gap - len, width: 2, height: len }} />
      <span className={bar} style={{ left: -1, top: gap, width: 2, height: len }} />
      <span className={bar} style={{ top: -1, left: -gap - len, height: 2, width: len }} />
      <span className={bar} style={{ top: -1, left: gap, height: 2, width: len }} />
      <span className="absolute -left-[1.5px] -top-[1.5px] h-[3px] w-[3px] rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.9)]" />
      {melee && <span className="absolute -left-4 -top-4 h-8 w-8 rounded-full border border-white/40" />}
    </div>
  );
}

/** 배그식 나침반 띠 — 카메라 방향을 15°마다 눈금으로 */
function Compass({ selfRef, width }: { selfRef: React.RefObject<SelfInfo>; width: number }) {
  const strip = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const PX = width / 120; // 화면에 ±60°
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cy = selfRef.current.camYaw;
      let h = (180 - (cy * 180) / Math.PI) % 360;
      if (h < 0) h += 360;
      if (strip.current) strip.current.style.transform = `translateX(${width / 2 - (h + 360) * PX}px)`;
      if (label.current) label.current.textContent = String(Math.round(h) % 360).padStart(3, "0");
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [selfRef, width, PX]);
  const ticks = [];
  for (let d = 0; d <= 1080; d += 15) {
    const deg = d % 360;
    const name = deg === 0 ? "N" : deg === 90 ? "E" : deg === 180 ? "S" : deg === 270 ? "W" : deg % 45 === 0 ? String(deg) : "";
    ticks.push(
      <span key={d} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: d * PX }}>
        <span className={`w-px ${name ? "h-2 bg-white/80" : "h-1 bg-white/40"}`} />
        {name && <span className={`mt-px text-[9px] font-semibold leading-none ${deg % 90 === 0 ? "text-white" : "text-white/55"}`}>{name}</span>}
      </span>,
    );
  }
  return (
    <div className="relative h-7 overflow-hidden" style={{ width, maskImage: "linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent)", WebkitMaskImage: "linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent)" }}>
      <div ref={strip} className="absolute left-0 top-0 h-5 will-change-transform">
        {ticks}
      </div>
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] font-bold tabular-nums text-amber-200">
        <span ref={label}>000</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 설정 (이 기기에만 저장)

export interface ViewSettings {
  sens: number;
  /** pubg = 클릭하면 마우스 시점 고정 / click = 바닥 클릭으로 걷기 */
  mode: "pubg" | "click";
}

const SETTINGS_KEY = "morph-hide:view";

function loadSettings(): ViewSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<ViewSettings>) : {};
    return { sens: typeof v.sens === "number" ? Math.max(0.3, Math.min(2.5, v.sens)) : 1, mode: v.mode === "click" ? "click" : "pubg" };
  } catch {
    return { sens: 1, mode: "pubg" };
  }
}

function SettingsPanel({ settings, onChange, touch }: { settings: ViewSettings; onChange: (s: ViewSettings) => void; touch: boolean }) {
  return (
    <div className={`w-56 rounded-2xl p-3 text-xs text-white ${GLASS}`}>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">조작 설정</div>
      <label className="flex flex-col gap-1">
        <span className="flex justify-between">
          <span>시점 감도</span>
          <span className="tabular-nums text-white/60">{settings.sens.toFixed(1)}</span>
        </span>
        <input type="range" min={0.3} max={2.5} step={0.1} value={settings.sens} onChange={(e) => onChange({ ...settings, sens: Number(e.target.value) })} className="accent-white" />
      </label>
      {!touch && (
        <div className="mt-3 flex flex-col gap-1">
          <span>마우스 조작</span>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                ["pubg", "🎯 배그식 시점"],
                ["click", "🖱️ 클릭 이동"],
              ] as const
            ).map(([m, l]) => (
              <button key={m} type="button" onClick={() => onChange({ ...settings, mode: m })} className={`rounded-lg px-2 py-1.5 ${settings.mode === m ? "bg-white text-slate-900" : "bg-white/10 text-white/80 hover:bg-white/15"}`}>
                {l}
              </button>
            ))}
          </div>
          <span className="text-[10px] leading-snug text-white/45">{settings.mode === "pubg" ? "화면을 클릭하면 마우스로 둘러보고, 좌클릭 공격·우클릭 조준. ESC로 풀어요." : "바닥을 클릭하면 거기로 걸어가요. 드래그로 둘러보기."}</span>
        </div>
      )}
    </div>
  );
}

function HudBtn({ onClick, label, icon }: { onClick: () => void; label: string; icon: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={`grid h-9 min-w-9 place-items-center rounded-full px-2 text-sm text-white transition hover:bg-white/15 ${GLASS}`}>
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 조작 버튼 (조이스틱 + 점프 + 상황 버튼)

function ControlPad(props: {
  touch: boolean;
  isSeeker: boolean;
  hunt: boolean;
  weaponName: string;
  canAim: boolean;
  decoys: number;
  poseName: string;
  controlsRef: React.RefObject<Controls>;
  joyActive: React.RefObject<boolean>;
  onPose: () => void;
  onDecoy: () => void;
  onEmote: () => void;
  onFreeLook: (on: boolean) => void;
  locked: boolean;
}) {
  const { controlsRef } = props;
  const big = "grid place-items-center rounded-full border text-white shadow-lg shadow-black/30 backdrop-blur-md transition active:scale-95";
  return (
    <>
      {props.touch && <Joystick controlsRef={controlsRef} activeRef={props.joyActive} />}
      <div data-hud className="absolute bottom-4 right-4 flex items-end gap-2">
        <div className="flex flex-col items-end gap-2">
          {!props.isSeeker && (
            <>
              <button type="button" onClick={props.onPose} className={`${big} h-11 min-w-11 border-white/10 bg-slate-950/50 px-2.5 text-[11px] font-semibold`}>
                {!props.touch && <Key k="C" />} 🔄 {props.poseName}
              </button>
              <button type="button" disabled={props.decoys <= 0} onClick={props.onDecoy} className={`${big} h-11 min-w-11 border-white/10 bg-slate-950/50 px-2.5 text-[11px] font-semibold disabled:opacity-40`}>
                {!props.touch && <Key k="G" />} 👯 분신 {props.decoys}
              </button>
            </>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => (controlsRef.current.turn = true)} className={`${big} h-11 min-w-11 border-white/10 bg-slate-950/50 px-2.5 text-[11px] font-semibold`} aria-label="뒤돌기">
              {props.touch ? <span className="text-base">↩</span> : <><Key k="R" /> ↩ 뒤돌기</>}
            </button>
            <button
              type="button"
              onPointerDown={() => {
                controlsRef.current.freeLook = true;
                props.onFreeLook(true);
              }}
              onPointerUp={() => {
                controlsRef.current.freeLook = false;
                props.onFreeLook(false);
              }}
              onPointerCancel={() => {
                controlsRef.current.freeLook = false;
                props.onFreeLook(false);
              }}
              className={`${big} h-11 min-w-11 border-white/10 bg-slate-950/50 px-2.5 text-[11px] font-semibold`}
              aria-label="둘러보기 (누르는 동안)"
            >
              {props.touch ? <span className="text-base">👁</span> : <><Key k="Alt" /> 👁 둘러보기</>}
            </button>
          </div>
          <button type="button" onClick={props.onEmote} className={`${big} h-11 min-w-11 border-white/10 bg-slate-950/50 px-2.5 text-[11px] font-semibold`}>
            😜 감정표현
          </button>
        </div>
        <div className={props.touch ? "flex flex-col items-center gap-2" : "hidden"}>
          {props.isSeeker && props.hunt && (
            <>
              {props.canAim && (
                <button
                  type="button"
                  onPointerDown={() => (controlsRef.current.aim = true)}
                  onPointerUp={() => (controlsRef.current.aim = false)}
                  onPointerLeave={() => (controlsRef.current.aim = false)}
                  className={`${big} h-12 w-12 border-white/15 bg-slate-950/50 text-lg`}
                  aria-label="조준"
                >
                  🔭
                </button>
              )}
              <button type="button" onPointerDown={() => (controlsRef.current.attack = true)} className={`${big} h-16 w-16 border-white/20 bg-rose-500/45 text-[11px] font-bold`} aria-label="공격">
                <span className="text-lg leading-none">{props.weaponName.split(" ")[0]}</span>
                {!props.touch ? <Key k="F" /> : "공격"}
              </button>
            </>
          )}
          <button type="button" onPointerDown={() => (controlsRef.current.jump = true)} className={`${big} h-14 w-14 border-white/15 bg-white/15 text-[11px] font-bold`} aria-label="점프">
            ⤴️
            <span>{props.touch ? "점프" : "Space"}</span>
          </button>
        </div>
      </div>
      {!props.touch && (
        <div className="pointer-events-none absolute bottom-4 left-4 hidden max-w-[24%] rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-2 text-[10px] leading-relaxed text-white/65 backdrop-blur-md lg:block">
          <Key k="W" />
          <Key k="A" />
          <Key k="S" />
          <Key k="D" /> 이동 · <Key k="Shift" /> 달리기 · <Key k="Space" /> 점프 · <Key k="E" /> 문·창문·상자·사다리 · <Key k="M" /> 지도 · 1~4 감정표현
          <br />
          {props.isSeeker ? "좌클릭·F 공격 · 우클릭 꾹 조준 · R 뒤돌기 · Alt 꾹 둘러보기" : "C 자세 · G 분신 · R 뒤돌기 · Alt 꾹 둘러보기"}
        </div>
      )}
    </>
  );
}

function Joystick({ controlsRef, activeRef }: { controlsRef: React.RefObject<Controls>; activeRef: React.RefObject<boolean> }) {
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const R = 46;
  const set = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2);
    let y = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(x, y);
    if (d > R) {
      x = (x / d) * R;
      y = (y / d) * R;
    }
    setKnob({ x, y });
    controlsRef.current.mx = x / R;
    controlsRef.current.mz = -y / R;
    // 끝까지 밀면 달리기
    controlsRef.current.run = d >= R * 0.92;
  };
  const release = () => {
    setKnob(null);
    activeRef.current = false;
    controlsRef.current.mx = 0;
    controlsRef.current.mz = 0;
    controlsRef.current.run = false;
  };
  return (
    <div
      data-hud
      className="absolute bottom-4 left-4 grid h-32 w-32 touch-none select-none place-items-center rounded-full border border-white/10 bg-slate-950/35 shadow-lg shadow-black/30 backdrop-blur-md"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        activeRef.current = true;
        set(e);
      }}
      onPointerMove={(e) => knob && set(e)}
      onPointerUp={release}
      onPointerCancel={release}
      aria-label="이동 조이스틱"
    >
      <div className="h-12 w-12 rounded-full bg-white/85 shadow-lg shadow-black/40 ring-1 ring-white/60" style={{ transform: `translate(${knob?.x ?? 0}px, ${knob?.y ?? 0}px)` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 변신 카드 (롤 증강처럼 3장 중 하나)

const TONE = {
  prop: { off: "border-amber-200/25 bg-gradient-to-b from-amber-300/10 to-white/[0.03] hover:border-amber-200/60", on: "border-amber-200 bg-amber-300/20 shadow-[0_0_30px_-6px_rgba(252,211,77,0.6)]", bar: "bg-amber-300", chip: "bg-amber-300/15 text-amber-100" },
  living: { off: "border-emerald-200/25 bg-gradient-to-b from-emerald-300/10 to-white/[0.03] hover:border-emerald-200/60", on: "border-emerald-200 bg-emerald-300/20 shadow-[0_0_30px_-6px_rgba(110,231,183,0.6)]", bar: "bg-emerald-300", chip: "bg-emerald-300/15 text-emerald-100" },
  guard: { off: "border-sky-200/25 bg-gradient-to-b from-sky-300/10 to-white/[0.03] hover:border-sky-200/60", on: "border-sky-200 bg-sky-300/20 shadow-[0_0_30px_-6px_rgba(125,211,252,0.6)]", bar: "bg-sky-300", chip: "bg-sky-300/15 text-sky-100" },
} as const;

function toneOf(form: string): keyof typeof TONE {
  return form === "prop" ? "prop" : form === "guard" ? "guard" : "living";
}

function PickCards({ snap, mySeat, left, onAct }: { snap: Snap; mySeat: number; left: number; onAct: (a: Act) => void }) {
  const me = snap.players[mySeat];
  const picked = me.dg;
  const offer = me.offer;
  return (
    <div data-hud className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-[#0b1026]/95 via-[#151b3d]/92 to-[#2a1f3d]/95 p-3 backdrop-blur-sm">
      <div className="text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/45">Choose your disguise</div>
        <div className="mt-1 text-lg font-bold text-white sm:text-2xl">무엇으로 변신할까요?</div>
        <div className="text-xs text-white/60">
          {Math.ceil(left)}초 안에 안 고르면 <b className="text-amber-200">랜덤</b>으로 정해져요
        </div>
      </div>
      <div className="relative w-full max-w-3xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-36 sm:h-48">
          <PickPreview ids={offer} />
        </div>
        <div className="grid grid-cols-3 gap-2 pt-28 sm:gap-3 sm:pt-40">
          {offer.map((id) => {
            const d = DISGUISES.find((x) => x.id === id)!;
            const on = picked === id;
            return (
              <button
                key={id}
                type="button"
                disabled={!!picked}
                onClick={() => {
                  play("pick", 1);
                  onAct({ t: "pick", id });
                }}
                className={`group relative flex min-h-32 flex-col items-center gap-1 overflow-hidden rounded-2xl border p-2.5 text-center backdrop-blur-md transition duration-200 ${on ? `${TONE[toneOf(d.form)].on} -translate-y-1` : picked ? "border-white/5 bg-white/[0.03] opacity-40" : `${TONE[toneOf(d.form)].off} hover:-translate-y-1.5`}`}
              >
                <span className={`absolute inset-x-0 top-0 h-0.5 ${TONE[toneOf(d.form)].bar}`} />
                <span className="text-2xl drop-shadow">{d.icon}</span>
                <span className="text-sm font-bold text-white">{d.name}</span>
                <span className={`rounded-full px-2 py-px text-[10px] font-medium ${TONE[toneOf(d.form)].chip}`}>{d.form === "prop" ? "물건" : d.form === "guard" ? "술래 위장" : d.form === "vacuum" ? "기계" : d.form === "person" ? "사람" : "동물"}</span>
                <span className="hidden break-keep text-[10px] leading-snug text-white/60 sm:block">{d.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>
      {!picked && me.rr > 0 && (
        <button type="button" onClick={() => onAct({ t: "reroll" })} className={`rounded-full px-4 py-1.5 text-xs font-semibold text-white/85 transition hover:bg-white/15 ${GLASS}`}>
          🔄 다시 뽑기 ({me.rr}번 남음)
        </button>
      )}
      {picked && <div className="text-sm font-bold text-cyan-200">✔ 골랐어요! 다른 사람을 기다리는 중…</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 지도

const MAP_X0 = -17;
const MAP_X1 = 13;
const MAP_Z0 = -9;
const MAP_Z1 = 41;

function drawMap(ctx: CanvasRenderingContext2D, w: number, h: number, snap: Snap, buf: SnapBuffer, mySeat: number, self: SelfInfo, big: boolean) {
  const sx = w / (MAP_X1 - MAP_X0);
  const sz = h / (MAP_Z1 - MAP_Z0);
  const X = (x: number) => (x - MAP_X0) * sx;
  const Z = (z: number) => (z - MAP_Z0) * sz;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1f3a1c";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#3a3d44";
  ctx.fillRect(0, Z(16), w, Z(23) - Z(16));
  ctx.fillStyle = "#7b7b7b";
  ctx.fillRect(0, Z(14), w, Z(16) - Z(14));
  ctx.fillRect(0, Z(23), w, Z(25) - Z(23));
  ctx.fillStyle = "#4b4b50";
  ctx.fillRect(X(-16), Z(-8), X(12) - X(-16), Z(-5.25) - Z(-8));
  const floor = self.y > 5.4 ? 2 : self.y > 2.4 ? 1 : 0;
  for (const r of ROOMS) {
    if (r.floor !== floor && !(floor > 0 && r.floor === 0 && false)) continue;
    ctx.fillStyle = r.floorColor;
    ctx.fillRect(X(r.box[0]), Z(r.box[2]), X(r.box[1]) - X(r.box[0]), Z(r.box[3]) - Z(r.box[2]));
    if (big) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `${Math.max(9, w / 45)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(`${r.icon}${r.name}`, X((r.box[0] + r.box[1]) / 2), Z((r.box[2] + r.box[3]) / 2) + 4);
    }
  }
  // 벽
  ctx.fillStyle = "rgba(230,220,200,0.9)";
  for (const s of STATIC_SOLIDS) {
    if (s.k !== "wall" || !s.c) continue;
    const base = floor === 0 ? 0 : floor === 1 ? 3 : 6;
    if (s.y0 > base + 1 || s.y1 < base + 1) continue;
    ctx.fillRect(X(s.x0), Z(s.z0), Math.max(1, X(s.x1) - X(s.x0)), Math.max(1, Z(s.z1) - Z(s.z0)));
  }
  if (big) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `${Math.max(10, w / 40)}px sans-serif`;
    ctx.textAlign = "center";
    for (const a of AREAS) if (a.id !== "yard") ctx.fillText(`${a.icon}${a.name}`, X((a.box[0] + a.box[1]) / 2), Z(a.id === "street" ? 19.8 : (a.box[2] + a.box[3]) / 2));
    ctx.fillText(`${floor === 0 ? "1층" : floor === 1 ? "2층" : "다락·지붕"} 기준`, w / 2, h - 6);
  }
  // 상자
  for (const c of snap.chests) {
    if (c.opened) continue;
    const s = CHEST_SLOTS[c.slot];
    if (Math.abs(slotY(s) - self.y) > 2) continue;
    ctx.fillStyle = "#facc15";
    ctx.fillRect(X(s.x) - 2, Z(s.z) - 2, 4, 4);
  }
  // 찜 장소
  if (snap.goal?.open) {
    const g = GOAL_SLOTS[snap.goal.slot];
    ctx.strokeStyle = "#fde047";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X(g.x), Z(g.z), big ? 9 : 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 같은 편
  const me = snap.players[mySeat];
  const now = performance.now();
  for (const p of snap.players) {
    if (p.s === mySeat || !me || p.role !== me.role) continue;
    const vis = p.role === "seeker" ? p.alive : p.alive && !p.escaped && !!p.dg;
    if (!vis) continue;
    const pp = buf.player(p.s, now);
    if (!pp) continue;
    ctx.fillStyle = p.role === "seeker" ? "#38bdf8" : "#86efac";
    ctx.beginPath();
    ctx.arc(X(pp.x), Z(pp.z), big ? 5 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // 나 (화살표)
  ctx.save();
  ctx.translate(X(self.x), Z(self.z));
  ctx.rotate(-self.camYaw + Math.PI);
  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  const a = big ? 9 : 6;
  ctx.moveTo(0, -a);
  ctx.lineTo(a * 0.65, a * 0.7);
  ctx.lineTo(-a * 0.65, a * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function MiniMap({ snap, buf, mySeat, selfRef, size }: { snap: Snap; buf: SnapBuffer; mySeat: number; selfRef: React.RefObject<SelfInfo>; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const snapRef = useRef(snap);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);
  const h = Math.round(size * ((MAP_Z1 - MAP_Z0) / (MAP_X1 - MAP_X0)) * 0.62);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    // 큰 지도 한 장을 계속 다시 쓴다 (예전엔 150ms마다 새 캔버스를 만들어 GC가 잦았다)
    const full = document.createElement("canvas");
    full.width = size * 2;
    full.height = Math.round(size * 2 * ((MAP_Z1 - MAP_Z0) / (MAP_X1 - MAP_X0)));
    const fctx = full.getContext("2d")!;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 150) return;
      last = t;
      const cv = ref.current;
      const ctx = cv?.getContext("2d");
      if (!cv || !ctx) return;
      // 내 주변만 잘라 보여 준다
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, full.width, full.height);
      drawMap(fctx, full.width, full.height, snapRef.current, buf, mySeat, selfRef.current, false);
      const self = selfRef.current;
      const px = ((self.x - MAP_X0) / (MAP_X1 - MAP_X0)) * full.width;
      const pz = ((self.z - MAP_Z0) / (MAP_Z1 - MAP_Z0)) * full.height;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(full, Math.max(0, Math.min(full.width - cv.width, px - cv.width / 2)), Math.max(0, Math.min(full.height - cv.height, pz - cv.height / 2)), cv.width, cv.height, 0, 0, cv.width, cv.height);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [buf, mySeat, selfRef, size]);
  return <canvas ref={ref} width={size} height={h} className="block rounded-lg" style={{ width: size, height: h }} />;
}

function BigMap({ snap, buf, mySeat, selfRef, onClose }: { snap: Snap; buf: SnapBuffer; mySeat: number; selfRef: React.RefObject<SelfInfo>; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const snapRef = useRef(snap);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cv = ref.current;
      const ctx = cv?.getContext("2d");
      if (cv && ctx) drawMap(ctx, cv.width, cv.height, snapRef.current, buf, mySeat, selfRef.current, true);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [buf, mySeat, selfRef]);
  return (
    <div data-hud className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div className="flex max-h-full flex-col items-center gap-2">
        <canvas ref={ref} width={420} height={700} className="max-h-[78vh] w-auto rounded-xl border border-white/20" />
        <button type="button" className="rounded-full bg-white/15 px-4 py-1.5 text-xs text-white">
          닫기 (M)
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 피드·결과·점수

function KillFeed({ fx, names, mySeat, now }: { fx: FxItem[]; names: Record<number, string>; mySeat: number; now: number }) {
  const items = fx.filter((f) => now - f.at < 5000 && ["catch", "escape", "seekerDown", "goalOpen", "tier", "wrong"].includes(f.ev.type)).slice(-5);
  const nm = (s: number) => (s === mySeat ? "나" : (names[s] ?? `${s + 1}번`));
  const line = (f: FxItem): ReactNode => {
    const e = f.ev;
    switch (e.type) {
      case "catch":
        return (
          <>
            👁️ {nm(e.by)} {WEAPONS[e.weapon]?.icon} → 💥 {nm(e.target)}
          </>
        );
      case "escape":
        return <>🏁 {nm(e.seat)} 찜 성공!</>;
      case "seekerDown":
        return <>😵 술래 {nm(e.seat)} 체력 바닥</>;
      case "goalOpen":
        return <>🏁 찜 장소가 열렸어요: {GOAL_SLOTS[e.slot].name}</>;
      case "tier":
        return e.tier > 0 ? (
          <>
            ⚔️ 술래 무기 업그레이드: {WEAPONS[e.weapon].icon} {WEAPONS[e.weapon].name}
          </>
        ) : null;
      case "wrong":
        return e.by === mySeat ? <>✖ {e.what}였어요… 체력 {e.hp}</> : null;
      default:
        return null;
    }
  };
  return (
    <div className="pointer-events-none absolute right-2 top-[10.5rem] flex max-w-[55%] flex-col items-end gap-1 sm:top-[14rem]">
      {items.map((f) => {
        const l = line(f);
        return l ? (
          <div key={f.ev.id} className={`rounded-xl px-2.5 py-1 text-[11px] text-white/90 ${GLASS}`}>
            {l}
          </div>
        ) : null;
      })}
    </div>
  );
}

function RoundResult({ snap, names, mySeat }: { snap: Snap; names: Record<number, string>; mySeat: number }) {
  const h = snap.history[snap.history.length - 1];
  if (!h) return null;
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-3 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-950/70 p-5 text-white shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div className="text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-white/45">Round {snap.round}</div>
        <div className="mt-1 text-center text-xl font-bold">{h.winner === "seekers" ? "👁️ 술래 승리! 모두 찾았다" : "🫣 숨는 사람 승리!"}</div>
        <div className="mt-1 text-center text-xs text-white/60">술래: {h.seekers.map((s) => names[s]).join(", ")}</div>
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {h.hiders.map((x) => {
            const d = disguise(x.disguise);
            return (
              <li key={x.seat} className={`flex items-center justify-between rounded-xl px-3 py-1.5 ${x.seat === mySeat ? "bg-white/15" : "bg-white/[0.04]"}`}>
                <span>
                  {d?.icon} {names[x.seat]} <span className="text-white/50">({d?.name ?? "?"})</span>
                </span>
                <span className={x.result === "caught" ? "text-rose-300" : x.result === "escaped" ? "text-yellow-300" : "text-emerald-300"}>{x.result === "caught" ? `💥 ${x.by !== undefined ? names[x.by] + "에게" : ""} 잡힘` : x.result === "escaped" ? "🏁 찜!" : "🐦 끝까지 숨음"}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ScoreBoard({ snap, names, mySeat, onClose }: { snap: Snap; names: Record<number, string>; mySeat: number; onClose: () => void }) {
  const rows = [...snap.players].sort((a, b) => b.score - a.score);
  return (
    <div data-hud className="absolute inset-0 z-20 grid place-items-center bg-black/60 p-3" onClick={onClose}>
      <div className="w-full max-w-xs rounded-3xl border border-white/10 bg-slate-950/70 p-5 text-white shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div className="mb-3 text-center font-bold">{snap.phase === "gameOver" ? "🏁 최종 점수" : "🏆 점수"}</div>
        {rows.map((p, i) => (
          <div key={p.s} className={`flex items-center justify-between rounded-xl px-3 py-1.5 text-sm ${p.s === mySeat ? "bg-white/15" : ""}`}>
            <span>
              {i + 1}. {p.role === "seeker" ? "👁️" : "🫣"} {names[p.s]}
            </span>
            <b className="tabular-nums">{p.score}</b>
          </div>
        ))}
        <p className="mt-2 text-center text-[10px] text-white/50">끝까지 숨기 +3 · 찜 +4 · 버틴 1분마다 +1 · 술래 잡기 +2 · 술래 전원 검거 +2</p>
      </div>
    </div>
  );
}

function RuleStrip() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/75 light:border-slate-200 light:bg-white light:text-slate-600">
      <button type="button" className="flex w-full items-center justify-between font-semibold" onClick={() => setOpen((v) => !v)}>
        <span>📖 변신 숨바꼭질 — 숨는 사람은 사물·사람·동물로 변신, 술래는 시간이 갈수록 강해지는 무기로 찾아내요</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className="mt-2 list-disc space-y-1 pl-4 break-keep">
          <li>🎴 숨는 사람은 카드 3장 중 하나로 변신(15초, 안 고르면 랜덤). 맵에는 같은 물건·행인·강아지·점검원이 원래 섞여 있어요.</li>
          <li>🙈 30초 동안 숨기 — 자세 바꾸기(C)로 각도·자세를 맞추고, 분신(G)으로 똑같은 가짜를 세워 두세요.</li>
          <li>👁️ 술래는 🖐️ 맨손 → 🔨 뿅망치 → 🔫 권총 → 🎯 저격총처럼 시간에 따라 무기가 바뀌어요(이전 무기는 다시 못 꺼내요). 엉뚱한 걸 치면 체력이 깎이고 0이 되면 탈락!</li>
          <li>👮 &ldquo;술래인 척&rdquo;은 점검원으로 변신 — 점검원은 손을 앞으로 내밀며 여기저기 점검해요. 어설프게 따라 하세요.</li>
          <li>🏁 꼼꼼이 모드: 술래 시간 절반이 지나면 찜 장소가 열리고, 도착하면 탈출 성공(+4).</li>
        </ul>
      )}
    </div>
  );
}
