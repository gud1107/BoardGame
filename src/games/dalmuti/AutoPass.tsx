"use client";

/**
 * 스마트 자동 패스(Auto-Pass) — task brief §3 (2026-09-05 세션, "플레이어 맞춤형
 * 자동 패스 시스템 탑재"). Purely a client-side UI convenience layered on top
 * of the existing `pass` action in engine.ts — no engine/reducer change at
 * all, and no interaction with the bot-takeover AI (`chooseBotAction`), which
 * already decides its own moves independently. `evaluateAutoPass` is checked
 * every render while it's genuinely the viewer's trick turn; the moment any
 * one enabled condition matches, `DalmutiBoard.tsx` shows a 1s "🤖 자동 패스
 * 조건 충족" toast (+ the same `pass`-action SFX/voice a manual click would
 * get) and then dispatches the ordinary `pass` action — indistinguishable to
 * the engine from the player clicking 패스 themselves.
 *
 * Modes (AskUserQuestion, 2026-09-05 세션 — 체크박스 방식: 여러 개 동시에 ON
 * 가능, OR 조건으로 평가: 하나라도 충족되면 자동 패스):
 *  - `freeFollow` ("기본 프리패스"): 현재 트릭에 낼 수 있는 합법패가 아예 없을
 *    때 즉시 패스 (`legalPlayOptions`가 빈 배열 — 리드 차례에는 항상 최소 1개
 *    옵션이 있으므로 사실상 "따라가는 차례에 낼 패가 없을 때"만 의미 있음).
 *  - `lowRankSingle` ("낮은 숫자 단일 출도 시 패스"): 필드에 단일 카드(1장)로
 *    `lowRankThreshold`(기본 5, task brief 예시 "1~5번"을 기본값으로 채택,
 *    설정에서 1~12 사이로 직접 조정 가능) 이하의 강한 계급이 나왔을 때, 낼 수
 *    있는 패가 있어도 아껴서 무조건 패스.
 *  - `roleDefense` ("계급별 방어 모드"): 요청하신 "달무티(왕) 또는 대주교"의
 *    "대주교"는 이 게임의 실제 직위명(왕/귀족/평민/거지/노예)에 없어 왕+귀족
 *    (순위 1·2위)으로 매핑 확정(AskUserQuestion) — 이 둘이 모두 손패를 털고
 *    나갈 때까지 모든 턴을 자동 패스.
 *  - `waitForFirstFinisher` ("1명 탈출 시까지 무조건 패스"): 아직 아무도 손패를
 *    다 털지 못했다면(`finishOrder`가 비어있다면) 무조건 자동 패스.
 */

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { legalPlayOptions, type DalmutiState, type SeatIndex } from "./engine";

export interface AutoPassSettings {
  freeFollow: boolean;
  lowRankSingle: boolean;
  lowRankThreshold: number;
  roleDefense: boolean;
  waitForFirstFinisher: boolean;
}

export const DEFAULT_AUTO_PASS_SETTINGS: AutoPassSettings = {
  freeFollow: false,
  lowRankSingle: false,
  lowRankThreshold: 5,
  roleDefense: false,
  waitForFirstFinisher: false,
};

/** "🤖 자동 패스 조건 충족" 토스트가 화면에 떠 있다가 실제로 패스가 나가기까지의 시간(AskUserQuestion으로 확정된 "1초 띄우고 넘김" 스펙). */
export const AUTO_PASS_TOAST_MS = 1000;

const STORAGE_KEY = "dalmuti_auto_pass_settings_v1";

function clampThreshold(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_AUTO_PASS_SETTINGS.lowRankThreshold;
  return Math.min(12, Math.max(1, Math.round(n)));
}

function loadInitial(): AutoPassSettings {
  if (typeof window === "undefined") return DEFAULT_AUTO_PASS_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AUTO_PASS_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AutoPassSettings>;
    return {
      freeFollow: parsed.freeFollow ?? DEFAULT_AUTO_PASS_SETTINGS.freeFollow,
      lowRankSingle: parsed.lowRankSingle ?? DEFAULT_AUTO_PASS_SETTINGS.lowRankSingle,
      lowRankThreshold: clampThreshold(parsed.lowRankThreshold ?? DEFAULT_AUTO_PASS_SETTINGS.lowRankThreshold),
      roleDefense: parsed.roleDefense ?? DEFAULT_AUTO_PASS_SETTINGS.roleDefense,
      waitForFirstFinisher: parsed.waitForFirstFinisher ?? DEFAULT_AUTO_PASS_SETTINGS.waitForFirstFinisher,
    };
  } catch {
    return DEFAULT_AUTO_PASS_SETTINGS; // Corrupt JSON — fall back to defaults rather than throw.
  }
}

function persist(settings: AutoPassSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Privacy mode / storage quota — the setting just won't survive a reload.
  }
}

/**
 * Per-browser persisted auto-pass preferences, scoped to this one game.
 * Unlike the site-wide `audioSettings.ts` zustand store, nothing outside
 * React needs to read this, so a plain hook is enough. Read via a lazy
 * `useState` initializer (runs during render, not in an effect) rather than
 * `useEffect` + `setState` on mount — same pattern as
 * `PatchNoteButton.tsx`'s `hasUnseen`, and avoids the
 * `react-hooks/set-state-in-effect` cascading-render lint error a mount
 * effect here would trigger. `loadInitial` itself already guards
 * `typeof window === "undefined"` for the SSR pass.
 */
export function useAutoPassSettings() {
  const [settings, setSettings] = useState<AutoPassSettings>(loadInitial);
  const update = useCallback((patch: Partial<AutoPassSettings>) => {
    setSettings((prev) => {
      const next: AutoPassSettings = {
        ...prev,
        ...patch,
        lowRankThreshold: clampThreshold(patch.lowRankThreshold ?? prev.lowRankThreshold),
      };
      persist(next);
      return next;
    });
  }, []);
  // Turning every condition off keeps the user's chosen lowRankThreshold
  // intact (only the 4 boolean flags reset) so re-enabling later doesn't
  // silently forget it — deliberately not the same as "reset to defaults".
  const disableAll = useCallback(
    () => update({ freeFollow: false, lowRankSingle: false, roleDefense: false, waitForFirstFinisher: false }),
    [update],
  );
  const anyEnabled = settings.freeFollow || settings.lowRankSingle || settings.roleDefense || settings.waitForFirstFinisher;
  return { settings, update, disableAll, anyEnabled };
}

export interface AutoPassDecision {
  shouldPass: boolean;
  /** Korean reason shown in the toast — "" when `shouldPass` is false. */
  reason: string;
}

const NO_PASS: AutoPassDecision = { shouldPass: false, reason: "" };

/**
 * Pure decision function — checked every render while it's genuinely the
 * viewer's trick turn (same guard `pass()` itself and the manual 패스 button
 * already enforce: only ever eligible mid-trick as a follower, never while
 * leading). Evaluated in a fixed priority order for which `reason` text wins
 * when multiple enabled conditions match at once; all four are still a
 * single OR overall — any one match is enough to auto-pass.
 */
export function evaluateAutoPass(state: DalmutiState, seat: SeatIndex, settings: AutoPassSettings): AutoPassDecision {
  if (state.phase !== "trick" || state.activeSeat !== seat || state.trick.count === 0) return NO_PASS;

  if (settings.waitForFirstFinisher && state.finishOrder.length === 0) {
    return { shouldPass: true, reason: "아직 아무도 탈출하지 않아 패를 아낍니다" };
  }

  if (settings.roleDefense) {
    const kingSeat = state.rankOrder[0];
    const nobleSeat = state.rankOrder[1];
    const kingGone = state.players.find((p) => p.seat === kingSeat)!.finishedAtOrder !== null;
    const nobleGone = state.players.find((p) => p.seat === nobleSeat)!.finishedAtOrder !== null;
    if (!(kingGone && nobleGone)) {
      return { shouldPass: true, reason: "왕·귀족이 아직 남아있어 방어 모드로 패스합니다" };
    }
  }

  if (settings.lowRankSingle && state.trick.count === 1 && state.trick.rankValue !== null && state.trick.rankValue <= settings.lowRankThreshold) {
    return { shouldPass: true, reason: `${state.trick.rankValue}번 단일 카드라 패를 아낍니다` };
  }

  if (settings.freeFollow && legalPlayOptions(state, seat).length === 0) {
    return { shouldPass: true, reason: "낼 수 있는 카드가 없어 자동 패스합니다" };
  }

  return NO_PASS;
}

// ---------------------------------------------------------------------------
// UI: settings dropdown, persistent "켜짐" badge, and the 1s toast
// ---------------------------------------------------------------------------

/** ⚙️ 드롭다운 안의 체크박스+숫자입력 패널. 위치는 호출부(`DalmutiBoard.tsx`)가 `relative` 컨테이너로 앵커링한다. */
export function AutoPassSettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: AutoPassSettings;
  onChange: (patch: Partial<AutoPassSettings>) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute top-full right-0 z-30 mt-2 w-72 max-w-[85vw] rounded-2xl border border-white/15 bg-[#160f26] p-3 text-[11px] text-white/80 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold break-keep text-amber-200">⚙️ 자동 패스 설정</span>
        <button onClick={onClose} className="px-1 text-white/50 hover:text-white" aria-label="닫기">
          ✕
        </button>
      </div>
      <p className="mb-2 break-keep text-white/40">체크한 조건 중 하나라도 맞으면 자동으로 패스해요. 여러 개를 동시에 켤 수 있어요.</p>
      <label className="mb-1.5 flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 shrink-0"
          checked={settings.freeFollow}
          onChange={(e) => onChange({ freeFollow: e.target.checked })}
        />
        <span className="break-keep">기본 프리패스 — 낼 수 있는 카드가 아예 없을 때 즉시 패스</span>
      </label>
      <label className="mb-1.5 flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 shrink-0"
          checked={settings.lowRankSingle}
          onChange={(e) => onChange({ lowRankSingle: e.target.checked })}
        />
        <span className="flex flex-wrap items-center gap-1 break-keep">
          단일 카드로
          <input
            type="number"
            min={1}
            max={12}
            value={settings.lowRankThreshold}
            onChange={(e) => onChange({ lowRankThreshold: Number(e.target.value) })}
            className="w-11 shrink-0 rounded border border-white/20 bg-black/30 px-1 py-0.5 text-center text-white"
          />
          번 이하 강한 계급이 나오면 패 아끼며 패스
        </span>
      </label>
      <label className="mb-1.5 flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 shrink-0"
          checked={settings.roleDefense}
          onChange={(e) => onChange({ roleDefense: e.target.checked })}
        />
        <span className="break-keep">계급별 방어 — 왕·귀족이 모두 탈출할 때까지 계속 패스</span>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 shrink-0"
          checked={settings.waitForFirstFinisher}
          onChange={(e) => onChange({ waitForFirstFinisher: e.target.checked })}
        />
        <span className="break-keep">1명 탈출 시까지 무조건 패스 — 아직 아무도 손패를 다 못 털었으면 무조건 패스</span>
      </label>
    </div>
  );
}

/** 자동 패스가 하나라도 켜져 있는 동안 패스/카드내기 버튼 위에 상시 표시되는 배지 — 탭 한 번으로 전부 즉시 해제(AskUserQuestion). */
export function AutoPassBadge({ onDisable }: { onDisable: () => void }) {
  return (
    <button
      onClick={onDisable}
      title="탭하면 모든 자동 패스 조건이 즉시 꺼집니다"
      className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-sky-300/40 bg-sky-400/10 px-3 py-1.5 text-[11px] font-semibold break-keep text-sky-100 transition hover:border-sky-300/70 hover:bg-sky-400/20"
    >
      🤖 자동 패스 켜짐 · 끄기
    </button>
  );
}

/** "🤖 자동 패스 조건 충족" 1초 토스트 — 화면 하단 중앙에 떠 있다가 `AUTO_PASS_TOAST_MS` 후 (호출부에서) 실제 패스와 함께 사라진다. */
export function AutoPassToast({ reason }: { reason: string }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[75] flex justify-center px-4">
      <div
        className="max-w-[90vw] rounded-full border border-sky-300/50 bg-[#0d1a2b]/95 px-4 py-2 text-center text-xs font-semibold break-keep text-sky-100 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]"
        style={{ animation: "dalmuti-autopass-toast-in 200ms ease-out" }}
      >
        🤖 자동 패스 조건 충족: 패스 진행 — {reason}
      </div>
    </div>,
    document.body,
  );
}
