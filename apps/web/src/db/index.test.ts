import { describe, expect, it } from "vitest";
import { buildSslOption } from "./index";

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
