import { describe, expect, it } from "vitest";
import { resolveMigrationDatabaseUrl, resolveRuntimeDatabaseUrl } from "./url";

// One place decides which database URL the app and the migration tools use (SOP-07). Supabase's
// Vercel integration sets POSTGRES_URL (pooled) and POSTGRES_URL_NON_POOLING, not DATABASE_URL.

const APP = "postgres://mc_app@pooler:6543/postgres";
const POOLED = "postgres://integration@pooler:6543/postgres";
const DIRECT = "postgres://integration@db:5432/postgres";
const OWNER = "postgres://postgres@db:5432/postgres";

describe("resolveRuntimeDatabaseUrl", () => {
  it("prefers DATABASE_URL", () => {
    expect(resolveRuntimeDatabaseUrl({ DATABASE_URL: APP, POSTGRES_URL: POOLED })).toBe(APP);
  });

  it("falls back to POSTGRES_URL", () => {
    expect(resolveRuntimeDatabaseUrl({ POSTGRES_URL: POOLED })).toBe(POOLED);
    expect(resolveRuntimeDatabaseUrl({ DATABASE_URL: " ", POSTGRES_URL: POOLED })).toBe(POOLED);
  });

  it("never uses the non-pooling or migration URLs", () => {
    expect(
      resolveRuntimeDatabaseUrl({
        POSTGRES_URL_NON_POOLING: DIRECT,
        MIGRATION_DATABASE_URL: OWNER,
      }),
    ).toBeUndefined();
  });

  it("is undefined when nothing is set", () => {
    expect(resolveRuntimeDatabaseUrl({})).toBeUndefined();
    expect(resolveRuntimeDatabaseUrl({ DATABASE_URL: "", POSTGRES_URL: "  " })).toBeUndefined();
  });

  it("trims the value", () => {
    expect(resolveRuntimeDatabaseUrl({ DATABASE_URL: ` ${APP}\n` })).toBe(APP);
  });

  it("reads process.env by default", () => {
    expect(resolveRuntimeDatabaseUrl()).toBe(resolveRuntimeDatabaseUrl(process.env));
  });
});

describe("resolveMigrationDatabaseUrl", () => {
  const ALL = {
    MIGRATION_DATABASE_URL: OWNER,
    DATABASE_URL: APP,
    POSTGRES_URL_NON_POOLING: DIRECT,
    POSTGRES_URL: POOLED,
  };

  it("prefers MIGRATION_DATABASE_URL, then DATABASE_URL, then the non-pooling, then the pooled URL", () => {
    expect(resolveMigrationDatabaseUrl(ALL)).toBe(OWNER);
    expect(resolveMigrationDatabaseUrl({ ...ALL, MIGRATION_DATABASE_URL: "" })).toBe(APP);
    expect(
      resolveMigrationDatabaseUrl({ POSTGRES_URL_NON_POOLING: DIRECT, POSTGRES_URL: POOLED }),
    ).toBe(DIRECT);
    expect(resolveMigrationDatabaseUrl({ POSTGRES_URL: POOLED })).toBe(POOLED);
  });

  it("is undefined when nothing is set", () => {
    expect(resolveMigrationDatabaseUrl({})).toBeUndefined();
    expect(resolveMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: " " })).toBeUndefined();
  });

  it("reads process.env by default", () => {
    expect(resolveMigrationDatabaseUrl()).toBe(resolveMigrationDatabaseUrl(process.env));
  });
});
