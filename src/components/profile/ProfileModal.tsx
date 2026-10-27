"use client";

import { useState } from "react";
import Avatar from "@/components/common/Avatar";
import { PUBLIC_NAME_RULE, useProfileStore } from "@/store/profileStore";
import { useMyCharacter } from "@/lib/character/myCharacter";
import CharacterStudio from "./CharacterStudio";
import { useProfilePhoto } from "./ProfilePhoto";

/**
 * Profile editor: the public ranking nickname + 3D character (its portrait is the profile picture) — logged-in accounts only (see `profileStore.ts`;
 * guests never see the entry point that opens this, both in `SiteHeader`
 * and `/account`). Reuses the shared `Overlay` chrome, same as every other
 * modal in the app.
 */
export default function ProfileModal({ onClose }: { onClose: () => void }) {
  const avatarUrl = useProfileStore((s) => s.avatarUrl);
  const uploading = useProfileStore((s) => s.uploading);
  const error = useProfileStore((s) => s.error);
  const resetAvatar = useProfileStore((s) => s.resetAvatar);
  const photo = useProfilePhoto();
  const hasCharacter = useMyCharacter((s) => !!s.character);

  return (
    <CharacterStudio title="🙂 프로필" onClose={onClose}>
        <PublicNameEditor />
        <div className="w-full border-t border-white/10 light:border-slate-200" />
        <Avatar src={photo} size={112} className="border-2" />
        <p className="text-center text-[11px] leading-relaxed text-white/40 light:text-slate-400">
          {hasCharacter ? "고른 3D 캐릭터의 얼굴이 프로필 사진이에요." : "아래에서 3D 캐릭터를 고르면 그 캐릭터 얼굴이 프로필 사진이 돼요."}
        </p>

        {avatarUrl && (
          <div className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-white/10 p-3 light:border-slate-200">
            <p className="text-center text-[11px] leading-relaxed text-white/50 light:text-slate-500">
              예전에 올린 사진이 공개 랭킹에 아직 표시되고 있어요. 이미지 업로드 기능은 없어졌어요.
            </p>
            <button
              onClick={() => void resetAvatar()}
              disabled={uploading}
              className="rounded-xl border border-white/15 px-4 py-2 text-xs text-white/70 transition hover:border-white/30 disabled:opacity-40 light:border-slate-300 light:text-slate-600 light:hover:border-slate-400"
            >
              {uploading ? "삭제 중…" : "예전에 올린 사진 삭제"}
            </button>
            {error && <p className="text-xs text-rose-300">{error}</p>}
          </div>
        )}

        <div className="w-full border-t border-white/10 light:border-slate-200" />
        <span className="self-start text-xs font-semibold text-white/70 light:text-slate-600">🧑‍🎤 3D 게임 캐릭터</span>
    </CharacterStudio>
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
