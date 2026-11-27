"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { Frame3D, Loading3D, preferLowDetail, useBoardView, ViewToggle } from "@/games/shared/three/viewPref";
import { resolveLook } from "@/lib/character/avatar";
import { roomCharacterOf, useRoomCharacters } from "@/lib/character/roomCharacters";
import { ROLES, ROLE_BY_ID, SCENE_COUNT, STATS, TRAITS, type Fx, type RoleDef, type SetId } from "./data";
import {
  choicesFor,
  clapsOf,
  computeRankings,
  endingFor,
  lifeScoreOf,
  pendingSeats,
  phaseDurationMs,
  SCORE_PER_CLAP,
  STAT_MAX,
  type EngineAction,
  type GameState,
  type LogEntry,
  type Seat,
} from "./engine";
import { getLifeSkitSound, lifeSkitCues, lifeSkitIntensity } from "./lifeSkitSound";
import RulebookModal from "./RulebookModal";
import type { StageMood } from "./three/SkitStage3D";

const SkitStage3D = dynamic(() => import("./three/SkitStage3D"), { ssr: false, loading: () => <Loading3D label="🎬 무대를 세우는 중…" /> });

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const SUB = "text-white/55 light:text-slate-500";
export const SEAT_COLORS = ["#f87171", "#60a5fa", "#a3e635", "#fbbf24", "#c084fc", "#2dd4bf", "#fb923c", "#f472b6"];
export const SEAT_MARKS = ["●", "◆", "▲", "■", "★", "✚", "⬟", "♥"];

export const SET_META: Record<SetId, { name: string; emoji: string; from: string; to: string }> = {
  hut: { name: "초가집 마당", emoji: "🛖", from: "#1b2a55", to: "#5a4a2e" },
  hanok: { name: "양반댁 대청", emoji: "🏯", from: "#5f8fb5", to: "#7a4f2c" },
  palace: { name: "궁궐", emoji: "👑", from: "#7a1a1a", to: "#1c3f73" },
  market: { name: "장터", emoji: "🧺", from: "#c98a3c", to: "#7a5a34" },
  office: { name: "사무실", emoji: "🏢", from: "#5b7fa6", to: "#3a4656" },
  home: { name: "집", emoji: "🛋️", from: "#c98a5e", to: "#4f7396" },
  school: { name: "교실", emoji: "🏫", from: "#2f6b4f", to: "#8a6238" },
  street: { name: "밤거리", emoji: "🌃", from: "#141a3a", to: "#5a2f6e" },
  stage: { name: "무대", emoji: "🎤", from: "#3a0f5e", to: "#b0306a" },
};

interface Props {
  state: GameState;
  /** -1 = 관전(봇이 대신 두는 중) */
  viewerSeat: number;
  names: Record<Seat, string>;
  botSeats: ReadonlySet<Seat>;
  connectedSeats: ReadonlySet<Seat>;
  phaseStart: number;
  nowMs: number;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

function SeatChip({ seat }: { seat: Seat }) {
  return (
    <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white" style={{ background: SEAT_COLORS[seat % 8], textShadow: "0 1px 1px rgba(0,0,0,.6)" }}>
      {SEAT_MARKS[seat % 8]}
    </span>
  );
}

/** 수치 변화 칩: +2 💰 */
function FxChips({ fx, size = "md" }: { fx: Fx; size?: "sm" | "md" }) {
  const items = fx.map((v, i) => ({ v, i })).filter((x) => x.v !== 0);
  if (items.length === 0) return <span className={`text-xs ${SUB}`}>변화 없음</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {items.map(({ v, i }) => (
        <span
          key={i}
          className={`inline-flex items-center gap-0.5 rounded-full border font-black ${size === "sm" ? "px-1.5 py-px text-[11px]" : "px-2 py-0.5 text-xs"} ${
            v > 0 ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200 light:text-emerald-700" : "border-rose-400/50 bg-rose-500/15 text-rose-200 light:text-rose-700"
          }`}
        >
          {STATS[i].emoji}
          <span aria-label={`${STATS[i].name} ${v > 0 ? "증가" : "감소"}`}>{v > 0 ? `▲${v}` : `▼${-v}`}</span>
        </span>
      ))}
    </span>
  );
}

function StatBars({ stats, delta }: { stats: Fx; delta?: Fx }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
      {STATS.map((s, i) => (
        <div key={s.key} className="min-w-0">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="font-bold text-white/80 light:text-slate-700">
              {s.emoji} {s.name}
            </span>
            <span className="font-black text-white tabular-nums light:text-slate-900">
              {stats[i]}
              {delta && delta[i] !== 0 && <span className={delta[i] > 0 ? "ml-1 text-emerald-300 light:text-emerald-600" : "ml-1 text-rose-300 light:text-rose-600"}>{delta[i] > 0 ? `+${delta[i]}` : delta[i]}</span>}
            </span>
          </div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
            <div className="h-full rounded-full bg-amber-400 transition-[width] duration-500" style={{ width: `${(stats[i] / STAT_MAX) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TraitChips({ tags, fresh = [] }: { tags: readonly string[]; fresh?: readonly string[] }) {
  if (tags.length === 0) return <span className={`text-[11px] ${SUB}`}>아직 굳은 성격이 없어요</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} title={TRAITS[t]?.desc} className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${fresh.includes(t) ? "border-fuchsia-300 bg-fuchsia-500/25 text-fuchsia-100 light:text-fuchsia-800" : "border-white/15 text-white/75 light:border-slate-300 light:text-slate-600"}`}>
          {TRAITS[t]?.emoji} {TRAITS[t]?.name ?? t}
        </span>
      ))}
    </span>
  );
}

function moodOf(log: LogEntry | undefined): StageMood {
  if (!log) return "plain";
  const sum = log.fx.reduce((a, b) => a + b, 0);
  return sum >= 2 ? "good" : sum <= -1 ? "bad" : "plain";
}

/** 한 사람의 한 장면 결과 카드 (공개 단계·인생 돌아보기 공용) */
function ResultCard({ role, scene, log, compact = false }: { role: RoleDef; scene: number; log: LogEntry; compact?: boolean }) {
  const sc = role.scenes[scene];
  const def = sc.choices[log.choice];
  // 그 장면에 들어올 때의 성격으로 판정된 선택지 (기록의 swapped로 복원)
  const src = log.swapped && def.swap ? def.swap : def;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-black text-white light:text-slate-900">
        {def.fast && <span title="지름길">⚡ </span>}
        {src.label}
        {log.auto && <span className="ml-1.5 rounded bg-white/10 px-1 text-[10px] font-normal text-white/60 light:bg-slate-200 light:text-slate-500">시간 초과 · 대신 고름</span>}
        {log.swapped && <span className="ml-1.5 rounded bg-fuchsia-500/20 px-1 text-[10px] font-bold text-fuchsia-200 light:text-fuchsia-700">성격이 바꾼 선택지</span>}
      </p>
      <p className={`${compact ? "text-xs" : "text-sm"} leading-relaxed text-white/80 light:text-slate-700`}>{src.result}</p>
      {log.echoes.map((i) => {
        const e = sc.echoes?.[i];
        return e ? (
          <p key={i} className="rounded-lg border border-violet-400/30 bg-violet-500/10 px-2 py-1 text-xs leading-relaxed text-violet-100 light:text-violet-800">
            🦋 <b>나비효과</b> ({TRAITS[e.tag]?.emoji} {TRAITS[e.tag]?.name}) — {e.text}
          </p>
        ) : null;
      })}
      <div className="flex flex-wrap items-center gap-1.5">
        <FxChips fx={log.fx} size={compact ? "sm" : "md"} />
        {log.gained.map((t) => (
          <span key={t} className="rounded-full border border-fuchsia-300/60 bg-fuchsia-500/20 px-2 py-0.5 text-[11px] font-bold text-fuchsia-100 light:text-fuchsia-800" title={TRAITS[t]?.desc}>
            {TRAITS[t]?.emoji} {TRAITS[t]?.name} 획득
          </span>
        ))}
      </div>
      {!compact && log.gained.map((t) => <p key={t} className={`text-[11px] ${SUB}`}>{TRAITS[t]?.emoji} {TRAITS[t]?.desc} — 뒤 장면의 선택지와 결과가 달라질 수 있어요.</p>)}
    </div>
  );
}

export default function LifeSkitBoard({ state, viewerSeat, names, botSeats, connectedSeats, phaseStart, nowMs, onAction, onGameEnd }: Props) {
  const board = useBoardView("life-skit-view");
  const [lowDetail] = useState(preferLowDetail);
  const [rules, setRules] = useState(false);
  const spectating = viewerSeat < 0 || viewerSeat >= state.seatCount;
  const me = spectating ? 0 : viewerSeat;
  /** 무대에서 보고 있는 사람 (공개·엔딩에서만 바꿀 수 있다) */
  const [focusPick, setFocusPick] = useState<{ stage: number; seat: Seat } | null>(null);
  const [recap, setRecap] = useState<Seat | null>(null);
  const focus = state.phase !== "choose" && state.phase !== "cast" && focusPick && (state.phase === "ended" || focusPick.stage === state.stage) ? focusPick.seat : me;

  const classify = useMemo(() => lifeSkitCues(me), [me]);
  useSuiteBgm(getLifeSkitSound, state.phase !== "ended", lifeSkitIntensity(state));
  useSoundCues(state, getLifeSkitSound, classify);

  const byName = useRoomCharacters((s) => s.byName);
  const seat = state.seats[focus];
  const role = seat.role ? ROLE_BY_ID[seat.role] : null;
  const sceneIdx = Math.min(state.scene, SCENE_COUNT - 1);
  const sc = role?.scenes[sceneIdx] ?? null;
  const log = seat.log[sceneIdx];
  const heroLook = useMemo(() => resolveLook(focus, undefined, roomCharacterOf(byName, names[focus])), [focus, byName, names]);

  const total = phaseDurationMs(state);
  const left = total > 0 ? Math.max(0, Math.ceil((phaseStart + total - nowMs) / 1000)) : null;
  const waiting = pendingSeats(state);
  const name = (s: Seat) => names[s] ?? `${s + 1}번`;

  const mySeat = state.seats[me];
  const myRole = mySeat.role ? ROLE_BY_ID[mySeat.role] : null;
  const myChoices = state.phase === "choose" && myRole ? choicesFor(state, me) : [];
  const ending = state.phase === "ended" && role ? endingFor(role, seat) : null;

  const mood: StageMood =
    state.phase === "choose" ? (state.seats[focus].pending === null ? "think" : "wait") : state.phase === "reveal" ? moodOf(log) : ending ? (ending.bonus >= 14 ? "cheer" : ending.bonus <= 4 ? "bad" : "plain") : "plain";

  const rankings = state.phase === "ended" ? computeRankings(state) : [];

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="mr-auto text-sm font-black text-white light:text-slate-900">
        🎬 인생 상황극
        {state.phase !== "cast" && state.phase !== "ended" && (
          <span className="ml-2 rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] text-amber-200 light:text-amber-700">
            제{state.scene + 1}장 / {SCENE_COUNT}장
          </span>
        )}
      </h2>
      {left !== null && state.phase !== "ended" && (
        <span role="timer" className={`rounded-full px-2.5 py-1 text-[11px] font-black tabular-nums ${left <= 5 ? "bg-rose-500/25 text-rose-200 light:text-rose-700" : "bg-white/10 text-white/80 light:bg-slate-100 light:text-slate-700"}`}>
          ⏱ {left}초
        </span>
      )}
      <ViewToggle board={board} />
      <SuiteSoundHud suite={getLifeSkitSound} icon="🎷" label="Curtain Up Shuffle" preview="rimshot" />
      <button type="button" onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
        📖 룰북
      </button>
    </div>
  );

  /* ───────── 배역 고르기 ───────── */
  if (state.phase === "cast") {
    const picked = mySeat.role;
    return (
      <div className="flex flex-col gap-3">
        {header}
        <div className={PANEL}>
          <p className="text-sm font-black text-white light:text-slate-900">🎭 오늘의 배역을 고르세요</p>
          <p className={`mt-0.5 text-xs ${SUB}`}>배역마다 7장면짜리 인생이 있어요. 같은 배역을 여럿이 골라도 돼요 — 같은 인생을 어떻게 다르게 사는지 비교해 보세요.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Array.from({ length: state.seatCount }, (_, s) => {
              const r = state.seats[s].role ? ROLE_BY_ID[state.seats[s].role!] : null;
              return (
                <span key={s} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-white/75 light:border-slate-200 light:text-slate-600">
                  <SeatChip seat={s} /> {name(s)} {r ? `· ${r.emoji} ${r.name}` : "· 고르는 중…"}
                </span>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ROLES.map((r) => {
            const mine = picked === r.id;
            const takers = state.seats.map((x, s) => (x.role === r.id ? s : -1)).filter((s) => s >= 0);
            return (
              <button
                key={r.id}
                type="button"
                disabled={spectating || picked !== null}
                onClick={() => onAction({ type: "PICK_ROLE", seat: me, role: r.id })}
                className={`flex flex-col gap-1.5 rounded-2xl border p-3 text-left transition ${
                  mine ? "border-amber-300 bg-amber-400/15" : "border-white/10 bg-white/[0.04] hover:border-amber-300/60 disabled:opacity-55 disabled:hover:border-white/10 light:border-slate-200 light:bg-white"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-2xl">{r.emoji}</span>
                  <span className="text-sm font-black text-white light:text-slate-900">{r.name}</span>
                  <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${r.era === "joseon" ? "bg-emerald-500/20 text-emerald-200 light:text-emerald-700" : "bg-sky-500/20 text-sky-200 light:text-sky-700"}`}>{r.era === "joseon" ? "조선" : "현대"}</span>
                  <span className="ml-auto flex gap-0.5">
                    {takers.map((s) => (
                      <SeatChip key={s} seat={s} />
                    ))}
                  </span>
                </span>
                <span className="text-xs leading-relaxed text-white/70 light:text-slate-600">{r.blurb}</span>
                <span className={`text-[11px] ${SUB}`}>
                  시작: {STATS.map((s, i) => `${s.emoji}${r.start[i]}`).join("  ")}
                </span>
              </button>
            );
          })}
        </div>
        {rules && <RulebookModal onClose={() => setRules(false)} />}
      </div>
    );
  }

  /* ───────── 무대 (장면·공개·엔딩 공용) ───────── */
  const set = sc?.set ?? "stage";
  const meta = SET_META[set];
  const bubble = state.phase === "ended" ? null : sc;
  const stageOverlay = (
    <>
      <div className="pointer-events-none absolute top-2 left-2 flex max-w-[70%] flex-col items-start gap-1">
        <span className="rounded-md bg-black/70 px-2 py-1 text-[11px] font-black text-amber-200">
          {role?.emoji} {state.phase === "ended" ? `${role?.name} — 막이 내립니다` : sc?.title}
        </span>
        <span className="rounded-md bg-black/55 px-2 py-0.5 text-[10px] text-white/80">
          <SeatChipInline seat={focus} /> {name(focus)} · {meta.emoji} {meta.name}
        </span>
      </div>
      {bubble && (
        <div className="pointer-events-none absolute top-2 right-2 max-w-[58%] rounded-2xl rounded-tr-sm bg-white px-3 py-2 text-slate-900 shadow-lg sm:max-w-[44%]">
          <p className="text-[10px] font-black text-slate-500">{bubble.npc.name}</p>
          <p className="text-xs leading-snug font-bold sm:text-sm">“{bubble.line}”</p>
        </div>
      )}
      {state.phase === "choose" && sc && <p className="pointer-events-none absolute inset-x-2 bottom-2 rounded-lg bg-black/70 px-3 py-1.5 text-center text-xs leading-snug text-white sm:text-sm">{sc.text}</p>}
      {state.phase === "reveal" && log && sc && (
        <p className="pointer-events-none absolute inset-x-2 bottom-2 rounded-lg bg-black/75 px-3 py-1.5 text-center text-xs leading-snug text-white sm:text-sm">
          {(log.swapped && sc.choices[log.choice].swap ? sc.choices[log.choice].swap! : sc.choices[log.choice]).result}
        </p>
      )}
      {ending && (
        <p className="pointer-events-none absolute inset-x-2 bottom-2 rounded-lg bg-black/75 px-3 py-1.5 text-center text-xs leading-snug text-white sm:text-sm">
          {ending.emoji} <b>{ending.title}</b> — {ending.text}
        </p>
      )}
    </>
  );
  const stageKey = `${state.seed}:${state.phase === "ended" ? "end" : sceneIdx}:${focus}`;
  const stage =
    board.view === "3d" && role ? (
      <Frame3D>
        <SkitStage3D set={set} sceneKey={stageKey} hero={{ look: heroLook, seed: focus * 7 + 3, costume: role.costume }} npc={{ g: sc?.npc.g ?? "f", seed: (sceneIdx * 13 + focus * 5 + 40) % 97, joseon: role.era === "joseon" }} mood={mood} lowDetail={lowDetail} />
        {stageOverlay}
      </Frame3D>
    ) : (
      <div className="relative flex h-[230px] w-full items-center justify-center gap-8 overflow-hidden rounded-2xl border border-black/50 sm:h-[300px]" style={{ background: `linear-gradient(160deg, ${meta.from}, ${meta.to})` }}>
        <span className="text-6xl drop-shadow-lg sm:text-7xl">{role?.emoji}</span>
        <span className="text-4xl opacity-80">{meta.emoji}</span>
        <span className="text-6xl drop-shadow-lg sm:text-7xl">{state.phase === "ended" ? ending?.emoji : sc?.npc.g === "f" ? "👩" : "👨"}</span>
        {stageOverlay}
      </div>
    );

  const statusPanel = (target: Seat, delta?: Fx, fresh?: readonly string[]) => {
    const st = state.seats[target];
    return (
      <div className={`${PANEL} flex flex-col gap-2`}>
        <StatBars stats={st.stats} delta={delta} />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-[11px] font-bold ${SUB}`}>성격</span>
          <TraitChips tags={st.tags} fresh={fresh} />
        </div>
      </div>
    );
  };

  /* ───────── 장면: 고르기 ───────── */
  if (state.phase === "choose") {
    const chosen = mySeat.pending;
    return (
      <div className="flex flex-col gap-3">
        {header}
        {stage}
        {statusPanel(me)}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {myChoices.map((c, i) => {
            const picked = chosen === i;
            return (
              <button
                key={i}
                type="button"
                disabled={spectating || chosen !== null}
                onClick={() => onAction({ type: "CHOOSE", seat: me, scene: state.scene, choice: i })}
                className={`flex min-h-[76px] flex-col gap-1.5 rounded-2xl border p-3 text-left transition ${
                  picked
                    ? "border-amber-300 bg-amber-400/20"
                    : chosen !== null
                      ? "border-white/10 bg-white/[0.03] opacity-45 light:border-slate-200 light:bg-white"
                      : "border-white/15 bg-white/[0.05] hover:border-amber-300/70 hover:bg-amber-400/10 light:border-slate-300 light:bg-white"
                }`}
              >
                <span className="text-sm leading-snug font-black text-white light:text-slate-900">
                  {picked && "✔ "}
                  {c.label}
                </span>
                <span className="flex flex-wrap items-center gap-1 text-[11px]">
                  {c.fast && <span className="rounded-full bg-yellow-400/25 px-1.5 py-px font-black text-yellow-200 light:text-yellow-700">⚡ 지름길</span>}
                  {c.swappedBy && (
                    <span className="rounded-full bg-fuchsia-500/25 px-1.5 py-px font-bold text-fuchsia-100 light:text-fuchsia-700" title="내 성격 때문에 선택지가 바뀌었어요">
                      {TRAITS[c.swappedBy]?.emoji} {TRAITS[c.swappedBy]?.name} 때문에 바뀜
                    </span>
                  )}
                  {c.hint.length > 0 ? (
                    <span className={SUB}>
                      얻을 듯: {c.hint.map((h) => `${STATS[h].emoji}${STATS[h].name}`).join(" · ")}
                    </span>
                  ) : (
                    <span className={SUB}>얻을 게 안 보여요</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <p className={`text-center text-xs ${SUB}`}>
          {spectating
            ? "관전 중이에요"
            : chosen === null
              ? "보이는 건 얻을 것뿐 — 대가와 성격 변화는 공개 때 드러나요."
              : waiting.length > 0
                ? `골랐어요! 기다리는 중: ${waiting.map(name).join(", ")}`
                : "공개합니다…"}
        </p>
        {rules && <RulebookModal onClose={() => setRules(false)} />}
      </div>
    );
  }

  /* ───────── 공개 ───────── */
  if (state.phase === "reveal") {
    const myLog = mySeat.log[state.scene];
    const others = Array.from({ length: state.seatCount }, (_, s) => s).filter((s) => s !== me || spectating);
    const canClap = !spectating && mySeat.clapTo === null;
    return (
      <div className="flex flex-col gap-3">
        {header}
        {stage}
        {!spectating && myRole && myLog && (
          <div className={`${PANEL} flex flex-col gap-2`} onClick={() => setFocusPick({ stage: state.stage, seat: me })}>
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-200 light:text-amber-700">
              <SeatChip seat={me} /> 나의 선택 · {myRole.emoji} {myRole.scenes[state.scene].title}
              {myLog.claps.length > 0 && <span className="ml-auto rounded-full bg-amber-400/25 px-2 py-0.5 text-amber-100 light:text-amber-700">👏 {myLog.claps.length}</span>}
            </p>
            <ResultCard role={myRole} scene={state.scene} log={myLog} />
          </div>
        )}
        {!spectating && statusPanel(me, myLog?.fx, myLog?.gained)}
        {others.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className={`text-xs font-bold ${SUB}`}>
              🎞️ 다른 사람들의 인생 {canClap && others.length > 0 && "— 제일 웃긴(혹은 짠한) 장면에 👏 한 번!"}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {others.map((s) => {
                const st = state.seats[s];
                const r = ROLE_BY_ID[st.role!];
                const l = st.log[state.scene];
                if (!l) return null;
                const clapped = mySeat.clapTo === s;
                return (
                  <div key={s} className={`${PANEL} flex flex-col gap-2 ${focus === s ? "ring-2 ring-amber-300/70" : ""}`}>
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-white/75 light:text-slate-600">
                      <SeatChip seat={s} />
                      <span className="truncate">
                        {name(s)} · {r.emoji} {r.scenes[state.scene].title}
                      </span>
                      {l.claps.length > 0 && <span className="ml-auto shrink-0 rounded-full bg-amber-400/25 px-2 py-0.5 text-amber-100 light:text-amber-700">👏 {l.claps.length}</span>}
                    </div>
                    <p className={`text-[11px] leading-snug ${SUB}`}>
                      {r.scenes[state.scene].npc.name}: “{r.scenes[state.scene].line}”
                    </p>
                    <ResultCard role={r} scene={state.scene} log={l} compact />
                    <div className="mt-auto flex gap-1.5">
                      <button type="button" onClick={() => setFocusPick({ stage: state.stage, seat: s })} className="min-h-[36px] flex-1 rounded-lg border border-white/15 px-2 text-[11px] text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600">
                        🎬 무대에서 보기
                      </button>
                      {!spectating && (
                        <button
                          type="button"
                          disabled={!canClap}
                          onClick={() => onAction({ type: "CLAP", seat: me, scene: state.scene, to: s })}
                          className={`min-h-[36px] flex-1 rounded-lg px-2 text-[11px] font-black ${clapped ? "bg-amber-400 text-slate-900" : "bg-amber-500/20 text-amber-100 hover:bg-amber-500/35 disabled:opacity-35 light:text-amber-700"}`}
                        >
                          {clapped ? "👏 박수 침!" : `👏 박수 (+${SCORE_PER_CLAP}점)`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {!spectating && (
          <button
            type="button"
            disabled={mySeat.ready}
            onClick={() => onAction({ type: "READY", seat: me, scene: state.scene })}
            className="sticky bottom-2 z-20 rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-900 shadow-lg hover:bg-amber-400 disabled:bg-white/15 disabled:text-white/60 light:disabled:bg-slate-200 light:disabled:text-slate-500"
          >
            {mySeat.ready ? `기다리는 중: ${waiting.map(name).join(", ") || "…"}` : state.scene + 1 < SCENE_COUNT ? `▶ 다음 장면 (제${state.scene + 2}장)` : "🎬 엔딩 보기"}
          </button>
        )}
        {rules && <RulebookModal onClose={() => setRules(false)} />}
      </div>
    );
  }

  /* ───────── 엔딩 ───────── */
  return (
    <div className="flex flex-col gap-3">
      {header}
      {stage}
      <div className="flex flex-col gap-2">
        {rankings.map(({ seat: s, rank }) => {
          const st = state.seats[s];
          const r = ROLE_BY_ID[st.role!];
          const e = endingFor(r, st);
          const life = lifeScoreOf(r, st);
          const claps = clapsOf(st);
          const open = recap === s;
          return (
            <div key={s} className={`${PANEL} flex flex-col gap-2 ${focus === s ? "ring-2 ring-amber-300/70" : ""}`}>
              <button type="button" className="flex items-start gap-2 text-left" onClick={() => setFocusPick({ stage: state.stage, seat: s })}>
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${rank === 1 ? "bg-amber-400 text-slate-900" : "bg-white/10 text-white/80 light:bg-slate-200 light:text-slate-700"}`}>{rank}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-white/80 light:text-slate-600">
                    <SeatChip seat={s} /> {name(s)} {botSeats.has(s) && "🤖"} {!connectedSeats.has(s) && "(끊김)"} · {r.emoji} {r.name}
                  </span>
                  <span className="mt-0.5 block text-sm font-black text-white light:text-slate-900">
                    {e.emoji} {e.title}
                  </span>
                  <span className="block text-xs leading-relaxed text-white/75 light:text-slate-600">{e.text}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xl font-black text-amber-300 tabular-nums light:text-amber-600">{st.score}</span>
                  <span className={`block text-[10px] ${SUB}`}>
                    인생 {life}
                    {claps > 0 && ` + 👏${claps}×${SCORE_PER_CLAP}`}
                  </span>
                </span>
              </button>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-white/80 light:text-slate-600">{STATS.map((x, i) => `${x.emoji}${st.stats[i]}`).join("  ")}</span>
                <TraitChips tags={st.tags} />
                <button type="button" onClick={() => setRecap(open ? null : s)} className="ml-auto min-h-[32px] rounded-lg border border-white/15 px-2 text-[11px] text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600" aria-expanded={open}>
                  {open ? "접기" : "📜 인생 돌아보기"}
                </button>
              </div>
              {open && (
                <ol className="flex flex-col gap-2 border-t border-white/10 pt-2 light:border-slate-200">
                  {st.log.map((l, i) => (
                    <li key={i} className="flex flex-col gap-1">
                      <span className={`text-[11px] font-bold ${SUB}`}>
                        제{i + 1}장 · {r.scenes[i].title} {l.claps.length > 0 && `· 👏 ${l.claps.length}`}
                      </span>
                      <ResultCard role={r} scene={i} log={l} compact />
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
      <button className="rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-900 hover:bg-amber-400" onClick={onGameEnd}>
        🎬 막을 내리고 결과 저장
      </button>
      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function SeatChipInline({ seat }: { seat: Seat }) {
  return (
    <span className="mr-0.5 inline-block font-black" style={{ color: SEAT_COLORS[seat % 8] }}>
      {SEAT_MARKS[seat % 8]}
    </span>
  );
}
