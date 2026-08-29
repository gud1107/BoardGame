import { type MergedGroup, membersOf, resolveGroupId } from "./mergeGroups";

/** One already-recorded round's per-participant deltas, keyed by raw id (playerId or seat key). */
export interface SettlementRoundInput {
  round: number;
  label: string;
  deltas: Record<string, number>;
}

export interface SettlementRow {
  /** The `MergedGroup.canonicalId` (or the raw id itself, if ungrouped). */
  id: string;
  displayName: string;
  /** Raw ids folded into this row — length > 1 only for a merged row. */
  memberIds: string[];
  /** Per round, in the same order as `SettlementView.rounds`; `null` = didn't participate that round. */
  perRound: (number | null)[];
  total: number;
}

export interface SettlementView {
  rounds: { round: number; label: string }[];
  rows: SettlementRow[];
}

/**
 * Builds the Excel-style grid: one row per merged group (or ungrouped raw
 * id), one column per round, plus a running total. Never mutates
 * `rounds`/raw deltas — `mergedGroups` is purely a display-time fold.
 */
export function buildSettlementView(
  rounds: SettlementRoundInput[],
  names: Record<string, string>,
  mergedGroups: MergedGroup[],
): SettlementView {
  const groupIds = new Set<string>();
  for (const r of rounds) {
    for (const rawId of Object.keys(r.deltas)) groupIds.add(resolveGroupId(mergedGroups, rawId));
  }
  // Also include groups/ids that only exist via `names` (e.g. joined but never played a round yet).
  for (const rawId of Object.keys(names)) groupIds.add(resolveGroupId(mergedGroups, rawId));

  const rows: SettlementRow[] = [...groupIds].map((groupId) => {
    const memberIds = membersOf(mergedGroups, groupId);
    const displayName = names[groupId] ?? names[memberIds[0]] ?? groupId;
    let total = 0;
    const perRound = rounds.map((r) => {
      const memberDeltas = memberIds.filter((m) => m in r.deltas).map((m) => r.deltas[m]);
      if (memberDeltas.length === 0) return null;
      const sum = memberDeltas.reduce((a, b) => a + b, 0);
      total += sum;
      return sum;
    });
    return { id: groupId, displayName, memberIds, perRound, total };
  });

  rows.sort((a, b) => b.total - a.total);
  return { rounds: rounds.map((r) => ({ round: r.round, label: r.label })), rows };
}

/** "기택: +2,000원 / 건열: -2,000원 ..." — clipboard/카카오톡 정산 텍스트. */
export function formatSettlementText(view: SettlementView): string {
  return view.rows
    .map((r) => `${r.displayName}: ${r.total >= 0 ? "+" : ""}${r.total.toLocaleString()}원`)
    .join(" / ");
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel/Google Sheets-compatible CSV — rounds as columns, final 합계 column last. UTF-8 BOM prefix so Excel reads 한글 correctly. */
export function toSettlementCsv(view: SettlementView): string {
  const header = ["참가자", ...view.rounds.map((r) => r.label), "합계"];
  const lines = [header.map(csvCell).join(",")];
  for (const row of view.rows) {
    const cells = [
      row.displayName,
      ...row.perRound.map((v) => (v === null ? "" : v)),
      row.total,
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return "﻿" + lines.join("\r\n");
}
