import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { GAME_LAST_COMMIT } from "@/constants/gameLastUpdated.generated";
import {
  findShippingDeployment,
  gameIdsTouched,
  readVercelStatuses,
  VERCEL_ENVIRONMENT,
  type GameRelease,
  type GameReleasesResponse,
  type GhCommit,
  type GhDeployment,
  type GhStatus,
} from "@/lib/admin/gameReleases";

export const runtime = "nodejs";

const REPO = "https://api.github.com/repos/gud1107/BoardGame";
/** A build this old has settled, so its statuses can be cached for good. */
const SETTLED_MS = 15 * 60 * 1000;
/** Status lookups per request beyond this fall back to the deployment's own time (no push time). */
const MAX_STATUS_FETCHES = 25;
/** Newest main commits the bundled `GAME_LAST_COMMIT` may predate, looked up per request at most. */
const MAX_CATCH_UP_COMMITS = 15;

async function gh<T>(path: string, init: { cache?: "force-cache"; next?: { revalidate: number } }): Promise<T | null> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "board-game-admin" };
  // Optional: lifts the shared 60 req/h unauthenticated limit to 5,000.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(`${REPO}${path}`, { headers, ...init });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Is the caller a site admin (`is_site_admin()`, same check as the header's admin link and `src/proxy.ts`)? */
async function checkAdmin(): Promise<number | null> {
  const supabase = await createServerSupabase();
  if (!supabase) return 503;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 401;
  const { data } = await supabase.rpc("is_site_admin");
  return data === true ? null : 403;
}

/** Admin lobby's 커밋/푸시/배포순 sorts: per-game push + production deploy time of its newest commit. */
export async function GET() {
  const denied = await checkAdmin();
  if (denied) return NextResponse.json({ error: "forbidden" }, { status: denied });

  const now = Date.now();
  const [commits, deployments] = await Promise.all([
    gh<GhCommit[]>("/commits?sha=main&per_page=100", { next: { revalidate: 60 } }),
    gh<GhDeployment[]>(`/deployments?environment=${encodeURIComponent(VERCEL_ENVIRONMENT)}&per_page=100`, {
      next: { revalidate: 60 },
    }),
  ]);
  let partial = !commits || !deployments;
  const commitOrder = new Map((commits ?? []).map((c, i) => [c.sha, i]));

  let statusFetches = 0;
  const statusCache = new Map<string, Promise<GhStatus[] | null>>();
  const statusesOf = (sha: string, finishedAt: number) => {
    let p = statusCache.get(sha);
    if (!p) {
      if (statusFetches >= MAX_STATUS_FETCHES) return Promise.resolve(null);
      statusFetches++;
      p = gh<GhStatus[]>(
        `/commits/${sha}/statuses?per_page=100`,
        now - finishedAt > SETTLED_MS ? { cache: "force-cache" } : { next: { revalidate: 30 } },
      );
      statusCache.set(sha, p);
    }
    return p;
  };

  // The bundled map is only as fresh as the build's git history — a CLI
  // `vercel deploy` uploads no .git, so prebuild keeps the committed (stale)
  // file. Re-derive rows from main commits newer than its newest row.
  const lastCommit: Partial<Record<string, { at: string; sha: string }>> = { ...GAME_LAST_COMMIT };
  const bundledNewest = Math.max(0, ...Object.values(lastCommit).map((c) => Date.parse(c!.at)));
  const catchUp = (commits ?? [])
    .filter((c) => Date.parse(c.commit.committer.date) > bundledNewest)
    .slice(0, MAX_CATCH_UP_COMMITS);
  if (commits && catchUp.length === MAX_CATCH_UP_COMMITS) partial = true;
  const touched = await Promise.all(
    catchUp.map((c) => gh<{ files?: { filename: string }[] }>(`/commits/${c.sha}`, { cache: "force-cache" })),
  );
  catchUp.forEach((c, i) => {
    const detail = touched[i];
    if (!detail) {
      partial = true;
      return;
    }
    const at = c.commit.committer.date;
    for (const id of gameIdsTouched(detail.files ?? [])) {
      const prev = lastCommit[id];
      if (!prev || Date.parse(at) > Date.parse(prev.at)) lastCommit[id] = { at, sha: c.sha };
    }
  });

  // Newest games first, so the status budget goes where the sort cares most.
  const entries = Object.entries(lastCommit).sort((a, b) => Date.parse(b[1]!.at) - Date.parse(a[1]!.at));
  const games: Record<string, GameRelease> = {};
  await Promise.all(
    entries.map(async ([id, commit]) => {
      const { sha, at: commitAt } = commit!;
      const base: GameRelease = { sha, commitAt, pushedAt: null, deployedAt: null, state: "unknown" };
      const shipped = findShippingDeployment(sha, commitAt, commitOrder, deployments ?? []);
      if (shipped) {
        const statuses = await statusesOf(shipped.sha, Date.parse(shipped.created_at));
        const read = statuses ? readVercelStatuses(statuses) : null;
        if (!statuses) partial = true;
        // GitHub deployments are created when the Vercel build finishes, so
        // their own time stands in for the success status if that's missing.
        games[id] = {
          ...base,
          pushedAt: read?.pushedAt ?? null,
          deployedAt: read?.deployedAt ?? shipped.created_at,
          state: "deployed",
        };
      } else if (commitOrder.has(sha) && commits?.[0]) {
        // On GitHub but no finished production build yet — main's head build covers it.
        const statuses = await statusesOf(commits[0].sha, now);
        const read = statuses ? readVercelStatuses(statuses) : null;
        games[id] = read && read.state !== "unknown" ? { ...base, ...read } : { ...base, state: "pushed" };
      } else {
        games[id] = base;
      }
    }),
  );

  const body: GameReleasesResponse = { games, fetchedAt: new Date(now).toISOString(), partial };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
