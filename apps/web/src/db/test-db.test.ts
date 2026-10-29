import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { profiles } from "./schema";
import { createTestDb, openTestDb, type TestDbHandle } from "./test-db";

describe("createTestDb", () => {
  let handle: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("starts a fresh in-process Postgres with every migration applied", async () => {
    const result = await handle.db.execute(sql`select 1 as one`);
    expect(result.rows).toEqual([{ one: 1 }]);
  });
});

describe("openTestDb", () => {
  let handle: TestDbHandle;

  beforeAll(async () => {
    handle = await openTestDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("uses a throwaway real database when TEST_DATABASE_URL is set, else PGlite", () => {
    expect(handle.backend).toBe(process.env.TEST_DATABASE_URL ? "postgres" : "pglite");
  });

  it("returns plain row objects from rows(), on either backend", async () => {
    expect(await handle.rows(sql`select 1::int as one`)).toEqual([{ one: 1 }]);
  });

  it("has every migration applied", async () => {
    await handle.db
      .insert(profiles)
      .values({ id: "77777777-7777-4777-8777-777777777777", email: "t@x.edu", displayName: "T" });
    expect(await handle.rows(sql`select count(*)::int as n from profiles`)).toEqual([{ n: 1 }]);
  });

  it("gives each call its own database", async () => {
    const other = await openTestDb();
    try {
      expect(await other.rows(sql`select count(*)::int as n from profiles`)).toEqual([{ n: 0 }]);
    } finally {
      await other.close();
    }
  });
});
