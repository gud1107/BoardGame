import { describe, expect, it } from "vitest";
import { mergeParticipants } from "./mergeGroups";
import { buildSettlementView, formatSettlementText, toSettlementCsv, type SettlementRoundInput } from "./settlementView";

const rounds = [
  { round: 1, label: "라운드 1", deltas: { p1: 1000, p2: -1000 } },
  { round: 2, label: "라운드 2", deltas: { p1: -1000, p2: 1000 } },
  { round: 3, label: "라운드 3", deltas: { p1: 1000, p2: -1000 } },
];

describe("buildSettlementView", () => {
  it("keeps each raw id's history intact across a 3x renamed player (no data loss)", () => {
    // p1 played round 1 as "기택", round 2 as "기탁", round 3 as "기태기" —
    // the *ledger* stays keyed by p1 throughout (see roomBetting.ts/bettingStore
    // — renames never change the raw id), so nothing here should ever lose a round.
    const names = { p1: "기태기", p2: "건열" };
    const view = buildSettlementView(rounds, names, []);
    const p1Row = view.rows.find((r) => r.id === "p1")!;
    expect(p1Row.perRound).toEqual([1000, -1000, 1000]);
    expect(p1Row.total).toBe(1000);
  });

  it("sums a merged group's rounds into a single row under the canonical name", () => {
    // Suppose "기택"(p1) and a mistakenly-separate "기탁"(p1b) actually the same
    // person split across two raw ids — merging folds their rounds together.
    const split: SettlementRoundInput[] = [
      { round: 1, label: "라운드 1", deltas: { p1: 1000, p2: -1000 } },
      { round: 2, label: "라운드 2", deltas: { p1b: -1000, p2: 1000 } },
    ];
    const groups = mergeParticipants([], "p1", ["p1b"]);
    const view = buildSettlementView(split, { p1: "기택", p1b: "기택(다른이름)", p2: "건열" }, groups);
    const merged = view.rows.find((r) => r.id === "p1")!;
    expect(merged.memberIds.sort()).toEqual(["p1", "p1b"]);
    expect(merged.perRound).toEqual([1000, -1000]);
    expect(merged.total).toBe(0);
  });

  it("marks a round null for a group that didn't play it", () => {
    const view = buildSettlementView(
      [{ round: 1, label: "라운드 1", deltas: { p1: 500 } }],
      { p1: "A", p2: "B" },
      [],
    );
    const p2 = view.rows.find((r) => r.id === "p2")!;
    expect(p2.perRound).toEqual([null]);
    expect(p2.total).toBe(0);
  });

  it("sorts rows by total descending", () => {
    const view = buildSettlementView(rounds, { p1: "A", p2: "B" }, []);
    expect(view.rows[0].id).toBe("p1");
    expect(view.rows[0].total).toBe(1000);
  });
});

describe("formatSettlementText", () => {
  it("renders the kakao-style summary line", () => {
    const view = buildSettlementView(rounds, { p1: "기택", p2: "건열" }, []);
    const text = formatSettlementText(view);
    expect(text).toContain("기택: +1,000원");
    expect(text).toContain("건열: -1,000원");
    expect(text).toContain(" / ");
  });
});

describe("toSettlementCsv", () => {
  it("emits a header row, one row per participant, and a UTF-8 BOM for Excel", () => {
    const view = buildSettlementView(rounds, { p1: "기택", p2: "건열" }, []);
    const csv = toSettlementCsv(view);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("참가자,라운드 1,라운드 2,라운드 3,합계");
    expect(lines.some((l) => l.startsWith("건열,"))).toBe(true);
  });
});
