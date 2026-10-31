import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Full bot-vs-bot simulations (merge defense, tavern brawl, curling…) are
    // synchronous, so the timeout can't interrupt a hang anyway — it only
    // measures wall time, which balloons when all workers run in parallel.
    // The 5s default failed 2–7 of them at random on every full run.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
