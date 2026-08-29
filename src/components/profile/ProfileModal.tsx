"use client";

import { useRef } from "react";
import Overlay from "@/components/Overlay";
import Avatar from "@/components/common/Avatar";
import { DEFAULT_AVATAR } from "@/constants/avatar";
import { useProfileStore } from "@/store/profileStore";

/**
 * Profile avatar editor — logged-in accounts only (see `profileStore.ts`;
 * guests never see the entry point that opens this, both in `SiteHeader`
 * and `/account`). Reuses the shared `Overlay` chrome, same as every other
 * modal in the app.
 */
export default function ProfileModal({ onClose }: { onClose: () => void }) {
  const avatarUrl = useProfileStore((s) => s.avatarUrl);
  const uploading = useProfileStore((s) => s.uploading);
  const error = useProfileStore((s) => s.error);
  const uploadAvatar = useProfileStore((s) => s.uploadAvatar);
  const resetAvatar = useProfileStore((s) => s.resetAvatar);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <Overlay title="🖼️ 프로필 이미지" onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        <Avatar src={avatarUrl} size={112} className="border-2" />

        {error && <p className="text-xs text-rose-300">{error}</p>}

        <div className="flex w-full flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // allow re-selecting the same file later
              if (file) void uploadAvatar(file);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:opacity-50"
          >
            {uploading ? "업로드 중…" : "이미지 업로드"}
          </button>
          <button
            onClick={() => void resetAvatar()}
            disabled={uploading || !avatarUrl}
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 transition hover:border-white/30 disabled:opacity-40"
          >
            기본 이미지로 초기화
          </button>
        </div>

        <p className="text-center text-[11px] leading-relaxed text-white/40">
          PNG · JPG · WEBP · GIF, 최대 2MB. 기본 이미지는 `{DEFAULT_AVATAR}`이며, 다른 방 참가자에게는 동기화되지 않고 내
          화면에만 적용돼요.
        </p>
      </div>
    </Overlay>
  );
}
