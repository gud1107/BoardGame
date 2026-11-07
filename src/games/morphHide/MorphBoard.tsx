"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AREAS, BASE, CHEST_SLOTS, GOAL_SLOTS, ROOMS, STATIC_SOLIDS, placeName, slotY } from "./map";
import { DISGUISES, EMOTES, HIDE_SEC, KKOM_CALL_R, KKOM_CAMP_R, KKOM_ERRANDS, POSES, SEEKER_HP, SPAM_STEP, WEAPONS, disguise, secsToNextTier, weaponSchedule } from "./data";
import type { Act, PosReport } from "./sim";
import type { Snap, SnapBuffer } from "./net";
import { freshControls, type Controls, type FxItem, type NearInfo, type SelfInfo } from "./three/World3D";
import { AUG_N, AUG_PICKS, AUG_TIER_STYLE, HIDER_AUG_PICKS, aug } from "./augments";
import { falloff, isMuted, play, setMuted } from "./sound";
import { speakEmote, speakShout } from "./emoteVoice";

const World3D = dynamic(() => import("./three/World3D"), { ssr: false });
const PickPreview = dynamic(() => import("./three/PickPreview"), { ssr: false });
const DisguiseLineup = dynamic(() => import("./three/DisguiseLineup"), { ssr: false });

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
  // 꼼꼼이 집 지키기 경고용: 내 화면(예측) 위치가 기지 원 안인가 — 0.15초마다, 바뀔 때만 다시 그림
  const [inBaseZone, setInBaseZone] = useState(false);
  const watchBase = !!snap.goal && snap.phase === "hunt" && me?.role === "seeker";
  useEffect(() => {
    if (!watchBase) return;
    const id = window.setInterval(() => {
      const p = selfRef.current;
      setInBaseZone(Math.hypot(p.x - BASE.x, p.z - BASE.z) <= KKOM_CAMP_R && p.y < 1.5);
    }, 150);
    return () => window.clearInterval(id);
  }, [watchBase]);
  const [near, setNear] = useState<NearInfo | null>(null);
  const [full, setFull] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [remorphOpen, setRemorphOpen] = useState(false);
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
        case "kkomCall":
          play("goal", 1);
          if (!isMuted()) {
            // 걸린 사람은 내 목소리로 "들켰다", 아니면 술래 목소리로 "찾는다"
            const caller = snap.players.find((p) => p.role === "seeker");
            if (ev.out.includes(mySeat)) speakShout("busted", mySeat, ev.at, names[mySeat], 1);
            else if (caller) speakShout("found", caller.s, ev.at, names[caller.s], 1);
          }
          break;
        case "escape":
          play("escape", 0.8);
          if (!isMuted()) speakShout("kkom", ev.seat, ev.at, names[ev.seat], ev.seat === mySeat ? 1 : seatPos(ev.seat));
          break;
        case "decoy":
          if (ev.seat === mySeat) play("decoy", 1);
          break;
        case "seekerDown":
          play("seekerDown", 0.9);
          break;
        case "emote": {
          const v = ev.seat === mySeat ? 1 : seatPos(ev.seat);
          // 그 사람 캐릭터 목소리 + 성격별 대사 (말풍선과 같은 대사)
          if (!isMuted()) speakEmote(ev.emote, ev.seat, ev.at, names[ev.seat], v);
          break;
        }
        case "phase":
          if (ev.phase === "hunt") play("start", 1);
          break;
        case "aug":
          play(ev.seat === mySeat ? "augPick" : "pick", ev.seat === mySeat ? 1 : 0.35);
          break;
        case "intel":
          if (ev.seat === mySeat) play(ev.icon === "🔔" ? "bell" : "intel", 0.9);
          break;
        case "ping":
          if (ev.notify.includes(mySeat)) {
            play("sniff", 1);
            if (navigator.vibrate) navigator.vibrate(60);
          } else if (isSeeker) play(ev.kind === "trap" ? "bell" : ev.kind === "ear" ? "intel" : "sniff", ev.kind === "ear" ? 0.4 : 0.8);
          break;
        case "shock":
          play("shock", Math.max(0.35, at(ev.x, ev.z)));
          break;
      }
    }
    if (soundedRef.current.size > 500) soundedRef.current = new Set(fx.map((f) => f.ev.id));
  }, [fx, mySeat, isSeeker, snap.players, names]);
  // 술래 출발 3초 전 째깍
  const lastTickRef = useRef(-1);
  useEffect(() => {
    // 꼼꼼이의 숨는 시간은 비밀 — 째깍 소리도 없다
    if ((snap.phase === "pick" || (snap.phase === "hide" && !snap.goal)) && left <= 3.5 && left > 0) {
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
  // 숨는 사람 증강 카드가 뜨면 전체 화면을 잠시 풀고, 고르고 나면 원래대로 되돌린다
  const hiderAugOpen = !isSeeker && snap.phase === "pick" && !!me?.dg && (me?.ao?.length ?? 0) > 0;
  const fullRef = useRef(full);
  useEffect(() => {
    fullRef.current = full;
  }, [full]);
  const restoreFullRef = useRef(false);
  function restoreFull() {
    if (!restoreFullRef.current) return;
    restoreFullRef.current = false;
    setFull(true);
    // 카드 클릭(사용자 동작) 안에서 부르면 진짜 전체 화면으로, 시간 초과 랜덤이면 창 가득(고정 배치)으로만 돌아온다
    stageRef.current?.requestFullscreen?.().catch(() => {});
  }
  useEffect(() => {
    if (hiderAugOpen) {
      if (fullRef.current) {
        restoreFullRef.current = true;
        setFull(false);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      }
    } else restoreFull();
  }, [hiderAugOpen]);
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
  // 증강 카드가 떠 있나 (술래: 눈 가린 동안 / 숨는 사람: 변신을 고른 뒤)
  const myOffer = me?.ao ?? [];
  const augPickOpen = (snap.phase === "pick" || snap.phase === "hide") && myOffer.length > 0 && (isSeeker || !!me?.dg);
  // 증강 카드가 뜨면 등급별 소리 — 회차(가진 증강 수)당 1번, 다시 뽑기로는 다시 안 울린다
  const augOfferKey = augPickOpen ? `${snap.phase}:${me?.aug?.length ?? 0}:${aug(myOffer[0])?.tier ?? "silver"}` : null;
  useEffect(() => {
    if (!augOfferKey) return;
    const tier = augOfferKey.split(":")[2];
    play(tier === "prism" ? "augOfferPrism" : tier === "gold" ? "augOfferGold" : "augOffer", 1);
  }, [augOfferKey]);
  const keys = useRef(new Set<string>());
  const actRef = useRef({ cyclePose, decoy: () => onAct({ t: "decoy" }), trap: () => onAct({ t: "trap" }), shock: () => onAct({ t: "shock" }), num: (n: number) => onAct({ t: "emote", id: EMOTES[n - 1].id }) });
  useEffect(() => {
    actRef.current = {
      cyclePose,
      decoy: () => onAct({ t: "decoy" }),
      trap: () => onAct({ t: "trap" }),
      shock: () => onAct({ t: "shock" }),
      // 숫자 키: 증강·변신 카드가 떠 있으면 그 카드 고르기, 아니면 감정표현
      num: (n: number) => {
        if (augPickOpen) {
          const id = myOffer[n - 1];
          if (id) {
            play("augPick", 1);
            onAct({ t: "aug", id });
          }
        } else if (!isSeeker && snap.phase === "pick" && me && !me.dg) {
          const id = me.offer[n - 1];
          if (id) {
            play("pick", 1);
            onAct({ t: "pick", id });
          }
        } else if (EMOTES[n - 1]) onAct({ t: "emote", id: EMOTES[n - 1].id });
      },
    };
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
      else if (k === "t") actRef.current.trap();
      else if (k === "q") actRef.current.shock();
      else if (k === "m") setShowMap((v) => !v);
      else if (k === "tab") setShowBoard(true);
      else if (["1", "2", "3", "4"].includes(k)) actRef.current.num(Number(k));
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

  const wideStage = !touch && settings.wide;
  const myName = names[mySeat] ?? "나";
  const hidersLeft = snap.players.filter((p) => p.role === "hider" && p.alive && !p.escaped).length;
  const hidersTotal = snap.players.filter((p) => p.role === "hider").length;
  const nextTier = snap.phase === "hunt" ? secsToNextTier(snap.options.huntSec, elapsed) : null;
  const chestPulse = [...fx].reverse().find((f) => f.ev.type === "chest" && f.ev.seat === mySeat && f.ev.reward === "pulse" && nowPerf - f.at < 4000);
  const hit = [...fx].reverse().find((f) => (f.ev.type === "catch" || f.ev.type === "wrong") && f.ev.by === mySeat && nowPerf - f.at < 450);
  // 증강 알림 (내 것만) · 내가 증강에 들켰다는 알림
  const intels = fx.filter((f) => f.ev.type === "intel" && f.ev.seat === mySeat && nowPerf - f.at < (f.ev.text.length > 30 ? 9000 : 5000)).slice(-2);
  const spotted = !isSeeker && [...fx].reverse().find((f) => f.ev.type === "ping" && f.ev.notify.includes(mySeat) && nowPerf - f.at < 3500);
  const seekerAugs = snap.players.filter((p) => p.role === "seeker").flatMap((p) => p.aug ?? []);
  // 카드를 눌러야 하는 화면에선 마우스 시점 고정을 푼다 (고정된 채면 커서가 안 보여 카드를 못 누르던 문제)
  const needCursor = (isSeeker && (snap.phase === "pick" || snap.phase === "hide")) || (!isSeeker && snap.phase === "pick") || snap.phase === "roundEnd" || snap.phase === "gameOver" || showBoard;
  useEffect(() => {
    if (needCursor && document.pointerLockElement) document.exitPointerLock?.();
  }, [needCursor]);
  const myAugs = me?.aug ?? [];
  const showAugStatus = !!me && myAugs.length > 0 && (snap.phase === "hunt" || (!isSeeker && snap.phase === "hide")) && visible;
  const playing = visible && (snap.phase === "hide" || snap.phase === "hunt") && !(isSeeker && snap.phase === "hide");

  const phaseLabel = snap.phase === "pick" ? "변신 고르기" : snap.phase === "hide" ? "숨는 시간" : snap.phase === "hunt" ? "술래 시간" : snap.phase === "roundEnd" ? "라운드 결과" : "게임 끝";
  const urgent = left < 10 && (snap.phase === "hunt" || snap.phase === "hide");
  /** 꼼꼼이: 숨는 시간은 숨는 쪽에도 술래에게도 안 보인다 */
  const kkomSecret = !!snap.goal && snap.phase === "hide";


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
        className={`select-none overflow-hidden bg-[#1d2a5c] font-sans ${full ? "fixed inset-0 z-[80] h-[100dvh] w-screen" : `relative h-[clamp(400px,74vh,780px)] rounded-3xl border border-white/10 shadow-2xl shadow-black/40 ${wideStage ? WIDE_STAGE : ""}`}`}
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
            <span className={`text-base font-black tabular-nums leading-none sm:text-lg ${urgent && !kkomSecret ? "text-rose-300" : "text-white"}`}>{kkomSecret ? "??:??" : fmt(left)}</span>
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
              {snap.goal?.open && (
                <Chip tone="gold">
                  🏁 꼼꼬미 <b className="tabular-nums">{snap.players.filter((p) => p.escaped).length}</b>
                  <span className="text-white/45">/{Math.ceil(hidersTotal / 2)}</span>
                </Chip>
              )}
              {seekerAugs.length > 0 && <AugChips ids={seekerAugs} label={isSeeker ? "내 증강" : "술래 증강"} />}
            </div>
          )}
          {!isSeeker && snap.phase === "hide" && seekerAugs.length > 0 && <AugChips ids={seekerAugs} label="술래 증강" />}
        </div>

        {/* 왼쪽 위: 나 + 내 증강 */}
        {me && (
          <div data-hud className="pointer-events-none absolute left-2 top-2 flex max-w-[46%] flex-col items-start gap-1.5 sm:max-w-[28%]">
          <div className={`max-w-full rounded-2xl px-3 py-2 text-[11px] leading-snug text-white/90 ${GLASS}`}>
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
                  <HpBar hp={me.hp} max={me.mhp} w="w-24" />
                </div>
              )}
              {!isSeeker && def && (
                <div className="mt-1 text-[10px] text-white/75">
                  {def.icon} {def.name} · 👯 {me.dc}
                </div>
              )}
            </div>
          </div>
          {showAugStatus && <AugStatus me={me} snap={snap} simNow={simNow} hidersLeft={hidersLeft} />}
          </div>
        )}
        {!isSeeker && snap.phase === "hunt" && visible && me?.sn && (
          <div className={`pointer-events-none absolute left-1/2 top-[40%] -translate-x-1/2 animate-pulse rounded-full px-4 py-1.5 text-sm font-bold text-rose-100 ${GLASS} ring-2 ring-rose-400/70`}>⚠️ 술래가 나를 보고 있어요!</div>
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
            {!touch && !full && (
              <span className="hidden lg:contents">
                <HudBtn onClick={() => updateSettings({ ...settings, wide: !settings.wide })} label={settings.wide ? "기본 화면" : "큰 화면"} icon={settings.wide ? "🗗" : "🖥️"} />
              </span>
            )}
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
        {/* 집 지키기 경고 — "기지 안인가"는 내 화면 위치로 (방장 위치는 늦게 온다), 게이지는 방장 값 */}
        {isSeeker && snap.phase === "hunt" && snap.goal && inBaseZone && (me?.camp ?? 0) >= 0.5 && (
          <div className={`pointer-events-none absolute left-1/2 top-[44%] -translate-x-1/2 rounded-full px-3.5 py-1.5 text-xs font-semibold ${GLASS} ${(me?.camp ?? 0) >= 1 ? "text-rose-200 ring-1 ring-rose-400/70" : "text-amber-100"}`}>
            {(me?.camp ?? 0) >= 1 ? "🚫 집 지키기 금지 — 노란 원 밖으로 나가면 바로 잡을 수 있어요" : "🏠 노란 원 안에 오래 있으면 못 잡아요"}
          </div>
        )}

        {/* 조준점 (배그식: 가는 십자 + 가운데 점) */}
        {isSeeker && snap.phase === "hunt" && visible && <Crosshair melee={weapon.kind === "melee"} alert={!!me?.sn} />}
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
          <div className={`pointer-events-none absolute left-1/2 top-28 -translate-x-1/2 rounded-2xl px-4 py-2 text-sm font-semibold text-sky-100 ${GLASS} ring-1 ring-sky-300/50`}>📡 반경 {me?.aug?.includes("chest") ? 24 : 12}m 안에 숨은 사람 {chestPulse.ev.count}명</div>
        )}
        {snap.phase === "hunt" && (intels.length > 0 || spotted) && (
          <div className="pointer-events-none absolute left-1/2 top-[7.5rem] flex w-[min(92%,28rem)] -translate-x-1/2 flex-col items-center gap-1 sm:top-36">
            {intels.map((f) =>
              f.ev.type === "intel" ? (
                <div key={f.ev.id} className={`break-keep rounded-2xl px-3.5 py-1.5 text-center text-xs font-semibold text-fuchsia-50 sm:text-sm ${GLASS} ring-1 ring-fuchsia-300/45`}>
                  {f.ev.icon} {f.ev.text}
                </div>
              ) : null,
            )}
            {spotted && <div className={`rounded-2xl px-3.5 py-1.5 text-xs font-bold text-rose-100 sm:text-sm ${GLASS} ring-1 ring-rose-400/60`}>🐾 술래 증강에 근처가 드러났어요 — 자리를 옮겨요!</div>}
          </div>
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
                  <HpBar hp={me.hp} max={me.mhp} w="w-full" />
                  <div className="mt-0.5 flex justify-between gap-2 text-[10px] text-white/50">
                    <span className={me.wr > 0 ? "text-amber-200" : ""}>
                      {(me.sh ?? 0) > 0 ? <span className="text-cyan-200">🔰 보호막 {me.sh}</span> : me.hu ? <span className="text-emerald-200">🐺 추격 중 · 벌점 0</span> : <>헛치면 −{Math.round(weapon.penalty * (1 + (me.aug?.includes("steady") ? 0 : SPAM_STEP) * me.wr))}{me.wr > 0 && !me.aug?.includes("steady") ? " (연속)" : ""}</>}
                    </span>
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
            traps={isSeeker ? (me?.tr ?? 0) : 0}
            shocks={isSeeker ? (me?.sk ?? 0) : 0}
            onTrap={() => onAct({ t: "trap" })}
            onShock={() => onAct({ t: "shock" })}
            remorphs={!isSeeker ? (me?.rm ?? 0) : 0}
            onRemorph={() => {
              setEmoteOpen(false);
              setRemorphOpen((v) => !v);
            }}
            onEmote={() => {
              setRemorphOpen(false);
              setEmoteOpen((v) => !v);
            }}
            onFreeLook={setFreeLookUi}
            locked={locked}
          />
        )}
        {remorphOpen && playing && !isSeeker && me && (me.rm ?? 0) > 0 && (
          <div data-hud className="absolute bottom-44 right-3 flex flex-col items-end gap-1.5 sm:bottom-32">
            <div className={`rounded-full px-3 py-1 text-[11px] text-white/70 ${GLASS}`}>🎭 무엇으로 바꿀까요? (1번)</div>
            {me.offer
              .filter((id) => id !== me.dg)
              .map((id) => {
                const d = disguise(id);
                return d ? (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      onAct({ t: "remorph", id });
                      setRemorphOpen(false);
                    }}
                    className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-white ${GLASS} hover:bg-white/15`}
                  >
                    {d.icon} {d.name}
                  </button>
                ) : null;
              })}
          </div>
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
          <div data-hud className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-gradient-to-b from-[#0b1026]/95 via-black/95 to-[#0b1026]/95 p-3">
            <div className="w-full max-w-3xl text-center text-white">
              <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/45">Blindfolded</div>
              {snap.goal ? (
                <div className="mt-1 text-base font-bold sm:text-lg">
                  🏃 {KKOM_ERRANDS[snap.goal.errand ?? 0]} 찍고 오는 중… <span className="text-white/50">꼼꼬미</span>
                </div>
              ) : (
                <div className="mt-1 flex items-baseline justify-center gap-2">
                  <span className="text-sm font-bold text-white/70 sm:text-base">눈을 가리고 세는 중</span>
                  <span className="text-4xl font-black tabular-nums text-white">{Math.ceil(left + (snap.phase === "pick" ? HIDE_SEC : 0))}</span>
                </div>
              )}
              {me && <AugPicker me={me} phase={snap.phase} left={left} kkom={!!snap.goal} onAct={onAct} />}
              <p className="mx-auto mt-3 max-w-md break-keep text-[11px] leading-relaxed text-white/45">
                {snap.goal
                  ? "돌아오면 “찾는다!” — 숨는 사람이 몰래 전봇대를 찍으면 놓쳐요. 전봇대 옆에 붙어 지키면(8초+) 못 잡아요."
                  : "움직이는 물건, 신호를 안 지키는 행인, 손을 안 내미는 점검원을 찾아내세요."}
              </p>
              <div className="mx-auto mt-2 flex max-w-sm flex-wrap justify-center gap-1.5">
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
        {!isSeeker && snap.phase === "pick" && me && <PickCards snap={snap} mySeat={mySeat} left={left} onAct={onAct} onHiderAugPicked={restoreFull} />}
        {!isSeeker && snap.phase === "hide" && def && (
          <div className={`pointer-events-none absolute left-1/2 top-[32%] -translate-x-1/2 rounded-2xl px-4 py-2 text-center ${GLASS}`}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Hide</div>
            <div className="text-sm text-white">
              {snap.goal ? (
                <>
                  {def.icon} <b>{def.name}</b>(으)로 변신 — 술래가 {KKOM_ERRANDS[snap.goal.errand ?? 0]} 찍으러 갔어요. <b>언제 돌아올지 몰라요!</b>
                </>
              ) : (
                <>
                  {def.icon} <b>{def.name}</b>(으)로 변신 — <span className="tabular-nums">{Math.ceil(left)}</span>초 안에 숨으세요
                </>
              )}
            </div>
            {snap.goal && <div className="mt-1 text-[11px] text-amber-200/90">📢 &ldquo;찾는다!&rdquo; 때 술래 기지 {KKOM_CALL_R}m 안에 있으면 아웃 · 사냥 중에 몰래 전봇대를 찍으면 꼼꼬미 성공(+4)</div>}
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
        {(showBoard || snap.phase === "gameOver") && <ScoreBoard snap={snap} names={names} mySeat={mySeat} simNow={simNow} onClose={() => setShowBoard(false)} />}
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

function HpBar({ hp, max = SEEKER_HP, w }: { hp: number; max?: number; w: string }) {
  return (
    <div className={`mt-1 h-1.5 ${w} overflow-hidden rounded-full bg-white/12`}>
      <div className={`h-full rounded-full transition-[width] duration-300 ${hp > max * 0.5 ? "bg-white/90" : hp > max * 0.25 ? "bg-amber-300" : "bg-rose-500"}`} style={{ width: `${Math.min(100, (hp / max) * 100)}%` }} />
    </div>
  );
}

/** 증강 아이콘 줄 (누르거나 올리면 이름·설명) */
function AugChips({ ids, label }: { ids: string[]; label: string }) {
  return (
    <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] text-white/85 ${GLASS}`}>
      <span className="text-white/50">{label}</span>
      {ids.map((id, i) => {
        const a = aug(id);
        return a ? (
          <span key={`${id}${i}`} title={`${a.name} — ${a.desc}`} style={{ textShadow: `0 0 6px ${AUG_TIER_STYLE[a.tier].color}` }}>
            {a.icon}
          </span>
        ) : null;
      })}
    </span>
  );
}

/** 증강 지금 상태 한 줄 (위쪽 패널·Tab) */
function augStatusText(id: string, me: Snap["players"][number], snap: Snap, simNow: number, hidersLeft: number): { text: string; hot?: boolean; off?: boolean } {
  const hunt = snap.phase === "hunt";
  const secTo = (t: number | undefined) => Math.max(0, Math.ceil(((t ?? 0) - simNow) / 1000));
  switch (id) {
    case "radar":
    case "scent":
      return hunt ? { text: `${secTo(me.an?.[id])}초 뒤`, hot: secTo(me.an?.[id]) <= 3 } : { text: "사냥 때 시작" };
    case "lastone":
      return !hunt ? { text: "사냥 때" } : hidersLeft === 1 ? { text: `${secTo(me.an?.last)}초 뒤`, hot: true } : { text: `${hidersLeft}명 남음` };
    case "trap":
      return hunt ? { text: `덫 ${me.tr ?? 0}개`, off: (me.tr ?? 0) === 0 } : { text: "사냥 때 3개" };
    case "shock":
      return hunt ? { text: `${me.sk ?? 0}회 남음`, off: (me.sk ?? 0) === 0 } : { text: "사냥 때 2회" };
    case "shield":
      return { text: `${me.sh ?? 0}회 남음`, off: (me.sh ?? 0) === 0 };
    case "hunter":
      return me.hu ? { text: "발동 중!", hot: true } : { text: "대기" };
    case "resolve":
      return me.ru ? { text: "사용함", off: true } : { text: "대기" };
    case "h_armor":
      return (me.sh ?? 0) > 0 ? { text: "대기" } : { text: "사용함", off: true };
    case "h_remorph":
      return (me.rm ?? 0) > 0 ? { text: "1회 남음" } : { text: "사용함", off: true };
    case "h_danger":
      return !hunt ? { text: "사냥 때" } : me.sn ? { text: "보고 있어요!", hot: true } : { text: "안전" };
    case "h_tracker": {
      if (!hunt) return { text: "사냥 때" };
      const cyc = (simNow - snap.phaseStart) % AUG_N.hTrackEvery;
      const showFrom = AUG_N.hTrackEvery - AUG_N.hTrackShow;
      return cyc >= showFrom ? { text: "지도에 표시 중", hot: true } : { text: `${Math.ceil((showFrom - cyc) / 1000)}초 뒤` };
    }
    default:
      return { text: "적용 중" };
  }
}

/** 사냥 중 왼쪽 위: 내 증강 + 언제 발동하나 + 지금 상태 */
function AugStatus({ me, snap, simNow, hidersLeft }: { me: Snap["players"][number]; snap: Snap; simNow: number; hidersLeft: number }) {
  return (
    <div className={`w-full rounded-2xl px-2.5 py-1.5 text-white ${GLASS}`}>
      <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-fuchsia-200/70">내 증강 · Tab 자세히</div>
      {(me.aug ?? []).map((id) => {
        const a = aug(id);
        if (!a) return null;
        const st = augStatusText(id, me, snap, simNow, hidersLeft);
        return (
          <div key={id} className={`mt-1 ${st.off ? "opacity-45" : ""}`}>
            <div className="flex items-center gap-1 text-[11px] leading-tight">
              <span style={{ textShadow: `0 0 6px ${AUG_TIER_STYLE[a.tier].color}` }}>{a.icon}</span>
              <span className="truncate font-semibold">{a.name}</span>
              <span className={`ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold tabular-nums ${st.hot ? "bg-rose-400/30 text-rose-100" : "bg-white/10 text-white/80"}`}>{st.text}</span>
            </div>
            <div className="break-keep text-[9px] leading-snug text-white/50 sm:text-[10px]">{a.when}</div>
          </div>
        );
      })}
    </div>
  );
}

/** 증강 고르기 — 3장 중 1장. 술래는 라운드당 두 번(눈 가린 동안), 숨는 사람은 변신을 고른 뒤 한 번 */
function AugPicker({ me, phase, left, kkom, onAct, onPicked, hider }: { me: Snap["players"][number]; phase: Snap["phase"]; left: number; kkom: boolean; onAct: (a: Act) => void; onPicked?: () => void; hider?: boolean }) {
  const owned = me.aug ?? [];
  const offer = me.ao ?? [];
  const total = hider ? HIDER_AUG_PICKS : AUG_PICKS;
  const step = Math.min(owned.length + 1, total);
  const done = owned.length >= total;
  // 꼼꼼이는 숨는 시간이 비밀 — 남은 초를 보여 주지 않는다
  const showLeft = !(kkom && phase === "hide");
  return (
    <div className="mt-3">
      <div className="flex items-center justify-center gap-2 text-xs text-white/60">
        <span className="font-semibold uppercase tracking-[0.2em] text-fuchsia-200/80">Augment</span>
        <span>
          {done ? (hider ? "증강 완료 — 곧 숨기 시작!" : "증강 2개 완료 — 곧 출발!") : <>{hider ? "숨는 사람 증강" : "증강 고르기"} <b className="text-white">{step}/{total}</b></>}
          {!done && showLeft && <span className="text-white/45"> · {Math.ceil(left)}초 안에 안 고르면 랜덤</span>}
        </span>
      </div>
      {offer.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:gap-3">
          {offer.map((id, i) => {
            const a = aug(id);
            if (!a) return null;
            const st = AUG_TIER_STYLE[a.tier];
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  play("augPick", 1);
                  onAct({ t: "aug", id });
                  onPicked?.();
                }}
                className={`group relative flex cursor-pointer flex-col items-center gap-1 overflow-hidden rounded-2xl border bg-white/[0.04] p-2 text-center backdrop-blur-md transition duration-200 hover:-translate-y-1.5 hover:bg-white/10 active:scale-95 sm:p-3 ${hider ? "min-h-28 sm:min-h-32" : "min-h-36 sm:min-h-44"}`}
                style={{ borderColor: `${st.color}66`, boxShadow: `0 0 28px -10px ${st.color}` }}
              >
                <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: st.color }} />
                <span className="absolute left-1.5 top-1.5 hidden h-5 min-w-5 place-items-center rounded-md border border-white/25 bg-white/10 text-[10px] font-bold text-white/80 sm:grid">{i + 1}</span>
                <span className="rounded-full px-2 py-px text-[9px] font-bold tracking-wide" style={{ color: st.color, background: `${st.color}22` }}>
                  {st.name}
                </span>
                <span className={`drop-shadow ${hider ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl"}`}>{a.icon}</span>
                <span className="break-keep text-[13px] font-bold leading-tight text-white sm:text-sm">{a.name}</span>
                <span className="break-keep text-[10px] leading-snug text-white/65 sm:text-[11px]">{a.desc}</span>
                <span className="break-keep text-[9px] leading-snug text-fuchsia-200/70 sm:text-[10px]">⏱ {a.when}</span>
                {a.kind === "active" && <span className="mt-auto rounded-full bg-white/10 px-1.5 py-px text-[9px] text-white/70">직접 쓰는 기술</span>}
              </button>
            );
          })}
        </div>
      )}
      {offer.length > 0 && <div className="mt-1.5 hidden text-[10px] text-white/40 sm:block">카드를 누르거나 숫자 키 1·2·3</div>}
      {offer.length === 0 && !done && phase === "pick" && !hider && <div className="mt-3 text-xs text-white/55">숨는 시간이 되면 2번째 증강 3장이 나와요 (높은 등급이 잘 나와요)</div>}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
        {offer.length > 0 && (me.arr ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => {
              play("augReroll", 1);
              onAct({ t: "augReroll" });
            }} className={`rounded-full px-3.5 py-1.5 text-xs font-semibold text-white/85 transition hover:bg-white/15 ${GLASS}`}>
            🔄 다시 뽑기 ({me.arr})
          </button>
        )}
        {owned.map((id) => {
          const a = aug(id);
          return a ? (
            <span key={id} className={`rounded-full px-2.5 py-1 text-[11px] text-white ${GLASS}`} style={{ borderColor: `${AUG_TIER_STYLE[a.tier].color}88` }} title={a.desc}>
              ✔ {a.icon} {a.name}
            </span>
          ) : null;
        })}
      </div>
    </div>
  );
}

function Crosshair({ melee, alert }: { melee: boolean; alert?: boolean }) {
  const gap = melee ? 7 : 5;
  const len = melee ? 5 : 7;
  const bar = "absolute bg-white/95 shadow-[0_0_2px_rgba(0,0,0,0.9)]";
  return (
    <div className={`pointer-events-none absolute left-1/2 top-1/2 h-0 w-0`}>
      {alert && <span className="absolute -left-6 -top-6 h-12 w-12 animate-ping rounded-full border-2 border-fuchsia-300/80" />}
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
  /** PC 넓은 창(1024px+)에서 게임 화면을 창 크기만큼 크게 */
  wide: boolean;
}

const SETTINGS_KEY = "morph-hide:view";
/**
 * PC 큰 화면: 페이지 기본 칸(2xl)을 벗어나 창 너비 − 양쪽 1.5rem(최대 1800px)까지 넓히고,
 * 높이는 창 높이에 맞춰(16:9를 넘지 않게) 키운다. lg(1024px+) 창에서만.
 */
const WIDE_STAGE = "lg:mx-[max(calc(50%-50vw+1.5rem),calc(50%-900px))] lg:h-[clamp(480px,min(calc(100dvh-7rem),56vw),1000px)]";

function loadSettings(): ViewSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<ViewSettings>) : {};
    return { sens: typeof v.sens === "number" ? Math.max(0.3, Math.min(2.5, v.sens)) : 1, mode: v.mode === "click" ? "click" : "pubg", wide: v.wide !== false };
  } catch {
    return { sens: 1, mode: "pubg", wide: true };
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
      {!touch && (
        <div className="mt-3 hidden flex-col gap-1 lg:flex">
          <span>게임 화면 크기</span>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                [true, "🖥️ 큰 화면"],
                [false, "▭ 기본"],
              ] as const
            ).map(([w, l]) => (
              <button key={l} type="button" onClick={() => onChange({ ...settings, wide: w })} className={`rounded-lg px-2 py-1.5 ${settings.wide === w ? "bg-white text-slate-900" : "bg-white/10 text-white/80 hover:bg-white/15"}`}>
                {l}
              </button>
            ))}
          </div>
          <span className="text-[10px] leading-snug text-white/45">큰 화면 = 창 너비만큼 넓게(최대 1800px). 전체 화면(⛶)과는 따로예요.</span>
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
  remorphs: number;
  onRemorph: () => void;
  traps: number;
  shocks: number;
  onTrap: () => void;
  onShock: () => void;
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
              {props.remorphs > 0 && (
                <button type="button" onClick={props.onRemorph} className={`${big} h-11 min-w-11 border-fuchsia-300/40 bg-fuchsia-500/25 px-2.5 text-[11px] font-semibold`}>
                  🎭 재변신
                </button>
              )}
            </>
          )}
          {props.isSeeker && props.hunt && (props.traps > 0 || props.shocks > 0) && (
            <div className="flex gap-2">
              {props.traps > 0 && (
                <button type="button" onClick={props.onTrap} className={`${big} h-11 min-w-11 border-amber-200/30 bg-slate-950/50 px-2.5 text-[11px] font-semibold`}>
                  {!props.touch && <Key k="T" />} 🔔 덫 {props.traps}
                </button>
              )}
              {props.shocks > 0 && (
                <button type="button" onClick={props.onShock} className={`${big} h-11 min-w-11 border-fuchsia-300/40 bg-fuchsia-500/25 px-2.5 text-[11px] font-semibold`}>
                  {!props.touch && <Key k="Q" />} 💥 충격파 {props.shocks}
                </button>
              )}
            </div>
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
          {props.isSeeker ? "좌클릭·F 공격 · 우클릭 꾹 조준 · T 덫 · Q 충격파 · R 뒤돌기 · Alt 꾹 둘러보기" : "C 자세 · G 분신 · R 뒤돌기 · Alt 꾹 둘러보기"}
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

function PickCards({ snap, mySeat, left, onAct, onHiderAugPicked }: { snap: Snap; mySeat: number; left: number; onAct: (a: Act) => void; onHiderAugPicked?: () => void }) {
  const me = snap.players[mySeat];
  const picked = me.dg;
  const offer = me.offer;
  const seekerAugs = snap.players.filter((p) => p.role === "seeker").flatMap((p) => (p.aug ?? []).map((id) => ({ id, s: p.s })));
  return (
    <div data-hud className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-gradient-to-b from-[#0b1026]/95 via-[#151b3d]/92 to-[#2a1f3d]/95 p-3 backdrop-blur-sm">
      <div className="text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/45">Choose your disguise</div>
        <div className="mt-1 text-lg font-bold text-white sm:text-2xl">무엇으로 변신할까요?</div>
        <div className="text-xs text-white/60">
          {Math.ceil(left)}초 안에 안 고르면 <b className="text-amber-200">랜덤</b>으로 정해져요
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1 text-[11px] text-white/70">
          <span className="text-white/45">술래 증강:</span>
          {seekerAugs.length === 0 ? (
            <span className="text-white/45">고르는 중…</span>
          ) : (
            seekerAugs.map(({ id, s }) => {
              const a = aug(id);
              return a ? (
                <span key={`${s}${id}`} className={`rounded-full px-2 py-0.5 ${GLASS}`} title={a.desc}>
                  {a.icon} {a.name}
                </span>
              ) : null;
            })
          )}
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
      {picked && (me.ao?.length ?? 0) > 0 && (
        <div className="w-full max-w-2xl">
          <AugPicker me={me} phase={snap.phase} left={left} kkom={!!snap.goal} onAct={onAct} onPicked={onHiderAugPicked} hider />
        </div>
      )}
      {picked && (me.ao?.length ?? 0) === 0 && (
        <div className="text-center text-sm font-bold text-cyan-200">
          ✔ 골랐어요! 다른 사람을 기다리는 중…
          {(me.aug ?? []).map((id) => {
            const a = aug(id);
            return a ? (
              <div key={id} className="mt-1 text-xs font-medium text-white/75">
                {a.icon} {a.name} — {a.desc}
              </div>
            ) : null;
          })}
        </div>
      )}
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
  // 숨는 쪽 술래 추적기: 25초마다 5초 동안 술래 위치
  if (me?.role === "hider" && me.aug?.includes("h_tracker") && snap.phase === "hunt") {
    const cyc = (buf.simNow(now) - snap.phaseStart) % AUG_N.hTrackEvery;
    if (cyc >= AUG_N.hTrackEvery - AUG_N.hTrackShow) {
      for (const p of snap.players) {
        if (p.role !== "seeker" || !p.alive) continue;
        const pp = buf.player(p.s, now);
        if (!pp) continue;
        ctx.fillStyle = "#f43f5e";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(X(pp.x), Z(pp.z), big ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  // 술래 증강 표시 (냄새·덫·귀·충격파 원) — 술래 화면에만
  if (me?.role === "seeker") {
    const simT = buf.simNow(now);
    for (const g of (snap.pings ?? [])) {
      if (g.until < simT) continue;
      const col = g.kind === "shock" ? "#f0abfc" : g.kind === "trap" ? "#fcd34d" : g.kind === "ear" ? "#7dd3fc" : "#f472b6";
      const blink = 0.55 + 0.45 * Math.sin(now / 160);
      ctx.strokeStyle = col;
      ctx.globalAlpha = blink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(g.x), Z(g.z), Math.max(3, g.r * sx), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.18 * blink;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const t of (snap.traps ?? [])) {
      ctx.fillStyle = "#fcd34d";
      ctx.beginPath();
      ctx.arc(X(t.x), Z(t.z), big ? 3.5 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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
  const items = fx.filter((f) => now - f.at < 5000 && ["catch", "escape", "seekerDown", "goalOpen", "tier", "wrong", "kkomCall", "aug"].includes(f.ev.type)).slice(-5);
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
        return <>🏁 {nm(e.seat)} 꼼꼬미!</>;
      case "kkomCall":
        return (
          <>
            📢 찾는다!{e.out.length > 0 && <> — 🙈 {e.out.map(nm).join(", ")} 기지 근처에서 들켜 아웃</>}
          </>
        );
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
      case "aug": {
        const a = aug(e.aug);
        return a ? (
          <>
            🃏 술래 {nm(e.seat)} 증강: {a.icon} {a.name}
          </>
        ) : null;
      }
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
        <HiderLineup snap={snap} names={names} mySeat={mySeat} />
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

/** 끝난 라운드의 숨는 사람 변신 모습 — 작은 3D 진열대 + 같은 칸 수의 이름표 */
function HiderLineup({ snap, names, mySeat }: { snap: Snap; names: Record<number, string>; mySeat: number }) {
  const h = snap.history[snap.history.length - 1];
  if (!h || h.hiders.length === 0) return null;
  const items = h.hiders.map((x) => ({ seat: x.seat, dg: x.disguise, pose: snap.players[x.seat]?.pose ?? 0, caught: x.result === "caught" }));
  const cols = { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` };
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#1d2a5c]/70 to-[#0b1026]/80">
      <div className="h-24 sm:h-28">
        <DisguiseLineup items={items} seed={snap.seed} round={snap.round} />
      </div>
      <div className="grid border-t border-white/10 bg-black/30 px-0.5 py-1" style={cols}>
        {h.hiders.map((x) => {
          const d = disguise(x.disguise);
          return (
            <div key={x.seat} className={`min-w-0 px-0.5 text-center leading-tight ${x.seat === mySeat ? "text-cyan-200" : "text-white/85"}`}>
              <div className="truncate text-[10px] font-semibold">{x.seat === mySeat ? "나" : names[x.seat]}</div>
              <div className="truncate text-[9px] text-white/55">{d ? d.name : "?"}</div>
              <div className={`text-[9px] ${x.result === "caught" ? "text-rose-300" : x.result === "escaped" ? "text-yellow-300" : "text-emerald-300"}`}>{x.result === "caught" ? "💥 잡힘" : x.result === "escaped" ? "🏁 찜" : "🐦 생존"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Tab / 🏆 — 점수 + 이번 라운드 + 내 증강 설명.
 * 이번 라운드: 숨는 사람(또는 탈락자)은 살아 있는 사람·변신·술래별 잡은 수까지,
 * 술래는 "내가 잡은 사람"만 (살아 있는 숨는 사람의 변신은 술래에게 숨긴다).
 */
function ScoreBoard({ snap, names, mySeat, simNow, onClose }: { snap: Snap; names: Record<number, string>; mySeat: number; simNow: number; onClose: () => void }) {
  const rows = [...snap.players].sort((a, b) => b.score - a.score);
  const me = snap.players[mySeat];
  const isSeeker = me?.role === "seeker";
  const nm = (s: number) => (s === mySeat ? "나" : (names[s] ?? `${s + 1}번`));
  const hiders = snap.players.filter((p) => p.role === "hider");
  const seekers = snap.players.filter((p) => p.role === "seeker");
  const hidersLeft = hiders.filter((p) => p.alive && !p.escaped).length;
  const inRound = snap.phase === "hide" || snap.phase === "hunt";
  const myCaught = hiders.filter((p) => p.cb === mySeat);
  const status = (p: Snap["players"][number]) => (p.escaped ? "🏁 찜" : p.alive ? "🫣 숨는 중" : p.cb === -1 ? "📢 찾는다! 아웃" : p.cb !== undefined ? `💥 ${nm(p.cb)}에게 잡힘` : "💥 잡힘");
  return (
    <div data-hud className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-black/60 p-3" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto sm:flex-row">
        {/* 점수 */}
        <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-4 text-white shadow-2xl shadow-black/50 backdrop-blur-xl sm:w-60 sm:shrink-0">
          <div className="mb-2 text-center font-bold">{snap.phase === "gameOver" ? "🏁 최종 점수" : "🏆 점수"}</div>
          {rows.map((p, i) => (
            <div key={p.s} className={`flex items-center justify-between rounded-xl px-3 py-1.5 text-sm ${p.s === mySeat ? "bg-white/15" : ""}`}>
              <span className="truncate">
                {i + 1}. {p.role === "seeker" ? "👁️" : "🫣"} {names[p.s]}
              </span>
              <b className="tabular-nums">{p.score}</b>
            </div>
          ))}
          <p className="mt-2 text-center text-[10px] text-white/50">끝까지 숨기 +3 · 찜 +4 · 버틴 1분마다 +1 · 술래 잡기 +2 · 술래 전원 검거 +2</p>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* 게임 끝: 마지막 라운드에 숨는 사람이 어떤 모습이었나 */}
          {snap.phase === "gameOver" && snap.history.length > 0 && (
            <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-4 text-white shadow-2xl shadow-black/50 backdrop-blur-xl">
              <div className="text-center text-sm font-bold">🎭 마지막 라운드 — 이렇게 숨어 있었어요</div>
              <HiderLineup snap={snap} names={names} mySeat={mySeat} />
            </div>
          )}
          {/* 이번 라운드 */}
          {snap.phase !== "gameOver" && (
            <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-4 text-white shadow-2xl shadow-black/50 backdrop-blur-xl">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-bold">📋 라운드 {snap.round}</span>
                <span className="text-xs text-white/60">
                  숨은 사람 <b className="text-white">{hidersLeft}</b>/{hiders.length} 남음
                </span>
              </div>
              {isSeeker ? (
                <>
                  <div className="text-xs text-white/60">내가 잡은 사람 {myCaught.length}명</div>
                  {myCaught.length === 0 ? (
                    <div className="mt-1 rounded-xl bg-white/5 px-3 py-2 text-xs text-white/50">{inRound ? "아직 아무도 못 잡았어요" : "이번 라운드엔 못 잡았어요"}</div>
                  ) : (
                    myCaught.map((p) => {
                      const d = disguise(p.dg);
                      return (
                        <div key={p.s} className="mt-1 flex items-center justify-between rounded-xl bg-white/5 px-3 py-1.5 text-sm">
                          <span className="truncate">💥 {nm(p.s)}</span>
                          <span className="shrink-0 text-xs text-white/70">{d ? `${d.icon} ${d.name}` : "?"}</span>
                        </div>
                      );
                    })
                  )}
                  <p className="mt-2 text-[10px] text-white/40">살아 있는 사람의 변신은 술래에게 보이지 않아요</p>
                </>
              ) : (
                <>
                  {hiders.map((p) => {
                    const d = disguise(p.dg);
                    return (
                      <div key={p.s} className={`mt-1 flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm ${p.s === mySeat ? "bg-white/15" : "bg-white/5"} ${p.alive && !p.escaped ? "" : "opacity-60"}`}>
                        <span className="min-w-0 flex-1 truncate">{nm(p.s)}</span>
                        <span className="shrink-0 text-xs text-white/80">{d ? `${d.icon} ${d.name}` : "고르는 중"}</span>
                        <span className="w-24 shrink-0 truncate text-right text-[11px] text-white/60">{status(p)}</span>
                      </div>
                    );
                  })}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {seekers.map((p) => (
                      <span key={p.s} className="rounded-full bg-sky-400/15 px-2.5 py-1 text-[11px] text-sky-100">
                        👁️ {nm(p.s)} — 잡은 사람 <b className="tabular-nums">{p.catches}</b>명{p.alive ? "" : " · 😵 탈락"}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 내 증강 설명 */}
          {me && (me.aug?.length ?? 0) > 0 && (
            <div className="rounded-3xl border border-white/10 bg-slate-950/75 p-4 text-white shadow-2xl shadow-black/50 backdrop-blur-xl">
              <div className="mb-1 font-bold">🃏 내 증강</div>
              {(me.aug ?? []).map((id) => {
                const a = aug(id);
                if (!a) return null;
                const st = augStatusText(id, me, snap, simNow, hidersLeft);
                const tier = AUG_TIER_STYLE[a.tier];
                return (
                  <div key={id} className="mt-1.5 rounded-xl bg-white/5 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span>{a.icon}</span>
                      <b>{a.name}</b>
                      <span className="rounded-full px-1.5 py-px text-[9px] font-bold" style={{ color: tier.color, background: `${tier.color}22` }}>
                        {tier.name}
                      </span>
                      {inRound && <span className={`ml-auto rounded-full px-1.5 py-px text-[10px] ${st.hot ? "bg-rose-400/30 text-rose-100" : "bg-white/10 text-white/75"}`}>{st.text}</span>}
                    </div>
                    <div className="mt-0.5 break-keep text-xs text-white/75">{a.desc}</div>
                    <div className="mt-0.5 break-keep text-[11px] text-fuchsia-200/75">⏱ {a.when}</div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-center text-[10px] text-white/45">아무 데나 누르면 닫혀요 · PC는 Tab을 떼면 닫혀요</p>
        </div>
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
          <li>🎴 숨는 사람은 카드 3장 중 하나로 변신하고, 이어서 숨는 사람 증강도 3장 중 1장 골라요(20초, 안 고르면 랜덤 · 숫자 키 1·2·3). 맵에는 같은 물건·행인·강아지·점검원이 원래 섞여 있어요.</li>
          <li>🙈 30초 동안 숨기 — 자세 바꾸기(C)로 각도·자세를 맞추고, 분신(G)으로 똑같은 가짜를 세워 두세요.</li>
          <li>👁️ 술래는 🖐️ 맨손 → 🔨 뿅망치 → 🔫 권총 → 🎯 저격총처럼 시간에 따라 무기가 바뀌어요(이전 무기는 다시 못 꺼내요). 엉뚱한 걸 치면 체력이 깎이고 0이 되면 탈락!</li>
          <li>🃏 술래 증강: 눈을 가린 동안 3장 중 하나씩 두 번 골라요(실버·골드·프리즘, 다시 뽑기 1번). 체력·속도 같은 능력치, 레이더·냄새 추적 같은 단서(정확한 위치는 안 줘요), 방울 덫(T)·충격파(Q) 같은 기술이 있어요. 숨는 사람도 술래가 뭘 골랐는지 볼 수 있어요. 사냥 중 왼쪽 위에 내 증강과 언제 발동하는지가 계속 보이고, Tab(🏆)을 누르면 이번 라운드 상황과 증강 설명이 나와요.</li>
          <li>👮 &ldquo;술래인 척&rdquo;은 점검원으로 변신 — 점검원은 손을 앞으로 내밀며 여기저기 점검해요. 어설프게 따라 하세요.</li>
          <li>🏁 꼼꼼이 모드(골목 놀이 &lsquo;꼼꼬미&rsquo;): 술래는 숫자 대신 먼 곳을 찍고 와서 숨는 시간이 매번 달라요(20~40초, 비공개). &ldquo;찾는다!&rdquo; 때 기지 근처에 있으면 아웃, 사냥 중 몰래 술래 기지 전봇대를 찍으면 꼼꼬미 성공(+4). 숨기만 하고 버티면 +1뿐, 절반 이상 찍어야 숨는 쪽 승. 술래가 전봇대를 8초 넘게 지키면 그동안 못 잡고, 잡힌 사람이 다음 술래.</li>
        </ul>
      )}
    </div>
  );
}
