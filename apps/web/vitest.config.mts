import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Server modules start with `import "server-only"`, which throws outside an RSC build.
      "server-only": fileURLToPath(new URL("./vitest.server-only.ts", import.meta.url)),
    },
  },
  test: {
    name: "web",
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Each DB test boots its own PGlite (WASM Postgres). With one worker per core the boots
    // contend, and on a 32-core machine they overran the 10 s default hook timeout.
    hookTimeout: 60_000,
    // Some tests boot their PGlite database inside the test; a cold first run (WASM compile,
    // migrations) can take ~40 s under load, so match the hook timeout.
    testTimeout: 60_000,
  },
});
