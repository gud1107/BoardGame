"use client";

import { useEffect } from "react";
import { generateDefaultPayoutTable, validatePayoutTable } from "@/lib/betting/zeroSum";

interface Props {
  participantCount: number;
  payoutTable: number[];
  onChange: (table: number[]) => void;
}

const ORDINALS = ["🥇", "🥈", "🥉"];
function rankLabel(idx: number) {
  return ORDINALS[idx] ?? `${idx + 1}위`;
}

export default function PayoutTableEditor({ participantCount, payoutTable, onChange }: Props) {
  useEffect(() => {
    if (payoutTable.length !== participantCount) {
      onChange(generateDefaultPayoutTable(participantCount));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantCount]);

  const check = validatePayoutTable(payoutTable);

  function updateAt(idx: number, value: number) {
    const next = [...payoutTable];
    next[idx] = value;
    onChange(next);
  }

  if (payoutTable.length !== participantCount) return null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-white/80">순위별 상금 / 벌금 (원)</p>
        <button
          onClick={() => onChange(generateDefaultPayoutTable(participantCount))}
          className="text-xs text-white/50 underline hover:text-white/80"
        >
          기본값으로 재설정
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {payoutTable.map((value, idx) => (
          <label key={idx} className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 p-2">
            <span className="text-xs text-white/50">
              {rankLabel(idx)} ({idx + 1}등)
            </span>
            <input
              type="number"
              step={100}
              value={value}
              onChange={(e) => updateAt(idx, Number(e.target.value))}
              className={`w-full bg-transparent text-sm font-semibold outline-none ${
                value > 0 ? "text-emerald-300" : value < 0 ? "text-rose-300" : "text-white/60"
              }`}
            />
          </label>
        ))}
      </div>

      <p
        className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${
          check.valid
            ? "bg-emerald-500/10 text-emerald-300"
            : "bg-rose-500/10 text-rose-300"
        }`}
      >
        {check.valid
          ? "✓ 합계 0원 — 제로섬 조건을 만족합니다."
          : `✗ 합계 ${check.sum.toLocaleString()}원 — 상금과 벌금의 합이 0원이 되도록 조정하세요.`}
      </p>
    </div>
  );
}
