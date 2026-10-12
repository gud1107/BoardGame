import { describe, expect, it } from "vitest";
import { findShippingDeployment, gameIdsTouched, readVercelStatuses, VERCEL_CONTEXT } from "./gameReleases";

// main, newest first: d (head) → c → b → a
const order = new Map(["d", "c", "b", "a"].map((sha, i) => [sha, i]));
const deploys = [
  { sha: "d", created_at: "2026-10-11T12:40:00Z" },
  { sha: "c", created_at: "2026-10-11T12:20:00Z" },
  { sha: "a", created_at: "2026-10-11T12:00:00Z" },
];

describe("findShippingDeployment", () => {
  it("picks the oldest deployment at or after the commit in main's order", () => {
    expect(findShippingDeployment("a", "2026-10-11T11:59:00Z", order, deploys)?.sha).toBe("a");
    // b was pushed together with c — c's build shipped it
    expect(findShippingDeployment("b", "2026-10-11T12:10:00Z", order, deploys)?.sha).toBe("c");
  });

  it("returns null for a pushed commit with no finished build yet", () => {
    const order2 = new Map([["e", 0], ...[...order].map(([s, i]) => [s, i + 1] as [string, number])]);
    expect(findShippingDeployment("e", "2026-10-11T12:50:00Z", order2, deploys)).toBeNull();
  });

  it("falls back to deployment time for commits older than the fetched page", () => {
    // x/y are deployments of commits that also fell off the page
    const older = [...deploys, { sha: "x", created_at: "2026-10-11T11:00:00Z" }, { sha: "y", created_at: "2026-10-11T11:30:00Z" }];
    expect(findShippingDeployment("old", "2026-10-11T11:10:00Z", order, older)?.sha).toBe("y");
  });

  it("returns null for an off-page commit older than every fetched deployment", () => {
    expect(findShippingDeployment("old", "2026-10-11T11:00:00Z", order, deploys)).toBeNull();
  });
});

describe("gameIdsTouched", () => {
  const f = (...names: string[]) => names.map((filename) => ({ filename }));

  it("maps game dirs to ids like the generator script", () => {
    expect(gameIdsTouched(f("src/games/tavernBrawl/a.ts", "src/games/mineOfOblivion2/b.ts", "src/app/page.tsx")).sort()).toEqual([
      "mine-of-oblivion-2",
      "tavern-brawl",
    ]);
    expect(gameIdsTouched(f("src/games/shared/x.ts", "src/games/five-cucumbers/y.ts"))).toEqual(["five-cucumbers"]);
  });

  it("skips site-wide sweeps", () => {
    expect(gameIdsTouched(f("src/games/a/x.ts", "src/games/b/x.ts", "src/games/c/x.ts", "src/games/d/x.ts"))).toEqual([]);
  });
});

describe("readVercelStatuses", () => {
  const s = (state: string, at: string, context = VERCEL_CONTEXT) => ({ state, context, created_at: at });

  it("uses the first pending as push time and success as deploy time", () => {
    expect(
      readVercelStatuses([
        s("success", "2026-10-11T12:40:48Z"),
        s("success", "2026-10-11T12:39:43Z", "Vercel – other"),
        s("pending", "2026-10-11T12:38:37Z"),
      ]),
    ).toEqual({ pushedAt: "2026-10-11T12:38:37Z", deployedAt: "2026-10-11T12:40:48Z", state: "deployed" });
  });

  it("reports building / failed / unknown", () => {
    expect(readVercelStatuses([s("pending", "2026-10-11T12:38:37Z")]).state).toBe("building");
    expect(readVercelStatuses([s("failure", "2026-10-11T12:39:00Z"), s("pending", "2026-10-11T12:38:37Z")]).state).toBe("failed");
    expect(readVercelStatuses([]).state).toBe("unknown");
  });
});
