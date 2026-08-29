"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSubscriptionStore } from "@/store/subscriptionStore";
import { useProfileStore } from "@/store/profileStore";
import { TIER_LABELS } from "@/lib/entitlements/types";
import SupabaseRequiredNotice from "@/components/SupabaseRequiredNotice";
import Avatar from "@/components/common/Avatar";
import ProfileModal from "@/components/profile/ProfileModal";

export default function AccountPage() {
  const router = useRouter();

  const hydrated = useSubscriptionStore((s) => s.hydrated);
  const configured = useSubscriptionStore((s) => s.configured);
  const userId = useSubscriptionStore((s) => s.userId);
  const email = useSubscriptionStore((s) => s.email);
  const tier = useSubscriptionStore((s) => s.tier);
  const subscription = useSubscriptionStore((s) => s.subscription);
  const entitlement = useSubscriptionStore((s) => s.entitlement);
  const refresh = useSubscriptionStore((s) => s.refresh);
  const toggleCancelAtPeriodEnd = useSubscriptionStore((s) => s.toggleCancelAtPeriodEnd);
  const signOut = useSubscriptionStore((s) => s.signOut);

  const profileAvatarUrl = useProfileStore((s) => s.avatarUrl);
  const initProfile = useProfileStore((s) => s.init);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void initProfile();
  }, [initProfile]);

  useEffect(() => {
    if (hydrated && configured && !userId) {
      router.push("/login?next=/account");
    }
  }, [hydrated, configured, userId, router]);

  if (hydrated && !configured) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <SupabaseRequiredNotice feature="구독 관리" />
      </div>
    );
  }

  if (!hydrated || !userId || !tier) {
    return <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-white/40">불러오는 중…</div>;
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-6 text-xl font-bold text-white">내 구독</h1>
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center gap-3">
          <Avatar src={profileAvatarUrl} size={56} />
          <div>
            <p className="text-xs text-white/40">계정</p>
            <p className="text-sm text-white">{email}</p>
            <button
              onClick={() => setProfileModalOpen(true)}
              className="mt-1 text-xs text-rose-300 hover:text-rose-200"
            >
              프로필 이미지 변경
            </button>
          </div>
        </div>
        <div>
          <p className="text-xs text-white/40">요금제</p>
          <p className="text-sm font-semibold text-rose-200">{TIER_LABELS[tier]}</p>
          {subscription?.periodEnd && (
            <p className="mt-0.5 text-xs text-white/40">
              {new Date(subscription.periodEnd).toLocaleDateString("ko-KR")}까지
              {subscription.cancelAtPeriodEnd && " (해지 예약됨 — 이후 무료로 전환)"}
            </p>
          )}
        </div>
        {entitlement && (
          <div>
            <p className="text-xs text-white/40">오늘 이용 현황</p>
            <p className="text-sm text-white">
              {entitlement.used} / {entitlement.cap}
              {entitlement.unit === "games" ? "회" : "분"}
            </p>
          </div>
        )}
        {subscription && subscription.tier !== "free" && (
          <button
            onClick={() => void toggleCancelAtPeriodEnd()}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30"
          >
            {subscription.cancelAtPeriodEnd ? "해지 예약 취소" : "해지 예약하기"}
          </button>
        )}
        <p className="text-xs text-white/40">요금제 업그레이드/충전은 아직 준비 중이에요 — 문의는 관리자에게 해주세요.</p>
        <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-4">
          <Link href="/" className="text-xs text-white/50 hover:text-white/80">
            대시보드로
          </Link>
          <button
            onClick={() => {
              void signOut();
              router.push("/");
            }}
            className="text-xs text-rose-300 hover:text-rose-200"
          >
            로그아웃
          </button>
        </div>
      </div>
      {profileModalOpen && <ProfileModal onClose={() => setProfileModalOpen(false)} />}
    </div>
  );
}
