import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSslOption, getDb } from "./index";

const store = globalThis as typeof globalThis & {
  __mcKalshiDb?: unknown;
  __mcKalshiDbRefused?: true;
};
const FAKE_URL = "postgres://user:s3cret-password@db.example.invalid:5432/postgres";

describe("getDb", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store.__mcKalshiDb = undefined;
    store.__mcKalshiDbRefused = undefined;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    errorSpy.mockRestore();
    store.__mcKalshiDb = undefined;
    store.__mcKalshiDbRefused = undefined;
  });

  it("returns undefined when DATABASE_URL is unset", () => {
    vi.stubEnv("DATABASE_URL", "");
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
