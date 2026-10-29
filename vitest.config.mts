import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    // Each web test file boots an in-process Postgres (PGlite); one worker per core (32 on the
    // owner's machine) starves them and turns setup into timeouts. CI runners have fewer cores.
    maxWorkers: 8,
  },
});
