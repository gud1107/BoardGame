"use client";

import { useEffect, useMemo, useState } from "react";
import RulebookModal from "./RulebookModal";
import RoleInspector from "./RoleInspector";
import PhaseSkipVote from "./PhaseSkipVote";
import { MafiaRevealOverlay, useBoardShake, useMafiaReveals } from "./MafiaEffects";
import {
  getKnowledge,
  knownRoleFor,
  type MafiaState,
  type EngineAction,
  type Role,
  type SeatIndex,
  type Team,
} from "./engine";

export interface MafiaBoardProps {
  state: MafiaState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

const ROLE_META: Record<Role, { label: string; icon: string; team: Team; blurb: string }> = {
  citizen: { label: "시민", icon: "🙂", team: "citizen", blurb: "특수 능력은 없지만, 낮 토론과 투표로 마피아를 찾아내야 합니다." },
  mafia: { label: "마피아", icon: "🔪", team: "mafia", blurb: "매일 밤 동료와 함께 시민 1명을 지목해 제거하세요." },
  police: { label: "경찰", icon: "👮", team: "citizen", blurb: "매일 밤 1명을 조사해 마피아인지 확인할 수 있습니다." },
  doctor: { label: "의사", icon: "💉", team: "citizen", blurb: "매일 밤 1명을 지정해 마피아의 습격으로부터 보호하세요." },
  spy: { label: "스파이", icon: "🕶️", team: "mafia", blurb: "매일 밤 1명을 조사해 정확한 직업을 알아냅니다. 마피아를 찾으면 그날 밤부터 마피아의 암살 표결에 합류합니다." },
  soldier: { label: "군인", icon: "🪖", team: "citizen", blurb: "마피아의 첫 습격을 1회 자동으로 막아냅니다 (방탄조끼)." },
  politician: { label: "정치인", icon: "🎩", team: "citizen", blurb: "낮 찬반 투표로는 처형되지 않으며, 투표권이 2표로 계산됩니다." },
  medium: { label: "영매", icon: "🔮", team: "citizen", blurb: "매일 밤 이미 사망한 사람 1명의 진짜 직업을 확인할 수 있습니다." },
  terrorist: { label: "테러리스트", icon: "💣", team: "citizen", blurb: "낮 투표로 처형당하면, 자신을 지목했던 사람 중 1명을 길동무로 데려갑니다." },
};

const TEAM_LABEL: Record<Team, string> = { citizen: "시민 진영 승리!", mafia: "마피아 진영 승리!" };

const PANEL = "relative overflow-hidden rounded-3xl border border-black/60 bg-gradient-to-b from-[#1b1414] via-[#120d0d] to-[#0a0707] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)] light:border-slate-200 light:from-white light:via-slate-50 light:to-slate-100 light:shadow-md";

function useCountdown(phaseStartedAt: number, phaseDurationMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  return Math.max(0, Math.ceil((phaseStartedAt + phaseDurationMs - now) / 1000));
}

const PHASE_LABEL: Record<MafiaState["phase"], string> = {
  night: "🌙 밤",
  dayAnnounce: "☀️ 아침 브리핑",
  dayDiscuss: "💬 낮 토론",
  nomination: "☝️ 지목 투표",
  defense: "🎤 최후 변론",
  finalVote: "🗳️ 찬반 투표",
  execution: "⚖️ 결과 집행",
  terroristRevenge: "💣 길동무 선택",
  gameOver: "🏁 게임 종료",
};

export default function MafiaBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: MafiaBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [roleModalOpen, setRoleModalOpen] = useState(true);
  const [trackedPlayers, setTrackedPlayers] = useState(state.players);
  if (trackedPlayers !== state.players) {
    setTrackedPlayers(state.players);
    setRoleModalOpen(true);
  }

  const viewer = state.players[viewerSeat];
  const iAmGhost = !viewer.alive;
  const knowledge = useMemo(() => getKnowledge(state, viewerSeat), [state, viewerSeat]);
  const secondsLeft = useCountdown(state.phaseStartedAt, state.phaseDurationMs);
  const meta = ROLE_META[viewer.role];

  const aliveMafiaCount = state.players.filter((p) => p.alive && p.team === "mafia").length;
  const aliveCitizenCount = state.players.filter((p) => p.alive && p.team === "citizen").length;
  const aliveCount = aliveMafiaCount + aliveCitizenCount;
  const skipThreshold = Math.floor(aliveCount / 2);
  const skipCount = Object.values(state.skipVotes).filter(Boolean).length;
  const canSkip = state.phase === "night" || state.phase === "dayDiscuss";
  const hasVotedSkip = state.skipVotes[viewerSeat] ?? false;

  // 전 액션 시네마틱 FX (2026-09-20 요청) — 모든 이벤트를 순서대로 재생하되,
  // 비공개 이벤트(치료 빗나감/경찰 조사 결과)는 당사자가 아니면 렌더링 없이
  // 즉시 큐에서 넘긴다(다른 사람에게는 절대 노출되지 않는 보안 뷰 격리).
  const { current: reveal, dismissCurrent: dismissReveal } = useMafiaReveals(state);
  const revealApplies =
    reveal !== null &&
    !((reveal.type === "heal-miss" && reveal.doctorSeat !== viewerSeat) || (reveal.type === "police-result" && reveal.policeSeat !== viewerSeat));
  useEffect(() => {
    if (reveal && !revealApplies) dismissReveal();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-check when the event itself changes
  }, [reveal]);
  const shakeStyle = useBoardShake(reveal?.type === "death" ? reveal.id : null);

  if (state.phase === "gameOver" && state.winner) {
    return (
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
        <div className={`${PANEL} flex flex-1 flex-col items-center gap-5 p-8 text-center`}>
          <span className="relative z-10 text-5xl">🏆</span>
          <h2 className="relative z-10 text-2xl font-bold text-amber-100 light:text-amber-700">{TEAM_LABEL[state.winner]}</h2>
          <p className="relative z-10 text-sm text-white/60 light:text-slate-600">
            {state.winReason === "mafia-eliminated" ? "모든 마피아 진영이 제거되었습니다." : "마피아 진영의 수가 시민 진영과 같아지거나 더 많아졌습니다."}
          </p>
          <div className="relative z-10 flex flex-wrap justify-center gap-2">
            {state.players.map((p) => {
              const m = ROLE_META[p.role];
              return (
                <div
                  key={p.seat}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-xs light:shadow-sm ${
                    m.team === "citizen" ? "border-sky-400/40 bg-sky-400/10" : "border-rose-400/40 bg-rose-400/10"
                  } ${!p.alive ? "opacity-60" : ""}`}
                >
                  <span className="text-white/80 light:text-slate-700">{names[p.seat]}</span>
                  <span>
                    {m.icon} {m.label}
                  </span>
                  {!p.alive && <span className="text-[10px] text-rose-300">💀 사망</span>}
                </div>
              );
            })}
          </div>
          <button onClick={onGameEnd} className="relative z-10 rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400">
            결과 확정하고 계속하기
          </button>
        </div>
        <RoleInspector state={state} viewerSeat={viewerSeat} names={names} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
      <div className={`${PANEL} flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4`} style={shakeStyle}>
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-1.5 text-xs text-rose-100/70 light:text-slate-600">
          <span>
            {state.config.mode === "classic" ? "🎲 기본룰" : "🃏 확장룰"} · {PHASE_LABEL[state.phase]}
            {state.dayNumber > 0 ? ` · ${state.dayNumber}일차` : ""} · 생존 시민 {aliveCitizenCount} / 마피아 {aliveMafiaCount}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full border border-white/15 bg-black/30 px-2.5 py-1 font-mono text-amber-300 light:border-slate-300 light:bg-slate-100 light:text-amber-700">
              ⏱️ {secondsLeft}s
            </span>
            {canSkip && !iAmGhost && (
              <PhaseSkipVote
                skipCount={skipCount}
                requiredCount={skipThreshold + 1}
                hasVotedSkip={hasVotedSkip}
                onToggleSkip={() => onAction({ type: "toggleSkipVote", seat: viewerSeat, atMs: Date.now() })}
              />
            )}
            <button
              onClick={() => setRoleModalOpen(true)}
              className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-200 transition hover:border-amber-300/50 light:bg-amber-50 light:text-amber-700 light:border-amber-300"
            >
              🎭 내 역할
            </button>
            <button
              onClick={() => setRulebookOpen(true)}
              className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white light:border-slate-300 light:text-slate-600"
            >
              📖 룰북
            </button>
          </div>
        </div>

        {iAmGhost && (
          <div className="relative z-10 rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-center text-xs text-indigo-100 light:border-indigo-300 light:bg-indigo-50 light:text-indigo-700">
            👻 당신은 사망했습니다 — 이제부터 전체 직업을 볼 수 있는 유령 관전 모드입니다. 아래 유령 전용 채팅으로만 대화할 수 있어요.
          </div>
        )}

        <SeatGrid state={state} viewerSeat={viewerSeat} names={names} connectedSeats={connectedSeats} revealAll={iAmGhost} />

        <div className="relative z-10 rounded-xl border border-white/10 bg-black/30 p-3 text-center light:border-slate-200 light:bg-slate-50">
          <PhasePanel state={state} viewerSeat={viewerSeat} names={names} knowledge={knowledge} onAction={onAction} />
        </div>

        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
        {roleModalOpen && <RoleModal viewerSeat={viewerSeat} names={names} meta={meta} onClose={() => setRoleModalOpen(false)} />}
        {reveal && revealApplies && <MafiaRevealOverlay key={reveal.id} event={reveal} names={names} onDone={dismissReveal} />}
      </div>
      <RoleInspector state={state} viewerSeat={viewerSeat} names={names} />
    </div>
  );
}

function SeatGrid({
  state,
  viewerSeat,
  names,
  connectedSeats,
  revealAll,
}: {
  state: MafiaState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  revealAll: boolean;
}) {
  return (
    <div className="relative z-10 grid grid-cols-3 gap-2 sm:grid-cols-4">
      {state.players.map((p) => {
        const showRole = revealAll || (!p.alive && state.config.revealRoleOnDeath) || state.phase === "gameOver";
        const m = ROLE_META[p.role];
        const isSuspect = state.suspect === p.seat && (state.phase === "defense" || state.phase === "finalVote");
        // 정체 영구 각인(2026-09-20 요청): 이 뷰어가 직접 조사해서 알아낸 대상만
        // 네온 배지로 표시 — 다른 사람(타 팀원 포함)에게는 절대 안 보이는
        // 보안 뷰 격리. 이미 전 직업이 공개된 경우(유령/게임종료)는 굳이
        // 중복 표기하지 않음.
        const known = !revealAll && state.phase !== "gameOver" ? knownRoleFor(state, viewerSeat, p.seat) : null;
        return (
          <div
            key={p.seat}
            className={`relative flex flex-col items-center gap-0.5 rounded-xl border p-2 text-center transition ${
              !p.alive
                ? "border-white/10 bg-black/40 opacity-50 light:border-slate-200 light:bg-slate-100"
                : isSuspect
                  ? "border-amber-300/70 bg-amber-500/10 ring-2 ring-amber-300/60"
                  : "border-white/10 bg-white/5 light:border-slate-200 light:bg-white"
            }`}
          >
            {known && (
              <span
                className={`absolute -top-2 -right-1.5 rounded-full border px-1.5 py-0.5 text-[9px] font-black ${
                  known.isMafia ? "border-red-500 bg-red-950 text-red-400" : "border-cyan-400 bg-cyan-950 text-cyan-300"
                }`}
                style={{
                  animation: "mafia-badge-breathe 2s ease-in-out infinite",
                  ["--badge-glow" as string]: known.isMafia ? "rgba(239,68,68,0.6)" : "rgba(6,182,212,0.5)",
                }}
                title={`확인된 직업: ${ROLE_META[known.role].label}`}
              >
                {known.isMafia ? "🚨 마피아" : "🛡️ 시민"}
              </span>
            )}
            <span className="flex items-center gap-1 text-[11px] font-semibold text-white/90 light:text-slate-800">
              <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(p.seat) ? "bg-emerald-400" : "bg-white/20 light:bg-slate-300"}`} />
              {names[p.seat]}
              {p.seat === viewerSeat && <span className="text-amber-200 light:text-amber-700">(나)</span>}
            </span>
            {!p.alive && <span className="text-[10px] text-rose-300 light:text-rose-600">💀 사망</span>}
            {showRole && (
              <span className="text-[10px] text-white/60 light:text-slate-500">
                {m.icon} {m.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RoleModal({
  viewerSeat,
  names,
  meta,
  onClose,
}: {
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  meta: (typeof ROLE_META)[Role];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-amber-400/30 bg-[#160f0f] p-6 text-center shadow-2xl light:bg-white light:border-amber-300">
        <p className="mb-1 text-xs text-white/40 light:text-slate-500">{names[viewerSeat]}님의 비밀 정보</p>
        <div className="mb-3 text-5xl">{meta.icon}</div>
        <h2 className={`mb-1 text-xl font-bold ${meta.team === "citizen" ? "text-sky-300 light:text-sky-600" : "text-rose-300 light:text-rose-600"}`}>{meta.label}</h2>
        <p className="mb-3 text-sm text-white/60 light:text-slate-600">당신은 {meta.team === "citizen" ? "시민 진영" : "마피아 진영"}입니다.</p>
        <p className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70 light:border-slate-200 light:bg-slate-50 light:text-slate-600">{meta.blurb}</p>
        <button onClick={onClose} className="mt-2 w-full rounded-xl bg-rose-700 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-600">
          확인했어요
        </button>
      </div>
    </div>
  );
}

function PhasePanel({
  state,
  viewerSeat,
  names,
  knowledge,
  onAction,
}: {
  state: MafiaState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  knowledge: ReturnType<typeof getKnowledge>;
  onAction: (action: EngineAction) => void;
}) {
  const viewer = state.players[viewerSeat];
  const alive = state.players.filter((p) => p.alive);

  if (state.phase === "night") {
    if (state.nightNumber === 0) {
      return <p className="text-xs text-indigo-100/70 light:text-slate-600">🕯️ 첫날 밤, 서로의 얼굴을 확인하는 상견례가 진행 중입니다...</p>;
    }
    if (!viewer.alive) {
      return <p className="text-xs text-white/40 light:text-slate-400">👻 깊은 밤, 도시가 잠들어 있습니다...</p>;
    }
    const na = state.nightActions;

    if (viewer.role === "mafia" || (viewer.role === "spy" && viewer.spyContactedMafia)) {
      const alreadyVoted = na.mafiaVotes[viewerSeat];
      const candidates = alive.filter((p) => !knowledge.mafiaTeammates.includes(p.seat) && p.seat !== viewerSeat);
      const teammateVotes = Object.entries(na.mafiaVotes)
        .filter(([seat]) => Number(seat) !== viewerSeat)
        .map(([seat, target]) => `${names[Number(seat)]} → ${target !== undefined ? names[target] : "고민 중"}`);
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-rose-100/80 light:text-slate-700">🔪 오늘 밤 제거할 대상을 동료와 함께 지목하세요.</p>
          {teammateVotes.length > 0 && <p className="text-[11px] text-rose-200/50 light:text-slate-500">동료 현황: {teammateVotes.join(" · ")}</p>}
          <TargetGrid
            candidates={candidates}
            names={names}
            selected={alreadyVoted}
            onPick={(target) => onAction({ type: "mafiaNightVote", seat: viewerSeat, target })}
          />
        </div>
      );
    }
    if (viewer.role === "spy") {
      if (na.spyTarget === undefined) {
        return (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-rose-100/80 light:text-slate-700">🕶️ 조사할 대상 1명을 지목하세요. 마피아를 찾으면 그날 밤부터 암살 표결에 합류합니다.</p>
            <TargetGrid candidates={alive.filter((p) => p.seat !== viewerSeat)} names={names} selected={undefined} onPick={(target) => onAction({ type: "spyNightAction", seat: viewerSeat, target })} />
          </div>
        );
      }
      return (
        <p className="text-xs text-rose-100/60 light:text-slate-600">
          조사 결과: {names[na.spyResult!.target]}님은 <b>{ROLE_META[na.spyResult!.role].label}</b>입니다.
        </p>
      );
    }
    if (viewer.role === "doctor") {
      if (na.doctorTarget !== undefined) return <p className="text-xs text-emerald-100/70 light:text-slate-600">💉 {names[na.doctorTarget]}님을 보호하기로 했습니다.</p>;
      const canSelf = state.nightNumber === 1 && state.config.doctorSelfHeal;
      const candidates = state.players.filter((p) => p.alive && (p.seat !== viewerSeat || canSelf));
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-emerald-100/80 light:text-slate-700">💉 오늘 밤 보호할 대상을 지정하세요.{!canSelf && " (자가치료 불가)"}</p>
          <TargetGrid candidates={candidates} names={names} selected={undefined} onPick={(target) => onAction({ type: "doctorNightAction", seat: viewerSeat, target })} />
        </div>
      );
    }
    if (viewer.role === "police") {
      if (na.policeResult !== undefined) {
        return (
          <p className="text-xs text-sky-100/70 light:text-slate-600">
            조사 결과: {names[na.policeResult.target]}님은 마피아{na.policeResult.isMafia ? "가 맞습니다." : "가 아닙니다."}
          </p>
        );
      }
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-sky-100/80 light:text-slate-700">👮 조사할 대상 1명을 지목하세요.</p>
          <TargetGrid candidates={alive.filter((p) => p.seat !== viewerSeat)} names={names} selected={undefined} onPick={(target) => onAction({ type: "policeNightAction", seat: viewerSeat, target })} />
        </div>
      );
    }
    if (viewer.role === "medium") {
      if (na.mediumResult !== undefined) {
        return (
          <p className="text-xs text-violet-100/70 light:text-slate-600">
            영매 결과: {names[na.mediumResult.target]}님의 진짜 직업은 <b>{ROLE_META[na.mediumResult.role].label}</b>였습니다.
          </p>
        );
      }
      const deadSeats = state.players.filter((p) => !p.alive);
      if (deadSeats.length === 0) return <p className="text-xs text-white/40 light:text-slate-400">🔮 아직 사망한 사람이 없어 조사할 대상이 없습니다.</p>;
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-violet-100/80 light:text-slate-700">🔮 사망한 사람 중 1명의 직업을 확인하세요.</p>
          <TargetGrid candidates={deadSeats} names={names} selected={undefined} onPick={(target) => onAction({ type: "mediumNightAction", seat: viewerSeat, target })} />
        </div>
      );
    }
    return <p className="text-xs text-white/40 light:text-slate-400">🌙 깊은 밤, 도시가 잠들어 있습니다... 다른 사람들의 능력 발동을 기다리는 중입니다.</p>;
  }

  if (state.phase === "dayAnnounce") {
    const outcome = state.lastNightOutcome;
    if (!outcome || outcome.night === 0) return <p className="text-xs text-white/60 light:text-slate-600">☀️ 첫날 아침, 평화로운 밤이었습니다.</p>;
    if (outcome.victim !== null) {
      return (
        <p className="text-xs text-rose-200/80 light:text-rose-700">
          💀 지난밤, <b>{names[outcome.victim]}</b>님이 마피아의 습격으로 사망했습니다.
        </p>
      );
    }
    if (outcome.savedByDoctor) return <p className="text-xs text-emerald-200/80 light:text-emerald-700">✨ 지난밤 습격이 있었지만, 의사의 치료로 아무도 사망하지 않았습니다.</p>;
    if (outcome.savedByArmor) return <p className="text-xs text-emerald-200/80 light:text-emerald-700">🪖 지난밤 습격이 있었지만, 군인의 방탄조끼가 막아냈습니다.</p>;
    return <p className="text-xs text-white/60 light:text-slate-600">☀️ 지난밤은 조용했습니다. 아무도 사망하지 않았습니다.</p>;
  }

  if (state.phase === "dayDiscuss") {
    return <p className="text-xs text-white/60 light:text-slate-600">💬 자유 토론 시간입니다 — 아래 채팅으로 의심스러운 사람에 대해 이야기해 보세요.</p>;
  }

  if (state.phase === "nomination") {
    if (!viewer.alive) return <p className="text-xs text-white/40 light:text-slate-400">👻 생존자들의 지목투표를 지켜보는 중...</p>;
    const nominated = state.nominations[viewerSeat];
    const count = Object.keys(state.nominations).length;
    if (nominated !== undefined) {
      return (
        <p className="text-xs text-amber-100/70 light:text-slate-600">
          {names[nominated]}님을 지목했습니다 · {count}/{alive.length}명 투표 완료
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-amber-100/80 light:text-slate-700">
          ☝️ 가장 의심스러운 사람을 지목하세요 · {count}/{alive.length}명 투표 완료
        </p>
        <TargetGrid candidates={alive.filter((p) => p.seat !== viewerSeat)} names={names} selected={undefined} onPick={(target) => onAction({ type: "nominate", seat: viewerSeat, target, atMs: Date.now() })} />
      </div>
    );
  }

  if (state.phase === "defense") {
    return (
      <p className="text-xs text-amber-100/80 light:text-slate-700">
        🎤 <b>{names[state.suspect!]}</b>님의 최후 변론 시간입니다. 아래 채팅으로 변론을 들어보세요.
      </p>
    );
  }

  if (state.phase === "finalVote") {
    const suspect = state.suspect!;
    if (viewerSeat === suspect) return <p className="text-xs text-amber-100/70 light:text-slate-600">🗳️ 다른 생존자들이 당신의 처형 여부를 투표하는 중입니다...</p>;
    if (!viewer.alive) return <p className="text-xs text-white/40 light:text-slate-400">👻 찬반 투표를 지켜보는 중...</p>;
    const myVote = state.finalVotes[viewerSeat];
    if (myVote !== undefined) return <p className="text-xs text-amber-100/70 light:text-slate-600">투표를 완료했습니다 ({myVote === "yes" ? "찬성" : "반대"}) — 결과를 기다리는 중...</p>;
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="text-xs text-amber-100/80 light:text-slate-700">
          <b>{names[suspect]}</b>님을 처형하는 데 찬성하시나요?
        </p>
        <div className="flex gap-2">
          <button onClick={() => onAction({ type: "finalVote", seat: viewerSeat, vote: "yes", atMs: Date.now() })} className="rounded-full bg-rose-600 px-5 py-2 text-xs font-semibold text-white hover:bg-rose-500">
            ⚖️ 찬성 (처형)
          </button>
          <button onClick={() => onAction({ type: "finalVote", seat: viewerSeat, vote: "no", atMs: Date.now() })} className="rounded-full bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500">
            🙅 반대 (구원)
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "execution") {
    const outcome = state.lastExecution;
    if (!outcome) return <p className="text-xs text-white/60 light:text-slate-600">동률로 이번 지목투표는 무효 처리되었습니다.</p>;
    if (outcome.blockedByPolitician) {
      return (
        <p className="text-xs text-sky-200/80 light:text-sky-700">
          🎩 <b>{names[outcome.suspect]}</b>님은 정치인이라 투표로 처형되지 않습니다! (찬성 {outcome.yes} · 반대 {outcome.no})
        </p>
      );
    }
    if (!outcome.executed) {
      return (
        <p className="text-xs text-emerald-200/80 light:text-emerald-700">
          🙅 과반수 미달로 <b>{names[outcome.suspect]}</b>님은 처형되지 않았습니다. (찬성 {outcome.yes} · 반대 {outcome.no})
        </p>
      );
    }
    return (
      <p className="text-xs text-rose-200/80 light:text-rose-700">
        ⚖️ <b>{names[outcome.suspect]}</b>님이 처형되었습니다. (찬성 {outcome.yes} · 반대 {outcome.no})
      </p>
    );
  }

  if (state.phase === "terroristRevenge" && state.pendingTerroristRevenge) {
    const { terroristSeat, eligibleNominators } = state.pendingTerroristRevenge;
    if (viewerSeat !== terroristSeat) {
      return (
        <p className="text-xs text-rose-200/80 light:text-rose-700">
          💣 <b>{names[terroristSeat]}</b>님이 처형되며 길동무를 선택하는 중입니다...
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-rose-200/90 light:text-rose-700">💣 당신을 지목했던 사람 중 1명을 길동무로 선택하세요.</p>
        <TargetGrid
          candidates={eligibleNominators.map((seat) => state.players[seat])}
          names={names}
          selected={undefined}
          onPick={(target) => onAction({ type: "terroristRevenge", seat: viewerSeat, target, atMs: Date.now() })}
        />
      </div>
    );
  }

  return null;
}

function TargetGrid({
  candidates,
  names,
  selected,
  onPick,
}: {
  candidates: { seat: SeatIndex }[];
  names: Record<SeatIndex, string>;
  selected: SeatIndex | undefined;
  onPick: (target: SeatIndex) => void;
}) {
  if (candidates.length === 0) return <p className="text-xs text-white/40 light:text-slate-400">지목할 수 있는 대상이 없습니다.</p>;
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {candidates.map((c) => (
        <button
          key={c.seat}
          disabled={selected !== undefined}
          onClick={() => onPick(c.seat)}
          className={`rounded-full border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed ${
            selected === c.seat
              ? "border-amber-300 bg-amber-500/20 text-amber-100"
              : "border-white/15 bg-white/5 text-white/80 hover:border-white/30 light:border-slate-300 light:bg-white light:text-slate-700"
          }`}
        >
          {names[c.seat]}
        </button>
      ))}
    </div>
  );
}
