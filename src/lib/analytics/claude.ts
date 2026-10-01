/**
 * Claude's automated test runs (Playwright on the production site) are
 * recorded under one fixed identity instead of being dropped, so the admin
 * pages show them as "🤖 클로드" (2026-10-02 request). The database keeps
 * this id out of the public play counts, out of phone alerts, and — unless
 * the admin opts in — out of the admin stats (supabase/admin_claude.sql,
 * `claude_device_id()`); the two values must match.
 */
export const CLAUDE_DEVICE_ID = "00000000-0000-4000-8000-00000c1a0de0";
export const CLAUDE_NICKNAME = "🤖 클로드";
