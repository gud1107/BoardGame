"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Avatar from "@/components/common/Avatar";
import { PUBLIC_NAME_RULE, useProfileStore } from "@/store/profileStore";
import { useMyCharacter } from "@/lib/character/myCharacter";
import CharacterStudio from "./CharacterStudio";
import { cleanNickname, GAME_NICKNAME_MAX, useMyNickname } from "@/lib/identity/myNickname";
import { useProfilePhoto } from "./ProfilePhoto";
import { useSubscriptionStore } from "@/store/subscriptionStore";

/**
 * Profile editor: game nickname + public ranking nickname + 3D character (its
 * portrait is the profile picture). Guests get it too (SiteHeader): the game
 * nickname and character are kept on this device; the ranking nickname needs
 * an account (`profileStore.ts`), so guests see a login link in its place.
 * Reuses the shared `Overlay` chrome, same as every other modal in the app.
 */
export default function ProfileModal({ onClose }: { onClose: () => void }) {
  const avatarUrl = useProfileStore((s) => s.avatarUrl);
  const uploading = useProfileStore((s) => s.uploading);
  const error = useProfileStore((s) => s.error);
  const resetAvatar = useProfileStore((s) => s.resetAvatar);
  const photo = useProfilePhoto();
  const hasCharacter = useMyCharacter((s) => !!s.character);
  const signedIn = !!useSubscriptionStore((s) => s.userId);

  return (
    <CharacterStudio title="🙂 프로필" onClose={onClose}>
        <GameNicknameEditor signedIn={signedIn} />
        {signedIn ? (
          <PublicNameEditor />
        ) : (
          <p className="w-full rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-100/80 light:border-amber-300 light:bg-amber-50 light:text-amber-800">
            게스트로 꾸민 닉네임·캐릭터는 이 기기(브라우저)에만 저장돼요.{" "}
            <Link href="/login" onClick={onClose} className="font-semibold underline">
              로그인
            </Link>
            하면 계정에 저장되어 다른 기기에서도 쓰고, 공개 랭킹 닉네임도 정할 수 있어요.
          </p>
        )}
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

/** 게임 닉네임: what every online game's room field starts filled with (`myNickname.ts`). */
function GameNicknameEditor({ signedIn }: { signedIn: boolean }) {
  const nickname = useMyNickname((s) => s.nickname);
  const init = useMyNickname((s) => s.init);
  const setNickname = useMyNickname((s) => s.set);
  const publicName = useProfileStore((s) => s.publicName);
  const setPublicName = useProfileStore((s) => s.setPublicName);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // one name everywhere by default: the ranking shows the same name the table did
  const [alsoRankingPref, setAlsoRanking] = useState(true);
  // guests have no ranking name to keep in step
  const alsoRanking = signedIn && alsoRankingPref;
  useEffect(() => {
    void init();
  }, [init]);
  const value = draft ?? nickname;
  const dirty = cleanNickname(value) !== nickname || (alsoRanking && !!nickname && nickname !== publicName);

  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const clean = cleanNickname(value);
        setNickname(clean);
        setDraft(null);
        setSaved(true);
        // the ranking name is unique and stricter — a refusal shows under 랭킹 닉네임 below
        if (alsoRanking && clean && clean !== publicName) void setPublicName(clean);
      }}
    >
      <label htmlFor="game-nickname" className="text-xs font-semibold text-white/70 light:text-slate-600">
        게임 닉네임 <span className="font-normal text-white/40 light:text-slate-400">· 게임 방에 들어갈 때 자동으로 입력돼요</span>
      </label>
      <div className="flex gap-2">
        <input
          id="game-nickname"
          value={value}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          maxLength={GAME_NICKNAME_MAX}
          placeholder={publicName ?? "예: 상어"}
          className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-900 light:placeholder:text-slate-400"
        />
        <button type="submit" disabled={!dirty} className="shrink-0 rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:opacity-40">
          저장
        </button>
      </div>
      {signedIn && (
        <label className="flex items-center gap-2 text-xs text-white/60 light:text-slate-500">
          <input type="checkbox" checked={alsoRanking} onChange={(e) => setAlsoRanking(e.target.checked)} className="h-4 w-4 accent-rose-500" />
          공개 랭킹에도 같은 이름으로 (다른 사람이 쓰고 있으면 랭킹 닉네임은 그대로예요)
        </label>
      )}
      {saved ? (
        <p className="text-xs text-emerald-300 light:text-emerald-600">{nickname ? "저장했어요. 다음에 들어가는 방부터 이 닉네임이 입력돼요." : "지웠어요. 방에서 마지막으로 쓴 이름이 입력돼요."}</p>
      ) : (
        publicName &&
        !nickname && (
          <button type="button" onClick={() => setDraft(publicName)} className="self-start text-xs text-white/50 underline hover:text-white/80 light:text-slate-500 light:hover:text-slate-700">
            랭킹 닉네임(&lsquo;{publicName}&rsquo;)과 같게
          </button>
        )
      )}
    </form>
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
