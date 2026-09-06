import { PATCH_NOTES } from "@/constants/patchNotes";
import PatchNoteList from "@/components/patchNotes/PatchNoteList";

export const metadata = {
  title: "패치노트 · 보드게임 허브",
  description: "보드게임 허브의 일자별 수정 이력",
};

export default function PatchNotesPage() {
  const latest = PATCH_NOTES[0];
  const oldest = PATCH_NOTES[PATCH_NOTES.length - 1];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="mb-1 text-2xl font-bold text-white">📋 패치노트</h1>
      <p className="mb-6 text-sm text-white/50">
        {oldest.releaseDate}부터 {latest.releaseDate}까지, 날짜별 수정 이력을 최신순으로
        모았습니다. 최신 버전은 {latest.version}입니다.
      </p>
      <PatchNoteList />
    </div>
  );
}
