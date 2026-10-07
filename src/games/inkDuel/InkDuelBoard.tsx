"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeWeapon, ELEMENT_LABEL, INK_COLORS, totalInk, WEAPON_LABEL, type InkColor, type Stroke, type WeaponStats } from "./analyze";
import ArenaCanvas, { CARD_MS, SEAT_COLORS, type ArenaAnim } from "./ArenaCanvas";
import { computeRankings, MAX_ROUNDS, MIN_INK, wallPlacementError, type EngineAction, type InkDuelState, type InkEvent, type SeatIndex } from "./engine";
import { playCardRevealSound, playMyTurnSound, playScribbleTick, playVictorySound, playWallSound } from "./inkDuelAudio";
import WeaponPad, { DoodleSvg } from "./WeaponPad";

export const TURN_SECONDS = 45;

interface Props {
  state: InkDuelState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: ReadonlySet<SeatIndex>;
  onAction: (action: EngineAction) => void;
  /** True while a shot replay is on screen — the host holds bot turns until it finishes. */
  onAnimatingChange?: (animating: boolean) => void;
  onGameEnd: () => void;
}

type Mode = "weapon" | "wall";

const COLOR_NAMES = ["검정", "빨강", "파랑", "초록", "노랑"];

export function WeaponCard({ stats, compact = false }: { stats: WeaponStats; compact?: boolean }) {
  const label = WEAPON_LABEL[stats.kind];
  const rows: [string, string][] = [
    ["피해", `${stats.damage}`],
    ...(stats.blastRadius > 0 ? ([["폭발 반경", `${Math.round(stats.blastRadius)}`]] as [string, string][]) : []),
    ...(stats.chains > 0 ? ([["연쇄", `${stats.chains}회`]] as [string, string][]) : []),
    ["치명타", `${Math.round(stats.critChance * 100)}%`],
    ["속도", `×${stats.speedMul.toFixed(2)}`],
  ];
  return (
    <div className={`flex items-center gap-3 rounded-xl border-2 border-slate-700 bg-[#fffdf6] text-slate-800 shadow-md ${compact ? "p-2" : "p-3"}`}>
      <div className="rounded-lg border border-slate-300 bg-white p-1">
        <DoodleSvg strokes={stats.shape} size={compact ? 56 : 80} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`font-bold ${compact ? "text-sm" : "text-lg"}`}>
          {label.emoji} {label.name}
          {stats.pierce && <span className="ml-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-white">관통</span>}
        </p>
        <p className="text-[11px] text-slate-500">{ELEMENT_LABEL[stats.element]}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
          {rows.map(([k, v]) => (
            <span key={k}>
              <span className="text-slate-500">{k}</span> <b>{v}</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function eventCaption(ev: InkEvent | null, names: Record<SeatIndex, string>): string[] {
  if (!ev) return [];
  const out: string[] = [];
  const who = names[ev.seat] ?? "누군가";
  if (ev.kind === "pass") out.push(`💤 ${who} 님이 턴을 넘겼어요`);
  else if (ev.kind === "wall") out.push(`🧱 ${who} 님이 잉크 벽을 세웠어요`);
  else {
    const w = WEAPON_LABEL[ev.stats.kind];
    if (ev.hits.length === 0) out.push(`${w.emoji} ${who} 님의 ${w.name} — 빗나감!`);
    else
      out.push(
        `${w.emoji} ${who} 님의 ${w.name}${ev.crit ? " (치명타!)" : ""} → ${ev.hits.map((h) => `${names[h.seat] ?? "?"} −${h.dmg}`).join(", ")}`,
      );
    for (const k of ev.killed) out.push(`💀 ${names[k] ?? "?"} 님 탈락`);
  }
  for (const d of ev.dots) out.push(`${d.kind === "burn" ? "🔥 화상" : "☠️ 중독"} ${names[d.seat] ?? "?"} −${d.dmg}`);
  return out;
}

function WindBadge({ wind }: { wind: number }) {
  const strength = Math.round(Math.abs(wind) * 100);
  const arrow = wind === 0 ? "·" : wind > 0 ? "→".repeat(Math.max(1, Math.ceil(strength / 1.5))) : "←".repeat(Math.max(1, Math.ceil(strength / 1.5)));
  return (
    <span className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-slate-300 light:text-slate-600">
      🌬️ 바람 <b className="font-mono">{arrow}</b> {strength}
    </span>
  );
}

export default function InkDuelBoard({ state, viewerSeat, names, connectedSeats, onAction, onAnimatingChange, onGameEnd }: Props) {
  // --- Replay bookkeeping: `shown` lags `state` while a shot animates. ---
  const [shown, setShown] = useState(state);
  const [anim, setAnim] = useState<ArenaAnim | null>(null);
  const [seenSeq, setSeenSeq] = useState(state.seq);
  const latestRef = useRef(state);
  useEffect(() => {
    latestRef.current = state;
  }, [state]);
  if (state.seq !== seenSeq) {
    setSeenSeq(state.seq);
    if (!anim) {
      if (state.lastEvent?.kind === "shot" && state.seq === shown.seq + 1) setAnim({ event: state.lastEvent, base: shown, target: state });
      else setShown(state);
    }
  }
  const handleAnimDone = useCallback(() => {
    setAnim(null);
    setShown(latestRef.current);
  }, []);
  useEffect(() => {
    onAnimatingChange?.(anim !== null);
  }, [anim, onAnimatingChange]);

  const [cardHiddenFor, setCardHiddenFor] = useState<number | null>(null);
  useEffect(() => {
    if (!anim) return;
    playCardRevealSound();
    const id = anim.event.id;
    const t = window.setTimeout(() => setCardHiddenFor(id), CARD_MS);
    return () => window.clearTimeout(t);
  }, [anim]);
  const cardVisible = anim !== null && cardHiddenFor !== anim.event.id;

  // Wall placement sound when a wall event lands on screen.
  const lastWallEventRef = useRef<number | null>(null);
  useEffect(() => {
    const ev = shown.lastEvent;
    if (ev?.kind === "wall" && lastWallEventRef.current !== ev.id) {
      lastWallEventRef.current = ev.id;
      playWallSound();
    }
  }, [shown.lastEvent]);

  // --- Turn drafts (reset every new turn) ---
  const myTurn = !anim && shown.seq === state.seq && state.phase === "playing" && state.turnSeat === viewerSeat;
  const [draftSeq, setDraftSeq] = useState(state.seq);
  const [mode, setMode] = useState<Mode>("weapon");
  const [weapon, setWeapon] = useState<Stroke[]>([]);
  const [wall, setWall] = useState<Stroke[]>([]);
  const [color, setColor] = useState<InkColor>(0);
  const defaultAngle = () => {
    const me = state.players[viewerSeat];
    let nearest: number | null = null;
    for (const p of state.players) if (p.alive && p.seat !== viewerSeat && (nearest === null || Math.abs(p.x - me.x) < Math.abs(nearest - me.x))) nearest = p.x;
    return nearest !== null && nearest < me.x ? 135 : 45;
  };
  const [angle, setAngle] = useState(defaultAngle);
  const [power, setPower] = useState(60);
  const [timeLeft, setTimeLeft] = useState(TURN_SECONDS);
  if (draftSeq !== state.seq) {
    setDraftSeq(state.seq);
    setWeapon([]);
    setWall([]);
    setMode("weapon");
    setAngle(defaultAngle());
    setTimeLeft(TURN_SECONDS);
  }

  const budget = state.inkBudget;
  const activeStrokes = mode === "weapon" ? weapon : wall;
  const inkUsed = totalInk(activeStrokes);
  const stats = useMemo(() => (weapon.length > 0 && totalInk(weapon) >= MIN_INK ? analyzeWeapon(weapon) : null), [weapon]);
  const wallError = wall.length > 0 ? wallPlacementError(state, viewerSeat, wall) : null;

  const submitRef = useRef<() => void>(() => {});
  const submit = (auto = false) => {
    if (!myTurn) return;
    if (mode === "weapon" && stats) onAction({ type: "fire", seat: viewerSeat, strokes: weapon, angle, power });
    else if (mode === "wall" && wall.length > 0 && !wallError && totalInk(wall) >= MIN_INK) onAction({ type: "wall", seat: viewerSeat, strokes: wall });
    else if (auto) {
      if (stats) onAction({ type: "fire", seat: viewerSeat, strokes: weapon, angle, power });
      else onAction({ type: "pass", seat: viewerSeat });
    }
  };
  useEffect(() => {
    submitRef.current = () => submit(true);
  });

  useEffect(() => {
    if (!myTurn) return;
    playMyTurnSound();
    const start = Date.now();
    let fired = false;
    const id = window.setInterval(() => {
      const left = Math.max(0, TURN_SECONDS - Math.floor((Date.now() - start) / 1000));
      setTimeLeft(left);
      if (left <= 0 && !fired) {
        fired = true;
        submitRef.current();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [myTurn, state.seq]);

  // Victory fanfare once the final state is on screen.
  const over = shown.phase === "gameOver" && !anim;
  const fanfareRef = useRef(false);
  useEffect(() => {
    if (over && !fanfareRef.current) {
      fanfareRef.current = true;
      playVictorySound();
    }
  }, [over]);

  const viewState = shown;
  const turnSeat = anim ? anim.event.seat : viewState.phase === "playing" ? viewState.turnSeat : null;
  const captions = eventCaption(viewState.lastEvent, names);
  const rankings = over ? computeRankings(shown) : [];
  const hpShown = anim ? anim.event.hpBefore : viewState.players.map((p) => p.hp);

  return (
    <div className="flex flex-col gap-3">
      {/* HUD */}
      <div className="flex flex-wrap items-center gap-2">
        {viewState.players.map((p) => (
          <div
            key={p.seat}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
              turnSeat === p.seat ? "border-amber-400 bg-amber-400/15 light:bg-amber-50" : "border-white/10 light:border-slate-200"
            } ${p.alive ? "" : "opacity-40 line-through"}`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEAT_COLORS[p.seat % SEAT_COLORS.length] }} />
            <span className="max-w-[7rem] truncate font-semibold text-white light:text-slate-800">
              {names[p.seat]}
              {p.seat === viewerSeat ? " (나)" : ""}
            </span>
            <span className="font-mono text-white/70 light:text-slate-600">♥{Math.round(hpShown[p.seat])}</span>
            {!connectedSeats.has(p.seat) && <span title="연결 끊김">📡</span>}
          </div>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <span className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-slate-300 light:text-slate-600">
            라운드 {Math.min(viewState.round, MAX_ROUNDS)}/{MAX_ROUNDS}
          </span>
          <WindBadge wind={viewState.wind} />
        </span>
      </div>

      {/* Arena */}
      <div className="relative">
        <ArenaCanvas
          view={viewState}
          anim={anim}
          onAnimDone={handleAnimDone}
          names={names}
          turnSeat={turnSeat}
          aim={myTurn && mode === "weapon" ? { seat: viewerSeat, angle, power, speedMul: stats?.speedMul ?? 1 } : null}
          onAim={(a, p) => {
            setAngle(a);
            setPower(p);
          }}
          wallDraft={myTurn && mode === "wall" ? { strokes: wall, color, budget, error: wallError, onChange: setWall } : null}
        />
        {cardVisible && anim && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3">
            <div className="w-full max-w-xs animate-[inkcard_0.35s_ease-out]">
              <p className="mb-1 text-center text-xs font-bold text-slate-700 drop-shadow">{names[anim.event.seat]} 님의 낙서 판정!</p>
              <WeaponCard stats={anim.event.stats} />
            </div>
          </div>
        )}
        {!myTurn && !anim && viewState.phase === "playing" && (
          <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-slate-900/75 px-3 py-1 text-xs text-white">
            ✏️ {names[viewState.turnSeat]} 님이 낙서하는 중…
          </div>
        )}
        {over && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-900/55 p-3">
            <div className="w-full max-w-xs rounded-2xl border-2 border-slate-700 bg-[#fffdf6] p-4 text-center text-slate-800 shadow-xl">
              <p className="text-3xl">🏆</p>
              <p className="mt-1 text-lg font-bold">
                {rankings
                  .filter((r) => r.rank === 1)
                  .map((r) => names[r.seat])
                  .join(", ")}{" "}
                승리!
              </p>
              <ol className="mt-3 space-y-1 text-left text-sm">
                {rankings.map((r) => (
                  <li key={r.seat} className="flex justify-between gap-2">
                    <span>
                      {r.rank}위 {names[r.seat]}
                    </span>
                    <span className="text-xs text-slate-500">
                      가한 피해 {shown.damageDealt[r.seat]} · 최고 {shown.bestHit[r.seat]}
                    </span>
                  </li>
                ))}
              </ol>
              <button onClick={onGameEnd} className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
                결과 확인
              </button>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes inkcard { from { transform: scale(0.6) rotate(-6deg); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>

      {captions.length > 0 && !anim && (
        <div className="flex flex-col gap-0.5 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/80 light:bg-slate-100 light:text-slate-700">
          {captions.map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
      )}

      {/* Turn controls */}
      {myTurn && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/5 p-3 light:bg-amber-50/60">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-amber-300 light:text-amber-700">내 차례!</span>
            <div className="flex rounded-full border border-white/15 p-0.5 light:border-slate-300">
              {(
                [
                  ["weapon", "⚔️ 무기 그리기"],
                  ["wall", "🧱 벽 그리기"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    mode === m ? "bg-amber-500 text-white" : "text-white/60 hover:text-white light:text-slate-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className={`ml-auto font-mono text-sm font-bold ${timeLeft <= 10 ? "text-rose-400" : "text-white/70 light:text-slate-600"}`}>⏱ {timeLeft}s</span>
          </div>

          {/* Ink gauge + palette */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-[10rem] flex-1 items-center gap-2">
              <span className="text-xs text-white/60 light:text-slate-500">🖋️ 잉크</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
                <div className="h-full rounded-full bg-slate-300 transition-all light:bg-slate-700" style={{ width: `${Math.max(0, 100 - (inkUsed / budget) * 100)}%` }} />
              </div>
              <span className="font-mono text-xs text-white/70 light:text-slate-600">
                {Math.max(0, Math.floor(budget - inkUsed))}/{budget}
              </span>
            </div>
            <div className="flex gap-1.5">
              {INK_COLORS.map((c, i) => (
                <button
                  key={c}
                  title={COLOR_NAMES[i]}
                  onClick={() => setColor(i as InkColor)}
                  className={`h-7 w-7 rounded-full border-2 transition ${color === i ? "scale-110 border-amber-400" : "border-white/20 light:border-slate-300"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => (mode === "weapon" ? setWeapon((s) => s.slice(0, -1)) : setWall((s) => s.slice(0, -1)))}
                className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-slate-300 light:text-slate-600"
              >
                ↶ 되돌리기
              </button>
              <button
                onClick={() => (mode === "weapon" ? setWeapon([]) : setWall([]))}
                className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-slate-300 light:text-slate-600"
              >
                🗑 지우기
              </button>
            </div>
          </div>

          {mode === "weapon" ? (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr]">
              <div className="mx-auto w-full max-w-[220px]">
                <WeaponPad strokes={weapon} color={color} budget={budget} onChange={setWeapon} onScribble={playScribbleTick} />
                <p className="mt-1 text-center text-[10px] text-white/40 light:text-slate-400">곧은 선=창 · 닫힌 도형=폭탄 · 지그재그=번개 · 색=속성</p>
              </div>
              <div className="flex flex-col gap-2">
                {stats ? (
                  <>
                    <WeaponCard stats={stats} compact />
                    <p className="text-[11px] text-white/50 light:text-slate-500">{WEAPON_LABEL[stats.kind].hint}</p>
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/20 p-4 text-center text-xs text-white/50 light:border-slate-300 light:text-slate-500">
                    왼쪽 공책에 무기를 그려보세요 ✏️
                  </div>
                )}
                <label className="flex items-center gap-2 text-xs text-white/70 light:text-slate-600">
                  <span className="w-10">각도</span>
                  <input type="range" min={0} max={180} value={angle} onChange={(e) => setAngle(Number(e.target.value))} className="flex-1 accent-amber-500" style={{ direction: "rtl" }} />
                  <span className="w-10 text-right font-mono">{angle}°</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-white/70 light:text-slate-600">
                  <span className="w-10">힘</span>
                  <input type="range" min={10} max={100} value={power} onChange={(e) => setPower(Number(e.target.value))} className="flex-1 accent-amber-500" />
                  <span className="w-10 text-right font-mono">{power}</span>
                </label>
                <p className="text-[10px] text-white/40 light:text-slate-400">경기장을 드래그해서 조준할 수도 있어요 (점선은 궤적의 앞부분만 보여줘요)</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => onAction({ type: "pass", seat: viewerSeat })}
                    className="rounded-xl border border-white/15 px-3 py-2.5 text-xs text-white/60 light:border-slate-300 light:text-slate-500"
                  >
                    패스
                  </button>
                  <button
                    disabled={!stats}
                    onClick={() => submit()}
                    className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    🚀 발사!
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-white/60 light:text-slate-500">
                경기장 위 파란 영역 안에 직접 선을 그어 벽을 세우세요. 벽 내구도 = 사용한 잉크. 창은 벽을 관통하고, 폭탄은 벽을 부숴요.
              </p>
              {wallError && <p className="text-xs font-semibold text-rose-400">⚠️ {wallError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => onAction({ type: "pass", seat: viewerSeat })}
                  className="rounded-xl border border-white/15 px-3 py-2.5 text-xs text-white/60 light:border-slate-300 light:text-slate-500"
                >
                  패스
                </button>
                <button
                  disabled={wall.length === 0 || !!wallError || totalInk(wall) < MIN_INK}
                  onClick={() => submit()}
                  className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  🧱 벽 세우기
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
