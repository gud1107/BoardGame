"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeWeapon, ELEMENT_LABEL, totalInk, WEAPON_LABEL, type InkColor, type Stroke, type WeaponStats } from "./analyze";
import ArenaCanvas, { CARD_MS, CharacterAvatar, type ArenaAnim } from "./ArenaCanvas";
import { characterFor } from "./arenaArt";
import {
  applyMove,
  computeRankings,
  maxMoveFor,
  MAX_ROUNDS,
  MIN_INK,
  moveInk,
  resolveMove,
  SHIELD_GUARD,
  shieldWall,
  wallPlacementError,
  type EngineAction,
  type InkDuelState,
  type InkEvent,
  type SeatIndex,
} from "./engine";
import { playCardRevealSound, playMyTurnSound, playScribbleTick, playVictorySound, playWallSound } from "./inkDuelAudio";
import WeaponPad, { DoodleSvg, InkPalette } from "./WeaponPad";
import { MAPS } from "./maps";
import { activeStatuses, STATUS_INFO } from "./status";

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

type Mode = "weapon" | "wall" | "shield";

const ELEMENT_CARD: Record<WeaponStats["element"], { from: string; to: string; foil: string }> = {
  none: { from: "#475569", to: "#1e293b", foil: "#cbd5e1" },
  fire: { from: "#f97316", to: "#b91c1c", foil: "#fde68a" },
  ice: { from: "#38bdf8", to: "#1d4ed8", foil: "#e0f2fe" },
  poison: { from: "#22c55e", to: "#15803d", foil: "#dcfce7" },
  shock: { from: "#facc15", to: "#ca8a04", foil: "#fef9c3" },
  slow: { from: "#22d3ee", to: "#0e7490", foil: "#cffafe" },
  stun: { from: "#b45309", to: "#78350f", foil: "#fde68a" },
  curse: { from: "#a855f7", to: "#6b21a8", foil: "#f3e8ff" },
  crush: { from: "#fb923c", to: "#c2410c", foil: "#ffedd5" },
  vampire: { from: "#f472b6", to: "#be185d", foil: "#fce7f3" },
  chaos: { from: "#cbd5e1", to: "#64748b", foil: "#f1f5f9" },
  dark: { from: "#4338ca", to: "#1e1b4b", foil: "#e0e7ff" },
};

function StatBar({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="w-9 shrink-0 text-slate-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-500" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
      <b className="w-8 shrink-0 text-right font-mono text-slate-700">{text}</b>
    </div>
  );
}

/** Trading-card style readout of a doodle's weapon stats. */
export function WeaponCard({ stats, compact = false }: { stats: WeaponStats; compact?: boolean }) {
  const label = WEAPON_LABEL[stats.kind];
  const theme = ELEMENT_CARD[stats.element];
  const traits = [
    stats.element2 ? `+ ${ELEMENT_LABEL[stats.element2].split(" (")[0]}` : null,
    stats.bounces > 0 ? `튕김 ${stats.bounces}회` : null,
    stats.dig > 0 ? "땅 파고들기" : null,
    stats.knockback > 0 ? `밀쳐내기 ${stats.knockback}` : null,
    stats.pellets > 0 ? `산탄 ${stats.pellets}발` : null,
    stats.returnAcc > 0 ? "되돌아옴" : null,
    stats.gravityMul < 0.5 && stats.returnAcc === 0 ? "중력 ↓" : null,
    stats.gravityMul > 1.5 ? "무거움" : null,
  ].filter((t): t is string => t !== null);
  const bars = (
    <div className="flex flex-col gap-1">
      <StatBar label="피해" value={stats.damage} max={40} text={`${stats.damage}`} />
      {stats.blastRadius > 0 && <StatBar label="폭발" value={stats.blastRadius} max={80} text={`${Math.round(stats.blastRadius)}`} />}
      {stats.chains > 0 && <StatBar label="연쇄" value={stats.chains} max={4} text={`${stats.chains}회`} />}
      <StatBar label="치명타" value={stats.critChance} max={0.45} text={`${Math.round(stats.critChance * 100)}%`} />
      <StatBar label="속도" value={stats.speedMul} max={1.35} text={`×${stats.speedMul.toFixed(2)}`} />
      {traits.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-1">
          {traits.map((t) => (
            <span key={t} className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold text-white">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
  const art = (size: number) => (
    <div
      className="relative overflow-hidden rounded-lg border-2 border-white/80 shadow-inner"
      style={{ background: `radial-gradient(circle at 30% 25%, ${theme.foil}, #fffdf6 70%)` }}
    >
      <DoodleSvg strokes={stats.shape} size={size} />
      <div className="pointer-events-none absolute inset-0 animate-[inkfoil_2.6s_linear_infinite] bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,0.75)_50%,transparent_65%)] bg-[length:250%_100%]" />
    </div>
  );
  if (compact) {
    return (
      <div className="flex items-stretch gap-2.5 rounded-xl p-[3px] shadow-md" style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}>
        <div className="hidden p-0.5 sm:block">{art(60)}</div>
        <div className="min-w-0 flex-1 rounded-[10px] bg-[#fffdf6] p-2 text-slate-800 sm:rounded-l-none">
          <p className="flex items-center gap-1 text-sm font-black">
            <span className="text-base">{label.emoji}</span> {label.name}
            {stats.pierce && <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-white">관통</span>}
            <span className="ml-auto truncate text-[10px] font-semibold text-slate-500">{ELEMENT_LABEL[stats.element].split(" (")[0]}</span>
          </p>
          <div className="mt-1">{bars}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl p-[4px] shadow-2xl" style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}>
      <div className="rounded-[13px] bg-[#fffdf6] p-3 text-slate-800">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full text-xl shadow" style={{ background: theme.foil }}>
            {label.emoji}
          </span>
          <div className="min-w-0">
            <p className="text-lg leading-tight font-black">
              {label.name}
              {stats.pierce && <span className="ml-1.5 rounded bg-slate-800 px-1.5 py-0.5 align-middle text-[10px] text-white">관통</span>}
            </p>
            <p className="text-[11px] text-slate-500">{ELEMENT_LABEL[stats.element]}</p>
          </div>
        </div>
        <div className="flex gap-3">
          {art(88)}
          <div className="min-w-0 flex-1 self-center">{bars}</div>
        </div>
      </div>
    </div>
  );
}

function eventCaption(ev: InkEvent | null, names: Record<SeatIndex, string>): string[] {
  if (!ev) return [];
  const out: string[] = [];
  const who = names[ev.seat] ?? "누군가";
  if (ev.move) out.push(`🚶 ${who} 님이 ${ev.move.to > ev.move.from ? "오른쪽" : "왼쪽"}으로 ${Math.abs(ev.move.to - ev.move.from)}px 이동`);
  if (ev.kind === "pass") out.push(`💤 ${who} 님이 턴을 넘겼어요`);
  else if (ev.kind === "wall") out.push(`🧱 ${who} 님이 잉크 벽을 세웠어요`);
  else if (ev.kind === "shield") out.push(`🛡️ ${who} 님이 방패를 세웠어요`);
  else {
    const w = WEAPON_LABEL[ev.stats.kind];
    if (ev.shieldWallId !== undefined) out.push(`🛡️ ${who} 님이 가벼운 방패를 세우고 쐈어요`);
    if (ev.caught) out.push(`🪃 ${who} 님의 부메랑이 돌아와 손에 쏙! (빗나감)`);
    else if (ev.hits.length === 0) out.push(`${w.emoji} ${who} 님의 ${w.name} — 빗나감!`);
    else
      out.push(
        `${w.emoji} ${who} 님의 ${w.name}${ev.crit ? " (치명타!)" : ""} → ${ev.hits.map((h) => `${names[h.seat] ?? "?"} −${h.dmg}`).join(", ")}`,
      );
    if (ev.confusedAngle !== undefined) out.push(`😵 혼란! ${who} 님의 조준이 ${ev.confusedAngle}°로 빗나갔어요`);
    if (ev.bentPower !== undefined) out.push(`🐌/🕶️ ${who} 님의 발사 힘이 ${ev.bentPower}(으)로 흐트러졌어요`);
    for (const inf of ev.inflicted ?? []) out.push(`${names[inf.seat] ?? "?"} → ${inf.statuses.map((s) => `${STATUS_INFO[s].emoji} ${STATUS_INFO[s].name}`).join(" · ")}`);
    if (ev.heal > 0) out.push(`🩷 흡혈! ${who} 님 +${ev.heal}`);
    for (const k of ev.killed) out.push(`💀 ${names[k] ?? "?"} 님 탈락`);
  }
  for (const d of ev.dots) {
    if (d.kind === "stun") out.push(`💫 ${names[d.seat] ?? "?"} 님은 기절해서 이번 턴을 쉬어요`);
    else out.push(`${d.kind === "burn" ? "🔥 화상" : "☠️ 중독"} ${names[d.seat] ?? "?"} −${d.dmg}`);
  }
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
    if ((ev?.kind === "wall" || ev?.kind === "shield") && lastWallEventRef.current !== ev.id) {
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
  const [shield, setShield] = useState<Stroke[]>([]);
  const [shieldAngle, setShieldAngle] = useState(() => (state.players[viewerSeat] && state.players.some((p) => p.alive && p.seat !== viewerSeat && p.x < state.players[viewerSeat].x) ? 150 : 30));
  const [color, setColor] = useState<InkColor>(0);
  const defaultAngle = () => {
    const me = state.players[viewerSeat];
    let nearest: number | null = null;
    for (const p of state.players) if (p.alive && p.seat !== viewerSeat && (nearest === null || Math.abs(p.x - me.x) < Math.abs(nearest - me.x))) nearest = p.x;
    return nearest !== null && nearest < me.x ? 135 : 45;
  };
  const [angle, setAngle] = useState(defaultAngle);
  const [power, setPower] = useState(60);
  const turnSeconds = state.rules?.turnSeconds ?? TURN_SECONDS;
  const [timeLeft, setTimeLeft] = useState(turnSeconds);
  const [walk, setWalk] = useState(0);
  if (draftSeq !== state.seq) {
    setDraftSeq(state.seq);
    setWeapon([]);
    setWall([]);
    setShield([]);
    setMode("weapon");
    setAngle(defaultAngle());
    setShieldAngle(defaultAngle() > 90 ? 150 : 30);
    setTimeLeft(turnSeconds);
    setWalk(0);
  }

  // Everything this turn is previewed from where the walk would leave me (ink already deducted).
  const preview = useMemo(() => (walk !== 0 && state.phase === "playing" ? (applyMove(state, viewerSeat, walk) ?? state) : state), [state, viewerSeat, walk]);
  const budget = preview.inkBudget;
  const activeStrokes = mode === "weapon" ? weapon : mode === "shield" ? shield : wall;
  const setActive = mode === "weapon" ? setWeapon : mode === "shield" ? setShield : setWall;
  const weaponInk = totalInk(weapon);
  const shieldInk = totalInk(shield);
  // Weapon + shield share the turn's ink (they can go up together); a wall is on its own.
  const inkUsed = mode === "wall" ? totalInk(activeStrokes) : weaponInk + shieldInk;
  const stats = useMemo(() => (weapon.length > 0 && totalInk(weapon) >= MIN_INK ? analyzeWeapon(weapon) : null), [weapon]);
  const wallError = wall.length > 0 ? wallPlacementError(preview, viewerSeat, wall) : null;
  const shieldReady = shield.length > 0 && totalInk(shield) >= MIN_INK;
  const shieldPreview = useMemo(() => (shieldReady ? shieldWall(preview, viewerSeat, shield, shieldAngle) : null), [shieldReady, preview, viewerSeat, shield, shieldAngle]);
  const shieldGuardPct = Math.round(Math.min(1, shieldInk / 100) * (1 - SHIELD_GUARD) * 100);
  const withShield = shieldReady ? { shield: { strokes: shield, angle: shieldAngle } } : {};
  const walked = preview.players[viewerSeat].x - state.players[viewerSeat].x;
  const canWalk = (next: number) => {
    if (Math.abs(next) > maxMoveFor(state, viewerSeat)) return false;
    const to = resolveMove(state, viewerSeat, next);
    return moveInk(state.players[viewerSeat].x, to) * (iAmSlow ? 2 : 1) + inkUsed <= state.inkBudget;
  };
  const withWalk = <A extends EngineAction>(a: A): A => (walk !== 0 ? { ...a, move: walk } : a);
  const myStatus = state.players[viewerSeat]?.status ?? {};
  const iAmSlow = (myStatus.slow ?? 0) > 0;
  const iAmBlind = (myStatus.blind ?? 0) > 0;

  const submitRef = useRef<() => void>(() => {});
  const submit = (auto = false) => {
    if (!myTurn) return;
    if (mode === "weapon" && stats) onAction(withWalk({ type: "fire", seat: viewerSeat, strokes: weapon, angle, power, ...withShield }));
    else if (mode === "wall" && wall.length > 0 && !wallError && totalInk(wall) >= MIN_INK) onAction(withWalk({ type: "wall", seat: viewerSeat, strokes: wall }));
    else if (mode === "shield" && shieldReady) onAction(withWalk({ type: "shield", seat: viewerSeat, strokes: shield, angle: shieldAngle }));
    else if (auto) {
      if (stats) onAction(withWalk({ type: "fire", seat: viewerSeat, strokes: weapon, angle, power, ...withShield }));
      else onAction(withWalk({ type: "pass", seat: viewerSeat }));
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
      const left = Math.max(0, turnSeconds - Math.floor((Date.now() - start) / 1000));
      setTimeLeft(left);
      if (left <= 0 && !fired) {
        fired = true;
        submitRef.current();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [myTurn, state.seq, turnSeconds]);

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
  const charOf = (seat: SeatIndex) => state.characters?.[seat] ?? seat;
  const mapInfo = MAPS[state.map ?? "meadow"];

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
            <span className="-my-1 -ml-1.5 rounded-full p-0.5" style={{ background: characterFor(charOf(p.seat)).light }} title={characterFor(charOf(p.seat)).name}>
              <CharacterAvatar char={charOf(p.seat)} size={26} dead={!p.alive} />
            </span>
            <span className="max-w-[7rem] truncate font-semibold text-white light:text-slate-800">
              {names[p.seat]}
              {p.seat === viewerSeat ? " (나)" : ""}
            </span>
            <span className="font-mono text-white/70 light:text-slate-600">♥{Math.round(hpShown[p.seat])}</span>
            {activeStatuses(p.status).length > 0 && (
              <span title={activeStatuses(p.status).map((s) => STATUS_INFO[s].name).join(", ")}>{activeStatuses(p.status).map((s) => STATUS_INFO[s].emoji).join("")}</span>
            )}
            {!connectedSeats.has(p.seat) && <span title="연결 끊김">📡</span>}
          </div>
        ))}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-slate-300 light:text-slate-600" title={mapInfo.rule}>
            {mapInfo.emoji} {mapInfo.name}
          </span>
          <span className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-slate-300 light:text-slate-600">
            라운드 {Math.min(viewState.round, viewState.rules?.rounds ?? MAX_ROUNDS)}/{viewState.rules?.rounds ?? MAX_ROUNDS}
          </span>
          {myTurn && iAmBlind ? (
            <span className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-slate-300 light:text-slate-600">🕶️ 바람 ???</span>
          ) : (
            <WindBadge wind={viewState.wind} />
          )}
        </span>
      </div>

      {/* Arena */}
      <div className="relative">
        <ArenaCanvas
          view={myTurn ? preview : viewState}
          anim={anim}
          onAnimDone={handleAnimDone}
          names={names}
          turnSeat={turnSeat}
          walkFrom={myTurn && walked !== 0 ? { seat: viewerSeat, x: state.players[viewerSeat].x } : null}
          aim={myTurn && mode !== "wall" ? { seat: viewerSeat, angle: mode === "shield" ? shieldAngle : angle, power, speedMul: stats?.speedMul ?? 1, noArc: mode === "shield" || iAmBlind } : null}
          shieldPreview={myTurn && shieldPreview && mode !== "wall" ? (mode === "weapon" ? { ...shieldPreview, light: true } : shieldPreview) : null}
          onAim={(a, p) => {
            if (mode === "shield") {
              setShieldAngle(a);
              return;
            }
            setAngle(a);
            setPower(p);
          }}
          wallDraft={myTurn && mode === "wall" ? { strokes: wall, color, budget, error: wallError, onChange: setWall } : null}
        />
        {cardVisible && anim && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3">
            <div className="w-full max-w-xs animate-[inkcard_0.5s_cubic-bezier(.2,.9,.3,1.3)]">
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
              <div className="flex justify-center gap-1">
                {rankings
                  .filter((r) => r.rank === 1)
                  .map((r) => (
                    <span key={r.seat} className="animate-[inkwin_0.9s_ease-in-out_infinite_alternate]">
                      <CharacterAvatar char={charOf(r.seat)} size={64} />
                    </span>
                  ))}
              </div>
              <p className="text-2xl">🏆</p>
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
                    <span className="flex items-center gap-1.5">
                      <b className="w-6">{r.rank}위</b>
                      <CharacterAvatar char={charOf(r.seat)} size={22} dead={r.rank > 1} />
                      {names[r.seat]}
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
      <style>{`
        @keyframes inkcard { 0% { transform: scale(0.4) rotate(-14deg); opacity: 0 } 60% { transform: scale(1.06) rotate(2deg); opacity: 1 } 100% { transform: none } }
        @keyframes inkfoil { from { background-position: 150% 0 } to { background-position: -100% 0 } }
        @keyframes inkwin { from { transform: translateY(0) rotate(-4deg) } to { transform: translateY(-6px) rotate(4deg) } }
      `}</style>

      {captions.length > 0 && !anim && (
        <div className="flex flex-col gap-0.5 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/80 light:bg-slate-100 light:text-slate-700">
          {captions.map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
      )}

      {/* Turn controls */}
      {myTurn && (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-400/40 bg-amber-400/5 p-2.5 sm:gap-3 sm:p-3 light:bg-amber-50/60">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-amber-300 light:text-amber-700">내 차례!</span>
            <div className="flex rounded-full border border-white/15 p-0.5 light:border-slate-300">
              {(
                [
                  ["weapon", "⚔️ 무기", " 그리기"],
                  ["shield", "🛡️ 방패", ""],
                  ["wall", "🧱 벽", " 그리기"],
                ] as const
              ).map(([m, label, more]) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition sm:px-3 ${
                    mode === m ? "bg-amber-500 text-white" : "text-white/60 hover:text-white light:text-slate-600"
                  }`}
                >
                  {label}
                  <span className="hidden sm:inline">{more}</span>
                </button>
              ))}
            </div>
            <span className={`ml-auto font-mono text-sm font-bold ${timeLeft <= 10 ? "text-rose-400" : "text-white/70 light:text-slate-600"}`}>⏱ {timeLeft}s</span>
          </div>

          {/* Walk: spend ink to reposition before acting */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/70 light:text-slate-600">
            <span>🚶 이동</span>
            {(
              [
                [-20, "◀◀"],
                [-10, "◀"],
                [10, "▶"],
                [20, "▶▶"],
              ] as const
            ).map(([d, label]) => (
              <button
                key={label}
                disabled={!canWalk(walk + d)}
                onClick={() => setWalk((w) => w + d)}
                className="min-w-[2rem] rounded-lg border border-white/15 px-1.5 py-0.5 font-mono transition hover:border-white/30 disabled:opacity-30 sm:min-w-[2.25rem] sm:px-2 sm:py-1 light:border-slate-300"
              >
                {label}
              </button>
            ))}
            <span className="font-mono">
              {walked === 0 ? "제자리" : `${walked > 0 ? "→" : "←"} ${Math.abs(walked)}px`}
              {walked !== 0 && <span className="text-white/45 light:text-slate-400"> (잉크 −{moveInk(0, walked)})</span>}
            </span>
            {walk !== 0 && (
              <button onClick={() => setWalk(0)} className="rounded-lg px-2 py-1 text-white/50 underline light:text-slate-500">
                되돌리기
              </button>
            )}
            {walk !== 0 && walked !== walk && <span className="text-amber-300 light:text-amber-700">벽이나 상대에 막혔어요</span>}
          </div>

          {/* Ink gauge + palette */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex w-full items-center gap-2 sm:w-auto sm:min-w-[10rem] sm:flex-1">
              <span className="text-xs text-white/60 light:text-slate-500">🖋️ 잉크</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
                <div className="h-full rounded-full bg-slate-300 transition-all light:bg-slate-700" style={{ width: `${Math.max(0, 100 - (inkUsed / budget) * 100)}%` }} />
              </div>
              <span className="font-mono text-xs text-white/70 light:text-slate-600">
                {Math.max(0, Math.floor(budget - inkUsed))}/{budget}
              </span>
            </div>
            <InkPalette color={color} onChange={setColor} />
            <div className="ml-auto flex gap-1.5 sm:ml-0">
              <button
                title="되돌리기"
                onClick={() => setActive((s) => s.slice(0, -1))}
                className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-slate-300 light:text-slate-600"
              >
                ↶<span className="hidden sm:inline"> 되돌리기</span>
              </button>
              <button
                title="지우기"
                onClick={() => setActive([])}
                className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 light:border-slate-300 light:text-slate-600"
              >
                🗑<span className="hidden sm:inline"> 지우기</span>
              </button>
            </div>
          </div>

          {mode !== "wall" ? (
            <div className="grid grid-cols-[minmax(0,44%)_1fr] gap-2 sm:grid-cols-[minmax(0,220px)_1fr] sm:gap-3">
              <div className="w-full max-w-[220px]">
                <WeaponPad
                  strokes={mode === "shield" ? shield : weapon}
                  color={color}
                  budget={mode === "shield" ? budget - weaponInk : budget - shieldInk}
                  onChange={mode === "shield" ? setShield : setWeapon}
                  onScribble={playScribbleTick}
                />
                <p className="mt-1 hidden text-center text-[10px] text-white/40 sm:block light:text-slate-400">
                  {mode === "shield" ? "그린 모양이 그대로 방패가 돼요" : "선·원·세모·네모·별·지그재그·C자·소용돌이·S자·점점이 — 모양마다 다른 무기, 두 색을 섞으면 효과 2개"}
                </p>
              </div>
              {mode === "shield" ? (
                <div className="flex flex-col gap-2">
                  <div className="rounded-xl border border-sky-400/40 bg-sky-400/10 p-2.5 text-xs text-white/80 light:bg-sky-50 light:text-slate-700">
                    <p className="font-bold">🛡️ 방패</p>
                    <p className="mt-0.5 text-[11px] text-white/60 light:text-slate-500">
                      그린 모양이 내 옆에 서요. 받는 피해가 잉크에 비례해 줄어요 (잉크 100 = −{Math.round((1 - SHIELD_GUARD) * 100)}%).
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-white/60 light:text-slate-500">
                      <li>
                        <b>방패만 세우기</b>: 턴을 쓰는 대신 단단해서 날아오는 공격을 막아요
                      </li>
                      <li>
                        <b>⚔️ 무기 탭에서 그리고 쏘기</b>: 같은 턴에 쏠 수 있지만 가벼운 방패라 공격은 통과하고 피해만 줄어요
                      </li>
                    </ul>
                    {shieldPreview && (
                      <p className="mt-1 font-mono text-[11px]">
                        내구도 {shieldPreview.hp} · 피해 −{shieldGuardPct}%
                      </p>
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-white/70 light:text-slate-600">
                    <span className="w-7 shrink-0 sm:w-10">방향</span>
                    <input type="range" min={0} max={180} value={shieldAngle} onChange={(e) => setShieldAngle(Number(e.target.value))} className="min-w-0 flex-1 accent-sky-500" style={{ direction: "rtl" }} />
                    <span className="w-10 text-right font-mono">{shieldAngle}°</span>
                  </label>
                  <p className="hidden text-[10px] text-white/40 sm:block light:text-slate-400">경기장을 드래그해서 방패 방향을 정할 수도 있어요</p>
                  <div className="mr-14 flex gap-2 sm:mr-0">
                    <button
                      onClick={() => onAction(withWalk({ type: "pass", seat: viewerSeat }))}
                      className="rounded-xl border border-white/15 px-2.5 py-2.5 text-xs text-white/60 sm:px-3 light:border-slate-300 light:text-slate-500"
                    >
                      패스
                    </button>
                    <button
                      disabled={!shieldReady}
                      onClick={() => submit()}
                      className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      🛡️ 방패만 세우기
                    </button>
                  </div>
                </div>
              ) : (
              <div className="flex flex-col gap-2">
                {stats ? (
                  <>
                    <WeaponCard stats={stats} compact />
                    <p className="hidden text-[11px] text-white/50 sm:block light:text-slate-500">{WEAPON_LABEL[stats.kind].hint}</p>
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/20 p-3 text-center text-xs text-white/50 sm:p-4 light:border-slate-300 light:text-slate-500">
                    ← 공책에 무기를 그려보세요 ✏️
                    <span className="mt-1 block text-[10px] sm:hidden">선·원·세모·네모·별·지그재그·C자·소용돌이·S자·점점이</span>
                  </div>
                )}
                {shieldReady && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-400/40 bg-sky-400/10 px-2 py-1 text-[11px] text-white/80 light:bg-sky-50 light:text-slate-700">
                    <span>
                      🛡️ 가벼운 방패도 함께 (잉크 −{Math.ceil(shieldInk)} · 피해 −{shieldGuardPct}%)
                    </span>
                    <button type="button" onClick={() => setShield([])} className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] light:border-slate-300">
                      빼기
                    </button>
                  </div>
                )}
                <label className="flex items-center gap-2 text-xs text-white/70 light:text-slate-600">
                  <span className="w-7 shrink-0 sm:w-10">각도</span>
                  <input type="range" min={0} max={180} value={angle} onChange={(e) => setAngle(Number(e.target.value))} className="min-w-0 flex-1 accent-amber-500" style={{ direction: "rtl" }} />
                  <span className="w-10 text-right font-mono">{angle}°</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-white/70 light:text-slate-600">
                  <span className="w-7 shrink-0 sm:w-10">힘</span>
                  <input type="range" min={10} max={100} value={power} onChange={(e) => setPower(Number(e.target.value))} className="min-w-0 flex-1 accent-amber-500" />
                  <span className="w-10 text-right font-mono">{power}</span>
                </label>
                <p className="hidden text-[10px] text-white/40 sm:block light:text-slate-400">경기장을 드래그해서 조준할 수도 있어요 (점선은 궤적의 앞부분만 보여줘요)</p>
                <div className="mr-14 flex gap-2 sm:mr-0">
                  <button
                    onClick={() => onAction(withWalk({ type: "pass", seat: viewerSeat }))}
                    className="rounded-xl border border-white/15 px-2.5 py-2.5 text-xs text-white/60 sm:px-3 light:border-slate-300 light:text-slate-500"
                  >
                    패스
                  </button>
                  <button
                    disabled={!stats}
                    onClick={() => submit()}
                    className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {shieldReady ? "🛡️+🚀 발사!" : "🚀 발사!"}
                  </button>
                </div>
              </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-white/60 light:text-slate-500">
                경기장 위 파란 영역 안에 직접 선을 그어 벽을 세우세요. 벽 내구도 = 사용한 잉크. 창은 벽을 관통하고, 폭탄은 벽을 부숴요.
              </p>
              {wallError && <p className="text-xs font-semibold text-rose-400">⚠️ {wallError}</p>}
              <div className="mr-14 flex gap-2 sm:mr-0">
                <button
                  onClick={() => onAction(withWalk({ type: "pass", seat: viewerSeat }))}
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
      {/* Room to scroll the action buttons above the site's floating 🎲 / bug-report buttons on phones. */}
      {myTurn && <div aria-hidden className="h-16 sm:hidden" />}
    </div>
  );
}
