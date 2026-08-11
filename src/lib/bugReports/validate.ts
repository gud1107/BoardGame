/**
 * Pure validation/formatting helpers for bug reports. Deliberately
 * dependency-free (no IndexedDB/File/Canvas/DOM APIs) so this file is
 * unit-testable under vitest's `environment: "node"` config (see
 * `vitest.config.mts` — there's no jsdom in this project). Anything that
 * needs a browser API (file reading, image downscaling) lives in
 * `attachment.ts` instead and is exercised by manual/visual verification
 * only, per ARCHITECTURE.md §2's "known blind spot" for UI-layer code.
 */

export interface BugReportFormInput {
  title: string;
  description: string;
  author: string;
  /** Optional — see `validateBugReportInput` for the format check applied when present. */
  phone?: string;
}

export type BugReportField = "title" | "description" | "author" | "phone";
export type BugReportFieldErrors = Partial<Record<BugReportField, string>>;

/**
 * 제목/내용/글쓴이는 필수, 전화번호는 선택이지만 입력됐다면 형식을 검증한다
 * (작업 지시의 "선택/필수 처리" 요구를 "값이 있으면 형식 검증, 없으면 통과"로
 * 해석 — 연락처 없이도 제보 자체는 막지 않아야 접근성이 떨어지지 않는다).
 */
export function validateBugReportInput(input: BugReportFormInput): BugReportFieldErrors {
  const errors: BugReportFieldErrors = {};
  if (!input.title.trim()) errors.title = "제목을 입력해주세요.";
  if (!input.description.trim()) errors.description = "내용을 입력해주세요.";
  if (!input.author.trim()) errors.author = "글쓴이(작성자)를 입력해주세요.";

  const phoneDigits = (input.phone ?? "").replace(/\D/g, "");
  if (phoneDigits && (phoneDigits.length < 9 || phoneDigits.length > 11)) {
    errors.phone = "올바른 전화번호 형식이 아닙니다.";
  }
  return errors;
}

export function isBugReportValid(input: BugReportFormInput): boolean {
  return Object.keys(validateBugReportInput(input)).length === 0;
}

/**
 * As-you-type formatting into Korean phone number groups. Simplification
 * (documented, not exhaustive over every area-code length): 11 digits ⇒
 * 3-4-4 (mobile, e.g. 010-1234-5678), 9~10 digits ⇒ 3-3-4.
 */
export function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Masks the middle group for display/list rendering, e.g.
 * "010-1234-5678" -> "010-****-5678". Accepts either a raw or already
 * formatted string. Values too short to safely split into 3 groups are
 * returned unchanged rather than guessed at.
 */
export function maskPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 9) return value;
  const parts = formatPhoneNumber(digits).split("-");
  if (parts.length !== 3) return value;
  return [parts[0], "*".repeat(parts[1].length), parts[2]].join("-");
}

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** Cap on the raw file the user picks, before client-side compression. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export function validateAttachmentMeta(meta: { type: string; size: number }): string | null {
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(meta.type)) {
    return "이미지 파일(PNG/JPEG/GIF/WEBP)만 첨부할 수 있습니다.";
  }
  if (meta.size > MAX_ATTACHMENT_BYTES) {
    return "첨부파일은 5MB 이하만 업로드할 수 있습니다.";
  }
  return null;
}
