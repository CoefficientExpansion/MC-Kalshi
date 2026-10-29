import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "engine",
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Only applied when run with --coverage (`npx vitest run --coverage` in this package).
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text"],
      thresholds: { lines: 95 },
    },
  },
});
