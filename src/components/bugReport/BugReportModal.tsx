"use client";

import { useRef, useState, type DragEvent } from "react";
import Overlay from "@/components/Overlay";
import { GAME_REGISTRY } from "@/games/registry";
import { useBugReportStore } from "@/store/bugReportStore";
import { compressImageDataUrl, readFileAsDataUrl } from "@/lib/bugReports/attachment";
import { formatPhoneNumber, validateAttachmentMeta, validateBugReportInput } from "@/lib/bugReports/validate";
import type { BugReportFieldErrors } from "@/lib/bugReports/validate";
import type { BugReportAttachment, BugReportRecord } from "@/lib/db/types";

const PLAYABLE_GAMES = GAME_REGISTRY.filter((g) => g.playable);

interface BugReportModalProps {
  onClose: () => void;
  /**
   * When provided, the report is pinned to this game and the game picker is
   * replaced by a read-only badge — this is the "게임 내에서 접근 시 게임
   * 종류 정보가 자동으로 매핑" requirement. Omit for hub-level access
   * (header button, board page), where the user can pick a game or leave it
   * unset ("허브 전체").
   */
  gameId?: string;
  gameName?: string;
  onSubmitted?: (report: BugReportRecord) => void;
}

export default function BugReportModal({ gameId, gameName, onClose, onSubmitted }: BugReportModalProps) {
  const submitReport = useBugReportStore((s) => s.submitReport);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedGameId, setSelectedGameId] = useState(gameId ?? "");
  const [attachment, setAttachment] = useState<BugReportAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [processingAttachment, setProcessingAttachment] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<BugReportFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<BugReportRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const locked = Boolean(gameId);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const metaError = validateAttachmentMeta({ type: file.type, size: file.size });
    if (metaError) {
      setAttachmentError(metaError);
      return;
    }
    setAttachmentError(null);
    setProcessingAttachment(true);
    try {
      const rawDataUrl = await readFileAsDataUrl(file);
      const dataUrl = await compressImageDataUrl(rawDataUrl, file.type);
      setAttachment({ fileName: file.name, mimeType: file.type, dataUrl });
    } catch {
      setAttachmentError("이미지를 처리하지 못했습니다. 다른 파일로 시도해주세요.");
    } finally {
      setProcessingAttachment(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    void handleFile(e.dataTransfer.files[0]);
  }

  async function handleSubmit() {
    const input = { title, description, author, phone };
    const validation = validateBugReportInput(input);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }
    setErrors({});
    setSubmitting(true);
    setSubmitError(null);

    const game = PLAYABLE_GAMES.find((g) => g.id === selectedGameId);
    try {
      const result = await submitReport({
        ...input,
        gameId: gameId ?? (selectedGameId || undefined),
        gameName: gameName ?? game?.name,
        attachment: attachment ?? undefined,
      });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setSubmitted(result.report);
      onSubmitted?.(result.report);
    } catch {
      setSubmitError("제출 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Overlay title="🐛 버그 리포트" onClose={onClose}>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="text-4xl">✅</span>
          <p className="text-sm text-white/80">제보해주셔서 감사합니다! 접수되었습니다.</p>
          <p className="text-xs text-white/40">
            게시판에서 처리 상태를 확인하실 수 있어요 (접수됨 → 확인 중 → 수정 완료).
          </p>
          <div className="mt-2 flex gap-2">
            <a
              href="/bug-reports"
              className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:border-white/30"
            >
              게시판 보기
            </a>
            <button
              onClick={onClose}
              className="rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-400"
            >
              닫기
            </button>
          </div>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay title="🐛 버그 리포트 작성" onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        {locked ? (
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
            <span>🎮</span>
            <span>
              <span className="text-white/40">관련 게임: </span>
              {gameName ?? gameId}
            </span>
          </div>
        ) : (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-white/70">관련 게임 (선택)</span>
            <select
              value={selectedGameId}
              onChange={(e) => setSelectedGameId(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-rose-400 focus:outline-none"
            >
              <option value="">허브 전체 (게임 무관)</option>
              {PLAYABLE_GAMES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-white/70">
            제목 <span className="text-rose-400">*</span>
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="어떤 문제인가요?"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
          />
          {errors.title && <span className="text-xs text-rose-400">{errors.title}</span>}
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-white/70">
            내용 <span className="text-rose-400">*</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="버그가 발생한 상황을 자세히 설명해주세요 (재현 방법, 예상 동작 등)"
            rows={5}
            className="resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
          />
          {errors.description && <span className="text-xs text-rose-400">{errors.description}</span>}
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-white/70">
              글쓴이 <span className="text-rose-400">*</span>
            </span>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="닉네임 또는 이름"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
            />
            {errors.author && <span className="text-xs text-rose-400">{errors.author}</span>}
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-white/70">전화번호 (선택)</span>
            <input
              value={phone}
              onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
              placeholder="010-1234-5678"
              inputMode="numeric"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-rose-400 focus:outline-none"
            />
            {errors.phone && <span className="text-xs text-rose-400">{errors.phone}</span>}
          </label>
        </div>

        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-white/70">첨부파일 (선택)</span>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition ${
              dragOver ? "border-rose-400 bg-rose-500/10" : "border-white/15 hover:border-white/30"
            }`}
          >
            {attachment ? (
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- base64 data: URI, next/image can't optimize this */}
                <img
                  src={attachment.dataUrl}
                  alt={attachment.fileName}
                  className="max-h-40 rounded-lg border border-white/10 object-contain"
                />
                <span className="text-xs text-white/50">{attachment.fileName}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAttachment(null);
                  }}
                  className="text-xs text-rose-300 underline"
                >
                  제거
                </button>
              </div>
            ) : processingAttachment ? (
              <span className="text-xs text-white/50">처리 중...</span>
            ) : (
              <>
                <span className="text-2xl">📎</span>
                <span className="text-xs text-white/50">
                  이미지를 드래그하거나 클릭해서 첨부하세요 (PNG/JPEG/GIF/WEBP, 5MB 이하)
                </span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
          </div>
          {attachmentError && <span className="text-xs text-rose-400">{attachmentError}</span>}
        </div>

        {submitError && <p className="text-sm text-rose-400">{submitError}</p>}

        <button
          onClick={() => void handleSubmit()}
          disabled={submitting || processingAttachment}
          className="mt-1 w-full rounded-xl bg-rose-500 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {submitting ? "제출 중..." : "제출하기"}
        </button>
      </div>
    </Overlay>
  );
}
