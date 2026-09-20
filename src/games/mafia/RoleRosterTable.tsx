"use client";

import { useState } from "react";
import { rolePoolFor, type MafiaMode, type Role, type Team } from "./engine";

/**
 * 좌측 상단 "직업 배정 현황표" (2026-09-20 요청) — `rolePoolFor`가 셔플 전
 * 반환하는 고정 인원수 분포를 그대로 집계해서 보여준다(실제 좌석 배정과
 * 무관하게 방 설정만으로 결정되는 값이라 게임 시작 전에도 정확하다).
 * 데스크톱은 항상 펼친 상태, 모바일은 미니 뱃지로 접혀 있다가 탭하면 아래로
 * 펼쳐지는 드롭다운 — 생존자 그리드는 문서 흐름상 이 컴포넌트 아래에 오므로
 * 접힌 상태든 펼친 상태든 절대 가리지 않는다.
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

export interface RoleRosterTableProps {
  mode: MafiaMode;
  playerCount: number;
}

function RosterRows({ roster }: { roster: { role: Role; count: number }[] }) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <tbody className="divide-y divide-white/10 light:divide-slate-200">
        {roster.map(({ role, count }) => {
          const m = ROLE_META[role];
          return (
            <tr key={role}>
              <td className="flex items-center gap-1.5 py-1 pl-1">
                <span className="text-xs">{m.icon}</span>
                <span className={`font-semibold ${m.team === "mafia" ? "text-rose-300 light:text-rose-600" : "text-white/80 light:text-slate-700"}`}>{m.label}</span>
              </td>
              <td className="py-1 pr-1 text-right font-mono font-bold text-amber-300 light:text-amber-700">{count}명</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function RoleRosterTable({ mode, playerCount }: RoleRosterTableProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const roster = rosterFor(mode, playerCount);

  return (
    <div className="relative z-20 flex shrink-0 self-start">
      {/* 데스크톱: 항상 펼쳐진 고정 카드 */}
      <div className="hidden overflow-hidden rounded-xl border border-amber-500/30 bg-neutral-900/95 shadow-lg backdrop-blur-md lg:block light:border-amber-300/50 light:bg-white">
        <div className="flex items-center gap-1.5 border-b border-white/10 bg-black/30 px-2.5 py-1.5 light:border-slate-200 light:bg-slate-50">
          <span className="text-xs">📋</span>
          <span className="text-[11px] font-bold text-amber-300 light:text-amber-700">직업 배정 ({playerCount}인)</span>
        </div>
        <div className="max-h-[40vh] overflow-y-auto p-1.5">
          <RosterRows roster={roster} />
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
            <div className="absolute top-full left-0 z-20 mt-1 min-w-[150px] overflow-hidden rounded-xl border border-amber-500/30 bg-neutral-900/95 shadow-2xl backdrop-blur-md transition-all duration-150 light:border-amber-300/50 light:bg-white">
              <div className="max-h-[40vh] overflow-y-auto p-1.5">
                <RosterRows roster={roster} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
