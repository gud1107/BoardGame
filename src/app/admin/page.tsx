"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useAdminStore } from "@/store/adminStore";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { TIER_LABELS, type Tier } from "@/lib/entitlements/types";
import { SUPER_ADMIN_EMAIL } from "@/lib/admin/superAdmin";

const TIERS: Tier[] = ["free", "lite", "max"];

export default function AdminPage() {
  const loading = useAdminStore((s) => s.loading);
  const settings = useAdminStore((s) => s.settings);
  const users = useAdminStore((s) => s.users);
  const usersError = useAdminStore((s) => s.usersError);
  const savingUserId = useAdminStore((s) => s.savingUserId);
  const settingsSaving = useAdminStore((s) => s.settingsSaving);
  const init = useAdminStore((s) => s.init);
  const setSettings = useAdminStore((s) => s.setSettings);
  const saveSettings = useAdminStore((s) => s.saveSettings);
  const saveUser = useAdminStore((s) => s.saveUser);

  // Who's actually logged in right now — the entitlements kill switch below
  // is only interactive for the super-admin account, see superAdmin.ts.
  const myEmail = useSubscriptionStore((s) => s.email);
  const initSubscription = useSubscriptionStore((s) => s.init);
  const isSuperAdmin = myEmail === SUPER_ADMIN_EMAIL;

  useEffect(() => {
    void init();
    void initSubscription();
  }, [init, initSubscription]);

  if (loading || !settings) {
    return <div className="mx-auto max-w-5xl px-4 py-16 text-center text-sm text-white/40">불러오는 중…</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">관리자 대시보드</h1>
        <Link
          href="/admin/stats"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/30"
        >
          📊 방문/플레이 통계 →
        </Link>
      </div>

      <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="mb-4 text-sm font-semibold text-white/80">사이트 전역 설정</h2>
        <div className="flex flex-col gap-4">
          <label
            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
              isSuperAdmin ? "border-rose-400/30 bg-rose-500/[0.06] text-white" : "border-white/10 text-white/40"
            }`}
            title={isSuperAdmin ? undefined : `${SUPER_ADMIN_EMAIL} 계정으로 로그인해야 변경할 수 있습니다.`}
          >
            <span>
              🔒 무료/사용량 제한 전체 ON/OFF{" "}
              <span className="text-xs opacity-70">(끄면 모든 티어가 무제한으로 플레이 가능)</span>
            </span>
            <input
              type="checkbox"
              checked={settings.entitlementsEnabled}
              disabled={!isSuperAdmin}
              onChange={(e) => setSettings({ ...settings, entitlementsEnabled: e.target.checked })}
              className="h-4 w-4 disabled:cursor-not-allowed"
            />
          </label>
          {!isSuperAdmin && (
            <p className="-mt-2 text-xs text-white/40">
              위 스위치는 개발자 계정({SUPER_ADMIN_EMAIL})으로 로그인했을 때만 켜고 끌 수 있습니다.
            </p>
          )}
          <label className="flex items-center justify-between text-sm text-white/70">
            게스트 모드 (로그인 없이 즉시 플레이)
            <input
              type="checkbox"
              checked={settings.guestModeEnabled}
              onChange={(e) => setSettings({ ...settings, guestModeEnabled: e.target.checked })}
              className="h-4 w-4"
            />
          </label>
          <label className="flex items-center justify-between text-sm text-white/70">
            과금 방식
            <select
              value={settings.meteringMode}
              onChange={(e) => setSettings({ ...settings, meteringMode: e.target.value as "coin" | "time" })}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-white"
            >
              <option value="coin">횟수(코인) 제한형</option>
              <option value="time">시간 제한형</option>
            </select>
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {TIERS.map((tier) => (
              <div key={tier} className="rounded-xl border border-white/10 p-3">
                <p className="mb-2 text-xs font-semibold text-white/60">{TIER_LABELS[tier]}</p>
                <label className="mb-1 flex items-center justify-between text-xs text-white/50">
                  하루 게임 수
                  <input
                    type="number"
                    min={0}
                    value={settings.tierLimits[tier].gamesPerDay}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        tierLimits: {
                          ...settings.tierLimits,
                          [tier]: { ...settings.tierLimits[tier], gamesPerDay: Number(e.target.value) },
                        },
                      })
                    }
                    className="w-16 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-right text-white"
                  />
                </label>
                <label className="flex items-center justify-between text-xs text-white/50">
                  하루 이용 시간(분)
                  <input
                    type="number"
                    min={0}
                    value={settings.tierLimits[tier].minutesPerDay}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        tierLimits: {
                          ...settings.tierLimits,
                          [tier]: { ...settings.tierLimits[tier], minutesPerDay: Number(e.target.value) },
                        },
                      })
                    }
                    className="w-16 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-right text-white"
                  />
                </label>
              </div>
            ))}
            <div className="rounded-xl border border-dashed border-white/15 p-3">
              <p className="mb-2 text-xs font-semibold text-white/60">게스트</p>
              <label className="mb-1 flex items-center justify-between text-xs text-white/50">
                하루 게임 수
                <input
                  type="number"
                  min={0}
                  value={settings.guestLimits.gamesPerDay}
                  onChange={(e) =>
                    setSettings({ ...settings, guestLimits: { ...settings.guestLimits, gamesPerDay: Number(e.target.value) } })
                  }
                  className="w-16 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-right text-white"
                />
              </label>
              <label className="flex items-center justify-between text-xs text-white/50">
                하루 이용 시간(분)
                <input
                  type="number"
                  min={0}
                  value={settings.guestLimits.minutesPerDay}
                  onChange={(e) =>
                    setSettings({ ...settings, guestLimits: { ...settings.guestLimits, minutesPerDay: Number(e.target.value) } })
                  }
                  className="w-16 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-right text-white"
                />
              </label>
            </div>
          </div>

          <button
            onClick={() => void saveSettings()}
            disabled={settingsSaving}
            className="w-fit rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50"
          >
            {settingsSaving ? "저장 중…" : "설정 저장"}
          </button>
        </div>
      </section>

      <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="mb-4 text-sm font-semibold text-white/80">가입 유저 ({users.length}명)</h2>
        {usersError && <p className="text-xs text-rose-300">{usersError}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-white/40">
              <tr>
                <th className="pb-2 pr-3">이메일</th>
                <th className="pb-2 pr-3">역할</th>
                <th className="pb-2 pr-3">요금제</th>
                <th className="pb-2 pr-3">오늘 사용량</th>
                <th className="pb-2 pr-3">만료일</th>
                <th className="pb-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-white/5 text-white/70">
                  <td className="py-2 pr-3">{u.email}</td>
                  <td className="py-2 pr-3">{u.role}</td>
                  <td className="py-2 pr-3">
                    <select
                      value={u.tier}
                      onChange={(e) => void saveUser(u.id, { tier: e.target.value as Tier })}
                      disabled={savingUserId === u.id}
                      className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-white"
                    >
                      {TIERS.map((t) => (
                        <option key={t} value={t}>
                          {TIER_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    {u.gamesUsedToday}회 · {u.minutesUsedToday}분
                  </td>
                  <td className="py-2 pr-3">{u.periodEnd ? new Date(u.periodEnd).toLocaleDateString("ko-KR") : "—"}</td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => void saveUser(u.id, { resetUsageToday: true })}
                      disabled={savingUserId === u.id}
                      className="rounded border border-white/15 px-2 py-1 text-white/60 hover:border-white/30"
                    >
                      오늘 사용량 초기화
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-sm text-white/40">
        📊 방문자 통계 / 게임별 플레이 통계는 위의 <Link href="/admin/stats" className="underline">방문/플레이 통계</Link>{" "}
        페이지로 옮겨졌습니다. IP 지오로케이션 등 추가 세부 지표는 다음 단계에서 검토합니다.
      </section>
    </div>
  );
}
