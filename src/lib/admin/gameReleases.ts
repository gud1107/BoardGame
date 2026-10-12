/**
 * Admin-only "신규 업데이트순" data: for each game's newest game-specific
 * commit (`GAME_LAST_COMMIT`, regenerated on every build), when it was
 * pushed and when it reached production. Pure logic only — the GitHub fetches
 * live in `src/app/api/admin/game-releases/route.ts`.
 *
 * Source of truth is the public GitHub API (no token needed, 60 req/h):
 * - `/commits` (newest first) gives main's order, so "the first production
 *   deployment that contains commit S" is the oldest deployment whose sha is
 *   S or newer — exact for this repo's linear main.
 * - Vercel's `Production – board-game` GitHub deployments are created when a
 *   build finishes, and each deployed head commit carries `Vercel – board-game`
 *   statuses: `pending` (webhook received ≈ push time) → `success`/`failure`.
 */

export type ReleaseState = "deployed" | "building" | "failed" | "pushed" | "unknown";

export interface GameRelease {
  sha: string;
  commitAt: string;
  /** Vercel's first `pending` status on the push head that shipped this commit. */
  pushedAt: string | null;
  /** That build's `success` status. */
  deployedAt: string | null;
  state: ReleaseState;
}

export interface GameReleasesResponse {
  games: Record<string, GameRelease>;
  fetchedAt: string;
  /** GitHub rate limit hit / unreachable — push/deploy times may be missing. */
  partial: boolean;
}

export interface GhDeployment {
  sha: string;
  created_at: string;
}

export interface GhCommit {
  sha: string;
  commit: { committer: { date: string } };
}

export interface GhStatus {
  state: string;
  context: string;
  created_at: string;
}

export const VERCEL_CONTEXT = "Vercel – board-game";
export const VERCEL_ENVIRONMENT = "Production – board-game";

/**
 * The deployment that first shipped commit `sha` (committed at `commitAt`):
 * the oldest one at or after it in main's order. Commits older than the
 * fetched `/commits` page fall back to "first deployment finished after the
 * commit" — rebases refresh committer dates, so this rarely misfires —
 * or null when the commit predates every fetched deployment.
 */
export function findShippingDeployment(
  sha: string,
  commitAt: string,
  commitOrder: ReadonlyMap<string, number>,
  deployments: readonly GhDeployment[],
): GhDeployment | null {
  const idx = commitOrder.get(sha);
  // Older than every fetched deployment: the one that shipped it fell off the
  // page, so any match here would be a much later, unrelated build.
  if (idx === undefined && deployments.every((d) => Date.parse(d.created_at) > Date.parse(commitAt))) return null;
  let best: GhDeployment | null = null;
  for (const d of deployments) {
    const dIdx = commitOrder.get(d.sha);
    const contains =
      idx !== undefined
        ? dIdx !== undefined && dIdx <= idx
        : dIdx !== undefined || Date.parse(d.created_at) >= Date.parse(commitAt);
    if (contains && (!best || Date.parse(d.created_at) < Date.parse(best.created_at))) best = d;
  }
  return best;
}

/** Push/deploy times from one commit's Vercel statuses (newest first, as GitHub returns them). */
export function readVercelStatuses(statuses: readonly GhStatus[]): Pick<GameRelease, "pushedAt" | "deployedAt" | "state"> {
  const ours = statuses.filter((s) => s.context === VERCEL_CONTEXT);
  const oldestFirst = [...ours].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const pushedAt = oldestFirst[0]?.created_at ?? null;
  const success = oldestFirst.find((s) => s.state === "success");
  if (success) return { pushedAt, deployedAt: success.created_at, state: "deployed" };
  const latest = oldestFirst.at(-1);
  if (latest && (latest.state === "failure" || latest.state === "error")) return { pushedAt, deployedAt: null, state: "failed" };
  if (latest) return { pushedAt, deployedAt: null, state: "building" };
  return { pushedAt: null, deployedAt: null, state: "unknown" };
}

/** Same rules as `scripts/gen-game-last-updated.mjs`: dir → id, `shared` skipped. */
const toGameId = (dir: string) =>
  dir
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase();
const MAX_GAMES_PER_COMMIT = 3;

/** Game ids one commit counts as "updated" for — none for a site-wide sweep. */
export function gameIdsTouched(files: readonly { filename: string }[]): string[] {
  const dirs = new Set(
    files.map((f) => f.filename.match(/^src\/games\/([^/]+)\//)?.[1]).filter((d): d is string => !!d && d !== "shared"),
  );
  return dirs.size > MAX_GAMES_PER_COMMIT ? [] : [...dirs].map(toGameId);
}
