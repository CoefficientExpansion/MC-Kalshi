import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    name: "web",
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Each DB test boots its own PGlite (WASM Postgres). With one worker per core the boots
    // contend, and on a 32-core machine they overran the 10 s default hook timeout.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
