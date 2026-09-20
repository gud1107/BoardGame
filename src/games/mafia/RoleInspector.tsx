"use client";

import { useState } from "react";
import { getKnowledge, type MafiaState, type Role, type SeatIndex, type Team } from "./engine";

/**
 * Always-on "내 직업 & 목표" HUD (2026-09-20 "우측 항시 내 직업 패널" 요청) —
 * companion to `RoleModal` in MafiaBoard.tsx (which still fires once per
 * game start for the initial reveal). Unlike that modal, this never blocks
 * the board: desktop (lg+) renders it as a fixed-width column beside the
 * board (same pattern as avalon/AvalonRoleGuideSidebar.tsx — see that file's
 * doc — and `/games/[gameId]/page.tsx`'s per-game `pageMaxWidth` map, which
 * now includes "mafia"); narrower viewports collapse it to an edge tab that
 * slides a drawer open on demand.
 */

const ROLE_META: Record<Role, { label: string; icon: string; team: Team }> = {
  citizen: { label: "시민", icon: "🙂", team: "citizen" },
  mafia: { label: "마피아", icon: "🔪", team: "mafia" },
  police: { label: "경찰", icon: "👮", team: "citizen" },
  doctor: { label: "의사", icon: "💉", team: "citizen" },
  spy: { label: "스파이", icon: "🕶️", team: "mafia" },
  soldier: { label: "군인", icon: "🪖", team: "citizen" },
  politician: { label: "정치인", icon: "🎩", team: "citizen" },
  medium: { label: "영매", icon: "🔮", team: "citizen" },
  terrorist: { label: "테러리스트", icon: "💣", team: "citizen" },
};

/** Static per-role ability blurb — dynamic bits (armor remaining, self-heal availability) are appended separately below. */
const ROLE_ABILITY: Record<Role, string> = {
  citizen: "특수 능력은 없습니다. 낮 토론과 투표로 마피아를 찾아내는 것이 유일한 무기예요.",
  mafia: "매일 밤 동료와 함께 시민 1명을 지목해 제거합니다. 팀원의 지목 현황이 실시간으로 공유돼요.",
  police: "매일 밤 1명을 조사해 마피아인지 아닌지 확인합니다. 한 번 알아낸 결과는 게임이 끝날 때까지 기억돼요. 단, 성공/실패 여부(마피아를 찾았는지)는 그날 밤 바로 전원에게 익명으로 공개돼요 — 누구를 조사했는지는 계속 비공개.",
  doctor: "매일 밤 1명을 지정해 마피아의 습격으로부터 보호합니다.",
  spy: "매일 밤 1명을 조사해 정확한 직업을 알아냅니다. 마피아를 찾아내면 그날 밤부터 마피아의 암살 표결에 합류해요.",
  soldier: "마피아의 습격을 1회 자동으로 막아냅니다 (방탄조끼, 게임당 1회).",
  politician: "낮 찬반 투표로는 처형되지 않으며, 지목투표·찬반투표 모두 투표권이 2표로 계산돼요.",
  medium: "매일 밤 이미 사망한 사람 1명의 진짜 직업을 확인합니다.",
  terrorist: "낮 투표로 처형당하면, 자신을 지목했던 사람 중 1명을 길동무로 데려가요.",
};

const TEAM_META: Record<Team, { label: string; icon: string; className: string }> = {
  mafia: { label: "마피아 연합", icon: "🩸", className: "border-rose-500/40 bg-rose-500/10 text-rose-300" },
  citizen: { label: "시민 연합", icon: "🛡️", className: "border-sky-400/40 bg-sky-400/10 text-sky-300" },
};

const TEAM_OBJECTIVES: Record<Team, string> = {
  mafia: "생존한 마피아 진영의 수가 생존한 시민 진영의 수와 같아지거나 더 많아지면 승리합니다.",
  citizen: "마피아 진영(마피아, 스파이 포함)을 모두 제거하면 승리합니다.",
};

function currentActionGuide(state: MafiaState, viewerSeat: SeatIndex): string {
  const viewer = state.players[viewerSeat];
  if (!viewer.alive) return "👻 유령 관전 모드입니다 — 모든 직업을 볼 수 있고, 유령 전용 채팅으로 대화할 수 있어요.";

  switch (state.phase) {
    case "night":
      if (state.nightNumber === 0) return "첫날 밤 상견례 중입니다 — 이번 밤엔 아무 능력도 발동하지 않아요.";
      if (viewer.role === "mafia" || (viewer.role === "spy" && viewer.spyContactedMafia)) {
        return state.nightActions.mafiaVotes[viewerSeat] !== undefined ? "제거 대상을 지목했어요 — 결과를 기다려요." : "오늘 밤 제거할 대상을 동료와 함께 지목하세요.";
      }
      if (viewer.role === "doctor") return state.nightActions.doctorTarget !== undefined ? "보호 대상을 지정했어요." : "오늘 밤 보호할 대상을 지정하세요.";
      if (viewer.role === "police") return state.nightActions.policeTarget !== undefined ? "조사를 완료했어요." : "조사할 대상을 지목하세요.";
      if (viewer.role === "spy") return state.nightActions.spyTarget !== undefined ? "조사를 완료했어요." : "조사할 대상을 지목하세요.";
      if (viewer.role === "medium") return state.nightActions.mediumTarget !== undefined ? "조사를 완료했어요." : "사망한 사람 중 조사할 대상을 고르세요.";
      return "밤에는 특별한 능력이 없어요 — 다른 사람들의 행동을 기다려요.";
    case "dayAnnounce":
      return "아침 브리핑을 확인하세요.";
    case "dayDiscuss":
      return "자유 토론 시간이에요 — 의심스러운 사람에 대해 이야기해보세요.";
    case "nomination":
      return state.nominations[viewerSeat] !== undefined ? "지목을 완료했어요 — 다른 사람들을 기다려요." : "가장 의심스러운 사람을 지목하세요.";
    case "defense":
      return state.suspect === viewerSeat ? "당신이 용의자예요 — 최후 변론을 준비하세요." : "용의자의 최후 변론을 들어보세요.";
    case "finalVote":
      if (state.suspect === viewerSeat) return "다른 생존자들이 당신의 처형 여부를 투표하는 중이에요.";
      return state.finalVotes[viewerSeat] !== undefined ? "투표를 완료했어요 — 결과를 기다려요." : "처형 찬반 투표를 하세요.";
    case "execution":
      return "결과를 확인하세요.";
    case "terroristRevenge":
      return state.pendingTerroristRevenge?.terroristSeat === viewerSeat ? "길동무로 데려갈 사람을 고르세요." : "결과를 지켜보는 중이에요.";
    case "gameOver":
      return "게임이 종료되었습니다.";
    default:
      return "";
  }
}

export interface RoleInspectorProps {
  state: MafiaState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  /** 채팅 입력창 포커스(가상 키보드 팝업) 중이면 true — 모바일 edge-tab/드로어를 임시로 숨긴다. 데스크톱 사이드바는 영향받지 않음(2026-09-20 요청). */
  isChatInputFocused?: boolean;
}

function GuideContent({ state, viewerSeat, names }: RoleInspectorProps) {
  const viewer = state.players[viewerSeat];
  const roleMeta = ROLE_META[viewer.role];
  const teamMeta = TEAM_META[viewer.team];
  const knowledge = getKnowledge(state, viewerSeat);
  const myInvestigations = state.investigationLog.filter((r) => r.investigator === viewerSeat);

  const dynamicNotes: string[] = [];
  if (viewer.role === "soldier") dynamicNotes.push(`🪖 방탄조끼 잔여: ${viewer.hasUsedArmor ? "0회 (이미 사용함)" : "1회"}`);
  if (viewer.role === "doctor") {
    dynamicNotes.push(
      state.nightNumber <= 1
        ? state.config.doctorSelfHeal
          ? "💉 1일차 밤(지금)에 한해 자가치료가 허용돼요."
          : "💉 이 방은 자가치료가 금지되어 있어요."
        : "💉 1일차 밤이 지나면 자가치료는 항상 불가능해요.",
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <section className={`flex items-center justify-between rounded-xl border p-2.5 ${teamMeta.className}`}>
        <span className="text-[11px] font-black tracking-wider">
          {teamMeta.icon} {teamMeta.label.toUpperCase()}
        </span>
        <span className={`text-xs font-bold ${viewer.alive ? "text-emerald-400" : "text-rose-400"}`}>{viewer.alive ? "● 생존" : "💀 사망 (유령)"}</span>
      </section>

      <section className="flex flex-col items-center gap-2 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-neutral-900/60 to-neutral-950/60 p-4 text-center light:border-amber-300/40 light:from-amber-50 light:to-white">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-amber-500/40 bg-black/30 text-4xl shadow-[0_0_18px_rgba(245,158,11,0.2)] light:bg-white">
          {roleMeta.icon}
        </div>
        <h3 className="text-lg font-black tracking-widest text-white light:text-slate-900">{roleMeta.label}</h3>
        <p className="px-1 text-[11px] leading-relaxed text-white/60 light:text-slate-600">{ROLE_ABILITY[viewer.role]}</p>
        {dynamicNotes.map((note, i) => (
          <p key={i} className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[10px] text-amber-200/90 light:border-slate-200 light:bg-slate-50 light:text-amber-700">
            {note}
          </p>
        ))}
      </section>

      {knowledge.mafiaTeammates.length > 0 && (
        <section className="rounded-lg border border-rose-400/25 bg-rose-500/10 p-2.5 text-[11px] text-rose-100">
          🩸 마피아 동료: {knowledge.mafiaTeammates.map((s) => names[s]).join(", ")}
        </section>
      )}

      {myInvestigations.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <p className="text-[10px] font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">🏷️ 내가 확인한 대상</p>
          <div className="flex flex-col gap-1">
            {myInvestigations.map((r, i) => (
              <span
                key={i}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                  r.isMafia
                    ? "border-red-500 bg-red-950 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.6)]"
                    : "border-cyan-400 bg-cyan-950 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.5)]"
                }`}
              >
                {r.isMafia ? "🚨" : "🛡️"} {names[r.target]} — {r.isMafia ? "마피아" : "시민"}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">🏆 승리 조건</p>
        <p className="rounded-lg border border-amber-300/25 bg-amber-400/10 p-2.5 text-[11px] leading-relaxed text-amber-100 light:border-amber-300 light:bg-amber-50 light:text-amber-800">
          {TEAM_OBJECTIVES[viewer.team]}
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">지금 할 일</p>
        <p className="rounded-lg border border-white/10 bg-black/20 p-2.5 text-[11px] leading-relaxed text-white/80 light:border-slate-200 light:bg-slate-50 light:text-slate-700">
          {currentActionGuide(state, viewerSeat)}
        </p>
      </section>
    </div>
  );
}

export default function RoleInspector(props: RoleInspectorProps) {
  const { isChatInputFocused = false } = props;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const viewer = props.state.players[props.viewerSeat];
  const roleMeta = ROLE_META[viewer.role];

  // 채팅 입력에 포커스가 가면(가상 키보드 팝업) 모바일 드로어가 열려 있어도
  // 즉시 닫는다 — 키보드 위로 드로어가 겹쳐 보이는 것을 방지. MafiaBoard.tsx의
  // trackedPlayers 패턴과 동일한 "렌더 중 비교 후 setState" 방식(useEffect 없이).
  const [prevChatFocused, setPrevChatFocused] = useState(isChatInputFocused);
  if (isChatInputFocused !== prevChatFocused) {
    setPrevChatFocused(isChatInputFocused);
    if (isChatInputFocused) setDrawerOpen(false);
  }

  return (
    <>
      {/* Desktop: always-visible fixed column beside the board. */}
      <aside
        className="hidden w-72 shrink-0 flex-col gap-3 rounded-[24px] border border-white/10 bg-[#0f0b0b] p-3 text-xs shadow-2xl lg:flex light:border-slate-200 light:bg-white"
        style={{ background: "linear-gradient(160deg,#1b1414 0%,#120d0d 45%,#0a0707 100%)" }}
      >
        <h3 className="text-[11px] font-semibold tracking-wide text-amber-300 uppercase">🎴 내 직업 &amp; 목표</h3>
        <GuideContent {...props} />
      </aside>

      {/* Mobile/tablet: a collapsed edge badge that opens a slide-in drawer, so the board is never obstructed uninvited.
          Slides out of view while the chat input is focused (virtual keyboard up) so it never collides with the keyboard/chat sheet. */}
      <button
        onClick={() => setDrawerOpen(true)}
        aria-label="내 직업 및 목표 패널 열기"
        className={`fixed top-1/2 right-0 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-xl border border-r-0 border-amber-300/30 bg-[#120d0d] px-1.5 py-3 text-[10px] font-semibold text-amber-200 shadow-lg transition-all duration-200 lg:hidden ${
          isChatInputFocused ? "pointer-events-none translate-x-full opacity-0" : "translate-x-0 opacity-100"
        }`}
      >
        <span className="text-base">{roleMeta.icon}</span>
        <span className="[writing-mode:vertical-rl]">내 직업</span>
      </button>

      {drawerOpen && !isChatInputFocused && (
        <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
          <div className="relative flex h-full w-72 max-w-[80vw] flex-col gap-3 overflow-y-auto border-l border-amber-300/20 bg-[#120d0d] p-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold tracking-wide text-amber-300 uppercase">🎴 내 직업 &amp; 목표</h3>
              <button onClick={() => setDrawerOpen(false)} aria-label="닫기" className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:border-white/30 hover:text-white">
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
