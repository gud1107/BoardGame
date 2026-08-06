"use client";

import { useEffect, useState } from "react";
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

/** Selectable quick-settle unit — driving both the one-click table generator and each row's ±stepper. */
const UNITS = [1000, 2000, 5000, 10000];

export default function PayoutTableEditor({ participantCount, payoutTable, onChange }: Props) {
  const [unit, setUnit] = useState(1000);

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

  function step(idx: number, direction: 1 | -1) {
    updateAt(idx, payoutTable[idx] + direction * unit);
  }

  if (payoutTable.length !== participantCount) return null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-white/80">순위별 상금 / 벌금 (원)</p>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-white/40">단위</span>
          {UNITS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                unit === u
                  ? "border-rose-400/60 bg-rose-500/20 text-white"
                  : "border-white/15 text-white/50 hover:border-white/30"
              }`}
            >
              {(u / 1000).toLocaleString()}천
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onChange(generateDefaultPayoutTable(participantCount, unit))}
        className="mb-2 w-full rounded-lg border border-white/15 py-1.5 text-xs text-white/70 transition hover:border-rose-400/40 hover:text-white"
      >
        ⚡ 빠른 정산 적용 (1등 +{(unit * Math.floor(participantCount / 2)).toLocaleString()}원 ~ {participantCount}등 −
        {(unit * Math.floor(participantCount / 2)).toLocaleString()}원)
      </button>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {payoutTable.map((value, idx) => (
          <div key={idx} className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 p-2">
            <span className="text-xs text-white/50">
              {rankLabel(idx)} ({idx + 1}등)
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => step(idx, -1)}
                aria-label={`${idx + 1}등 금액 ${unit.toLocaleString()}원 감소`}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/15 text-xs text-white/60 hover:border-white/30 hover:text-white"
              >
                −
              </button>
              <input
                type="number"
                step={100}
                value={value}
                onChange={(e) => updateAt(idx, Number(e.target.value))}
                className={`w-full min-w-0 bg-transparent text-center text-sm font-semibold outline-none ${
                  value > 0 ? "text-emerald-300" : value < 0 ? "text-rose-300" : "text-white/60"
                }`}
              />
              <button
                type="button"
                onClick={() => step(idx, 1)}
                aria-label={`${idx + 1}등 금액 ${unit.toLocaleString()}원 증가`}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/15 text-xs text-white/60 hover:border-white/30 hover:text-white"
              >
                +
              </button>
            </div>
          </div>
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
