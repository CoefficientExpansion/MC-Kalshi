import { describe, expect, it } from "vitest";
import { ANY_DOMAIN, DEFAULT_ALLOWED_DOMAINS } from "./auth-email";
import { getEmailDomainPolicy, getSignInMode, parseSignInMode } from "./sign-in-mode";

// SIGN_IN_MODE (ADR-0007): exactly "open" turns on open sign-up; anything else is college mode.

describe("parseSignInMode", () => {
  it("is open only for the exact word open, surrounding spaces ignored", () => {
    expect(parseSignInMode("open")).toBe("open");
    expect(parseSignInMode(" open \n")).toBe("open");
  });

  it("fails closed to college mode for unset, blank and every other value", () => {
    for (const raw of [
      undefined,
      "",
      "   ",
      "OPEN",
      "Open",
      "true",
      "1",
      "college",
      "opens",
      "o pen",
    ]) {
      expect(parseSignInMode(raw), String(raw)).toBe("college");
    }
  });
});

describe("getSignInMode", () => {
  it("reads SIGN_IN_MODE from the environment", () => {
    expect(getSignInMode({ SIGN_IN_MODE: "open" })).toBe("open");
    expect(getSignInMode({})).toBe("college");
    // A public variable of a similar name means nothing: the mode is server-only.
    expect(getSignInMode({ NEXT_PUBLIC_SIGN_IN_MODE: "open" })).toBe("college");
  });
});

describe("getEmailDomainPolicy", () => {
  it("allows any domain in open mode", () => {
    expect(getEmailDomainPolicy({ SIGN_IN_MODE: "open" })).toBe(ANY_DOMAIN);
    expect(getEmailDomainPolicy({ SIGN_IN_MODE: "open", ALLOWED_EMAIL_DOMAINS: "x.edu" })).toBe(
      ANY_DOMAIN,
    );
  });

  it("is the college allowlist in college mode", () => {
    expect(getEmailDomainPolicy({})).toEqual(DEFAULT_ALLOWED_DOMAINS);
    expect(getEmailDomainPolicy({ SIGN_IN_MODE: "OPEN" })).toEqual(DEFAULT_ALLOWED_DOMAINS);
    expect(getEmailDomainPolicy({ ALLOWED_EMAIL_DOMAINS: "x.edu" })).toEqual(["x.edu"]);
  });
});
