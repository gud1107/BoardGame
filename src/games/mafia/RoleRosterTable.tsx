"use client";

import { Fragment, useState } from "react";
import { rolePoolFor, type MafiaMode, type PublicLogEntry, type Role, type Team } from "./engine";

/**
 * 좌측 상단 "직업 배정 현황표" (2026-09-20 요청) — `rolePoolFor`가 셔플 전
 * 반환하는 고정 인원수 분포를 그대로 집계해서 보여준다(실제 좌석 배정과
 * 무관하게 방 설정만으로 결정되는 값이라 게임 시작 전에도 정확하다).
 * 데스크톱은 항상 펼친 상태, 모바일은 미니 뱃지로 접혀 있다가 탭하면 아래로
 * 펼쳐지는 드롭다운 — 생존자 그리드는 문서 흐름상 이 컴포넌트 아래에 오므로
 * 접힌 상태든 펼친 상태든 절대 가리지 않는다.
 *
 * 2026-09-20 2차 요청 — 직업 이름을 탭하면 능력 설명 + "이번 게임에서
 * 공개적으로 드러난 행동 로그"가 펼쳐진다. 로그는 `state.publicLog`(엔진의
 * `dayAnnounce`/`execution`/`terroristRevenge` 단계가 이미 전원에게
 * 공개하는 사실만 누적한 배열)에서 이 역할과 관련된 항목만 골라 보여준다 —
 * 새로운 정체 정보를 절대 드러내지 않는다("의사가 치료했다"는 보여주되
 * "그 의사가 몇 번 좌석인지"는 보여주지 않는 식, 기존 `dayAnnounce` 안내
 * 문구와 동일한 트레이드오프). 조사류 능력(경찰/스파이/영매)은 결과가 항상
 * 비공개라 로그가 존재하지 않는다.
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

const ROLE_ABILITY: Record<Role, string> = {
  citizen: "특수 능력은 없습니다. 낮 토론과 투표로 마피아를 찾아내는 것이 유일한 무기예요.",
  mafia: "매일 밤 동료와 함께 시민 1명을 지목해 제거합니다.",
  police: "매일 밤 1명을 조사해 마피아인지 아닌지 확인합니다. 누구를 조사했는지는 비공개지만, 성공/실패 여부는 그날 밤 전원에게 익명으로 공개돼요.",
  doctor: "매일 밤 1명을 지정해 마피아의 습격으로부터 보호합니다.",
  spy: "매일 밤 1명을 조사해 정확한 직업을 알아냅니다. 마피아를 찾아내면 그날 밤부터 암살 표결에 합류해요. (결과는 본인만 알 수 있어요)",
  soldier: "마피아의 습격을 1회 자동으로 막아냅니다 (방탄조끼, 게임당 1회).",
  politician: "낮 찬반 투표로는 처형되지 않으며, 투표권이 2표로 계산돼요.",
  medium: "매일 밤 이미 사망한 사람 1명의 진짜 직업을 확인합니다. (결과는 본인만 알 수 있어요)",
  terrorist: "낮 투표로 처형당하면, 자신을 지목했던 사람 중 1명을 길동무로 데려가요.",
};

function rosterFor(mode: MafiaMode, playerCount: number): { role: Role; count: number }[] {
  const pool = rolePoolFor(mode, playerCount);
  const order: Role[] = [];
  const counts = new Map<Role, number>();
  for (const role of pool) {
    if (!counts.has(role)) order.push(role);
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return order.map((role) => ({ role, count: counts.get(role)! }));
}

/** 이 역할과 관련해 이미 전원에게 공개된 사건만 골라 문장으로 옮긴다 — 좌석/정체는 절대 언급하지 않는다. */
function publicLogLinesFor(role: Role, log: readonly PublicLogEntry[]): string[] {
  const lines: string[] = [];
  for (const e of log) {
    if (role === "mafia" && e.type === "mafiaAttack") {
      if (e.savedByDoctor) lines.push(`${e.night}일차 밤: 습격을 시도했지만 의사의 치료로 실패`);
      else if (e.savedByArmor) lines.push(`${e.night}일차 밤: 습격을 시도했지만 군인의 방탄조끼에 막힘`);
      else if (e.victim !== null) lines.push(`${e.night}일차 밤: 습격 성공`);
    } else if (role === "doctor" && e.type === "mafiaAttack" && e.savedByDoctor) {
      lines.push(`${e.night}일차 밤: 치료로 목숨을 구함`);
    } else if (role === "soldier" && e.type === "mafiaAttack" && e.savedByArmor) {
      lines.push(`${e.night}일차 밤: 방탄조끼로 습격을 막아냄`);
    } else if (role === "politician" && e.type === "execution" && e.blockedByPolitician) {
      lines.push(`${e.day}일차: 처형 투표가 가결됐지만 정치인이라 면제됨`);
    } else if (role === "terrorist" && e.type === "terroristRevenge") {
      lines.push(`${e.day}일차: 처형되며 길동무 1명을 함께 처형시킴`);
    } else if (role === "police" && e.type === "policeCheck") {
      lines.push(e.foundMafia ? `${e.night}일차 밤: 조사 성공 — 마피아를 찾아냄` : `${e.night}일차 밤: 조사 실패 — 마피아가 아니었음`);
    }
  }
  return lines;
}

export interface RoleRosterTableProps {
  mode: MafiaMode;
  playerCount: number;
  publicLog: readonly PublicLogEntry[];
}

function RoleDetail({ role, publicLog }: { role: Role; publicLog: readonly PublicLogEntry[] }) {
  const lines = publicLogLinesFor(role, publicLog);
  // 2026-09-21 요청: 경찰만 성공/실패 여부가 매밤 공개되도록 변경(스파이/영매는 여전히 완전 비공개).
  const hasNoPublicRecord = role === "citizen" || role === "spy" || role === "medium";
  return (
    <div className="flex flex-col gap-1.5 px-1 pt-1 pb-2 text-[10px]">
      <p className="text-white/70 light:text-slate-600">{ROLE_ABILITY[role]}</p>
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-white/40 uppercase tracking-wide light:text-slate-400">공개된 행동 기록</p>
        {hasNoPublicRecord ? (
          <p className="text-white/40 light:text-slate-400">이 능력의 결과는 항상 비공개라 공개 기록이 없어요.</p>
        ) : lines.length === 0 ? (
          <p className="text-white/40 light:text-slate-400">아직 공개된 행동 기록이 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {lines.map((line, i) => (
              <li key={i} className="rounded-md border border-white/10 bg-black/20 px-1.5 py-1 text-white/70 light:border-slate-200 light:bg-slate-50 light:text-slate-600">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RosterRows({
  roster,
  publicLog,
  expandedRole,
  onToggleRole,
}: {
  roster: { role: Role; count: number }[];
  publicLog: readonly PublicLogEntry[];
  expandedRole: Role | null;
  onToggleRole: (role: Role) => void;
}) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <tbody className="divide-y divide-white/10 light:divide-slate-200">
        {roster.map(({ role, count }) => {
          const m = ROLE_META[role];
          const expanded = expandedRole === role;
          return (
            <Fragment key={role}>
              <tr>
                <td className="py-1 pl-1">
                  <button
                    type="button"
                    onClick={() => onToggleRole(role)}
                    className="flex items-center gap-1.5 text-left hover:underline"
                  >
                    <span className="text-xs">{m.icon}</span>
                    <span className={`font-semibold ${m.team === "mafia" ? "text-rose-300 light:text-rose-600" : "text-white/80 light:text-slate-700"}`}>{m.label}</span>
                  </button>
                </td>
                <td className="py-1 pr-1 text-right font-mono font-bold text-amber-300 light:text-amber-700">{count}명</td>
              </tr>
              {expanded && (
                <tr>
                  <td colSpan={2}>
                    <RoleDetail role={role} publicLog={publicLog} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export default function RoleRosterTable({ mode, playerCount, publicLog }: RoleRosterTableProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedRole, setExpandedRole] = useState<Role | null>(null);
  const roster = rosterFor(mode, playerCount);
  const toggleRole = (role: Role) => setExpandedRole((cur) => (cur === role ? null : role));

  return (
    <div className="relative z-20 flex shrink-0 self-start">
      {/* 데스크톱: 항상 펼쳐진 고정 카드 */}
      <div className="hidden overflow-hidden rounded-xl border border-amber-500/30 bg-neutral-900/95 shadow-lg backdrop-blur-md lg:block light:border-amber-300/50 light:bg-white">
        <div className="flex items-center gap-1.5 border-b border-white/10 bg-black/30 px-2.5 py-1.5 light:border-slate-200 light:bg-slate-50">
          <span className="text-xs">📋</span>
          <span className="text-[11px] font-bold text-amber-300 light:text-amber-700">직업 배정 ({playerCount}인)</span>
        </div>
        <div className="max-h-[40vh] w-56 overflow-y-auto p-1.5">
          <RosterRows roster={roster} publicLog={publicLog} expandedRole={expandedRole} onToggleRole={toggleRole} />
        </div>
      </div>

      {/* 모바일/태블릿: 미니 뱃지 → 탭하면 드롭다운으로 펼쳐짐 */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-neutral-900/95 px-2.5 py-1 text-[11px] font-bold text-amber-300 shadow-md backdrop-blur-md light:border-amber-300/50 light:bg-white light:text-amber-700"
        >
          📋 직업 구성 ({playerCount}인) {mobileOpen ? "▲" : "▼"}
        </button>
        {mobileOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMobileOpen(false)} />
            <div className="absolute top-full left-0 z-20 mt-1 min-w-[190px] overflow-hidden rounded-xl border border-amber-500/30 bg-neutral-900/95 shadow-2xl backdrop-blur-md transition-all duration-150 light:border-amber-300/50 light:bg-white">
              <div className="max-h-[50vh] overflow-y-auto p-1.5">
                <RosterRows roster={roster} publicLog={publicLog} expandedRole={expandedRole} onToggleRole={toggleRole} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
