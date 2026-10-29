import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAllowedEmail } from "@/server/auth-email";
import { ALLOWED_EMAIL_CASES } from "@/server/auth-email-cases";
import { createTestDb, type TestDb } from "./test-db";

// The Before User Created hook is the real enforcement of CLAUDE.md hard constraint 2: Supabase
// Auth calls it inside the database, so it holds even for requests that skip the app.
// Contract: https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook

const MIGRATION = fileURLToPath(
  new URL("../../drizzle/0002_auth_signup_hook.sql", import.meta.url),
);

type HookResult = { error?: { http_code: number; message: string } };

describe("hook_before_user_created", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });

  async function callHook(event: unknown): Promise<HookResult> {
    const json = JSON.stringify(event);
    const result = await db.execute<{ r: HookResult }>(
      sql`select public.hook_before_user_created(${json}::jsonb) as r`,
    );
    return result.rows[0]?.r as HookResult;
  }
  const eventFor = (email: unknown) => ({
    metadata: { name: "before-user-created", ip_address: "127.0.0.1" },
    user: {
      id: "ff7fc9ae-3b1b-4642-9241-64adb9848a03",
      email,
      app_metadata: { provider: "email" },
    },
  });

  it("allows both college domains with an empty object", async () => {
    expect(await callHook(eventFor("jane@maryvillecollege.edu"))).toEqual({});
    expect(await callHook(eventFor("jdoe@my.maryvillecollege.edu"))).toEqual({});
  });

  it("is case-insensitive and ignores surrounding spaces", async () => {
    expect(await callHook(eventFor("  Jane@MaryvilleCollege.EDU "))).toEqual({});
  });

  it("rejects other domains with Supabase's error object (403 and a message)", async () => {
    const result = await callHook(eventFor("jane@gmail.com"));
    expect(result.error?.http_code).toBe(403);
    expect(result.error?.message).toMatch(/Maryville College/);
    expect(Object.keys(result)).toEqual(["error"]);
  });

  it("rejects an event with no email, a null email, a non-string email, or no user", async () => {
    for (const event of [
      { user: {} },
      eventFor(null),
      eventFor(""),
      eventFor(42),
      eventFor(["jane@maryvillecollege.edu"]),
      { metadata: {} },
      {},
      null,
    ]) {
      const result = await callHook(event);
      expect(result.error?.http_code, JSON.stringify(event)).toBe(403);
    }
  });

  it("rejects an email over the length limits", async () => {
    expect(await callHook(eventFor(`${"a".repeat(64)}@maryvillecollege.edu`))).toEqual({});
    expect(
      (await callHook(eventFor(`${"a".repeat(65)}@maryvillecollege.edu`))).error,
    ).toBeDefined();
  });

  it("agrees with isAllowedEmail on every case in the shared table", async () => {
    for (const { email, allowed } of ALLOWED_EMAIL_CASES) {
      const result = await callHook(eventFor(email));
      const sqlAllows = result.error === undefined;
      expect(sqlAllows, `SQL verdict for ${JSON.stringify(email)}`).toBe(allowed);
      expect(isAllowedEmail(email), `TS verdict for ${JSON.stringify(email)}`).toBe(allowed);
    }
  });
});

describe("hook_before_user_created grants", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  const canExecute = async (role: string) => {
    const r = await db.execute<{ ok: boolean }>(
      sql`select has_function_privilege(${role}, 'public.hook_before_user_created(jsonb)', 'EXECUTE') as ok`,
    );
    return r.rows[0]?.ok;
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });

  it("applies without Supabase's roles (PGlite has none) and leaves PUBLIC without execute", async () => {
    const roles = await db.execute<{ rolname: string }>(
      sql`select rolname from pg_roles where rolname in ('supabase_auth_admin', 'anon', 'authenticated')`,
    );
    expect(roles.rows).toEqual([]);
    await db.execute(sql`create role stranger`);
    expect(await canExecute("stranger")).toBe(false);
  });

  it("with Supabase's roles present, only supabase_auth_admin may execute", async () => {
    // Supabase grants execute on new public functions to anon/authenticated by default; mimic it,
    // then re-run the migration the way a Supabase database would have experienced it.
    for (const role of ["supabase_auth_admin", "anon", "authenticated"]) {
      await db.execute(sql.raw(`create role ${role}`));
    }
    await db.execute(sql`grant usage on schema public to anon, authenticated`);
    await db.execute(
      sql`grant execute on function public.hook_before_user_created(jsonb) to anon, authenticated, public`,
    );
    expect(await canExecute("anon")).toBe(true);

    const statements = readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint");
    for (const statement of statements) {
      await db.execute(sql.raw(statement));
    }

    expect(await canExecute("supabase_auth_admin")).toBe(true);
    expect(await canExecute("anon")).toBe(false);
    expect(await canExecute("authenticated")).toBe(false);
    expect(await canExecute("stranger")).toBe(false);
    const usage = await db.execute<{ ok: boolean }>(
      sql`select has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') as ok`,
    );
    expect(usage.rows[0]?.ok).toBe(true);
  });
});
