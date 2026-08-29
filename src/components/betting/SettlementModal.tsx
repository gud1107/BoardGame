"use client";

import { useMemo, useState } from "react";
import type { MergedGroup } from "@/lib/betting/mergeGroups";
import { buildSettlementView, formatSettlementText, toSettlementCsv, type SettlementRoundInput } from "@/lib/betting/settlementView";

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  rounds: SettlementRoundInput[];
  /** Raw id (playerId or seat key) -> current display name. */
  names: Record<string, string>;
  mergedGroups: MergedGroup[];
  /** True for a non-host viewer of a room-linked session — hides merge/adjust controls, keeps copy/CSV. */
  readOnly?: boolean;
  onMerge?: (canonicalId: string, memberIds: string[]) => void;
  onUnmerge?: (canonicalId: string) => void;
  /** Local device-bound tool only — room-linked sessions don't expose a manual-adjust affordance yet. */
  onManualAdjust?: (id: string, amount: number, note?: string) => void;
}

export default function SettlementModal({
  title,
  open,
  onClose,
  rounds,
  names,
  mergedGroups,
  readOnly = false,
  onMerge,
  onUnmerge,
  onManualAdjust,
}: Props) {
  const view = useMemo(() => buildSettlementView(rounds, names, mergedGroups), [rounds, names, mergedGroups]);

  const [mergeMode, setMergeMode] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");

  if (!open) return null;

  function toggleChecked(id: string) {
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function confirmMerge() {
    if (checked.length < 2 || !onMerge) return;
    const [canonicalId, ...rest] = checked;
    onMerge(canonicalId, rest);
    setChecked([]);
    setMergeMode(false);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formatSettlementText(view));
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — silently no-op, nothing else to fall back to.
    }
  }

  function handleDownloadCsv() {
    const blob = new Blob([toSettlementCsv(view)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title}_정산표_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function submitAdjust(id: string) {
    const amount = Number(adjustAmount);
    if (!Number.isFinite(amount) || amount === 0 || !onManualAdjust) return;
    onManualAdjust(id, amount, adjustNote.trim() || undefined);
    setAdjustingId(null);
    setAdjustAmount("");
    setAdjustNote("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl border border-white/10 bg-[#12101c] shadow-2xl sm:max-w-3xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-bold text-white">📊 {title} 정산표</h2>
          <button onClick={onClose} aria-label="닫기" className="grid h-10 w-10 place-items-center rounded-full text-xl text-white/50 hover:bg-white/10 hover:text-white">
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {view.rows.length === 0 ? (
            <p className="text-sm text-white/40">아직 기록된 라운드가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[28rem] border-collapse text-sm">
                <thead>
                  <tr className="bg-white/5 text-left text-white/60">
                    {!readOnly && mergeMode && <th className="w-8 px-2 py-2" />}
                    <th className="sticky left-0 bg-[#181622] px-3 py-2 font-medium whitespace-nowrap">참가자</th>
                    {view.rounds.map((r) => (
                      <th key={r.round} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                        {r.label}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-bold whitespace-nowrap">합계</th>
                    {!readOnly && <th className="px-2 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((row) => (
                    <tr key={row.id} className="border-t border-white/5">
                      {!readOnly && mergeMode && (
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={checked.includes(row.id)}
                            onChange={() => toggleChecked(row.id)}
                            aria-label={`${row.displayName} 선택`}
                          />
                        </td>
                      )}
                      <td className="sticky left-0 bg-[#12101c] px-3 py-2 whitespace-nowrap text-white/85">
                        {row.displayName}
                        {row.memberIds.length > 1 && (
                          <span className="ml-1 text-[10px] text-white/40">({row.memberIds.length}개 별명 합침)</span>
                        )}
                      </td>
                      {row.perRound.map((v, i) => (
                        <td
                          key={i}
                          className={`px-3 py-2 text-right tabular-nums ${
                            v === null ? "text-white/25" : v >= 0 ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {v === null ? "-" : `${v >= 0 ? "+" : ""}${v.toLocaleString()}`}
                        </td>
                      ))}
                      <td className={`px-3 py-2 text-right font-bold tabular-nums ${row.total >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                        {row.total >= 0 ? "+" : ""}
                        {row.total.toLocaleString()}
                      </td>
                      {!readOnly && (
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          {row.memberIds.length > 1 ? (
                            <button
                              onClick={() => onUnmerge?.(row.id)}
                              className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:border-white/30"
                            >
                              분리
                            </button>
                          ) : (
                            onManualAdjust && (
                              <button
                                onClick={() => setAdjustingId(adjustingId === row.id ? null : row.id)}
                                className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:border-white/30"
                              >
                                보정
                              </button>
                            )
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {adjustingId && onManualAdjust && (
            <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3">
              <p className="mb-2 text-xs text-amber-200">
                {names[adjustingId] ?? adjustingId}님의 금액을 수동으로 보정합니다 (기존 합계에 더해집니다).
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="number"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  placeholder="±금액 (원)"
                  className="min-h-11 flex-1 rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
                />
                <input
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  placeholder="사유 (선택)"
                  className="min-h-11 flex-1 rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
                />
                <button
                  onClick={() => submitAdjust(adjustingId)}
                  className="min-h-11 shrink-0 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-white hover:bg-amber-400"
                >
                  적용
                </button>
              </div>
            </div>
          )}

          {!readOnly && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!mergeMode ? (
                <button
                  onClick={() => setMergeMode(true)}
                  disabled={!onMerge || view.rows.length < 2}
                  className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  🔗 동일 인물 합치기
                </button>
              ) : (
                <>
                  <span className="text-xs text-white/50">{checked.length}명 선택됨 (2명 이상 선택)</span>
                  <button
                    onClick={confirmMerge}
                    disabled={checked.length < 2}
                    className="rounded-full bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    합치기 확정
                  </button>
                  <button
                    onClick={() => {
                      setMergeMode(false);
                      setChecked([]);
                    }}
                    className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:border-white/30"
                  >
                    취소
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 border-t border-white/10 px-4 py-3">
          <button
            onClick={handleCopy}
            disabled={view.rows.length === 0}
            className="min-h-11 flex-1 rounded-xl bg-emerald-500 px-3 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copyFeedback ? "✓ 복사됨" : "📋 정산 텍스트 복사"}
          </button>
          <button
            onClick={handleDownloadCsv}
            disabled={view.rows.length === 0}
            className="min-h-11 flex-1 rounded-xl border border-white/15 px-3 text-sm font-semibold text-white/80 transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ⬇️ CSV 다운로드
          </button>
        </div>
      </div>
    </div>
  );
}
