"use client";

import { useState } from "react";
import {
  failThreshold,
  type AvalonState,
  type Role,
  type SeatIndex,
  type Team,
} from "./engine";

/**
 * Always-available "내 역할 & 목표" reference panel (companion to the
 * one-shot `RoleModal` in AvalonBoard.tsx, which still fires once per game
 * start/rematch for the initial reveal — see HANDOFF.md). Unlike that modal,
 * this never blocks the board: on desktop (lg+) it renders as a fixed-width
 * column beside the table (the `[gameId]` page widens Avalon's container for
 * this, same pattern as `SummonersRiftGuideSidebar`); on narrower viewports
 * it collapses to an edge tab that slides open a drawer over the board on
 * demand, so it never covers gameplay uninvited.
 *
 * Content is a static per-role reference (ability blurb + team objective)
 * plus one derived "what do I do right now" line — the same knowledge/phase
 * data the rest of the board already reads, just summarized in one place.
 */

const ROLE_META: Record<Role, { label: string; icon: string; team: Team }> = {
  merlin: { label: "메를린", icon: "🧙", team: "good" },
  percival: { label: "퍼시벌", icon: "🛡️", team: "good" },
  loyalist: { label: "충신", icon: "⚔️", team: "good" },
  morgana: { label: "모르가나", icon: "🌙", team: "evil" },
  mordred: { label: "모드레드", icon: "👑", team: "evil" },
  oberon: { label: "오베론", icon: "🏝️", team: "evil" },
  assassin: { label: "암살자", icon: "🏹", team: "evil" },
};

/** Static per-role ability blurb — what this role privately knows/can do, independent of the current game's seat assignment. */
const ROLE_ABILITY: Record<Role, string> = {
  merlin:
    "게임 시작 시 악의 세력을 모두 알고 있습니다(모드레드는 제외). 다만 정체를 들키면 안 됩니다 — 너무 확신에 차서 행동하면 마지막에 암살자에게 지목당해요.",
  percival:
    "게임 시작 시 메를린과 모르가나 두 사람을 함께 보지만, 둘 중 누가 진짜 메를린인지는 알 수 없습니다. 대화를 통해 진짜를 가려내야 해요.",
  loyalist:
    "특별한 정보 없이 시작합니다. 원정 결과와 사람들의 행동 패턴을 관찰해서 누가 악의 세력인지 추리해야 해요.",
  morgana:
    "게임 시작 시 다른 악의 세력 동료를 모두 알고 있습니다. 퍼시벌에게는 메를린으로 보이므로, 그 오해를 적극적으로 이용하세요.",
  mordred:
    "게임 시작 시 다른 악의 세력 동료를 모두 알고 있습니다. 메를린에게도 악의 세력으로 보이지 않는 유일한 존재이므로, 원정대에 은근슬쩍 끼어들기 좋아요.",
  oberon:
    "다른 악의 세력이 누구인지 모르고, 다른 악의 세력도 오베론을 알아보지 못합니다. 홀로 눈치껏 방해해야 해요.",
  assassin:
    "게임 시작 시 다른 악의 세력 동료를 모두 알고 있습니다. 원정이 3회 실패하면 그 즉시, 3회 성공하면 최종 암살 페이즈에서 메를린으로 의심되는 사람을 지목해 역전을 노릴 수 있어요.",
};

const TEAM_META: Record<Team, { label: string; icon: string; accent: string }> =
  {
    good: { label: "선한 세력 (아서 왕의 충신)", icon: "🛡️", accent: "sky" },
    evil: { label: "악한 세력 (모드레드의 수하)", icon: "🗡️", accent: "rose" },
  };

const TEAM_OBJECTIVES: Record<Team, string[]> = {
  good: [
    "원정 3회 성공 달성하기",
    "원정 3회를 성공해도, 최종 페이즈에서 메를린의 정체가 암살자에게 발각되지 않기",
  ],
  evil: [
    "원정 3회 실패시키기",
    "원정대 지목이 5연속 부결되도록 유도하기",
    "원정 3회 성공을 허용했더라도, 최종 페이즈에서 메를린을 정확히 암살해 역전승 거두기",
  ],
};

export interface AvalonRoleGuideSidebarProps {
  state: AvalonState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  knowledge: {
    role: Role;
    team: Team;
    evilSeatsKnown: SeatIndex[];
    merlinPercivalCandidates: SeatIndex[];
  };
}

/** One-line "what should I do right now" summary for the current phase, tailored to the viewer's own situation. */
function currentActionGuide(state: AvalonState, viewerSeat: SeatIndex): string {
  const isLeader = state.leader === viewerSeat;
  const viewer = state.players[viewerSeat];

  switch (state.phase) {
    case "team-proposal":
      return isLeader
        ? `내가 리더예요 — 원정대 ${state.teamSizes[state.round - 1]}명을 골라 제출하세요.`
        : "리더가 원정대를 고르는 중이에요 — 잠시 기다려주세요.";
    case "voting": {
      if (state.votes[viewerSeat] !== undefined)
        return "투표를 완료했어요 — 다른 사람들의 투표를 기다리는 중.";
      return "제안된 원정대에 찬성/반대 투표를 하세요. 의심스러우면 반대해도 괜찮아요 (5연속 부결이면 악의 세력이 즉시 승리하니 주의).";
    }
    case "quest": {
      if (!state.proposedTeam.includes(viewerSeat))
        return "원정대가 카드를 제출하는 중이에요 — 결과를 기다려주세요.";
      if (state.questCards[viewerSeat] !== undefined)
        return "카드를 제출했어요 — 다른 원정대원을 기다리는 중.";
      return viewer.team === "good"
        ? "원정대에 뽑혔어요 — 선한 세력은 무조건 '성공' 카드만 낼 수 있어요."
        : "원정대에 뽑혔어요 — '성공'과 '실패' 중 골라 비공개로 제출하세요.";
    }
    case "assassination": {
      const isAssassin = viewer.role === "assassin";
      return isAssassin
        ? "원정 3회 성공! 메를린으로 의심되는 사람을 지목해 마지막 역전을 노리세요."
        : "원정 3회 성공! 암살자가 메를린을 지목하는 중이에요 — 결과를 기다려주세요.";
    }
    case "gameOver":
      return "게임이 종료되었습니다.";
    default:
      return "";
  }
}

function GuideContent({
  state,
  viewerSeat,
  names,
  knowledge,
}: AvalonRoleGuideSidebarProps) {
  const viewer = state.players[viewerSeat];
  const roleMeta = ROLE_META[viewer.role];
  const teamMeta = TEAM_META[viewer.team];
  const threshold = failThreshold(state.playerCount, state.round);

  return (
    <div className="flex flex-col gap-3">
      {/* Role & team badge */}
      <section className="flex flex-col gap-2 rounded-xl border border-amber-300/20 bg-amber-400/[0.06] p-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{roleMeta.icon}</span>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-white">
              {roleMeta.label}
            </span>
            <span
              className={`text-[11px] ${viewer.team === "good" ? "text-sky-300" : "text-rose-300"}`}
            >
              {teamMeta.icon} {teamMeta.label}
            </span>
          </div>
        </div>
      </section>

      {/* Role abilities & vision */}
      <section className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">
          역할 고유 능력
        </p>
        <p className="rounded-lg border border-white/10 bg-black/20 p-2.5 text-[11px] leading-relaxed text-white/70">
          {ROLE_ABILITY[viewer.role]}
        </p>
        {knowledge.evilSeatsKnown.length > 0 && (
          <p className="rounded-lg border border-rose-400/25 bg-rose-500/10 p-2 text-[11px] text-rose-100">
            👁️ 악의 세력으로 확인된 사람:{" "}
            {knowledge.evilSeatsKnown.map((s) => names[s]).join(", ")}
          </p>
        )}
        {knowledge.merlinPercivalCandidates.length > 0 && (
          <p className="rounded-lg border border-sky-400/25 bg-sky-500/10 p-2 text-[11px] text-sky-100">
            👁️ 메를린 또는 모르가나:{" "}
            {knowledge.merlinPercivalCandidates.map((s) => names[s]).join(", ")}{" "}
            (누가 진짜인지는 알 수 없음)
          </p>
        )}
      </section>

      {/* Team objectives */}
      <section className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">
          {teamMeta.icon} {viewer.team === "good" ? "선한 세력" : "악한 세력"}{" "}
          승리 목표
        </p>
        <ul className="flex flex-col gap-1">
          {TEAM_OBJECTIVES[viewer.team].map((objective, i) => (
            <li
              key={i}
              className={`rounded-lg border p-2 text-[11px] leading-relaxed ${
                viewer.team === "good"
                  ? "border-sky-400/20 bg-sky-500/[0.06] text-sky-100/90"
                  : "border-rose-400/20 bg-rose-500/[0.06] text-rose-100/90"
              }`}
            >
              {objective}
            </li>
          ))}
        </ul>
        {threshold > 1 && state.phase !== "gameOver" && (
          <p className="text-[10px] text-amber-200/60">
            ⚠️ 이번 {state.round}라운드는 실패 카드 2장 이상이어야 원정이
            실패해요.
          </p>
        )}
      </section>

      {/* Current-phase action guide */}
      <section className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">
          지금 할 일
        </p>
        <p className="rounded-lg border border-amber-300/25 bg-amber-400/10 p-2.5 text-[11px] leading-relaxed text-amber-100">
          {currentActionGuide(state, viewerSeat)}
        </p>
      </section>
    </div>
  );
}

export default function AvalonRoleGuideSidebar(
  props: AvalonRoleGuideSidebarProps,
) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const viewer = props.state.players[props.viewerSeat];
  const roleMeta = ROLE_META[viewer.role];

  return (
    <>
      {/* Desktop: always-visible fixed column beside the board. */}
      <aside
        className="hidden w-72 shrink-0 flex-col gap-3 rounded-[24px] border p-3 text-xs lg:flex"
        style={{
          borderColor: "rgba(200,170,110,0.25)",
          background:
            "linear-gradient(160deg,#241735 0%,#180f26 45%,#0d0817 100%)",
        }}
      >
        <h3
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color: "#e5c07b" }}
        >
          🎭 내 역할 &amp; 목표
        </h3>
        <GuideContent {...props} />
      </aside>

      {/* Mobile/tablet: collapsed edge tab that opens a slide-in drawer, so the board is never obstructed uninvited. */}
      <button
        onClick={() => setDrawerOpen(true)}
        aria-label="내 역할 및 목표 패널 열기"
        className="fixed top-1/2 right-0 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-xl border border-r-0 border-amber-300/30 bg-[#180f26] px-1.5 py-3 text-[10px] font-semibold text-amber-200 shadow-lg lg:hidden"
      >
        <span className="text-base">{roleMeta.icon}</span>
        <span className="[writing-mode:vertical-rl]">내 역할</span>
      </button>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative flex h-full w-[85vw] max-w-sm flex-col gap-3 overflow-y-auto border-l border-amber-300/20 bg-[#180f26] p-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between">
              <h3
                className="text-[11px] font-semibold tracking-wide uppercase"
                style={{ color: "#e5c07b" }}
              >
                🎭 내 역할 &amp; 목표
              </h3>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="닫기"
                className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:border-white/30 hover:text-white"
              >
                ✕
              </button>
            </div>
            <GuideContent {...props} />
          </div>
        </div>
      )}
    </>
  );
}
