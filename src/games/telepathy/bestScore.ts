/**
 * Best score per player count, kept in this browser (2인 and 4인 runs aren't
 * comparable, so each count has its own record). Per-viewer convenience only —
 * the account-synced stats (/stats, `maxScore`) stay the source of truth.
 */
const key = (playerCount: number) => `telepathy-best-score:${playerCount}p`;

export function readBestScore(playerCount: number): number {
  try {
    const v = Number(window.localStorage.getItem(key(playerCount)));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

export function saveBestScore(playerCount: number, score: number): void {
  try {
    if (score > readBestScore(playerCount)) window.localStorage.setItem(key(playerCount), String(score));
  } catch {
    /* storage blocked — the record just isn't kept */
  }
}
