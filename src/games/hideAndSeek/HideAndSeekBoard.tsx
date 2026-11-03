"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { preferLowDetail, webglAvailable } from "@/games/shared/three/viewPref";
import { BASE, DIST, ROOMS, SPOTS, room, spot, type RoomId } from "./house";
import {
  computeRankings,
  FLASH_CHARGES,
  hidersLeft,
  ITCH_AT,
  isActing,
  legalMoves,
  SCORE_HOME,
  SCORE_SURVIVE,
  type GameState,
  type Move,
  type MoveKind,
  type Seat,
  type SeatState,
} from "./engine";
import { cluesFor, describeEvents, figuresFor, MOVE_LABEL, SEAT_COLORS, T } from "./show";
import type { CameraFocus } from "./three/HouseScene3D";
import type { Drive } from "./three/HouseFigure";
import { walkSpecFor, type WalkInput, type WalkNear, type WalkTarget } from "./walk";
import HowToPlay from "./HowToPlay";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { callOut, getHideAndSeekSound, revealCues, tensionOf } from "./hideAndSeekSound";

const HouseScene3D = dynamic(() => import("./three/HouseScene3D"), { ssr: false });

/**
 * 한밤의 숨바꼭질 보드 — 3D 저택 + 역할별 행동 카드 + 이번 라운드 단서 기록 + 점수표.
 * 화면은 공개 정보와 내 정보만 쓴다(남의 숨은 곳은 라운드가 끝나야 보인다).
 */

export interface HideAndSeekBoardProps {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  deadlineMs: number | null;
  nowMs: number;
  /** 이번 턴에 내가 이미 확정한 행동 */
  committedMove: Move | null;
  onCommit: (move: Move) => void;
  onReady: () => void;
  onGameEnd: () => void;
}

const CARD_HELP: Record<MoveKind, string> = {
  hide: "저택의 숨을 곳 25곳 중 하나를 골라요. 술래는 마당 기둥에서 열까지 세는 중!",
  stay: `가만히 있어요. 같은 곳에서 ${ITCH_AT}턴째부터는 다리가 저려 부스럭 소리가 나요`,
  sneak: "같은 방·옆방의 다른 곳으로 옮겨요. 떠난 방에서 삐걱 소리! 술래가 들어온 방으로 가면 딱 마주쳐요",
  home: `술래 기둥까지 달려 찜! +${SCORE_HOME}. 술래가 마당이나 내 방으로 오면 막혀요`,
  search: "지금 방이나 옆방의 숨을 곳 하나를 뒤져요. 그 방으로 이동해요",
  move: "두 방까지 이동해요(꼬마 술래는 한 방). 마당을 지키면 찜을 막을 수 있어요",
  flash: "옆방을 비춰 몇 명 숨었는지 알아내요. 이동은 안 해요",
};

const KINDS_HIDER: MoveKind[] = ["stay", "sneak", "home"];
const KINDS_HUNTER: MoveKind[] = ["search", "move", "flash"];
const needsSpot = (k: MoveKind) => k === "hide" || k === "sneak" || k === "search";
const needsRoom = (k: MoveKind) => k === "move" || k === "flash";

function sameMove(a: Move, b: Move) {
  return a.kind === b.kind && (a.spot ?? "") === (b.spot ?? "") && (a.room ?? "") === (b.room ?? "");
}

export default function HideAndSeekBoard(props: HideAndSeekBoardProps) {
  const { state, viewerSeat: me, names, onCommit } = props;
  const mine = state.seats[me];
  const [lowDetail] = useState(preferLowDetail);
  const [gl] = useState(() => webglAvailable());
  const nm = (s: Seat) => (s === me ? "나" : (names[s] ?? `${s + 1}번`));

  // --- 판정 연출 ---------------------------------------------------------
  const showing = state.phase === "resolved" || state.phase === "ended";
  const [snap, setSnap] = useState<{ stage: number; mine: SeatState } | null>(null);
  if (!showing && (snap === null || snap.mine !== mine)) setSnap({ stage: state.stage, mine });
  const fresh = showing && snap !== null && snap.stage < state.stage;
  const prevMine = fresh ? snap!.mine : null;
  // 연출 시계: 판정을 처음 본 순간부터 (렌더 중에 맞춰야 첫 프레임에 결과가 새지 않는다)
  const [fxStart, setFxStart] = useState<{ stage: number; at: number }>({ stage: -1, at: 0 });
  // 시각은 Date.now() 기준 (nowMs가 0.25초마다 오므로 보드는 그만큼씩 다시 그려진다)
  if (showing && fxStart.stage !== state.stage) setFxStart({ stage: state.stage, at: props.nowMs });
  const elapsed = fxStart.stage === state.stage ? (props.nowMs - fxStart.at) / 1000 : 0;
  const revealed = !fresh || elapsed >= T.end;

  // --- 내 선택 -------------------------------------------------------------
  const [kind, setKind] = useState<MoveKind | null>(null);
  const [target, setTarget] = useState<{ spot?: string; room?: RoomId } | null>(null);
  const [stageSeen, setStageSeen] = useState(`${state.round}:${state.turn}`);
  if (stageSeen !== `${state.round}:${state.turn}`) {
    setStageSeen(`${state.round}:${state.turn}`);
    setKind(state.step === "hide" ? "hide" : null);
    setTarget(null);
  }
  const acting = isActing(state, me);
  const choosing = state.phase === "choosing" && acting && !props.committedMove && state.commits[me] === null;
  const legal = useMemo(() => (choosing ? legalMoves(state, me) : []), [choosing, state, me]);
  const effKind: MoveKind | null = state.step === "hide" ? "hide" : kind;
  const kindsAvail = state.step === "hide" ? (["hide"] as MoveKind[]) : mine.status === "hiding" ? KINDS_HIDER : KINDS_HUNTER;
  const optionsFor = (k: MoveKind) => legal.filter((m) => m.kind === k);
  const pickSpots = choosing && effKind && needsSpot(effKind) ? optionsFor(effKind).map((m) => m.spot!) : [];
  const pickRooms = choosing && effKind && needsRoom(effKind) ? optionsFor(effKind).map((m) => m.room!) : [];
  const move: Move | null = !effKind ? null : needsSpot(effKind) ? (target?.spot ? { kind: effKind, spot: target.spot } : null) : needsRoom(effKind) ? (target?.room ? { kind: effKind, room: target.room } : null) : { kind: effKind };
  const ready = !!move && legal.some((m) => sameMove(m, move));
  function pickKind(k: MoveKind) {
    setKind(k);
    const opts = optionsFor(k);
    setTarget(opts.length === 1 ? { spot: opts[0].spot, room: opts[0].room } : null);
  }
  function submit() {
    if (!move || !ready) return;
    getHideAndSeekSound().play("commit");
    onCommit(move);
  }

  // --- 소리 ----------------------------------------------------------------
  useSuiteBgm(getHideAndSeekSound, state.phase !== "ended", tensionOf(state));
  const soundStage = useRef<number | null>(null);
  useEffect(() => {
    if (soundStage.current === state.stage) return;
    const first = soundStage.current === null;
    soundStage.current = state.stage;
    if (first) return;
    const s = getHideAndSeekSound();
    const timers: number[] = [];
    const later = (sec: number, fn: () => void) => timers.push(window.setTimeout(fn, sec * 1000));
    if (state.phase === "choosing" && state.step === "hide") {
      s.play("count");
      later(0.4, () => callOut("꼭꼭 숨어라, 머리카락 보일라!"));
    } else if (state.phase === "choosing" && isActing(state, me)) {
      s.play("turn");
    } else if (state.phase === "resolved" && state.step === "hide") {
      s.play("ready");
      callOut("찾는다!", 1.1, 1.0);
    } else if (state.phase === "resolved" || state.phase === "ended") {
      for (const [t, name, arg] of revealCues(state.events)) later(t, () => s.play(name, arg));
      if (state.events.some((e) => e.t === "survive")) later(T.reveal, () => callOut("못 찾겠다 꾀꼬리!", 1.0, 1.25));
      if (state.phase === "ended") later(T.end + 0.4, () => s.play("victory"));
    }
    // 판정 화면을 일찍 넘겨도 예약된 소리는 마저 난다 (다음 단계와 겹치지 않을 만큼 짧다)
  }, [state, me]);

  // 시간 초과 직전 자동 확정: 고른 게 있으면 그걸로
  const { deadlineMs, nowMs } = props;
  const autoRef = useRef<string | null>(null);
  useEffect(() => {
    const tag = `${state.round}:${state.turn}`;
    if (!choosing || !deadlineMs || autoRef.current === tag) return;
    if (deadlineMs - nowMs < 600 && ready) {
      autoRef.current = tag;
      submit();
    }
  });

  // --- 3D 장면 데이터 ------------------------------------------------------
  const [focus, setFocus] = useState<CameraFocus>({ kind: "all" });

  // --- 직접 걷기 (3D) -----------------------------------------------------
  const [walkOn, setWalkOn] = useState(true);
  const walkMode = gl && walkOn && choosing;
  const walkSpec = useMemo(() => (walkMode ? walkSpecFor(state, me) : null), [walkMode, state, me]);
  const walkInput = useRef<WalkInput>({ x: 0, z: 0, hop: false });
  const drive = useRef<Drive>({ active: false, x: 0, y: 0, z: 0, yaw: 0, moving: false });
  const [near, setNear] = useState<WalkNear | null>(null);
  const nearTarget = walkSpec && near?.target ? (walkSpec.targets.find((t) => t.key === near.target) ?? null) : null;
  const nearStop = walkSpec && near && !nearTarget ? (walkSpec.stops[near.room] ?? null) : null;
  // 걸어서 고른 자리 — 커밋 뒤 판정까지 내 캐릭터가 그 자리에 머문다
  const [walked, setWalked] = useState<{ tag: string; t: WalkTarget } | null>(null);
  const turnTag = `${state.seed}:${state.round}:${state.turn}`;
  function chooseWalk(t: WalkTarget) {
    if (!choosing || !legal.some((m) => sameMove(m, t.move))) return;
    setWalked({ tag: turnTag, t });
    setFocus({ kind: "room", room: t.zone });
    getHideAndSeekSound().play("commit");
    onCommit(t.move);
  }
  const primary = useRef<() => void>(() => {});
  const secondary = useRef<() => void>(() => {});
  useEffect(() => {
    primary.current = () => {
      if (nearTarget) chooseWalk(nearTarget);
      else if (near?.ladder) walkInput.current.hop = true;
    };
    secondary.current = () => {
      if (walkSpec?.stops[near?.room ?? "yard"]) chooseWalk(walkSpec.stops[near!.room]!);
    };
  });
  // 키보드: WASD/방향키 이동 · E/스페이스/엔터 고르기 · Q 여기서 멈추기
  useEffect(() => {
    if (!walkMode) return;
    const inp = walkInput.current;
    const down = new Set<string>();
    const sync = () => {
      const k = (a: string, b: string) => (down.has(a) || down.has(b) ? 1 : 0);
      inp.x = k("d", "arrowright") - k("a", "arrowleft");
      inp.z = k("s", "arrowdown") - k("w", "arrowup");
    };
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
    const onDown = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const key = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        e.preventDefault();
        down.add(key);
        sync();
      } else if ((key === "e" || key === " " || key === "enter") && !e.repeat) {
        e.preventDefault();
        primary.current();
      } else if (key === "q" && !e.repeat) {
        secondary.current();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      down.delete(e.key.toLowerCase());
      sync();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      inp.x = 0;
      inp.z = 0;
    };
  }, [walkMode]);

  const figuresRaw = useMemo(() => figuresFor(state, me, fresh, prevMine, props.committedMove, names), [state, me, fresh, prevMine, props.committedMove, names]);
  const figures = useMemo(() => {
    if (!walked || walked.tag !== turnTag || showing) return figuresRaw;
    return figuresRaw.map((f) => (f.seat === me ? { ...f, path: [walked.t.snap], pathKey: `walk:${walked.t.key}`, pose: walked.t.pose, faceTo: walked.t.pose === "search" ? walked.t.at : null } : f));
  }, [figuresRaw, walked, turnTag, showing, me]);
  const clues = useMemo(() => cluesFor(state, fresh), [state, fresh]);
  const myRoom: RoomId | null = mine.status === "hiding" ? (mine.spot ? mine.room : props.committedMove?.spot ? spot(props.committedMove.spot)!.room : null) : mine.room;
  const seekerRoom = state.seats[state.seeker].room;

  const secsLeft = deadlineMs ? Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000)) : null;
  const history = useMemo(() => [...state.history].reverse(), [state.history]);
  const rankings = useMemo(() => (state.phase === "ended" ? computeRankings(state) : []), [state]);
  const seekerName = nm(state.seeker);
  const roleLine =
    mine.status === "seeker"
      ? state.step === "hide"
        ? "👁️ 이번 라운드 술래예요! 기둥에서 열까지 세는 중… 모두 숨으면 시작해요."
        : `👁️ 술래 — 🔦 손전등 ${state.flashes}/${FLASH_CHARGES}`
      : mine.status === "caught"
        ? "🔦 꼬마 술래 — 술래와 함께 남은 사람을 찾아요 (직접 잡으면 +1)"
        : mine.status === "home"
          ? `🙌 찜 성공! +${SCORE_HOME} — 나머지를 지켜보세요`
          : mine.status === "safe"
            ? `🐦 끝까지 숨었다! +${SCORE_SURVIVE}`
            : state.step === "hide"
              ? `🫣 ${seekerName}이(가) 열을 세는 동안 숨을 곳을 고르세요`
              : `🫣 ${mine.spot ? `${room(mine.room).name} · ${spot(mine.spot)!.name}` : ""}에 숨어 있어요${mine.still >= ITCH_AT - 1 ? " — 🦵 다리가 저려 와요!" : ""}`;

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 light:border-slate-200 light:bg-white">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono font-semibold text-amber-300 light:text-amber-600">
            라운드 {state.round} / {state.rounds}
          </span>
          <span className="text-white/70 light:text-slate-600">
            👁️ 술래 <b className="text-white light:text-slate-900">{seekerName}</b>
          </span>
          {state.step === "seek" && (
            <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs font-semibold text-indigo-100 light:bg-indigo-100 light:text-indigo-700">
              턴 {state.turn} / {state.seekTurns} · 남은 사람 {hidersLeft(state)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <SuiteSoundHud suite={getHideAndSeekSound} icon="🫣" label="Midnight Tiptoe" preview="creak" />
          <span className={`rounded-full px-2.5 py-1 ${state.phase === "choosing" || state.phase === "revealing" ? "bg-white font-semibold text-slate-900 light:bg-slate-900 light:text-white" : "border border-white/15 text-white/50 light:border-slate-300 light:text-slate-400"}`}>
            {state.step === "hide" ? "① 숨기" : "① 몰래 고르기"}
          </span>
          <span className={`rounded-full px-2.5 py-1 ${showing ? "bg-white font-semibold text-slate-900 light:bg-slate-900 light:text-white" : "border border-white/15 text-white/50 light:border-slate-300 light:text-slate-400"}`}>② 동시 공개</span>
          {secsLeft !== null && state.phase === "choosing" && <span className={`ml-1 w-10 text-right font-mono font-bold ${secsLeft <= 3 ? "text-rose-400" : "text-white/80 light:text-slate-700"}`}>{secsLeft}s</span>}
        </div>
      </div>

      <HowToPlay startOpen={state.round === 1 && state.turn === 0} />

      {/* 저택 */}
      <div className="relative h-[clamp(320px,62vw,540px)] overflow-hidden rounded-2xl border border-white/10 bg-[#0b1026]">
        {gl ? (
          <HouseScene3D
            viewerSeat={me}
            names={names}
            figures={figures}
            clues={clues}
            fxStart={fxStart.at}
            pickSpots={walkMode ? [] : pickSpots}
            pickRooms={walkMode ? [] : pickRooms}
            picked={choosing ? target : null}
            onPickSpot={(id) => setTarget({ spot: id })}
            onPickRoom={(id) => setTarget({ room: id })}
            focus={focus}
            lowDetail={lowDetail}
            walk={{ spec: walkSpec, input: walkInput, drive, onNear: setNear }}
            nearTarget={nearTarget?.at ?? null}
          />
        ) : (
          <FloorPlan state={state} viewer={me} pickSpots={pickSpots} pickRooms={pickRooms} target={target} onSpot={(id) => setTarget({ spot: id })} onRoom={(id) => setTarget({ room: id })} />
        )}
        {walkMode && walkSpec && (
          <>
            <div className="pointer-events-none absolute left-2 top-2 max-w-[60%] rounded-xl bg-black/55 px-2.5 py-1.5 text-[11px] leading-snug text-white/85 backdrop-blur">
              <b className="text-cyan-200">🕹️ 직접 걸어서 고르기</b>
              <br />
              <span className="hidden sm:inline">WASD·방향키 이동 · E/스페이스 고르기{Object.keys(walkSpec.stops).length > 0 ? " · Q 여기서 멈추기" : ""}</span>
              <span className="sm:hidden">왼쪽 조이스틱으로 걸어요</span>
              <br />
              {state.step === "hide" ? "금빛 고리 가구 앞에 가서 숨으세요" : mine.status === "hiding" ? "이번 턴엔 이 방과 옆방까지 갈 수 있어요" : "금빛 고리 = 뒤질 수 있는 곳"}
            </div>
            <Joystick inputRef={walkInput} />
            <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1.5">
              {nearStop && (
                <button type="button" onClick={() => secondary.current()} className="min-h-10 rounded-full border border-white/25 bg-black/55 px-3.5 text-xs font-semibold text-white backdrop-blur">
                  {nearStop.label}
                </button>
              )}
              {nearTarget ? (
                <button type="button" onClick={() => primary.current()} className="min-h-12 max-w-[11rem] animate-pulse rounded-2xl bg-cyan-400 px-4 text-sm font-black text-slate-900 shadow-lg shadow-cyan-500/30">
                  {nearTarget.label}
                </button>
              ) : near?.ladder ? (
                <button type="button" onClick={() => primary.current()} className="min-h-12 rounded-2xl bg-amber-300 px-4 text-sm font-black text-slate-900">
                  🪜 사다리 {near.room === "attic" ? "내려가기" : "오르기"}
                </button>
              ) : null}
            </div>
          </>
        )}
        {gl && !walkMode && (
          <div className="absolute right-2 top-2 flex flex-col gap-1.5">
            {(
              [
                ["🏠", "전체", { kind: "all" }],
                ...(myRoom && myRoom !== BASE ? ([["🙋", "내 위치", { kind: "room", room: myRoom }]] as const) : []),
                ...(state.step === "seek" && seekerRoom !== BASE && mine.status !== "seeker" ? ([["👁️", "술래", { kind: "room", room: seekerRoom }]] as const) : []),
              ] as [string, string, CameraFocus][]
            ).map(([icon, label, f]) => {
              const on = f.kind === focus.kind && (f.kind === "all" || (focus.kind === "room" && f.kind === "room" && focus.room === f.room));
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setFocus(f)}
                  className={`min-h-9 rounded-full border px-3 text-xs font-semibold backdrop-blur ${on ? "border-cyan-300 bg-cyan-400/25 text-cyan-50" : "border-white/20 bg-black/40 text-white/80 hover:border-white/40"}`}
                >
                  {icon} {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 내 상태 */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/85 light:border-slate-200 light:bg-white light:text-slate-700">
        <span className="break-keep">{roleLine}</span>
        {mine.status === "hiding" && state.step === "seek" && <span className="ml-2 rounded border border-dashed border-white/20 px-1.5 text-[11px] text-white/50 light:border-slate-300 light:text-slate-400">🔒 나만 보임</span>}
      </div>

      {/* 행동 고르기 */}
      {state.phase === "choosing" && acting && (
        <div className="flex flex-col gap-2">
          {choosing && walkMode ? (
            <div className="flex flex-col gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-50 light:text-cyan-900">
              <span className="break-keep">
                {nearTarget ? `${nearTarget.label} — E/스페이스 또는 오른쪽 아래 버튼` : state.step === "hide" ? "🙈 술래가 세는 동안 저택을 돌아다니며 숨을 곳을 찾으세요." : mine.status === "hiding" ? "🤫 지금 자리에서 고르면 숨죽이기, 다른 가구 앞으로 가면 살금살금, 기둥까지 가면 찜!" : "🔍 가구 앞에서 뒤지기, 방 안에서 Q(멈추기)로 이동만 할 수도 있어요."}
              </span>
              {optionsFor("flash").length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  🔦 손전등 {state.flashes}/{FLASH_CHARGES}:
                  {optionsFor("flash").map((m) => (
                    <button
                      key={m.room}
                      type="button"
                      onClick={() => {
                        getHideAndSeekSound().play("commit");
                        onCommit(m);
                      }}
                      className="min-h-9 rounded-full border border-amber-300/60 px-3 font-semibold text-amber-100 light:text-amber-700"
                    >
                      {room(m.room!).icon} {room(m.room!).name} 비추기
                    </button>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => setWalkOn(false)} className="self-start text-xs text-white/50 underline light:text-slate-500">
                📋 목록에서 고르기
              </button>
            </div>
          ) : choosing ? (
            <>
              {gl && (
                <button type="button" onClick={() => setWalkOn(true)} className="self-start rounded-full border border-cyan-300/50 px-3 py-1 text-xs font-semibold text-cyan-100 light:text-cyan-700">
                  🕹️ 직접 걸어서 고르기
                </button>
              )}
              {state.step === "seek" && (
                <div className="grid grid-cols-3 gap-2">
                  {kindsAvail.map((k) => {
                    const n = optionsFor(k).length;
                    const reason = n > 0 ? null : k === "home" ? "마당과 붙은 방에서만" : k === "flash" ? "손전등을 다 썼어요" : "할 수 없어요";
                    return (
                      <button
                        key={k}
                        type="button"
                        disabled={!!reason}
                        onClick={() => pickKind(k)}
                        className={`flex min-h-16 flex-col gap-0.5 rounded-xl border px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          kind === k ? "border-amber-400 bg-amber-400/15 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.8)]" : "border-white/15 bg-white/[0.03] hover:border-white/35 light:border-slate-300 light:bg-white"
                        }`}
                      >
                        <span className="text-sm font-bold text-white light:text-slate-900">
                          {MOVE_LABEL[k].icon} {MOVE_LABEL[k].label}
                        </span>
                        <span className="break-keep text-[11px] leading-snug text-white/55 light:text-slate-500">{reason ?? CARD_HELP[k]}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {state.step === "hide" && <p className="break-keep text-xs text-white/60 light:text-slate-500">{CARD_HELP.hide} 3D 저택에서 금빛 고리를 누르거나 아래 목록에서 고르세요.</p>}
              {effKind && (needsSpot(effKind) || needsRoom(effKind)) && (
                <TargetList kind={effKind} options={optionsFor(effKind)} target={target} onPick={setTarget} from={mine.room} />
              )}
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 light:border-slate-200 light:bg-white">
                <span className="flex-1 break-keep text-sm text-white/80 light:text-slate-700">{!effKind ? "행동을 하나 고르세요." : move ? describeMove(move) : `${MOVE_LABEL[effKind].icon} ${MOVE_LABEL[effKind].label} — ${needsSpot(effKind) ? "숨을 곳" : "방"}을 고르세요`}</span>
                <button type="button" disabled={!ready} onClick={submit} className="min-h-10 rounded-xl bg-amber-400 px-5 py-2 text-sm font-bold text-slate-900 disabled:opacity-40">
                  결정!
                </button>
              </div>
            </>
          ) : (
            <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100 light:text-emerald-700">✅ {props.committedMove ? describeMove(props.committedMove) : "결정"} — 다른 사람을 기다리는 중…</p>
          )}
        </div>
      )}
      {state.phase === "choosing" && !acting && <p className="text-center text-sm text-white/60 light:text-slate-500">{state.step === "hide" ? "🙈 다들 숨는 중… 하나, 둘, 셋…" : "지켜보는 중…"}</p>}
      {state.phase === "revealing" && <p className="text-center text-sm text-white/60 light:text-slate-500">모두 결정! 공개하는 중…</p>}

      {/* 이번 턴 결과 */}
      {showing && state.phase === "resolved" && (
        <div className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm light:border-slate-200 light:bg-white">
          {revealed ? (
            <>
              {state.step === "hide" ? (
                <p className="text-white/80 light:text-slate-700">🙈 모두 숨었다! “찾는다~!”</p>
              ) : (
                describeEvents(state.events, names, me).map((l, i) => (
                  <p key={i} className={`break-keep ${l.mine ? "text-amber-200 light:text-amber-700" : "text-white/80 light:text-slate-700"}`}>
                    {l.text}
                  </p>
                ))
              )}
              {state.step === "seek" && state.events.length === 0 && <p className="text-white/50">조용한 턴…</p>}
            </>
          ) : (
            <p className="text-white/50 light:text-slate-400">👀 공개 중…</p>
          )}
          {state.roundOver && revealed && <RoundReveal state={state} nm={nm} />}
          <button type="button" disabled={state.ready[me]} onClick={props.onReady} className="mt-1 min-h-9 self-end rounded-full border border-white/20 px-4 py-1.5 text-xs text-white/80 disabled:opacity-40 light:border-slate-300 light:text-slate-600">
            {state.ready[me] ? "기다리는 중…" : state.roundOver ? "다음 라운드 ▶" : "다음 턴 ▶"}
          </button>
        </div>
      )}

      {/* 이번 라운드 단서 기록 */}
      {state.step === "seek" && history.length > 0 && (
        <details className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm light:border-slate-200 light:bg-white" open>
          <summary className="cursor-pointer font-semibold text-white/80 light:text-slate-700">🗒️ 이번 라운드 단서</summary>
          <div className="mt-1.5 flex max-h-52 flex-col gap-1.5 overflow-y-auto">
            {history.map((t) => (
              <div key={t.turn} className="flex gap-2">
                <span className="w-9 shrink-0 font-mono text-xs text-white/40 light:text-slate-400">T{t.turn}</span>
                <div className="flex flex-col">
                  {describeEvents(
                    t.events.filter((e) => e.t !== "move"),
                    names,
                    me,
                  ).map((l, i) => (
                    <span key={i} className={`break-keep text-[12.5px] ${l.mine ? "text-amber-200 light:text-amber-700" : "text-white/70 light:text-slate-600"}`}>
                      {l.text}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 점수표 */}
      <div className="overflow-x-auto rounded-2xl border border-white/10 light:border-slate-200">
        <table className="w-full min-w-[340px] text-sm">
          <thead className="text-xs text-white/50 light:text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-normal">이름</th>
              <th className="px-2 py-2 text-left font-normal">이번 라운드</th>
              <th className="px-2 py-2 text-right font-normal">점수</th>
            </tr>
          </thead>
          <tbody>
            {state.seats.map((s, seat) => (
              <tr key={seat} className="border-t border-white/5 text-white/80 light:border-slate-100 light:text-slate-700">
                <td className="px-3 py-1.5">
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: SEAT_COLORS[seat % SEAT_COLORS.length] }} />
                  {nm(seat)}
                </td>
                <td className="px-2 py-1.5">
                  {statusText(s, seat === state.seeker)}
                  {s.roundScore > 0 && <span className="ml-1 text-xs text-emerald-300 light:text-emerald-600">+{s.roundScore}</span>}
                </td>
                <td className="px-2 py-1.5 text-right font-mono font-bold text-amber-300 light:text-amber-600">{s.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 최종 결과 */}
      {state.phase === "ended" && revealed && (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 light:bg-amber-50">
          <RoundReveal state={state} nm={nm} />
          <h3 className="text-base font-bold text-white light:text-slate-900">🏆 최종 순위</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {rankings.map((r) => {
              const s = state.seats[r.seat];
              return (
                <li key={r.seat} className={r.rank === 1 ? "font-bold text-amber-200 light:text-amber-700" : "text-white/80 light:text-slate-700"}>
                  {r.rank}위 {nm(r.seat)} — {s.score}점 · 🙌 찜 {s.tally.homes} · 🐦 생존 {s.tally.survives} · 👁️ 잡음 {s.tally.catches}
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={props.onGameEnd} className="self-end rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-slate-900">
            결과 확인
          </button>
        </div>
      )}
    </div>
  );
}

/** 휴대폰용 가상 조이스틱 — 누른 곳 기준으로 끌면 그 방향으로 걷는다 */
function Joystick({ inputRef }: { inputRef: React.RefObject<WalkInput> }) {
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const R = 44;
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
    inputRef.current.x = x / R;
    inputRef.current.z = y / R;
  };
  const release = () => {
    setKnob(null);
    inputRef.current.x = 0;
    inputRef.current.z = 0;
  };
  return (
    <div
      className="absolute bottom-3 left-3 grid h-28 w-28 touch-none select-none place-items-center rounded-full border border-white/25 bg-black/35 backdrop-blur"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e);
      }}
      onPointerMove={(e) => knob && set(e)}
      onPointerUp={release}
      onPointerCancel={release}
      aria-label="이동 조이스틱"
    >
      <div className="h-11 w-11 rounded-full bg-white/70 shadow" style={{ transform: `translate(${knob?.x ?? 0}px, ${knob?.y ?? 0}px)` }} />
    </div>
  );
}

function statusText(s: SeatState, seeker: boolean): string {
  if (seeker) return "👁️ 술래";
  switch (s.status) {
    case "caught":
      return "😱 잡힘 · 꼬마 술래";
    case "home":
      return "🙌 찜!";
    case "safe":
      return "🐦 끝까지 숨음";
    default:
      return "🫣 숨는 중";
  }
}

function describeMove(m: Move): string {
  const base = `${MOVE_LABEL[m.kind].icon} ${MOVE_LABEL[m.kind].label}`;
  if (m.spot) {
    const sp = spot(m.spot)!;
    return `${base} → ${room(sp.room).name} ${sp.name}`;
  }
  if (m.room) return `${base} → ${room(m.room).icon} ${room(m.room).name}`;
  return base;
}

/** 라운드가 끝나면 모두가 어디 숨어 있었는지 공개 */
function RoundReveal({ state, nm }: { state: GameState; nm: (s: Seat) => string }) {
  return (
    <div className="mt-1 flex flex-col gap-0.5 rounded-xl border border-amber-300/30 bg-amber-300/10 p-2 text-[13px] text-amber-50 light:text-amber-900">
      <b>🎭 라운드 {state.round} 결과</b>
      {state.seats.map((s, seat) =>
        seat === state.seeker ? (
          <span key={seat}>
            👁️ {nm(seat)} 술래 — +{s.roundScore}
          </span>
        ) : (
          <span key={seat} className="break-keep">
            {s.status === "home" ? "🙌" : s.status === "safe" ? "🐦" : "😱"} {nm(seat)} — {s.status === "home" ? "찜 성공" : s.status === "safe" ? `끝까지 숨음 (${s.spot ? `${room(s.room).name} ${spot(s.spot)!.name}` : room(s.room).name})` : `T${s.caughtTurn}에 잡힘 (${room(s.room).name})`} · +{s.roundScore}
          </span>
        ),
      )}
    </div>
  );
}

function TargetList({ kind, options, target, onPick, from }: { kind: MoveKind; options: Move[]; target: { spot?: string; room?: RoomId } | null; onPick: (t: { spot?: string; room?: RoomId }) => void; from: RoomId }) {
  if (needsRoom(kind)) {
    const rooms = options.map((m) => m.room!).sort((a, b) => DIST[from][a] - DIST[from][b]);
    return (
      <div className="flex flex-wrap gap-1.5">
        {rooms.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onPick({ room: r })}
            className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${target?.room === r ? "border-cyan-300 bg-cyan-400 text-slate-900" : "border-white/20 text-white/80 hover:border-white/40 light:border-slate-300 light:text-slate-700"}`}
          >
            {room(r).icon} {room(r).name}
            {r === from ? " (제자리)" : DIST[from][r] === 2 ? " ·2칸" : ""}
          </button>
        ))}
      </div>
    );
  }
  const allowed = new Set(options.map((m) => m.spot!));
  const byRoom = ROOMS.filter((r) => SPOTS.some((s) => s.room === r.id && allowed.has(s.id)));
  return (
    <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-xl border border-white/10 p-2 light:border-slate-200">
      {byRoom.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 shrink-0 text-xs text-white/50 light:text-slate-500">
            {r.icon} {r.name}
            {r.id === from && kind !== "hide" ? " (여기)" : ""}
          </span>
          {SPOTS.filter((s) => s.room === r.id && allowed.has(s.id)).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick({ spot: s.id })}
              className={`min-h-9 rounded-full border px-2.5 text-xs font-semibold ${target?.spot === s.id ? "border-cyan-300 bg-cyan-400 text-slate-900" : "border-white/20 text-white/80 hover:border-white/40 light:border-slate-300 light:text-slate-700"}`}
            >
              {s.icon} {s.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** WebGL이 없을 때: 층별 평면도 (공개 정보만) */
function FloorPlan({ state, viewer, pickSpots, pickRooms, target, onSpot, onRoom }: { state: GameState; viewer: Seat; pickSpots: string[]; pickRooms: RoomId[]; target: { spot?: string; room?: RoomId } | null; onSpot: (id: string) => void; onRoom: (id: RoomId) => void }) {
  const ps = new Set(pickSpots);
  const pr = new Set(pickRooms);
  const here = (r: RoomId) =>
    state.seats
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => s.room === r && (s.status === "seeker" || s.status === "caught" || s.status === "home" || i === viewer || state.roundOver))
      .map(({ i }) => i);
  const floors: { label: string; rooms: RoomId[] }[] = [
    { label: "다락", rooms: ["attic"] },
    { label: "2층", rooms: ["kids", "study", "landing", "master"] },
    { label: "1층", rooms: ["bath", "kitchen", "hall", "living", "garage"] },
    { label: "마당", rooms: ["yard"] },
  ];
  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto p-2">
      {floors.map((f) => (
        <div key={f.label} className="flex gap-1.5">
          <span className="w-8 shrink-0 pt-1 text-[11px] text-white/40">{f.label}</span>
          <div className="grid flex-1 grid-cols-2 gap-1.5 sm:grid-cols-5">
            {f.rooms.map((r) => (
              <div
                key={r}
                role={pr.has(r) ? "button" : undefined}
                onClick={() => pr.has(r) && onRoom(r)}
                className={`rounded-lg border p-1.5 text-left text-[11px] text-white/80 ${target?.room === r ? "border-cyan-300" : pr.has(r) ? "border-amber-400/70" : "border-white/10"}`}
              >
                <div className="font-semibold">
                  {room(r).icon} {room(r).name} {here(r).map((i) => (i === state.seeker ? "👁️" : "🧒")).join("")}
                </div>
                <div className="flex flex-wrap gap-1">
                  {SPOTS.filter((s) => s.room === r).map((s) => (
                    <span
                      key={s.id}
                      role={ps.has(s.id) ? "button" : undefined}
                      onClick={(e) => {
                        if (!ps.has(s.id)) return;
                        e.stopPropagation();
                        onSpot(s.id);
                      }}
                      className={`rounded px-1 ${target?.spot === s.id ? "bg-cyan-400 text-slate-900" : ps.has(s.id) ? "bg-amber-400/20 text-amber-100" : "text-white/40"}`}
                    >
                      {s.icon}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
