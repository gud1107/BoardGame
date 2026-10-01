"use client";

import { useRef, useState } from "react";
import Overlay from "@/components/Overlay";
import Avatar from "@/components/common/Avatar";
import { DEFAULT_AVATAR } from "@/constants/avatar";
import { PUBLIC_NAME_RULE, useProfileStore } from "@/store/profileStore";

/**
 * Profile editor: the public ranking nickname + avatar — logged-in accounts only (see `profileStore.ts`;
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
    <Overlay title="🙂 프로필" onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        <PublicNameEditor />
        <div className="w-full border-t border-white/10 light:border-slate-200" />
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
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 transition hover:border-white/30 disabled:opacity-40 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400"
          >
            기본 이미지로 초기화
          </button>
        </div>

        <p className="text-center text-[11px] leading-relaxed text-white/40 light:text-slate-400">
          PNG · JPG · WEBP · GIF, 최대 2MB. 기본 이미지는 `{DEFAULT_AVATAR}`이며, 게임 방의 다른 참가자에게는 보이지 않고
          공개 랭킹에만 함께 표시돼요.
        </p>
      </div>
    </Overlay>
  );
}

/** Name shown on the public leaderboard (/stats → 공개 랭킹). Unset = "게이머_xxxxxx". */
function PublicNameEditor() {
  const publicName = useProfileStore((s) => s.publicName);
  const saving = useProfileStore((s) => s.savingName);
  const nameError = useProfileStore((s) => s.nameError);
  const setPublicName = useProfileStore((s) => s.setPublicName);
  const [draft, setDraft] = useState(publicName ?? "");
  const [saved, setSaved] = useState(false);
  const dirty = draft.trim() !== (publicName ?? "");

  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void setPublicName(draft).then((ok) => setSaved(ok));
      }}
    >
      <label htmlFor="public-name" className="text-xs font-semibold text-white/70 light:text-slate-600">
        랭킹 닉네임
      </label>
      <div className="flex gap-2">
        <input
          id="public-name"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          maxLength={12}
          placeholder="예: 페루도장인"
          className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400"
        />
        <button
          type="submit"
          disabled={saving || !dirty}
          className="shrink-0 rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:opacity-40"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
      {nameError ? (
        <p className="text-xs text-rose-300">{nameError}</p>
      ) : saved ? (
        <p className="text-xs text-emerald-300 light:text-emerald-600">저장했어요. 공개 랭킹에 바로 반영됩니다.</p>
      ) : (
        <p className="text-[11px] leading-relaxed text-white/40 light:text-slate-400">
          {PUBLIC_NAME_RULE}. 다른 사람과 겹칠 수 없어요. 비워두면 랭킹에 &lsquo;게이머_xxxxxx&rsquo;로 표시되고, 소셜 로그인
          계정의 실명은 랭킹에 나오지 않아요.
        </p>
      )}
    </form>
  );
}
