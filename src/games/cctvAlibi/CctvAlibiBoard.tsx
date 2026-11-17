"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { Frame3D, Loading3D, ViewToggle, preferLowDetail, useBoardView } from "@/games/shared/three/viewPref";
import { MAX_WINDOW, ROOMS, ROOM_COUNT, SEAT_COLORS, SEAT_GLYPHS, TICKS, VAULT, canStep, hasStairs, roomLabel, timeLabel } from "./data";
import {
  SCORE_ESCAPE,
  SCORE_GUEST_CATCH,
  SCORE_VOTE_BONUS,
  caseLog,
  claimKind,
  contradictionsOf,
  footageCount,
  rankOf,
  revealed,
  turnsLeft,
  type Contradiction,
  type EngineAction,
  type GameState,
  type LogEntry,
} from "./engine";
import { culpritAutoPlan, footageOf, forgeOptions, fullRoute, guestAutoRoute, validCulpritRoute, validGuestRoute, vaultTicks, type Forge } from "./planner";
import RulebookModal from "./RulebookModal";
import { claimText, logLine, phaseLabel, seatName, seatTag } from "./show";
import { cctvCues, getCctvSound } from "./cctvSound";
import type { SceneActor } from "./three/CctvScene3D";

const CctvScene3D = dynamic(() => import("./three/CctvScene3D"), { ssr: false, loading: () => <Loading3D label="감시 카메라를 연결하는 중…" /> });

export interface CctvAlibiBoardProps {
  state: GameState;
  viewerSeat: number;
  names: Record<number, string>;
  deadlineMs: number | null;
  nowMs: number;
  onAction: (a: EngineAction) => void;
  onGameEnd: () => void;
}

type Check = Extract<LogEntry, { kind: "check" }>;
type Claim = Extract<LogEntry, { kind: "testify" }>;
type Tab = "footage" | "rooms" | "memory" | "log";

type Fx = { id: string; kind: "check"; e: Check } | { id: string; kind: "testify"; e: Claim } | { id: string; kind: "tape" } | { id: string; kind: "verdict"; caught: boolean; culprit: number };
const FX_MS: Record<Fx["kind"], number> = { check: 2600, testify: 3400, tape: 2200, verdict: 3200 };

const BTN = "rounded-xl px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-35";
const MEMO = ["", "😇", "🤔", "😈"];

function Glyph({ seat, small }: { seat: number; small?: boolean }) {
  return (
    <b className={small ? "text-[10px] leading-none" : ""} style={{ color: SEAT_COLORS[seat % SEAT_COLORS.length] }}>
      {SEAT_GLYPHS[seat % SEAT_GLYPHS.length]}
    </b>
  );
}

export default function CctvAlibiBoard(props: CctvAlibiBoardProps) {
  const { state: view, viewerSeat: me, names, deadlineMs, nowMs, onAction, onGameEnd } = props;
  const board = useBoardView("cctv-alibi-view");
  const [lowDetail] = useState(preferLowDetail);
  const [rules, setRules] = useState(false);
  const [tips, setTips] = useState(false);
  const [tab, setTab] = useState<Tab>("footage");
  const [scrub, setScrub] = useState<{ t: number; from: number | null }>({ t: 0, from: null });
  const [playing, setPlaying] = useState(false);
  const [route, setRoute] = useState<number[]>([]);
  const [forge, setForge] = useState<Forge | null>(null);
  const [forgeLen, setForgeLen] = useState(1);
  const [pickCell, setPickCell] = useState<{ t: number; room: number } | null>(null);
  const [lie, setLie] = useState<{ open: boolean; target: number | null; t: number }>({ open: false, target: null, t: 1 });
  const [memo, setMemo] = useState<Record<number, number>>({});

  const n = view.seatCount;
  const seats = useMemo(() => Array.from({ length: n }, (_, s) => s), [n]);
  const ended = view.phase === "ended";
  const open = revealed(view);
  const night = view.phase === "night";
  const iAmCulprit = !open ? view.culprit === me : view.culprit === me;
  const myTurn = view.phase === "investigate" && view.turn === me;
  const start = view.starts[me] ?? 0;
  const myErrands = view.errands[me] ?? [];
  const planned = view.planned[me];
  const log = useMemo(() => caseLog(view), [view]);
  const checks = useMemo(() => log.filter((e) => e.kind === "check") as Check[], [log]);
  const checkAt = (t: number, room: number) => checks.find((c) => c.t === t && c.room === room);
  const myContra: Contradiction[] = useMemo(() => (night || iAmCulprit ? [] : contradictionsOf(view, me)), [view, me, night, iAmCulprit]);

  // ── 소리
  useSuiteBgm(getCctvSound, !ended, view.phase === "vote" ? 1 : 0);
  const classify = useMemo(() => cctvCues(me), [me]);
  useSoundCues(view, getCctvSound, classify);
  const secLeft = deadlineMs ? Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000)) : null;
  const mustAct = (night && !planned) || myTurn || (view.phase === "vote" && !view.voteIn[me]);
  const urgent = mustAct && secLeft !== null && secLeft <= 5 && secLeft > 0;
  useEffect(() => {
    if (urgent) getCctvSound().play("tick");
  }, [urgent, secLeft]);

  // ── 사건·단계가 바뀔 때 화면 상태 정리 + 연출 큐 (렌더 중 상태 조정 패턴)
  const [seen, setSeen] = useState({ caseNo: view.caseNo, phase: view.phase, stage: view.stage, log: view.log.length });
  const [fx, setFx] = useState<Fx[]>([]);
  if (seen.caseNo !== view.caseNo) {
    setSeen({ caseNo: view.caseNo, phase: view.phase, stage: view.stage, log: view.log.length });
    setFx([]);
    setRoute([]);
    setForge(null);
    setScrub({ t: 0, from: null });
    setPlaying(false);
    setPickCell(null);
    setMemo({});
    setTab("footage");
    setLie({ open: false, target: null, t: 1 });
  } else if (seen.phase !== view.phase || seen.stage !== view.stage || seen.log !== view.log.length) {
    const fresh: Fx[] = [];
    view.log.slice(seen.log).forEach((e, k) => {
      const id = `${seen.log + k}`;
      if (e.kind === "check") fresh.push({ id, kind: "check", e });
      else if (e.kind === "testify") fresh.push({ id, kind: "testify", e });
      else if (e.kind === "night") fresh.push({ id, kind: "tape" });
      else if (e.kind === "verdict") fresh.push({ id, kind: "verdict", caught: e.caught, culprit: e.culprit });
    });
    if (seen.phase !== view.phase) {
      if (view.phase === "watch") {
        setScrub({ t: 0, from: null });
        setPlaying(true);
        setTab("footage");
      }
      if (view.phase === "investigate") setPlaying(false);
    }
    if (seen.stage !== view.stage) {
      setPickCell(null);
      setLie((l) => ({ ...l, open: false }));
      if (view.phase === "investigate" && view.turn === me) setTab(myContra.length > 0 && !view.testified[me] ? "memory" : "rooms");
    }
    setSeen({ caseNo: view.caseNo, phase: view.phase, stage: view.stage, log: view.log.length });
    if (fresh.length) setFx((q) => [...q, ...fresh].slice(-5));
  }
  const curFx = fx[0] ?? null;
  useEffect(() => {
    if (!curFx) return;
    const t = window.setTimeout(() => setFx((q) => q.slice(1)), FX_MS[curFx.kind]);
    return () => window.clearTimeout(t);
  }, [curFx]);

  // ── 영상 재생
  if (playing && scrub.t >= TICKS) setPlaying(false);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setScrub((s) => (s.t >= TICKS ? s : { t: s.t + 1, from: s.t }));
      getCctvSound().play("scrub");
    }, 1100);
    return () => window.clearInterval(id);
  }, [playing]);
  const goto = (t: number) => {
    setPlaying(false);
    setScrub((s) => ({ t, from: t === s.t + 1 ? s.t : null }));
  };

  function act(a: EngineAction, cue = "select") {
    getCctvSound().unlock();
    getCctvSound().play(cue);
    onAction(a);
  }

  // ── 밤: 동선 짜기
  const cursor = route.length > 0 ? route[route.length - 1] : start;
  const full = fullRoute(start, route);
  const routeDone = route.length === TICKS;
  const stepOptions = useMemo(() => {
    if (!night || planned || routeDone) return [];
    return Array.from({ length: ROOM_COUNT + 1 }, (_, r) => r).filter((r) => canStep(cursor, r) && (r !== VAULT || iAmCulprit));
  }, [night, planned, routeDone, cursor, iAmCulprit]);
  const errandDone = (r: number) => r === start || route.includes(r);
  const guestOk = !iAmCulprit && routeDone && validGuestRoute(start, route, myErrands);
  const culpritRouteOk = iAmCulprit && routeDone && validCulpritRoute(start, route);
  const options = useMemo(() => (culpritRouteOk ? forgeOptions(fullRoute(start, route)) : []), [culpritRouteOk, start, route]);
  const lens = [1, 2, 3].filter((l) => l <= MAX_WINDOW && options.some((o) => o.rooms.length === l));
  const shownLen = lens.includes(forgeLen) ? forgeLen : (lens[0] ?? 1);
  const routeProblem = !routeDone
    ? null
    : iAmCulprit
      ? !route.includes(VAULT)
        ? "💎 지하 금고실에 한 번은 들러야 해요"
        : !culpritRouteOk
          ? `금고실에 드나든 시각이 연속 ${MAX_WINDOW}시각 안에 들어와야 영상으로 가릴 수 있어요`
          : null
      : !guestOk
        ? "⭐ 할 일이 있는 방을 모두 들러야 해요"
        : null;

  function stepTo(r: number) {
    if (!stepOptions.includes(r)) return;
    getCctvSound().unlock();
    getCctvSound().play(r === VAULT ? "vault" : "step");
    setForge(null);
    setRoute((prev) => [...prev, r]);
  }
  function undo() {
    getCctvSound().play("undo");
    setForge(null);
    setRoute((prev) => prev.slice(0, -1));
  }
  function autoFill() {
    getCctvSound().unlock();
    getCctvSound().play("step");
    if (iAmCulprit) {
      const p = culpritAutoPlan(start, Math.random, 0.8);
      setRoute(p.route);
      setForge(p.forge);
      setForgeLen(p.forge?.rooms.length ?? 1);
    } else {
      setRoute(guestAutoRoute(start, myErrands, Math.random));
      setForge(null);
    }
  }
  function submitPlan() {
    if (iAmCulprit ? !forge : !guestOk) return;
    act({ type: "PLAN", seat: me, stage: view.stage, plan: { route, forge: iAmCulprit ? forge : null } }, "submit");
  }

  // ── 지도에 세울 사람들
  const t = scrub.t;
  const actors: SceneActor[] = night
    ? seats.map((s) => (s === me ? { seat: s, room: cursor, from: route.length > 0 ? full[route.length - 1] : null } : { seat: s, room: view.starts[s], from: null }))
    : seats.map((s) => ({ seat: s, room: view.footage[s]?.[t] ?? view.starts[s], from: scrub.from !== null ? (view.footage[s]?.[scrub.from] ?? null) : null }));
  const stepKey = night ? `n${route.length}` : `t${t}`;
  const truthSeat = !night && (open ? view.culprit : iAmCulprit ? me : -1);
  const ghost =
    typeof truthSeat === "number" && truthSeat >= 0 && view.truth[truthSeat]?.length && view.truth[truthSeat][t] !== view.footage[truthSeat][t]
      ? { room: view.truth[truthSeat][t], label: truthSeat === me ? "🦹 실제 나" : "🦹 범인의 실제 위치" }
      : null;
  const scanCell = curFx?.kind === "check" ? curFx.e : pickCell && myTurn ? { t: pickCell.t, room: pickCell.room, truth: 0, footage: 0, pending: true } : null;
  const scan = scanCell && scanCell.t === t ? { room: scanCell.room, hit: "pending" in scanCell ? false : scanCell.truth !== scanCell.footage } : null;

  const waitingOn = (flags: boolean[]) => seats.filter((s) => !flags[s]);

  const banner = ended
    ? "🏁 모든 사건이 끝났어요"
    : night
      ? planned
        ? `🌙 제출 완료 — ${waitingOn(view.planned).length}명이 아직 동선을 짜는 중…`
        : iAmCulprit
          ? "🦹 당신이 범인! 금고실에 들르는 동선을 짜고, 그 구간의 영상을 바꿔치기하세요"
          : "🙋 손님 — 할 일 두 곳을 들르는 밤 동선을 짜세요"
      : view.phase === "watch"
        ? view.ready[me]
          ? `📼 판독 완료 — ${waitingOn(view.ready).length}명을 기다리는 중…`
          : "📼 CCTV 영상이 공개됐어요. 수상한 장면을 찾아보세요"
        : view.phase === "investigate"
          ? myTurn
            ? "🎯 내 차례 — 🔎 센서 대조 / 🗣️ 증언 / 💤 넘기기 중 하나"
            : `⏳ ${seatTag(view.turn, me, names)}의 수사 차례`
          : view.phase === "vote"
            ? view.voteIn[me]
              ? `🗳️ 투표 완료 — ${waitingOn(view.voteIn).length}명을 기다리는 중…`
              : "🗳️ 범인이라고 생각하는 사람에게 투표하세요 (비밀 · 동시 공개)"
            : view.ready[me]
              ? "⚖️ 다음 사건을 기다리는 중…"
              : "⚖️ 판결이 나왔어요";

  const mapNode =
    board.view === "3d" ? (
      <Frame3D tall hint={night ? (stepOptions.length ? "빛나는 방을 눌러 한 칸 이동 (제자리 = 머무르기)" : "밤 동선") : `${timeLabel(t)} CCTV`}>
        <CctvScene3D actors={actors} stepKey={stepKey} names={names} viewerSeat={me} pickable={stepOptions} onPickRoom={stepTo} errands={night && !iAmCulprit ? myErrands : []} ghost={ghost} scan={scan} lowDetail={lowDetail} />
        <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.035)_0px,rgba(255,255,255,0.035)_1px,transparent_1px,transparent_3px)]" aria-hidden />
        <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/55 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
          <span className={night ? "text-white/40" : "animate-pulse text-rose-400"}>●</span> {night ? "STANDBY" : "REC"} CAM-01 {timeLabel(night ? route.length : t)}
        </span>
      </Frame3D>
    ) : (
      <MansionMap2D actors={actors} me={me} names={names} pickable={stepOptions} onPick={stepTo} errands={night && !iAmCulprit ? myErrands : []} errandDone={errandDone} ghost={ghost} scan={scan} showVault={iAmCulprit || open} clock={timeLabel(night ? route.length : t)} live={!night} />
    );

  return (
    <div className="relative flex flex-col gap-3">
      <style>{`@keyframes cctvPop{0%{transform:scale(.7);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes cctvStamp{0%{transform:scale(2.4) rotate(-12deg);opacity:0}60%{transform:scale(.9) rotate(-12deg);opacity:1}100%{transform:scale(1) rotate(-12deg);opacity:1}}
@keyframes cctvScan{0%{background-position:0 -100%}100%{background-position:0 200%}}`}</style>

      {/* 상단 바 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-gradient-to-r from-[#0d1420] to-[#141018] px-3 py-2">
        <span className="text-sm font-bold text-sky-100">📹 사건 #{view.caseNo}</span>
        {view.totalCases > 1 && (
          <span className="text-xs text-white/50">
            {view.caseIndex + 1}/{view.totalCases}번째
          </span>
        )}
        <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-xs font-semibold text-sky-200">{phaseLabel(view)}</span>
        {view.phase === "investigate" && <span className="text-[11px] text-white/45">남은 차례 {turnsLeft(view)}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <SuiteSoundHud suite={getCctvSound} icon="📹" label="Night Tape" preview="match" />
          <ViewToggle board={board} />
          <button type="button" onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:border-white/30">
            📖 규칙
          </button>
        </div>
      </div>

      {/* 안내 + 타이머 */}
      <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${mustAct ? (iAmCulprit && !open ? "bg-rose-500/15 text-rose-100" : "bg-sky-400/15 text-sky-100") : "bg-white/5 text-white/70"}`}>
        <span className="flex-1 break-keep">{banner}</span>
        {secLeft !== null && !ended && <span className={`font-mono text-xs ${secLeft <= 10 ? "text-rose-300" : "text-white/50"}`}>⏱ {secLeft}s</span>}
      </div>

      {/* 내 역할 */}
      {!ended && (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-1.5 text-xs ${iAmCulprit && !open ? "border-rose-400/40 bg-rose-500/10 text-rose-100" : "border-white/10 bg-white/5 text-white/75"}`}>
          {open ? (
            <span>
              🦹 범인은 <b>{seatTag(view.culprit, me, names)}</b>
            </span>
          ) : iAmCulprit ? (
            <span className="break-keep">
              🦹 <b>범인</b> — 💎 금고실은 🪜 계단 방(갤러리·온실·중앙 홀·식당·현관)에서 내려가요. 영상 조작은 연속 {MAX_WINDOW}시각까지.
            </span>
          ) : (
            <>
              <span>
                🙋 <b>손님</b> · 출발 {roomLabel(start)}
              </span>
              {myErrands.map((r) => (
                <span key={r} className={night && errandDone(r) ? "text-emerald-300" : ""}>
                  {night ? (errandDone(r) ? "✅" : "⭐") : "⭐"} {ROOMS[r].icon} {ROOMS[r].errand}
                </span>
              ))}
            </>
          )}
          <button type="button" onClick={() => setTips((v) => !v)} className="ml-auto rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/60">
            💡 판독 요령
          </button>
        </div>
      )}
      {tips && (
        <ul className="list-disc space-y-1 rounded-xl border border-sky-300/20 bg-sky-400/5 py-2 pr-3 pl-6 text-[11px] break-keep text-sky-100/80">
          <li>영상이 가짜인 사람은 범인 한 명뿐이고, 가짜 구간은 연속 1~{MAX_WINDOW}시각이에요.</li>
          <li>금고실은 🪜 계단 방에서만 내려갈 수 있어요. 누군가의 영상에서 계단 방 근처의 “틈”을 찾아보세요.</li>
          <li>🔎 센서 대조는 그 시각·그 방에 실제로 몇 명이 있었는지 알려 줘요. 영상 인원과 다르면 그 칸에 가짜가 섞여 있어요.</li>
          <li>🧠 내 기억과 영상이 다르면(같이 있었는데 영상엔 없다 / 영상엔 같이 있는데 못 봤다) 그 사람이 범인이에요 — 증언하세요. 다만 범인도 거짓 증언을 할 수 있어요.</li>
        </ul>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="relative">
            {mapNode}
            {curFx && <FxOverlay fx={curFx} me={me} names={names} />}
          </div>

          {/* 재생 막대 */}
          {!night && (
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-2 py-1.5">
              <button
                type="button"
                onClick={() => {
                  getCctvSound().unlock();
                  if (playing) setPlaying(false);
                  else {
                    if (t >= TICKS) setScrub({ t: 0, from: null });
                    setPlaying(true);
                  }
                }}
                className="h-9 w-9 shrink-0 rounded-full bg-sky-600 text-sm text-white hover:bg-sky-500"
                aria-label={playing ? "멈춤" : "재생"}
              >
                {playing ? "⏸" : "▶"}
              </button>
              <div className="grid flex-1 grid-cols-9 gap-0.5">
                {Array.from({ length: TICKS + 1 }, (_, k) => (
                  <button key={k} type="button" onClick={() => goto(k)} className={`rounded-md py-1.5 font-mono text-[10px] ${k === t ? "bg-sky-400 font-bold text-slate-900" : "bg-white/5 text-white/55 hover:bg-white/10"}`}>
                    {timeLabel(k).slice(0, 2)}
                    <span className="hidden sm:inline">{timeLabel(k).slice(2)}</span>
                    <span className="sm:hidden">{k % 2 ? "½" : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 밤: 동선 짜기 */}
          {night && !planned && (
            <div className={`flex flex-col gap-2 rounded-2xl border p-3 ${iAmCulprit ? "border-rose-400/30 bg-rose-500/5" : "border-sky-400/30 bg-sky-400/5"}`}>
              <RouteStrip full={full} label="내 동선" vaultTone />
              <p className="text-[11px] break-keep text-white/55">
                지도에서 옆방을 눌러 30분에 한 칸씩 (지금 방을 누르면 머무르기). {route.length}/{TICKS}칸
              </p>
              <div className="flex flex-wrap gap-1.5">
                {stepOptions.map((r) => (
                  <button key={r} type="button" onClick={() => stepTo(r)} className={`rounded-full border px-2.5 py-1 text-xs ${r === VAULT ? "border-rose-300/60 bg-rose-500/20 text-rose-100" : r === cursor ? "border-white/25 text-white/70" : "border-amber-300/50 bg-amber-300/10 text-amber-100"}`}>
                    {r === cursor ? "⏸ 머무르기" : `${ROOMS[r].icon} ${ROOMS[r].name}`}
                    {!iAmCulprit && myErrands.includes(r) && !errandDone(r) && " ⭐"}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={`${BTN} border border-white/15 text-white/70`} disabled={route.length === 0} onClick={undo}>
                  ↩ 한 칸 취소
                </button>
                <button
                  type="button"
                  className={`${BTN} border border-white/15 text-white/70`}
                  disabled={route.length === 0}
                  onClick={() => {
                    getCctvSound().play("undo");
                    setRoute([]);
                    setForge(null);
                  }}
                >
                  🗑 처음부터
                </button>
                <button type="button" className={`${BTN} border border-white/15 text-white/70`} onClick={autoFill}>
                  🎲 자동으로 짜기
                </button>
              </div>
              {routeProblem && <p className="rounded-lg bg-rose-500/10 px-2 py-1.5 text-xs break-keep text-rose-200">{routeProblem}</p>}

              {culpritRouteOk && (
                <div className="flex flex-col gap-2 rounded-xl border border-rose-300/25 bg-black/25 p-2">
                  <p className="text-xs font-bold text-rose-100">🎞️ 영상 바꿔치기 — 금고실에 있던 {vaultTicks(full).map(timeLabel).join("·")}을(를) 덮는 가짜 장면을 고르세요</p>
                  <div className="flex gap-1">
                    {lens.map((l) => (
                      <button key={l} type="button" onClick={() => setForgeLen(l)} className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-bold ${shownLen === l ? "bg-rose-400/25 text-rose-100" : "bg-white/5 text-white/55"}`}>
                        {l}시각 조작 ({options.filter((o) => o.rooms.length === l).length})
                      </button>
                    ))}
                  </div>
                  <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {options
                      .filter((o) => o.rooms.length === shownLen)
                      .map((o) => {
                        const on = forge !== null && forge.from === o.from && forge.rooms.join() === o.rooms.join();
                        return (
                          <button
                            key={`${o.from}:${o.rooms.join()}`}
                            type="button"
                            onClick={() => {
                              getCctvSound().play("forge");
                              setForge(o);
                            }}
                            className={`rounded-lg border px-2 py-1 text-[11px] ${on ? "border-rose-300 bg-rose-400/25 text-white" : "border-white/15 text-white/70"}`}
                          >
                            {o.rooms.map((r, i) => `${timeLabel(o.from + i)} ${ROOMS[r].icon}`).join(" · ")}
                          </button>
                        );
                      })}
                  </div>
                  {forge && <RouteStrip full={footageOf(full, forge)} label="영상" fake={forge} />}
                  <p className="text-[10px] break-keep text-white/45">짧을수록 들킬 칸이 적지만, 가짜 장면의 방에 실제로 있던 손님은 “못 봤다”고 증언할 수 있어요.</p>
                </div>
              )}

              <button type="button" className={`${BTN} ${iAmCulprit ? "bg-rose-600 hover:bg-rose-500" : "bg-sky-600 hover:bg-sky-500"} text-white`} disabled={iAmCulprit ? !forge : !guestOk} onClick={submitPlan}>
                {iAmCulprit ? "🦹 이 계획으로 범행" : "✅ 동선 확정"}
              </button>
            </div>
          )}
          {night && planned && view.plans[me] && (
            <div className="flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-3">
              <RouteStrip full={fullRoute(start, view.plans[me]!.route)} label="내 동선" vaultTone />
              {view.plans[me]!.forge && <RouteStrip full={footageOf(fullRoute(start, view.plans[me]!.route), view.plans[me]!.forge)} label="영상" fake={view.plans[me]!.forge!} />}
            </div>
          )}

          {/* 판독 완료 */}
          {view.phase === "watch" && !view.ready[me] && (
            <button type="button" className={`${BTN} bg-sky-600 text-white hover:bg-sky-500`} onClick={() => act({ type: "READY", seat: me, stage: view.stage })}>
              ✅ 판독 완료 — 수사 시작
            </button>
          )}

          {/* 수사 행동 */}
          {myTurn && (
            <div className="flex flex-col gap-2 rounded-2xl border border-sky-400/30 bg-sky-400/5 p-3">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  className={`${BTN} bg-sky-600 text-white hover:bg-sky-500`}
                  disabled={!pickCell}
                  onClick={() => pickCell && act({ type: "CHECK", seat: me, stage: view.stage, t: pickCell.t, room: pickCell.room })}
                >
                  🔎 대조
                </button>
                <button
                  type="button"
                  className={`${BTN} bg-amber-500 text-slate-900 hover:bg-amber-400`}
                  disabled={view.testified[me] || (!iAmCulprit && myContra.length === 0)}
                  onClick={() => {
                    getCctvSound().play("select");
                    if (iAmCulprit) setLie((l) => ({ ...l, open: true, target: l.target ?? seats.find((s) => s !== me) ?? null }));
                    else setTab("memory");
                  }}
                >
                  🗣️ 증언{view.testified[me] ? " ✓" : !iAmCulprit && myContra.length > 0 ? ` (${myContra.length})` : ""}
                </button>
                <button type="button" className={`${BTN} border border-white/15 text-white/70 hover:border-white/30`} onClick={() => act({ type: "PASS", seat: me, stage: view.stage })}>
                  💤 넘기기
                </button>
              </div>
              <p className="text-[11px] break-keep text-white/60">
                {pickCell ? (
                  <>
                    선택: <b className="text-sky-200">{timeLabel(pickCell.t)} {roomLabel(pickCell.room)}</b> — 영상에는 {footageCount(view, pickCell.t, pickCell.room)}명. 실제 인원을 센서로 확인해요.
                  </>
                ) : (
                  "🔎 방별 표에서 대조할 칸(시각 × 방)을 누르세요."
                )}
                {!iAmCulprit && myContra.length === 0 && !view.testified[me] && " · 내 기억과 영상이 어긋난 장면이 없어 증언할 게 없어요."}
              </p>
            </div>
          )}

          {/* 투표 */}
          {view.phase === "vote" && !view.voteIn[me] && (
            <div className="flex flex-col gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-3">
              <p className="text-xs break-keep text-amber-100/80">범인이 혼자 가장 많은 표를 받아야 검거돼요. 동률이면 달아나요.</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {seats
                  .filter((s) => s !== me)
                  .map((s) => (
                    <button key={s} type="button" className={`${BTN} border border-white/15 bg-white/5 text-white hover:border-amber-300`} onClick={() => act({ type: "VOTE", seat: me, stage: view.stage, target: s }, "ballot")}>
                      <Glyph seat={s} /> {names[s] ?? `${s + 1}번`} {MEMO[memo[s] ?? 0]}
                    </button>
                  ))}
                <button type="button" className={`${BTN} border border-white/15 text-white/55`} onClick={() => act({ type: "VOTE", seat: me, stage: view.stage, target: null }, "ballot")}>
                  🏳️ 기권
                </button>
              </div>
            </div>
          )}

          {/* 판결 (사건 사이) */}
          {view.phase === "result" && (
            <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
              <Verdict view={view} me={me} names={names} />
              {!view.ready[me] && (
                <button type="button" className={`${BTN} bg-sky-600 text-white hover:bg-sky-500`} onClick={() => act({ type: "READY", seat: me, stage: view.stage })}>
                  다음 사건 ▶
                </button>
              )}
            </div>
          )}

          {/* 사람들 */}
          <div className="flex flex-wrap gap-1.5">
            {seats.map((s) => {
              const done = night ? view.planned[s] : view.phase === "watch" || view.phase === "result" ? view.ready[s] : view.phase === "vote" ? view.voteIn[s] : false;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={s === me || night}
                  title={s === me ? undefined : "눌러서 메모 (😇 결백 · 🤔 수상 · 😈 범인)"}
                  onClick={() => setMemo((m) => ({ ...m, [s]: ((m[s] ?? 0) + 1) % MEMO.length }))}
                  className={`rounded-full border px-2.5 py-1 text-[11px] text-white/80 ${view.phase === "investigate" && view.turn === s ? "border-sky-300 bg-sky-300/15" : "border-white/10 bg-white/5"} ${open && view.culprit === s ? "ring-2 ring-rose-400" : ""}`}
                >
                  <Glyph seat={s} /> {seatName(s, me, names)} · {view.scores[s]}점{done && " ✓"}
                  {view.testified[s] && !night && " 🗣️"}
                  {s !== me && MEMO[memo[s] ?? 0] && ` ${MEMO[memo[s] ?? 0]}`}
                  {open && view.culprit === s && " 🦹"}
                </button>
              );
            })}
          </div>
        </div>

        {/* 오른쪽: 영상 표 · 방별 · 기억 · 기록 */}
        {night ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs break-keep text-white/65">
            <p className="font-bold text-white/85">🌙 오늘 밤 (21:00 → 01:00)</p>
            <p>모두가 동시에, 몰래 밤 동선을 짜요. 30분마다 옆방으로 한 칸 가거나 머무를 수 있어요.</p>
            <p>밤이 지나면 저택 CCTV에 모두의 동선이 그대로 찍혀 공개돼요 — 단, 범인은 금고실에 다녀온 구간을 가짜 장면으로 바꿔 둬요.</p>
            <p className="text-white/45">출발 위치: {seats.map((s) => `${SEAT_GLYPHS[s]} ${ROOMS[view.starts[s]].icon}`).join("  ")}</p>
            {view.cases.length > 0 && <p className="text-white/45">지난 사건: {view.cases.map((c, i) => `${i + 1}번 ${c.caught ? "🚔 검거" : "💨 도주"}`).join(" · ")}</p>}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex gap-1">
              {(
                [
                  ["footage", "📼 사람별"],
                  ["rooms", "🔎 방별"],
                  ["memory", `🧠 내 기억${myContra.length ? " ❗" : ""}`],
                  ["log", "📜 기록"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setTab(id)} className={`flex-1 rounded-lg px-1 py-1.5 text-[11px] font-bold sm:text-xs ${tab === id ? "bg-sky-400/20 text-sky-100" : "bg-white/5 text-white/55"}`}>
                  {label}
                </button>
              ))}
            </div>
            {tab === "footage" && <FootageTable view={view} me={me} names={names} t={t} onPickTime={goto} checkAt={checkAt} contra={myContra} memo={memo} />}
            {tab === "rooms" && <RoomGrid view={view} t={t} onPickTime={goto} checkAt={checkAt} canPick={myTurn} pick={pickCell} onPick={(c) => {
              getCctvSound().play("select");
              setPickCell(c);
              goto(c.t);
            }} />}
            {tab === "memory" && (
              <MemoryPanel
                view={view}
                me={me}
                names={names}
                culprit={iAmCulprit}
                contra={myContra}
                canTestify={myTurn && !view.testified[me]}
                onTestify={(c) => act({ type: "TESTIFY", seat: me, stage: view.stage, target: c.target, t: c.t })}
                onPickTime={goto}
              />
            )}
            {tab === "log" && <LogList view={view} me={me} names={names} />}
          </div>
        )}
      </div>

      {/* 범인의 거짓 증언 */}
      {lie.open && myTurn && iAmCulprit && !view.testified[me] && (
        <Composer title="🗣️ 거짓 증언 (한 사건에 한 번)" onClose={() => setLie((l) => ({ ...l, open: false }))}>
          <p className="text-xs break-keep text-white/60">범인은 무엇이든 지어낼 수 있어요. 하지만 증언이 나오면 모두가 “범인은 증언한 사람 아니면 지목된 사람”이라고 생각해요.</p>
          <div className="flex flex-wrap gap-1.5">
            {seats
              .filter((s) => s !== me)
              .map((s) => (
                <button key={s} type="button" onClick={() => setLie((l) => ({ ...l, target: s }))} className={`rounded-full border px-3 py-1 text-xs ${lie.target === s ? "border-amber-300 bg-amber-300/20 text-amber-100" : "border-white/15 text-white/70"}`}>
                  <Glyph seat={s} /> {names[s] ?? `${s + 1}번`}
                </button>
              ))}
          </div>
          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: TICKS }, (_, k) => k + 1).map((k) => (
              <button key={k} type="button" onClick={() => setLie((l) => ({ ...l, t: k }))} className={`rounded-md py-1.5 font-mono text-[10px] ${lie.t === k ? "bg-amber-400 font-bold text-slate-900" : "bg-white/5 text-white/60"}`}>
                {timeLabel(k)}
              </button>
            ))}
          </div>
          {lie.target !== null && (
            <p className="rounded-xl bg-[#f3e9d2] px-3 py-2 text-sm font-semibold break-keep text-[#3b2a16]">
              “{claimText({ kind: "testify", caseIndex: view.caseIndex, round: view.round, seat: me, target: lie.target, t: lie.t, room: view.footage[me][lie.t], claim: claimKind(view, me, lie.target, lie.t) }, me, names)}”
            </p>
          )}
          <button type="button" disabled={lie.target === null} className={`${BTN} bg-amber-500 text-slate-900`} onClick={() => lie.target !== null && act({ type: "TESTIFY", seat: me, stage: view.stage, target: lie.target, t: lie.t })}>
            이렇게 증언하기
          </button>
        </Composer>
      )}

      {ended && view.outcome && <ResultPanel view={view} me={me} names={names} onGameEnd={onGameEnd} />}
      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RouteStrip({ full, label, fake, vaultTone }: { full: number[]; label: string; fake?: Forge; vaultTone?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-12 shrink-0 text-[10px] font-bold text-white/55">{label}</span>
      <div className="grid flex-1 grid-cols-9 gap-0.5">
        {Array.from({ length: TICKS + 1 }, (_, k) => {
          const r = full[k];
          const forged = fake && k >= fake.from && k < fake.from + fake.rooms.length;
          return (
            <div
              key={k}
              title={r !== undefined ? `${timeLabel(k)} ${ROOMS[r].name}` : timeLabel(k)}
              style={r !== undefined ? { backgroundColor: ROOMS[r].tint } : undefined}
              className={`flex flex-col items-center rounded-md py-0.5 ${r === undefined ? "border border-dashed border-white/15" : ""} ${forged ? "ring-2 ring-rose-400" : ""} ${vaultTone && r === VAULT ? "ring-2 ring-sky-300" : ""}`}
            >
              <span className="text-sm leading-tight">{r !== undefined ? ROOMS[r].icon : "·"}</span>
              <span className="font-mono text-[8px] text-white/45">{timeLabel(k)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MansionMap2D({
  actors,
  me,
  names,
  pickable,
  onPick,
  errands,
  errandDone,
  ghost,
  scan,
  showVault,
  clock,
  live,
}: {
  actors: SceneActor[];
  me: number;
  names: Record<number, string>;
  pickable: number[];
  onPick: (r: number) => void;
  errands: number[];
  errandDone: (r: number) => boolean;
  ghost: { room: number; label: string } | null;
  scan: { room: number; hit: boolean } | null;
  showVault: boolean;
  clock: string;
  live: boolean;
}) {
  const cell = (r: number) => {
    const room = ROOMS[r];
    const can = pickable.includes(r);
    const here = actors.filter((a) => a.room === r);
    return (
      <button
        key={r}
        type="button"
        disabled={!can}
        onClick={() => onPick(r)}
        style={{ backgroundColor: room.tint }}
        className={`relative flex min-h-[4.6rem] flex-col items-start gap-0.5 overflow-hidden rounded-xl border p-1.5 text-left transition sm:min-h-[5.6rem] ${can ? "cursor-pointer border-amber-300/80 ring-2 ring-amber-300/60 hover:brightness-125" : "cursor-default border-white/10"} ${
          scan?.room === r ? (scan.hit ? "ring-2 ring-rose-400" : "ring-2 ring-emerald-400") : ""
        }`}
      >
        <span className="text-[11px] leading-tight font-bold text-white/90">
          {room.icon} {room.name}
        </span>
        {r !== VAULT && hasStairs(r) && (
          <span className="absolute top-1 right-1 text-[10px]" title="지하 금고실로 내려가는 계단">
            🪜
          </span>
        )}
        {errands.includes(r) && <span className="text-[9px] text-amber-200">{errandDone(r) ? "✅" : "⭐"} {room.errand}</span>}
        <span className="mt-auto flex flex-wrap gap-0.5">
          {here.map((a) => (
            <span key={a.seat} title={names[a.seat]} className={`rounded-full px-1 text-[10px] font-black text-black ${a.seat === me ? "ring-1 ring-white" : ""}`} style={{ backgroundColor: SEAT_COLORS[a.seat % SEAT_COLORS.length] }}>
              {SEAT_GLYPHS[a.seat % SEAT_GLYPHS.length]}
              {a.seat === me ? "나" : ""}
            </span>
          ))}
          {ghost?.room === r && <span className="rounded-full border border-rose-400 bg-rose-950 px-1 text-[9px] font-bold text-rose-200">{ghost.label}</span>}
        </span>
        {can && <span className="absolute right-1 bottom-1 rounded bg-amber-300 px-1 text-[9px] font-bold text-black">{here.some((a) => a.seat === me) ? "머무르기" : "이동"}</span>}
      </button>
    );
  };
  return (
    <div className="relative rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_top,#152033,#07090f)] p-2">
      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] text-emerald-300/90">
        <span>
          <span className={live ? "animate-pulse text-rose-400" : "text-white/40"}>●</span> {live ? "REC" : "STANDBY"} CAM-01 {clock}
        </span>
        <span className="ml-auto text-white/35">🪜 = 금고실 계단</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">{Array.from({ length: ROOM_COUNT }, (_, r) => cell(r))}</div>
      {(showVault || pickable.includes(VAULT) || ghost?.room === VAULT) && <div className="mt-1.5 grid grid-cols-3 gap-1.5"><div />{cell(VAULT)}<div /></div>}
    </div>
  );
}

function FootageTable({
  view,
  me,
  names,
  t,
  onPickTime,
  checkAt,
  contra,
  memo,
}: {
  view: GameState;
  me: number;
  names: Record<number, string>;
  t: number;
  onPickTime: (t: number) => void;
  checkAt: (t: number, room: number) => Check | undefined;
  contra: Contradiction[];
  memo: Record<number, number>;
}) {
  const open = revealed(view);
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-1.5">
      <div className="grid grid-cols-[2.7rem_repeat(9,minmax(0,1fr))] gap-0.5 text-center">
        <span />
        {Array.from({ length: TICKS + 1 }, (_, k) => (
          <button key={k} type="button" onClick={() => onPickTime(k)} className={`rounded font-mono text-[8px] leading-4 sm:text-[9px] ${k === t ? "bg-sky-400 font-bold text-slate-900" : "text-white/45"}`}>
            {timeLabel(k)}
          </button>
        ))}
        {Array.from({ length: view.seatCount }, (_, s) => (
          <div key={s} className="contents">
            <span className="flex items-center gap-0.5 truncate text-left text-[10px] text-white/80" title={names[s]}>
              <Glyph seat={s} />
              <span className="truncate">{s === me ? "나" : (names[s] ?? `${s + 1}번`)}</span>
              {MEMO[memo[s] ?? 0]}
            </span>
            {Array.from({ length: TICKS + 1 }, (_, k) => {
              const r = view.footage[s]?.[k];
              if (r === undefined) return <span key={k} />;
              const chk = k > 0 ? checkAt(k, r) : undefined;
              const bad = contra.some((c) => c.target === s && c.t === k);
              const truth = open && s === view.culprit ? view.truth[s]?.[k] : undefined;
              const forged = truth !== undefined && truth !== r;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => onPickTime(k)}
                  title={`${timeLabel(k)} ${ROOMS[r].name}${chk ? ` · 센서 ${chk.truth}명 / 영상 ${chk.footage}명` : ""}${forged ? ` · 실제 ${ROOMS[truth!].name}` : ""}`}
                  style={{ backgroundColor: ROOMS[r].tint }}
                  className={`relative flex h-8 items-center justify-center rounded text-sm sm:h-9 ${k === t ? "outline outline-1 outline-sky-300" : ""} ${hasStairs(r) ? "border-b-2 border-amber-300/70" : "border-b-2 border-transparent"} ${
                    forged ? "ring-2 ring-rose-400" : bad ? "ring-2 ring-rose-400" : chk ? (chk.truth !== chk.footage ? "ring-2 ring-orange-400" : "ring-1 ring-emerald-400/80") : ""
                  }`}
                >
                  <span className={forged ? "opacity-40" : ""}>{ROOMS[r].icon}</span>
                  {forged && <span className="absolute -right-0.5 -bottom-0.5 rounded bg-rose-600 px-0.5 text-[9px] leading-tight">{ROOMS[truth!].icon}</span>}
                  {bad && <span className="absolute -top-1 -right-0.5 text-[9px]">❗</span>}
                  {!bad && !forged && chk && <span className="absolute -top-1 -right-0.5 text-[8px]">{chk.truth !== chk.footage ? "🚨" : "✔️"}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[9px] break-keep text-white/40">노란 밑줄 = 🪜 계단 방 · ✔️ 센서와 일치 · 🚨 그 칸에 가짜가 섞임 · ❗ 내 기억과 다름{open ? " · 빨간 테두리 = 조작된 장면(작은 그림이 실제 위치)" : ""}</p>
    </div>
  );
}

function RoomGrid({
  view,
  t,
  onPickTime,
  checkAt,
  canPick,
  pick,
  onPick,
}: {
  view: GameState;
  t: number;
  onPickTime: (t: number) => void;
  checkAt: (t: number, room: number) => Check | undefined;
  canPick: boolean;
  pick: { t: number; room: number } | null;
  onPick: (c: { t: number; room: number }) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-1.5">
      <div className="grid grid-cols-[1.6rem_repeat(8,minmax(0,1fr))] gap-0.5 text-center">
        <span />
        {Array.from({ length: TICKS }, (_, i) => i + 1).map((k) => (
          <button key={k} type="button" onClick={() => onPickTime(k)} className={`rounded font-mono text-[8px] leading-4 sm:text-[9px] ${k === t ? "bg-sky-400 font-bold text-slate-900" : "text-white/45"}`}>
            {timeLabel(k)}
          </button>
        ))}
        {Array.from({ length: ROOM_COUNT }, (_, r) => (
          <div key={r} className="contents">
            <span className="flex items-center justify-center text-sm" title={ROOMS[r].name}>
              {ROOMS[r].icon}
            </span>
            {Array.from({ length: TICKS }, (_, i) => i + 1).map((k) => {
              const who = Array.from({ length: view.seatCount }, (_, s) => s).filter((s) => view.footage[s]?.[k] === r);
              const chk = checkAt(k, r);
              const sel = pick?.t === k && pick.room === r;
              return (
                <button
                  key={k}
                  type="button"
                  disabled={!canPick || !!chk}
                  onClick={() => onPick({ t: k, room: r })}
                  title={`${timeLabel(k)} ${ROOMS[r].name} — 영상 ${who.length}명${chk ? ` · 센서 ${chk.truth}명` : ""}`}
                  className={`relative flex h-8 flex-wrap items-center justify-center gap-px rounded border sm:h-9 ${
                    sel ? "border-sky-300 bg-sky-400/30" : chk ? (chk.truth !== chk.footage ? "border-orange-400 bg-orange-500/20" : "border-emerald-400/60 bg-emerald-500/10") : canPick ? "border-white/15 bg-white/5 hover:border-sky-300/70" : "border-white/5 bg-white/[0.03]"
                  }`}
                >
                  {who.map((s) => (
                    <Glyph key={s} seat={s} small />
                  ))}
                  {chk && <span className={`absolute -top-1 -right-0.5 rounded px-0.5 text-[8px] leading-tight font-bold ${chk.truth !== chk.footage ? "bg-orange-500 text-black" : "bg-emerald-600 text-white"}`}>{chk.truth}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[9px] break-keep text-white/40">칸 = 그 시각 그 방에 영상으로 찍힌 사람. 모서리 숫자 = 센서가 센 실제 인원(초록 일치 · 주황 불일치). {canPick ? "내 차례 — 대조할 칸을 누르세요." : ""}</p>
    </div>
  );
}

function MemoryPanel({
  view,
  me,
  names,
  culprit,
  contra,
  canTestify,
  onTestify,
  onPickTime,
}: {
  view: GameState;
  me: number;
  names: Record<number, string>;
  culprit: boolean;
  contra: Contradiction[];
  canTestify: boolean;
  onTestify: (c: Contradiction) => void;
  onPickTime: (t: number) => void;
}) {
  const mine = view.truth[me] ?? [];
  const sight = view.sight[me] ?? [];
  if (mine.length === 0) return <p className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-white/50">기억을 불러오는 중…</p>;
  return (
    <div className="flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto rounded-xl border border-white/10 bg-black/25 p-2">
      {culprit ? (
        <p className="text-[11px] break-keep text-rose-200/90">🦹 내가 실제로 다닌 길이에요. 영상과 다른 칸이 조작한 장면 — 그 방에 찍힌 손님은 “못 봤다”고 증언할 수 있어요.</p>
      ) : contra.length > 0 ? (
        <p className="rounded-lg bg-rose-500/15 px-2 py-1.5 text-[11px] font-semibold break-keep text-rose-100">❗ 내 기억과 영상이 달라요 — 영상이 가짜인 사람은 범인뿐! {canTestify ? "증언해서 모두에게 알리세요." : "내 차례에 증언할 수 있어요."}</p>
      ) : (
        <p className="text-[11px] break-keep text-white/50">내가 실제로 본 사람과 영상이 모두 맞아요. (같은 방에 있던 사람만 기억해요)</p>
      )}
      {Array.from({ length: TICKS }, (_, i) => i + 1).map((k) => {
        const bad = contra.filter((c) => c.t === k);
        const fake = culprit && view.footage[me][k] !== mine[k];
        return (
          <div key={k} className={`rounded-lg px-2 py-1 text-[11px] ${bad.length ? "bg-rose-500/15" : fake ? "bg-rose-500/10" : "bg-white/5"}`}>
            <button type="button" onClick={() => onPickTime(k)} className="flex w-full flex-wrap items-center gap-x-2 text-left text-white/80">
              <span className="font-mono text-white/50">{timeLabel(k)}</span>
              <span>{roomLabel(mine[k])}</span>
              {fake && <span className="text-rose-200">→ 영상엔 {roomLabel(view.footage[me][k])}</span>}
              <span className="text-white/55">
                {sight[k]?.length ? (
                  <>
                    함께:{" "}
                    {sight[k].map((s) => (
                      <span key={s} className="mr-1">
                        <Glyph seat={s} /> {names[s] ?? `${s + 1}번`}
                      </span>
                    ))}
                  </>
                ) : (
                  "혼자"
                )}
              </span>
            </button>
            {bad.map((c) => (
              <div key={`${c.target}`} className="mt-1 flex flex-wrap items-center gap-2">
                <span className="break-keep text-rose-100">
                  ❗ {c.kind === "absent" ? `영상에는 ${seatTag(c.target, me, names)}이(가) 같이 있는데, 실제로는 없었어요` : `${seatTag(c.target, me, names)}이(가) 여기 있었는데, 영상엔 ${roomLabel(view.footage[c.target][k])}에 찍혀 있어요`}
                </span>
                <button type="button" disabled={!canTestify} onClick={() => onTestify(c)} className="rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-bold text-slate-900 disabled:opacity-35">
                  🗣️ 증언
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function LogList({ view, me, names }: { view: GameState; me: number; names: Record<number, string> }) {
  const lines = view.log.map((e, i) => ({ i, ...logLine(e, me, names) })).reverse();
  return (
    <div className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
      {lines.length === 0 && <p className="text-xs text-white/40">아직 기록이 없어요.</p>}
      {lines.map((l) => (
        <p key={l.i} className={`text-[11px] break-keep ${l.tone === "good" ? "text-emerald-200" : l.tone === "bad" ? "text-rose-200" : l.tone === "info" ? "text-amber-100/90" : "text-white/65"}`}>
          {l.icon} {l.text}
        </p>
      ))}
    </div>
  );
}

function FxOverlay({ fx, me, names }: { fx: Fx; me: number; names: Record<number, string> }) {
  const box = "pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/65 p-3 text-center backdrop-blur-[2px]";
  switch (fx.kind) {
    case "tape":
      return (
        <div className={box} style={{ animation: "cctvPop 0.25s both" }}>
          <p className="text-3xl">📼</p>
          <p className="text-base font-black text-sky-100">CCTV 영상 공개</p>
          <p className="text-xs text-white/70">이 중 한 사람의 영상은 일부가 가짜예요</p>
        </div>
      );
    case "check": {
      const diff = fx.e.truth !== fx.e.footage;
      return (
        <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex flex-col items-center gap-1 rounded-2xl bg-black/80 p-2.5 text-center" style={{ animation: "cctvPop 0.25s both" }}>
          <p className="text-xs text-white/80">
            🔎 {seatTag(fx.e.seat, me, names)}의 센서 대조 — {timeLabel(fx.e.t)} {roomLabel(fx.e.room)}
          </p>
          <p className="font-mono text-sm text-white/85">
            영상 {fx.e.footage}명 · 센서 <b className={diff ? "text-orange-300" : "text-emerald-300"}>{fx.e.truth}명</b>
          </p>
          <p style={{ animation: "cctvStamp 0.45s 0.5s both" }} className={`rounded-lg border-4 px-3 py-0.5 text-lg font-black ${diff ? "border-orange-400 text-orange-300" : "border-emerald-400 text-emerald-300"}`}>
            {diff ? "🚨 불일치!" : "✔️ 일치"}
          </p>
        </div>
      );
    }
    case "testify":
      return (
        <div className={box} style={{ animation: "cctvPop 0.25s both" }}>
          <p className="text-sm font-bold text-amber-200">🗣️ {seatTag(fx.e.seat, me, names)}의 증언</p>
          <p className="max-w-xs rounded-xl border border-amber-200/30 bg-[#f3e9d2] px-3 py-2 text-sm font-semibold break-keep text-[#3b2a16] shadow-lg">“{claimText(fx.e, me, names)}”</p>
          <p className="text-[11px] text-white/60">손님은 사실만 증언할 수 있어요 — 거짓이라면 증언한 사람이 범인</p>
        </div>
      );
    case "verdict":
      return (
        <div className={box} style={{ animation: "cctvPop 0.25s both" }}>
          <p className="text-sm text-white/80">범인은… {seatTag(fx.culprit, me, names)}</p>
          <p style={{ animation: "cctvStamp 0.5s 0.6s both" }} className={`rounded-lg border-4 px-4 py-1 text-2xl font-black ${fx.caught ? "border-emerald-400 text-emerald-300" : "border-rose-500 text-rose-400"}`}>
            {fx.caught ? "🚔 검거!" : "💨 도주!"}
          </p>
        </div>
      );
  }
}

function Composer({ title, onClose, children }: { title: string; onClose?: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center p-2 sm:p-4">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col gap-2.5 overflow-y-auto rounded-2xl border border-amber-300/30 bg-[#12151d]/95 p-3 shadow-2xl backdrop-blur" style={{ animation: "cctvPop 0.2s both" }}>
        <div className="flex items-center">
          <p className="flex-1 text-sm font-black text-amber-100">{title}</p>
          {onClose && (
            <button type="button" onClick={onClose} className="rounded-full px-2 text-white/60 hover:text-white" aria-label="닫기">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** 한 사건의 판결: 범인·조작 구간·표·점수 */
function Verdict({ view, me, names }: { view: GameState; me: number; names: Record<number, string> }) {
  const c = view.cases[view.cases.length - 1];
  if (!c) return null;
  const truth = view.truth[c.culprit] ?? [];
  const footage = view.footage[c.culprit] ?? [];
  const forge = view.plans[c.culprit]?.forge ?? null;
  return (
    <div className="flex flex-col gap-2 text-left">
      <p className={`text-center text-lg font-black ${c.caught ? "text-emerald-300" : "text-rose-300"}`}>
        {c.caught ? "🚔 검거!" : "💨 도주!"} 범인은 {seatTag(c.culprit, me, names)}
      </p>
      {truth.length > 0 && (
        <>
          <RouteStrip full={truth} label="실제" vaultTone />
          <RouteStrip full={footage} label="영상" fake={forge ?? undefined} />
        </>
      )}
      <div className="flex flex-col gap-1">
        {c.votes.map((v, s) => (
          <p key={s} className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-[11px] text-white/80">
            <span className="flex-1 truncate">
              <Glyph seat={s} /> {seatName(s, me, names)}
              {s === c.culprit && " 🦹"}
            </span>
            <span className="text-white/55">→ {v === null ? "기권" : seatTag(v, me, names)}</span>
            {s !== c.culprit && <span>{v === c.culprit ? "⭕" : "❌"}</span>}
            <b className={c.gains[s] > 0 ? "text-amber-200" : "text-white/35"}>+{c.gains[s]}</b>
          </p>
        ))}
      </div>
      <p className="text-[10px] break-keep text-white/40">
        검거하면 손님 모두 +{SCORE_GUEST_CATCH} · 범인을 찍은 표 +{SCORE_VOTE_BONUS} · 달아난 범인 +{SCORE_ESCAPE}
      </p>
    </div>
  );
}

function ResultPanel({ view, me, names, onGameEnd }: { view: GameState; me: number; names: Record<number, string>; onGameEnd: () => void }) {
  const o = view.outcome!;
  const medal = ["", "🥇", "🥈", "🥉"];
  const order = Array.from({ length: view.seatCount }, (_, s) => s).sort((a, b) => rankOf(view, a) - rankOf(view, b));
  const myRank = rankOf(view, me);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-3" style={{ animation: "cctvPop 0.3s both" }}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-2xl border border-sky-300/30 bg-gradient-to-b from-[#131b2a] to-[#0a0c12] p-4 text-center">
        <p className="text-xs text-white/50">📹 사건 #{view.caseNo} 종결</p>
        <p className="text-xl font-black text-sky-100">{o.winners.includes(me) ? "🎉 내가 이겼다!" : `🏆 ${o.winners.map((s) => seatTag(s, me, names)).join(", ")} 승리`}</p>
        <Verdict view={view} me={me} names={names} />
        <div className="flex flex-col gap-1 text-left">
          {order.map((s) => (
            <div key={s} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-xs text-white/80">
              <span className="w-5 text-base">{medal[rankOf(view, s)] ?? ""}</span>
              <span className="flex-1 truncate">
                <Glyph seat={s} /> {seatName(s, me, names)}
                <span className="text-white/45">
                  {" "}
                  · 대조 {view.tally[s].checks}(적중 {view.tally[s].hits}) · 증언 {view.tally[s].testimonies}
                </span>
              </span>
              <b className="text-amber-200">{view.scores[s]}점</b>
            </div>
          ))}
        </div>
        {view.cases.length > 1 && <p className="text-[11px] text-white/50">{view.cases.map((c, i) => `사건 ${i + 1}: ${seatName(c.culprit, me, names)} ${c.caught ? "🚔" : "💨"}`).join(" · ")}</p>}
        <p className="text-xs text-white/60">
          내 순위: {medal[myRank] ?? ""} {myRank}위
        </p>
        <button type="button" onClick={onGameEnd} className="rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-bold text-slate-900">
          결과 기록하고 계속
        </button>
      </div>
    </div>
  );
}
