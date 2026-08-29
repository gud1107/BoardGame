import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Separate config for opt-in, slow self-play benchmark suites (`*.bench.ts`
 * — see `aiBenchmark.bench.ts`'s header for why these are split out of the
 * default `vitest.config.mts`/`include: ["src/**\/*.test.ts"]`). Run via
 * `npm run test:bench`. `testTimeout` is generous on purpose: each `it()`
 * runs synchronously for real minutes, so vitest's timeout mechanism can't
 * actually interrupt it early regardless of this value — this just makes
 * that "it happens to work" fact an explicit, intentional setting instead of
 * an accident that would silently break if vitest's pool/scheduler ever
 * changes to something that *can* enforce the timeout mid-run.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.bench.ts"],
    testTimeout: 30 * 60 * 1000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
