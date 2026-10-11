"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import { isBgmEffectivelyMuted, isSfxEffectivelyMuted, useAudioSettingsStore } from "@/lib/audio/audioSettings";
import {
  canChallenge,
  computeRankings,
  getPlayerView,
  isTrueCard,
  MAX_PLAY,
  mustChallenge,
  pullDanger,
  type BluffRouletteState,
  type Card,
  type EngineAction,
  type Resolution,
  type SeatIndex,
} from "./engine";
import { CARD_ART, CardBack, CardFace } from "./cardArt";
import { buildTimeline, activePull, type ShowdownTimeline } from "./timeline";
import { getBluffSound } from "./bluffSound";
import RulebookModal from "./RulebookModal";
import type { Showdown } from "./Scene3D";

// three.js only loads when a 3D table is actually shown (rulebook §T: 2D fallback otherwise).
const Scene3D = dynamic(() => import("./Scene3D"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-amber-100/50">3D 테이블 준비 중…</div>,
});

interface Props {
  state: BluffRouletteState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
  /** This client drives bots → it also auto-advances past a finished showdown. */
  canDrive: boolean;
}

type View = "3d" | "2d";
type Quality = "high" | "low";
const VIEW_KEY = "bluff-roulette-view";
const QUALITY_KEY = "bluff-roulette-quality";
const AUTO_CONTINUE_S = 3;

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string) {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    /* private mode — keep the in-memory choice */
  }
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Identity of one showdown, stable across re-renders and state-syncs. */
function showdownKey(state: BluffRouletteState): string | null {
  const r = state.lastResolution;
  if (!r || state.phase === "playing") return null;
  return `${state.roundNumber}:${r.challengerSeat}:${r.accusedSeat}:${r.revealed.map((c) => c.id).join(",")}`;
}

function Pips({ shots, size = "sm" }: { shots: number; size?: "sm" | "md" }) {
  const d = size === "md" ? "h-2.5 w-2.5" : "h-1.5 w-1.5";
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`방아쇠 ${shots}/6`}>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={`${d} rounded-full ${i < shots ? "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.8)]" : "bg-amber-100/25"}`} />
      ))}
    </span>
  );
}

function SoundHud() {
  const s = useAudioSettingsStore();
  const bgmOn = !isBgmEffectivelyMuted(s);
  const sfxOn = !isSfxEffectivelyMuted(s);
  function toggle(kind: "bgm" | "sfx") {
    const sound = getBluffSound();
    sound.unlock();
    const set = kind === "bgm" ? s.setBgmMuted : s.setSfxMuted;
    if (kind === "bgm" ? bgmOn : sfxOn) {
      set(true);
      return;
    }
    s.setMasterMuted(false);
    set(false);
    if (kind === "sfx") setTimeout(() => sound.click(), 30);
  }
  const cls = (on: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${on ? "border-amber-500/70 bg-amber-950/70 text-amber-200" : "border-white/15 text-white/45 hover:border-white/30"}`;
  return (
    <>
      <button type="button" onClick={() => toggle("bgm")} aria-pressed={bgmOn} className={cls(bgmOn)} title="살롱 재즈 BGM">
        {bgmOn ? "🎷" : "🔇"}
        <span className="ml-1 hidden sm:inline">BGM</span>
      </button>
      <button type="button" onClick={() => toggle("sfx")} aria-pressed={sfxOn} className={cls(sfxOn)} title="효과음">
        {sfxOn ? "🔔" : "🔕"}
        <span className="ml-1 hidden sm:inline">효과음</span>
      </button>
    </>
  );
}

/** Caption for the current beat of a showdown (shared by the 3D and 2D tables). */
function showdownCaption(res: Resolution, tl: ShowdownTimeline, t: number, names: Record<SeatIndex, string>): { text: string; tone: "neutral" | "good" | "bad" | "skull" } {
  const n = (s: SeatIndex) => names[s] ?? `${s + 1}번`;
  if (t < tl.verdictAt) {
    return { text: `🗣 ${n(res.challengerSeat)}: "거짓말!"${res.forced ? " (손패가 없어 강제 의심)" : ""} — ${n(res.accusedSeat)}의 ${res.revealed.length}장 공개`, tone: "neutral" };
  }
  const pull = activePull(tl, t);
  if (pull) {
    const p = res.pulls[pull.index];
    const fired = pull.local >= tl.pulls[pull.index].fireAt - tl.pulls[pull.index].liftAt;
    if (!fired) return { text: `🔫 ${n(p.seat)}의 ${p.chamber + 1}번째 방아쇠… (위험 ${Math.round(pullDanger(p.chamber) * 100)}%)`, tone: "neutral" };
    return p.hit ? { text: `💥 탕! ${n(p.seat)} 탈락`, tone: "bad" } : { text: `찰칵… ${n(p.seat)} 생존!`, tone: "good" };
  }
  if (t < (tl.pulls[0]?.liftAt ?? tl.total)) {
    if (res.skull) return { text: `💀 해골 발동! ${n(res.accusedSeat)}을(를) 뺀 모두가 방아쇠를 당깁니다`, tone: "skull" };
    return res.truthful
      ? { text: `✅ 진짜였다! 의심한 ${n(res.challengerSeat)}이(가) 방아쇠를 당깁니다`, tone: "good" }
      : { text: `❌ 거짓말 들통! ${n(res.accusedSeat)}이(가) 방아쇠를 당깁니다`, tone: "bad" };
  }
  const dead = res.pulls.filter((p) => p.hit).map((p) => n(p.seat));
  return { text: dead.length ? `💀 ${dead.join(", ")} 탈락` : "모두 살아남았다", tone: dead.length ? "bad" : "good" };
}

/** 2D fallback / "3D 끄기" table: same public info laid out on an ellipse. */
function Table2D({
  state,
  viewerSeat,
  names,
  showdown,
  t,
}: {
  state: BluffRouletteState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  showdown: Showdown | null;
  t: number;
}) {
  const n = state.playerCount;
  const views = getPlayerView(state, viewerSeat);
  const pileCount = state.pile.reduce((k, p) => k + p.cards.length, 0);
  return (
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(ellipse_at_center,#1f6b45_0%,#0b3322_55%,#1a0e0a_80%)]">
      <div className="absolute inset-[18%] rounded-[50%] border-4 border-[#5a2e17] shadow-[inset_0_0_40px_rgba(0,0,0,0.6)]" />
      {views.map((v) => {
        const a = (((v.seat - viewerSeat + n) % n) / n) * Math.PI * 2;
        const x = 50 + Math.sin(a) * 40;
        const y = 50 + Math.cos(a) * 38;
        const pending = showdown ? showdown.res.pulls.filter((p, j) => p.seat === v.seat && t < showdown.tl.pulls[j].fireAt) : [];
        const shots = v.shots - pending.length;
        const alive = v.alive || pending.some((p) => p.hit);
        const active = state.phase === "playing" && state.activeSeat === v.seat;
        return (
          <div
            key={v.seat}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 rounded-xl border px-2 py-1 text-[11px] transition ${
              active ? "border-amber-300 bg-amber-900/70 shadow-[0_0_14px_rgba(251,191,36,0.6)]" : "border-white/10 bg-black/50"
            } ${alive ? "" : "opacity-40 grayscale"}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <span className="max-w-[5.5rem] truncate font-bold text-amber-50">{v.seat === viewerSeat ? "나" : names[v.seat]}</span>
            <span className="text-amber-100/70">{alive ? `🂠 ${v.handCount}` : "💀"}</span>
            <Pips shots={Math.max(0, shots)} />
          </div>
        );
      })}
      <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
        {showdown ? (
          <div className="flex gap-1">
            {showdown.res.revealed.map((c, i) =>
              t >= showdown.tl.flipAt(i) ? <CardFace key={c.id} kind={c.kind} className="h-16 w-12 drop-shadow-lg" /> : <CardBack key={c.id} className="h-16 w-12" />,
            )}
          </div>
        ) : (
          <>
            <CardFace kind={state.tableSuit} className="h-14 w-10 drop-shadow-[0_0_10px_rgba(255,230,160,0.6)]" />
            <span className="rounded-full bg-black/50 px-2 text-[10px] text-amber-100/80">더미 {pileCount}장</span>
          </>
        )}
      </div>
    </div>
  );
}

export default function BluffRouletteBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd, canDrive }: Props) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  // Client-only component (the game is loaded with ssr:false), so the device checks can run in initializers.
  const [hasWebgl] = useState(webglAvailable);
  const [view, setView] = useState<View>(() => (hasWebgl ? readPref<View>(VIEW_KEY, ["3d", "2d"], "3d") : "2d"));
  const [quality, setQuality] = useState<Quality>(() => {
    const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4 || window.innerWidth < 500;
    return readPref<Quality>(QUALITY_KEY, ["high", "low"], lowEnd ? "low" : "high");
  });

  // --- showdown clock: started (and ticked) from timer callbacks, never during render ---
  const sdKey = showdownKey(state);
  const [clock, setClock] = useState<{ key: string | null; at: number; now: number }>({ key: null, at: 0, now: 0 });
  const resolution = state.lastResolution;
  useEffect(() => {
    if (!sdKey || !resolution) return;
    const total = buildTimeline(resolution).total;
    const tick = () =>
      setClock((c) => {
        const now = performance.now();
        if (c.key !== sdKey) return { key: sdKey, at: now, now };
        return now - c.at > (total + 1) * 1000 ? c : { ...c, now };
      });
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 100);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [sdKey, resolution]);
  const showdown: Showdown | null = useMemo(
    () => (sdKey && resolution && clock.key === sdKey ? { res: resolution, tl: buildTimeline(resolution), startedAt: clock.at } : null),
    [sdKey, resolution, clock.key, clock.at],
  );
  const t = showdown ? (clock.now - showdown.startedAt) / 1000 : 0;
  const showdownDone = !!showdown && t >= showdown.tl.total;

  // --- sound ------------------------------------------------------------------
  useEffect(() => {
    const sound = getBluffSound();
    sound.startBgm();
    return () => sound.stopBgm();
  }, []);
  const me = state.players[viewerSeat];
  useEffect(() => {
    getBluffSound().setTension((me?.shots ?? 0) / 5);
  }, [me?.shots]);
  const pileLen = state.pile.length;
  const lastPileRef = useRef(pileLen);
  useEffect(() => {
    if (pileLen > lastPileRef.current) getBluffSound().cardSlide(state.pile[pileLen - 1].cards.length);
    lastPileRef.current = pileLen;
  }, [pileLen, state.pile]);
  useEffect(() => {
    if (!showdown) return;
    const sound = getBluffSound();
    const elapsed = (performance.now() - showdown.startedAt) / 1000;
    const timers = showdown.tl.cues
      .filter((c) => c.at >= elapsed - 0.05)
      .map((c) =>
        window.setTimeout(() => {
          const res = showdown.res;
          if (c.kind === "liar") sound.liar();
          else if (c.kind === "flip") sound.flip(res.skull || isTrueCard(res.revealed[c.index], res.tableSuit));
          else if (c.kind === "skull") sound.skull();
          else if (c.kind === "spin") sound.spin();
          else if (c.kind === "cock") sound.cock();
          else if (c.kind === "fire") {
            if (res.pulls[c.index].hit) sound.bang();
            else sound.click();
          }
        }, Math.max(0, (c.at - elapsed) * 1000)),
      );
    const endTimer = state.phase === "gameOver" ? window.setTimeout(() => sound.victory(), (showdown.tl.total - elapsed) * 1000) : null;
    return () => {
      timers.forEach(window.clearTimeout);
      if (endTimer) window.clearTimeout(endTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per showdown
  }, [showdown]);

  // --- auto-continue (one driver client only, so a stalled table never waits on a human click) ----
  useEffect(() => {
    if (!showdown || state.phase !== "reveal" || !canDrive) return;
    const wait = Math.max(0, (showdown.tl.total + AUTO_CONTINUE_S) * 1000 - (performance.now() - showdown.startedAt));
    const id = window.setTimeout(() => onAction({ type: "continue", seed: Math.floor(Math.random() * 1e9) }), wait);
    return () => window.clearTimeout(id);
  }, [showdown, state.phase, canDrive, onAction]);

  // Clear a stale selection whenever the hand changes (new round, a play went out) — compared during render, no effect.
  const handKey = me?.hand.map((c) => c.id).join(",") ?? "";
  const [selectionHandKey, setSelectionHandKey] = useState(handKey);
  if (selectionHandKey !== handKey) {
    setSelectionHandKey(handKey);
    setSelected([]);
  }

  const isMyTurn = state.phase === "playing" && state.activeSeat === viewerSeat && !!me?.alive;
  const forced = isMyTurn && mustChallenge(state);
  const challengeable = isMyTurn && canChallenge(state);
  const myTrue = me?.hand.filter((c) => isTrueCard(c, state.tableSuit)).length ?? 0;
  const prev = state.pile[state.pile.length - 1];

  function toggleCard(c: Card) {
    if (!isMyTurn || forced) return;
    getBluffSound().unlock();
    setSelected((sel) => (sel.includes(c.id) ? sel.filter((id) => id !== c.id) : sel.length >= MAX_PLAY ? sel : [...sel, c.id]));
  }
  function playSelected() {
    if (!isMyTurn || selected.length < 1) return;
    onAction({ type: "play", seat: viewerSeat, cardIds: selected });
    setSelected([]);
  }
  function callLiar() {
    if (!challengeable) return;
    getBluffSound().unlock();
    onAction({ type: "liar", seat: viewerSeat });
  }

  const caption = showdown ? showdownCaption(showdown.res, showdown.tl, t, names) : null;
  const myPullNow = showdown ? activePull(showdown.tl, t) : null;
  const flashMine =
    !!showdown && !!myPullNow && showdown.res.pulls[myPullNow.index].seat === viewerSeat && showdown.res.pulls[myPullNow.index].hit && myPullNow.local > 1.95 && myPullNow.local < 2.6;
  const flashOther =
    !!showdown && !!myPullNow && showdown.res.pulls[myPullNow.index].seat !== viewerSeat && showdown.res.pulls[myPullNow.index].hit && myPullNow.local > 1.95 && myPullNow.local < 2.15;

  const views = getPlayerView(state, viewerSeat);
  const sceneSeats = views.map((v) => ({ seat: v.seat, alive: v.alive, handCount: v.handCount, shots: v.shots }));
  const scenePile = state.pile.map((p) => ({ seat: p.seat, count: p.cards.length }));
  const use3d = view === "3d" && hasWebgl;

  const rankings = state.phase === "gameOver" ? computeRankings(state) : [];

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-amber-900/50 bg-[#140b08] p-2 text-amber-50 shadow-xl sm:p-3">
      <MyTurnOverlay isMyTurn={isMyTurn && !showdown} />

      {/* header */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-amber-950/80 px-2.5 py-1 text-[11px] font-bold text-amber-200">라운드 {state.roundNumber}</span>
        <span className="flex items-center gap-1 rounded-full border border-amber-400/40 bg-black/40 px-2 py-0.5 text-[11px]">
          오늘의 카드
          <CardFace kind={state.tableSuit} className="h-6 w-[18px]" />
          <b className="text-amber-200">{CARD_ART[state.tableSuit].label}</b>
          <span className="text-amber-100/50">+ 🎭</span>
        </span>
        {state.options.skullMode && <span className="rounded-full bg-violet-950/80 px-2 py-1 text-[11px] font-bold text-violet-200">💀 해골 모드</span>}
        <span className="ml-auto flex items-center gap-1">
          <SoundHud />
          <button type="button" onClick={() => setRulebookOpen(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:border-white/30">
            📖<span className="ml-1 hidden sm:inline">룰북</span>
          </button>
          <button type="button" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:border-white/30">
            ⚙
          </button>
        </span>
      </div>
      {settingsOpen && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/40 p-2 text-[11px]">
          <span className="text-white/50">화면</span>
          {(["3d", "2d"] as const).map((v) => (
            <button
              key={v}
              type="button"
              disabled={v === "3d" && !hasWebgl}
              onClick={() => {
                setView(v);
                writePref(VIEW_KEY, v);
              }}
              className={`rounded-full px-2.5 py-1 font-bold disabled:opacity-30 ${view === v ? "bg-amber-600 text-white" : "border border-white/15 text-white/60"}`}
            >
              {v === "3d" ? "3D 테이블" : "2D 테이블"}
            </button>
          ))}
          <span className="ml-2 text-white/50">그래픽</span>
          {(["high", "low"] as const).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                setQuality(q);
                writePref(QUALITY_KEY, q);
              }}
              className={`rounded-full px-2.5 py-1 font-bold ${quality === q ? "bg-amber-600 text-white" : "border border-white/15 text-white/60"}`}
            >
              {q === "high" ? "고품질" : "가볍게"}
            </button>
          ))}
          {!hasWebgl && <span className="text-rose-300">이 기기는 3D(WebGL)를 지원하지 않아 2D로 표시해요</span>}
        </div>
      )}

      {/* table */}
      <div className="relative h-[46vh] min-h-[260px] overflow-hidden rounded-xl border border-black/60 sm:h-[52vh] sm:max-h-[560px]">
        {use3d ? (
          <Scene3D
            playerCount={state.playerCount}
            seats={sceneSeats}
            pile={scenePile}
            tableSuit={state.tableSuit}
            activeSeat={state.phase === "playing" ? state.activeSeat : null}
            viewerSeat={viewerSeat}
            names={names}
            showdown={showdown}
            quality={quality}
          />
        ) : (
          <Table2D state={state} viewerSeat={viewerSeat} names={names} showdown={showdown} t={t} />
        )}
        {caption && (
          <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-center">
            <span
              className={`rounded-full px-3 py-1.5 text-center text-xs font-bold shadow-lg backdrop-blur sm:text-sm ${
                caption.tone === "good" ? "bg-emerald-900/80 text-emerald-100" : caption.tone === "bad" ? "bg-rose-900/85 text-rose-100" : caption.tone === "skull" ? "bg-violet-900/85 text-violet-100" : "bg-black/70 text-amber-100"
              }`}
            >
              {caption.text}
            </span>
          </div>
        )}
        {!showdown && state.phase === "playing" && (
          <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-center">
            <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] text-amber-100/90 backdrop-blur">
              {isMyTurn ? (forced ? "남은 사람들 손패가 없어요 — 거짓말! 을 외쳐야 해요" : "내 차례!") : `${names[state.activeSeat] ?? "상대"}의 차례`}
              {prev && ` · 직전: ${names[prev.seat] ?? "상대"} ${prev.cards.length}장`}
            </span>
          </div>
        )}
        {use3d && !showdown && <span className="pointer-events-none absolute right-2 bottom-2 text-[10px] text-white/30">드래그로 둘러보기</span>}
        {flashMine && <div className="pointer-events-none absolute inset-0 animate-pulse bg-rose-700/70" />}
        {flashOther && <div className="pointer-events-none absolute inset-0 bg-white/40" />}
        {showdownDone && state.phase === "reveal" && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <button
              type="button"
              onClick={() => onAction({ type: "continue", seed: Math.floor(Math.random() * 1e9) })}
              className="rounded-full bg-amber-600 px-5 py-2 text-sm font-bold text-white shadow-lg hover:bg-amber-500"
            >
              다음 라운드 ▶
            </button>
          </div>
        )}
        {state.phase === "gameOver" && (!showdown || showdownDone) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 p-4 text-center backdrop-blur-sm">
            <span className="text-4xl">🏆</span>
            <p className="text-lg font-extrabold text-amber-200">{state.winnerSeat !== null ? `${names[state.winnerSeat]} 최후의 생존자!` : "게임 종료"}</p>
            <ol className="flex flex-col gap-0.5 text-xs text-amber-100/80">
              {rankings.map((r) => (
                <li key={r.seat}>
                  {r.rank}위 · {names[r.seat]} <Pips shots={state.players[r.seat].shots} />
                </li>
              ))}
            </ol>
            <button type="button" onClick={onGameEnd} className="rounded-full bg-amber-500 px-6 py-2.5 text-sm font-bold text-black hover:bg-amber-400">
              결과 확인
            </button>
          </div>
        )}
      </div>

      {/* players strip */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {views.map((v) => {
          const pending = showdown ? showdown.res.pulls.filter((p, j) => p.seat === v.seat && t < showdown.tl.pulls[j].fireAt) : [];
          const alive = v.alive || pending.some((p) => p.hit);
          const shots = v.shots - pending.length;
          const active = state.phase === "playing" && state.activeSeat === v.seat;
          return (
            <div
              key={v.seat}
              className={`flex min-w-[5.5rem] shrink-0 flex-col gap-0.5 rounded-lg border px-2 py-1 text-[11px] ${
                active ? "border-amber-300 bg-amber-900/50" : "border-white/10 bg-white/[0.03]"
              } ${alive ? "" : "opacity-40"}`}
            >
              <span className="flex items-center gap-1 truncate font-bold">
                {!connectedSeats.has(v.seat) && alive && <span title="연결 끊김">📡</span>}
                {v.seat === viewerSeat ? "나" : names[v.seat]}
              </span>
              <span className="flex items-center justify-between gap-1 text-amber-100/70">
                {alive ? `🂠${v.handCount}` : "💀 탈락"}
                <Pips shots={Math.max(0, shots)} />
              </span>
            </div>
          );
        })}
      </div>

      {/* my hand + actions */}
      {me?.alive ? (
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/30 p-2">
          <div className="flex items-center justify-between text-[11px] text-amber-100/70">
            <span>
              내 손패 · 진짜 <b className="text-amber-200">{myTrue}</b>장 ({CARD_ART[state.tableSuit].label}+🎭)
            </span>
            <span className="flex items-center gap-1">
              내 리볼버 <Pips shots={me.shots} size="md" /> <span className="text-rose-300">{Math.round(pullDanger(me.shots) * 100)}%</span>
            </span>
          </div>
          <div className="flex min-h-[5.5rem] items-end justify-center gap-1.5">
            {me.hand.length === 0 && <span className="self-center text-xs text-white/40">손패를 모두 냈어요</span>}
            {me.hand.map((c) => {
              const on = selected.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCard(c)}
                  disabled={!isMyTurn || forced}
                  aria-pressed={on}
                  className={`transition ${on ? "-translate-y-3 drop-shadow-[0_0_10px_rgba(251,191,36,0.9)]" : ""} ${isMyTurn && !forced ? "hover:-translate-y-1" : "opacity-80"}`}
                >
                  <CardFace kind={c.kind} className="h-20 w-[57px] sm:h-24 sm:w-[69px]" />
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={playSelected}
              disabled={!isMyTurn || forced || selected.length === 0}
              className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white transition hover:bg-amber-500 disabled:opacity-30"
            >
              {selected.length > 0 ? `${selected.length}장 내기 ("전부 ${CARD_ART[state.tableSuit].label}")` : "카드 1~3장 고르기"}
            </button>
            <button
              type="button"
              onClick={callLiar}
              disabled={!challengeable}
              className={`flex-1 rounded-xl py-2.5 text-sm font-extrabold transition disabled:opacity-30 ${forced ? "animate-pulse bg-rose-600 text-white" : "bg-rose-800 text-rose-50 hover:bg-rose-700"}`}
            >
              거짓말! {prev && challengeable ? `(${names[prev.seat] ?? "상대"} ${prev.cards.length}장)` : ""}
            </button>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-white/10 bg-black/30 p-3 text-center text-xs text-white/50">💀 탈락했어요 — 남은 승부를 관전 중</p>
      )}

      {/* this round's claims */}
      {state.pile.length > 0 && (
        <div className="flex flex-wrap gap-1 text-[10px] text-amber-100/60">
          {state.pile.map((p, i) => (
            <span key={i} className="rounded-full bg-white/5 px-2 py-0.5">
              {names[p.seat] ?? `${p.seat + 1}번`} {p.cards.length}장
            </span>
          ))}
        </div>
      )}

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}
