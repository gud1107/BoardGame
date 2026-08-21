"use client";

import { type CSSProperties, useMemo, useState } from "react";
import RulebookModal from "./RulebookModal";
import AvalonRoleGuideSidebar from "./AvalonRoleGuideSidebar";
import {
  failThreshold,
  getKnowledge,
  type AvalonState,
  type EngineAction,
  type Role,
  type SeatIndex,
  type Team,
  type WinReason,
} from "./engine";

/**
 * Pure game UI + rules driver — mirrors BangBoard/GridPokerBoard's contract:
 * state is fully controlled by the caller (AvalonGame, which owns the
 * Supabase Realtime sync); this component only ever emits intent via
 * `onAction`, never mutates state itself. Every client holds the FULL state
 * (every seat's secret role) in memory — this component only ever *renders*
 * the viewer's own role/knowledge via `getKnowledge(state, viewerSeat)`. See
 * engine.ts and README for the accepted trust trade-off (no server authority).
 */
export interface AvalonBoardProps {
  state: AvalonState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

const ROLE_META: Record<Role, { label: string; icon: string; team: Team }> = {
  merlin: { label: "메를린", icon: "🧙", team: "good" },
  percival: { label: "퍼시벌", icon: "🛡️", team: "good" },
  loyalist: { label: "충신", icon: "⚔️", team: "good" },
  morgana: { label: "모르가나", icon: "🌙", team: "evil" },
  mordred: { label: "모드레드", icon: "👑", team: "evil" },
  oberon: { label: "오베론", icon: "🏝️", team: "evil" },
  assassin: { label: "암살자", icon: "🏹", team: "evil" },
};

const TEAM_LABEL: Record<Team, string> = {
  good: "선한 세력 승리!",
  evil: "악한 세력 승리!",
};

const WIN_REASON_LABEL: Record<WinReason, string> = {
  "three-fails": "원정 3회 실패",
  "five-rejects": "원정대 지목 5회 연속 부결",
  "assassin-correct": "암살자가 메를린을 정확히 지목",
  "three-successes": "원정 3회 성공 + 메를린 암살 실패",
};

// A deep royal-purple "round table" panel — distinct from Bang's wooden
// saloon and Grid Poker's navy card table, fitting Avalon's Arthurian theme.
const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/50 bg-gradient-to-b from-[#241735] via-[#180f26] to-[#0d0817] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

function TableTexture() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.05]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.15) 0px, rgba(255,255,255,0.15) 1px, transparent 1px, transparent 10px)",
      }}
    />
  );
}

/** Position of a non-viewer seat around the oval table, relative to the viewer always sitting at the bottom. */
function seatPosition(relativeIndex: number, total: number): CSSProperties {
  const angleDeg = 90 + (relativeIndex / total) * 360;
  const angleRad = (angleDeg * Math.PI) / 180;
  const x = 50 + 42 * Math.cos(angleRad);
  const y = 50 + 38 * Math.sin(angleRad);
  return { left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" };
}

export default function AvalonBoard({
  state,
  viewerSeat,
  names,
  connectedSeats,
  onAction,
  onGameEnd,
}: AvalonBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const [roleModalOpen, setRoleModalOpen] = useState(true);
  const [selection, setSelection] = useState<SeatIndex[]>([]);

  // `state.players` is only ever set once, inside startGame — no action
  // mutates it afterward — so its object identity is a reliable signal for
  // "a brand new game just started" (including rematches), independent of
  // whether this component instance ever unmounts. Reopen the private role
  // panel exactly then, so nobody has to hunt for the reopen button on turn 1.
  // Adjusting state during render (rather than in a useEffect) so it settles
  // within the same commit instead of triggering an extra cascading render.
  const [trackedPlayers, setTrackedPlayers] = useState(state.players);
  if (trackedPlayers !== state.players) {
    setTrackedPlayers(state.players);
    setRoleModalOpen(true);
  }

  const roundPhaseKey = `${state.round}-${state.phase}`;
  const [trackedRoundPhaseKey, setTrackedRoundPhaseKey] =
    useState(roundPhaseKey);
  if (trackedRoundPhaseKey !== roundPhaseKey) {
    setTrackedRoundPhaseKey(roundPhaseKey);
    setSelection([]);
  }

  const viewer = state.players[viewerSeat];
  const knowledge = useMemo(
    () => getKnowledge(state, viewerSeat),
    [state, viewerSeat],
  );
  const teamSize = state.teamSizes[state.round - 1];
  const isLeader = state.leader === viewerSeat;
  const assassinSeat = useMemo(
    () => state.players.find((p) => p.role === "assassin")?.seat ?? null,
    [state.players],
  );
  const isAssassin = assassinSeat === viewerSeat;

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 아발론 룰북
    </button>
  );

  const roleReopenButton = (
    <button
      onClick={() => setRoleModalOpen(true)}
      className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-200 transition hover:border-amber-300/50"
    >
      🎭 내 역할 다시 보기
    </button>
  );

  // -------------------------------------------------------------------------
  // Game over
  // -------------------------------------------------------------------------
  if (state.phase === "gameOver" && state.winner) {
    return (
      <div
        className={`${TABLE_PANEL} flex flex-col items-center gap-5 p-8 text-center`}
      >
        <TableTexture />
        <span className="relative z-10 text-5xl">🏆</span>
        <h2 className="relative z-10 text-2xl font-bold text-amber-100">
          {TEAM_LABEL[state.winner]}
        </h2>
        <p className="relative z-10 text-sm text-white/60">
          {WIN_REASON_LABEL[state.winReason!]}
        </p>
        <div className="relative z-10 flex flex-wrap justify-center gap-2">
          {state.players.map((p) => {
            const meta = ROLE_META[p.role];
            return (
              <div
                key={p.seat}
                className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-xs ${
                  meta.team === "good"
                    ? "border-sky-400/40 bg-sky-400/10"
                    : "border-rose-400/40 bg-rose-400/10"
                }`}
              >
                <span className="text-white/80">{names[p.seat]}</span>
                <span>
                  {meta.icon} {meta.label}
                </span>
              </div>
            );
          })}
        </div>
        <button
          onClick={onGameEnd}
          className="relative z-10 rounded-full bg-emerald-500 px-8 py-3 font-medium text-white transition hover:bg-emerald-400"
        >
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  const votedCount = Object.keys(state.votes).length;
  const iVoted = state.votes[viewerSeat] !== undefined;
  const questSubmittedCount = Object.keys(state.questCards).length;
  const iAmOnTeam = state.proposedTeam.includes(viewerSeat);
  const iSubmittedQuestCard = state.questCards[viewerSeat] !== undefined;
  const threshold = failThreshold(state.playerCount, state.round);

  function toggleSeatForProposal(seat: SeatIndex) {
    if (!isLeader || state.phase !== "team-proposal") return;
    setSelection((prev) => {
      if (prev.includes(seat)) return prev.filter((s) => s !== seat);
      if (prev.length >= teamSize) return prev;
      return [...prev, seat];
    });
  }

  function submitProposal() {
    if (selection.length !== teamSize) return;
    onAction({ type: "propose-team", seats: selection });
  }

  function castVote(vote: "approve" | "reject") {
    onAction({ type: "vote", seat: viewerSeat, vote });
  }

  function submitQuestCard(card: "success" | "fail") {
    onAction({ type: "play-quest-card", seat: viewerSeat, card });
  }

  function assassinate(target: SeatIndex) {
    onAction({ type: "assassinate", targetSeat: target });
  }

  const otherSeats = Array.from(
    { length: state.playerCount },
    (_, i) => i,
  ).filter((s) => s !== viewerSeat);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
      <div
        className={`${TABLE_PANEL} flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4`}
      >
        <TableTexture />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-1.5 text-xs text-amber-100/60">
          <span>
            {state.playerCount}인 · {state.round}라운드/5 · 원정대 {teamSize}명
            필요
            {threshold > 1
              ? ` · 이번 라운드는 실패 ${threshold}장 이상이어야 실패`
              : ""}
          </span>
          <div className="flex gap-1.5">
            {roleReopenButton}
            {rulebookButton}
          </div>
        </div>

        {/* Round history track — mirrors the physical rulebook's quest-size row (boardGameRule/아발론/아발론보드게임.jpg):
          one tile per round showing the team size, with the round that needs 2 fail cards picked out in red like the
          board's own "2 fails" callout instead of only being mentioned in the text banner above. */}
        <div className="relative z-10 flex justify-center gap-1.5">
          {state.teamSizes.map((size, i) => {
            const roundNumber = i + 1;
            const result = state.questResults[i];
            const isCurrent = state.round === roundNumber;
            const needsTwoFails =
              failThreshold(state.playerCount, roundNumber) > 1;
            return (
              <div
                key={roundNumber}
                className={`relative flex h-14 w-11 flex-col items-center justify-center rounded-xl border text-[10px] ${
                  result
                    ? result.success
                      ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
                      : "border-rose-400/50 bg-rose-400/10 text-rose-200"
                    : isCurrent
                      ? "border-amber-300 bg-amber-400/10 text-amber-100"
                      : "border-white/10 bg-white/5 text-white/40"
                }`}
              >
                {needsTwoFails && (
                  <span
                    title="이 라운드는 실패 카드 2장 이상이어야 실패"
                    className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-rose-300 bg-rose-600 text-[8px] font-bold text-white"
                  >
                    2
                  </span>
                )}
                <span>{roundNumber}R</span>
                <span className="text-sm font-bold">{size}인</span>
                <span>{result ? (result.success ? "✅" : "❌") : "—"}</span>
              </div>
            );
          })}
        </div>

        {/* Round table: every seat placed around an ellipse, viewer always at the bottom. */}
        <div className="relative z-10 mx-auto h-[260px] w-full max-w-md sm:h-[300px]">
          <div className="absolute inset-[8%] rounded-[50%] border-4 border-indigo-900/60 bg-gradient-to-b from-indigo-950/70 to-black/70 shadow-inner" />
          {/* Viewer's own seat, pinned at the bottom center. */}
          <SeatChip
            seat={viewerSeat}
            isSelf
            state={state}
            names={names}
            connectedSeats={connectedSeats}
            selection={selection}
            onClick={toggleSeatForProposal}
            style={seatPosition(0, state.playerCount)}
          />
          {otherSeats.map((seat, i) => (
            <SeatChip
              key={seat}
              seat={seat}
              isSelf={false}
              state={state}
              names={names}
              connectedSeats={connectedSeats}
              selection={selection}
              onClick={toggleSeatForProposal}
              style={seatPosition(i + 1, state.playerCount)}
            />
          ))}
        </div>

        {/* Phase-specific action panel */}
        <div className="relative z-10 rounded-xl border border-white/10 bg-black/30 p-3 text-center">
          {state.phase === "team-proposal" &&
            (isLeader ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-amber-100/80">
                  원정대 {teamSize}명을 골라주세요 ({selection.length}/
                  {teamSize} 선택됨) — 좌석을 눌러 선택하세요.
                </p>
                <button
                  disabled={selection.length !== teamSize}
                  onClick={submitProposal}
                  className="mx-auto w-full max-w-xs rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
                >
                  원정대 제출
                </button>
              </div>
            ) : (
              <p className="text-xs text-amber-100/50">
                {names[state.leader]}님이 원정대를 고르는 중...
              </p>
            ))}

          {state.phase === "voting" &&
            (iVoted ? (
              <p className="text-xs text-amber-100/60">
                투표 완료 · {votedCount}/{state.playerCount}명 투표함 — 다른
                사람을 기다리는 중...
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-amber-100/80">
                  원정대: {state.proposedTeam.map((s) => names[s]).join(", ")} —
                  찬성하시겠어요?
                </p>
                <p className="text-[11px] text-amber-100/40">
                  {votedCount}/{state.playerCount}명 투표함
                </p>
                <div className="flex justify-center gap-2">
                  <button
                    onClick={() => castVote("approve")}
                    className="rounded-full bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    👍 찬성
                  </button>
                  <button
                    onClick={() => castVote("reject")}
                    className="rounded-full bg-rose-600 px-5 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                  >
                    👎 반대
                  </button>
                </div>
              </div>
            ))}

          {state.phase === "quest" &&
            (!iAmOnTeam ? (
              <p className="text-xs text-amber-100/50">
                원정대({state.proposedTeam.map((s) => names[s]).join(", ")})가
                카드를 제출하는 중... ({questSubmittedCount}/{teamSize})
              </p>
            ) : iSubmittedQuestCard ? (
              <p className="text-xs text-amber-100/60">
                제출 완료 · {questSubmittedCount}/{teamSize}명 제출함 — 다른
                원정대원을 기다리는 중...
              </p>
            ) : viewer.team === "good" ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-amber-100/80">
                  선한 세력은 무조건 성공 카드만 제출할 수 있어요.
                </p>
                <button
                  onClick={() => submitQuestCard("success")}
                  className="rounded-full bg-emerald-600 px-6 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  ✅ 성공 제출
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-amber-100/80">
                  원정 카드를 비공개로 제출하세요.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => submitQuestCard("success")}
                    className="rounded-full bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    ✅ 성공
                  </button>
                  <button
                    onClick={() => submitQuestCard("fail")}
                    className="rounded-full bg-rose-600 px-5 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                  >
                    ❌ 실패
                  </button>
                </div>
              </div>
            ))}

          {state.phase === "assassination" &&
            (isAssassin ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-amber-100/80">
                  원정 3회 성공! 메를린으로 의심되는 사람을 지목해 암살하세요.
                  정확히 맞히면 악한 세력이 역전 승리합니다.
                </p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {state.players
                    .filter((p) => p.seat !== viewerSeat)
                    .map((p) => (
                      <button
                        key={p.seat}
                        onClick={() => assassinate(p.seat)}
                        className="rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-100 hover:border-rose-400/70 hover:bg-rose-500/20"
                      >
                        🏹 {names[p.seat]}
                      </button>
                    ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-amber-100/50">
                원정 3회 성공!{" "}
                {assassinSeat !== null ? names[assassinSeat] : "암살자"}님이
                메를린을 지목하는 중...
              </p>
            ))}
        </div>

        {rulebookOpen && (
          <RulebookModal onClose={() => setRulebookOpen(false)} />
        )}
        {roleModalOpen && (
          <RoleModal
            viewerSeat={viewerSeat}
            names={names}
            viewer={viewer}
            knowledge={knowledge}
            onClose={() => setRoleModalOpen(false)}
          />
        )}
      </div>
      <AvalonRoleGuideSidebar
        state={state}
        viewerSeat={viewerSeat}
        names={names}
        knowledge={knowledge}
      />
    </div>
  );
}

function SeatChip({
  seat,
  isSelf,
  state,
  names,
  connectedSeats,
  selection,
  onClick,
  style,
}: {
  seat: SeatIndex;
  isSelf: boolean;
  state: AvalonState;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  selection: SeatIndex[];
  onClick: (seat: SeatIndex) => void;
  style: CSSProperties;
}) {
  const isLeader = state.leader === seat;
  const inProposedTeam = state.proposedTeam.includes(seat);
  const isSelectable =
    state.phase === "team-proposal" && state.leader !== undefined;
  const isSelected = selection.includes(seat);
  const votedAlready =
    state.phase === "voting" && state.votes[seat] !== undefined;
  const questSubmittedAlready =
    state.phase === "quest" &&
    state.proposedTeam.includes(seat) &&
    state.questCards[seat] !== undefined;

  return (
    <div style={style} className="absolute flex flex-col items-center gap-0.5">
      <button
        disabled={!isSelectable}
        onClick={() => onClick(seat)}
        className={`flex flex-col items-center gap-0.5 rounded-xl border-2 px-2 py-1.5 text-center shadow-md transition ${
          isSelected
            ? "border-amber-300 bg-amber-500/20 ring-2 ring-amber-300"
            : inProposedTeam
              ? "border-sky-300/70 bg-sky-500/10"
              : isLeader
                ? "border-amber-300/60 bg-amber-950/40"
                : "border-white/15 bg-black/40"
        } ${isSelectable ? "cursor-pointer hover:border-amber-300/60" : ""}`}
      >
        <span className="flex items-center gap-1 text-[11px] font-semibold text-white/90">
          <span
            className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`}
          />
          {isLeader && <span title="리더">👑</span>}
          {names[seat]}
          {isSelf && <span className="text-amber-200">(나)</span>}
        </span>
        <span className="flex gap-1 text-[10px] text-amber-100/50">
          {votedAlready && <span title="투표 완료">🗳️</span>}
          {questSubmittedAlready && <span title="카드 제출 완료">🃏</span>}
        </span>
      </button>
    </div>
  );
}

function RoleModal({
  viewerSeat,
  names,
  viewer,
  knowledge,
  onClose,
}: {
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  viewer: AvalonState["players"][number];
  knowledge: ReturnType<typeof getKnowledge>;
  onClose: () => void;
}) {
  const meta = ROLE_META[viewer.role];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-amber-400/30 bg-[#1a1128] p-6 text-center shadow-2xl">
        <p className="mb-1 text-xs text-white/40">
          {names[viewerSeat]}님의 비밀 정보
        </p>
        <div className="mb-3 text-5xl">{meta.icon}</div>
        <h2
          className={`mb-1 text-xl font-bold ${meta.team === "good" ? "text-sky-300" : "text-rose-300"}`}
        >
          {meta.label}
        </h2>
        <p className="mb-4 text-sm text-white/60">
          당신은 {meta.team === "good" ? "선한 세력" : "악한 세력"}입니다.
        </p>

        {knowledge.evilSeatsKnown.length > 0 && (
          <div className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
            <p className="mb-1 font-medium">악의 세력으로 확인된 사람</p>
            <p>{knowledge.evilSeatsKnown.map((s) => names[s]).join(", ")}</p>
          </div>
        )}

        {knowledge.merlinPercivalCandidates.length > 0 && (
          <div className="mb-3 rounded-xl border border-sky-400/30 bg-sky-500/10 p-3 text-sm text-sky-100">
            <p className="mb-1 font-medium">메를린 또는 모르가나</p>
            <p>
              {knowledge.merlinPercivalCandidates
                .map((s) => names[s])
                .join(", ")}
            </p>
            <p className="mt-1 text-xs text-sky-200/60">
              둘 중 누가 진짜 메를린인지는 알 수 없습니다.
            </p>
          </div>
        )}

        {knowledge.evilSeatsKnown.length === 0 &&
          knowledge.merlinPercivalCandidates.length === 0 && (
            <p className="mb-3 text-xs text-white/40">
              이 역할은 다른 사람에 대한 추가 정보가 없습니다.
            </p>
          )}

        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500"
        >
          확인했어요
        </button>
      </div>
    </div>
  );
}
