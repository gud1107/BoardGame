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
const UNITS = [1000, 5000, 10000, 50000];

/** Keeps only digits and a single leading minus sign, e.g. "-1,0a00" → "-100". */
function sanitizeDigits(raw: string) {
  const negative = raw.trim().startsWith("-");
  const digits = raw.replace(/[^0-9]/g, "");
  return (negative && digits ? "-" : "") + digits;
}

export default function PayoutTableEditor({ participantCount, payoutTable, onChange }: Props) {
  const [unit, setUnit] = useState(1000);
  // While a row's input is focused we edit a raw digit-only buffer (no commas, so the
  // cursor never jumps mid-type); once it blurs we fall back to the always-formatted
  // `value.toLocaleString()` display driven straight off payoutTable.
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

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

  function commitEdit(idx: number) {
    const parsed = editText === "" || editText === "-" ? 0 : Number(editText);
    updateAt(idx, Number.isFinite(parsed) ? parsed : 0);
    setEditingIdx(null);
  }

  if (payoutTable.length !== participantCount) return null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-white/80 light:text-slate-700">순위별 상금 / 벌금 (원)</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-white/40 light:text-slate-400">단위</span>
          {UNITS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={`min-h-[2rem] rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition ${
                unit === u
                  ? "border-rose-400/60 bg-rose-500/20 text-white light:text-rose-900"
                  : "border-white/15 text-white/50 hover:border-white/30 light:border-slate-300 light:text-slate-500 light:hover:border-slate-400"
              }`}
            >
              +{u.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onChange(generateDefaultPayoutTable(participantCount, unit))}
        className="mb-2 min-h-11 w-full rounded-lg border border-white/15 px-2 py-2 text-xs text-white/70 transition hover:border-rose-400/40 hover:text-white light:border-slate-300 light:text-slate-600 light:hover:text-slate-900"
      >
        ⚡ 빠른 정산 적용 (1등 +{(unit * Math.floor(participantCount / 2)).toLocaleString()}원 ~ {participantCount}등 −
        {(unit * Math.floor(participantCount / 2)).toLocaleString()}원)
      </button>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-2">
        {payoutTable.map((value, idx) => (
          <div
            key={idx}
            className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-white/5 p-2.5 light:border-slate-200 light:bg-slate-50"
          >
            <span className="text-xs whitespace-nowrap text-white/50 light:text-slate-500">
              {rankLabel(idx)} ({idx + 1}등)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => step(idx, -1)}
                aria-label={`${idx + 1}등 금액 ${unit.toLocaleString()}원 감소`}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-white/15 text-base text-white/60 hover:border-white/30 hover:text-white active:bg-white/10 light:border-slate-300 light:text-slate-500 light:hover:border-slate-400 light:hover:text-slate-800 light:active:bg-slate-100"
              >
                −
              </button>
              <input
                type="text"
                inputMode="numeric"
                aria-label={`${idx + 1}등 금액`}
                value={editingIdx === idx ? editText : value.toLocaleString()}
                onFocus={() => {
                  setEditingIdx(idx);
                  setEditText(String(value));
                }}
                onChange={(e) => setEditText(sanitizeDigits(e.target.value))}
                onBlur={() => commitEdit(idx)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className={`min-h-11 min-w-[4.5rem] flex-1 rounded-md border border-white/10 bg-black/20 px-2 py-2 text-center text-base font-bold whitespace-nowrap tabular-nums outline-none focus:border-rose-400 light:border-slate-300 light:bg-white ${
                  value > 0 ? "text-emerald-300" : value < 0 ? "text-rose-300" : "text-white/60 light:text-slate-500"
                }`}
              />
              <button
                type="button"
                onClick={() => step(idx, 1)}
                aria-label={`${idx + 1}등 금액 ${unit.toLocaleString()}원 증가`}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-white/15 text-base text-white/60 hover:border-white/30 hover:text-white active:bg-white/10 light:border-slate-300 light:text-slate-500 light:hover:border-slate-400 light:hover:text-slate-800 light:active:bg-slate-100"
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
            ? "bg-emerald-500/10 text-emerald-300 light:bg-emerald-50 light:text-emerald-700"
            : "bg-rose-500/10 text-rose-300 light:bg-rose-50 light:text-rose-700"
        }`}
      >
        {check.valid
          ? "✓ 합계 0원 — 제로섬 조건을 만족합니다."
          : `✗ 합계 ${check.sum.toLocaleString()}원 — 상금과 벌금의 합이 0원이 되도록 조정하세요.`}
      </p>
    </div>
  );
}
