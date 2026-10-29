import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_DB_ROLE, buildSslOption, getDb, getDbChecked } from "./index";

const store = globalThis as typeof globalThis & {
  __mcKalshiDb?: unknown;
  __mcKalshiDbRefused?: true;
  __mcKalshiDbRoleCheck?: unknown;
  __mcKalshiDbRoleRefused?: true;
};

function resetStore() {
  store.__mcKalshiDb = undefined;
  store.__mcKalshiDbRefused = undefined;
  store.__mcKalshiDbRoleCheck = undefined;
  store.__mcKalshiDbRoleRefused = undefined;
}
const FAKE_URL = "postgres://user:s3cret-password@db.example.invalid:5432/postgres";

describe("getDb", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetStore();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    errorSpy.mockRestore();
    resetStore();
  });

  it("returns undefined when DATABASE_URL is unset", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_URL", "");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(getDb()).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("refuses to connect in production without DATABASE_CA_CERT, logging one line without secrets", () => {
    vi.stubEnv("DATABASE_URL", FAKE_URL);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_CA_CERT", "");
    expect(getDb()).toBeUndefined();
    expect(getDb()).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(line).toContain("DATABASE_CA_CERT");
    expect(line).not.toContain("\n");
    expect(line).not.toContain("s3cret");
    expect(line).not.toContain("example.invalid");
  });

  it("treats a whitespace-only certificate as unset in production", () => {
    vi.stubEnv("DATABASE_URL", FAKE_URL);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_CA_CERT", "  \\n ");
    expect(getDb()).toBeUndefined();
  });

  it("refuses even when a client was cached before the guard applied", () => {
    vi.stubEnv("DATABASE_URL", FAKE_URL);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(getDb()).toBeDefined();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_CA_CERT", "");
    expect(getDb()).toBeUndefined();
  });

  it("connects in production when the CA certificate is set", () => {
    vi.stubEnv("DATABASE_URL", FAKE_URL);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_CA_CERT", PEM);
    expect(getDb()).toBeDefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each(["preview", "development", ""])(
    "connects without a CA certificate when VERCEL_ENV is %j",
    (env) => {
      vi.stubEnv("DATABASE_URL", FAKE_URL);
      vi.stubEnv("VERCEL_ENV", env);
      vi.stubEnv("DATABASE_CA_CERT", "");
      expect(getDb()).toBeDefined();
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );
});

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";

describe("getDb database URL", () => {
  beforeEach(resetStore);
  afterEach(() => {
    vi.unstubAllEnvs();
    resetStore();
  });

  it("falls back to POSTGRES_URL (Supabase's Vercel integration) when DATABASE_URL is unset", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_URL", FAKE_URL);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(getDb()).toBeDefined();
  });

  it("ignores POSTGRES_URL_NON_POOLING at runtime", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_URL", "");
    vi.stubEnv("POSTGRES_URL_NON_POOLING", FAKE_URL);
    expect(getDb()).toBeUndefined();
  });
});

describe("getDbChecked (the production role guard, ADR-0006)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetStore();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("DATABASE_URL", FAKE_URL);
    vi.stubEnv("DATABASE_CA_CERT", PEM);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    errorSpy.mockRestore();
    resetStore();
  });

  it("names mc_app as the app role", () => {
    expect(APP_DB_ROLE).toBe("mc_app");
  });

  it("refuses the owner role in production, once, logging one line without secrets", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const query = vi.fn(async () => "postgres");
    expect(await getDbChecked(query)).toBeUndefined();
    expect(await getDbChecked(query)).toBeUndefined();
    expect(getDb()).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(line).toContain("mc_app");
    expect(line).not.toContain("\n");
    expect(line).not.toContain("s3cret");
    expect(line).not.toContain("example.invalid");
  });

  it("allows mc_app in production, checking only once", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const query = vi.fn(async () => APP_DB_ROLE);
    const db = await getDbChecked(query);
    expect(db).toBeDefined();
    expect(await getDbChecked(query)).toBe(db);
    expect(getDb()).toBe(db);
    expect(query).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each(["preview", "development", ""])(
    "allows the owner role without asking when VERCEL_ENV is %j",
    async (env) => {
      vi.stubEnv("VERCEL_ENV", env);
      const query = vi.fn(async () => "postgres");
      expect(await getDbChecked(query)).toBeDefined();
      expect(query).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );

  it("passes a failed check's error on and asks again next time", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const query = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("connect timeout"))
      .mockResolvedValueOnce(APP_DB_ROLE);
    await expect(getDbChecked(query)).rejects.toThrow("connect timeout");
    expect(await getDbChecked(query)).toBeDefined();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("is undefined without asking when no database URL is set", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_URL", "");
    const query = vi.fn(async () => APP_DB_ROLE);
    expect(await getDbChecked(query)).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("is undefined without asking when the CA-certificate guard refuses", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_CA_CERT", "");
    const query = vi.fn(async () => APP_DB_ROLE);
    expect(await getDbChecked(query)).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("buildSslOption", () => {
  it('keeps "require" when no CA certificate is configured', () => {
    expect(buildSslOption(undefined)).toBe("require");
    expect(buildSslOption("")).toBe("require");
    expect(buildSslOption("   \n ")).toBe("require");
  });

  it("verifies the server certificate when a CA is configured", () => {
    expect(buildSslOption(PEM)).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it("accepts literal backslash-n escapes (single-line env editors)", () => {
    expect(buildSslOption(PEM.replaceAll("\n", "\\n"))).toEqual({
      ca: PEM,
      rejectUnauthorized: true,
    });
  });

  it("trims surrounding whitespace", () => {
    expect(buildSslOption(`\n${PEM}\n`)).toEqual({ ca: PEM, rejectUnauthorized: true });
  });
});
