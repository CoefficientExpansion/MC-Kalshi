import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ANY_DOMAIN,
  DEFAULT_ALLOWED_DOMAINS,
  getAllowedDomains,
  isAllowedEmail,
  parseAllowedDomains,
} from "./auth-email";
import { ALLOWED_EMAIL_CASES } from "./auth-email-cases";

describe("parseAllowedDomains", () => {
  it("defaults when unset or blank", () => {
    expect(parseAllowedDomains(undefined)).toEqual(DEFAULT_ALLOWED_DOMAINS);
    expect(parseAllowedDomains("")).toEqual(DEFAULT_ALLOWED_DOMAINS);
    expect(parseAllowedDomains("  \n ")).toEqual(DEFAULT_ALLOWED_DOMAINS);
  });

  it("splits on commas, trims and lower-cases", () => {
    expect(parseAllowedDomains(" Example.EDU , my.example.edu ")).toEqual([
      "example.edu",
      "my.example.edu",
    ]);
  });

  it("drops entries that are not plain host names, and fails closed if none remain", () => {
    expect(parseAllowedDomains("a.edu,*,@b.edu,c d.edu,.e.edu,f.edu.")).toEqual(["a.edu"]);
    expect(parseAllowedDomains("*,@x")).toEqual([]);
    expect(parseAllowedDomains(",,")).toEqual([]);
  });

  it("reads ALLOWED_EMAIL_DOMAINS from the environment", () => {
    expect(getAllowedDomains({ ALLOWED_EMAIL_DOMAINS: "x.edu" })).toEqual(["x.edu"]);
    expect(getAllowedDomains({})).toEqual(DEFAULT_ALLOWED_DOMAINS);
  });
});

describe("isAllowedEmail", () => {
  it("has the two Maryville domains as its default", () => {
    expect(DEFAULT_ALLOWED_DOMAINS).toEqual(["maryvillecollege.edu", "my.maryvillecollege.edu"]);
  });

  it("accepts the two college domains", () => {
    expect(isAllowedEmail("jane.doe@maryvillecollege.edu")).toBe(true);
    expect(isAllowedEmail("jdoe1@my.maryvillecollege.edu")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isAllowedEmail("  Jane.Doe@MaryvilleCollege.EDU \n")).toBe(true);
    expect(isAllowedEmail("\tJDOE@MY.MARYVILLECOLLEGE.EDU")).toBe(true);
  });

  it("accepts plus tags and hyphens, apostrophes and underscores in the local part", () => {
    expect(isAllowedEmail("jane+kalshi@my.maryvillecollege.edu")).toBe(true);
    expect(isAllowedEmail("o'neil_j-2@maryvillecollege.edu")).toBe(true);
  });

  it.each([
    ["other domain", "jane@gmail.com"],
    ["subdomain trick", "x@evil.maryvillecollege.edu.attacker.com"],
    ["domain as a prefix", "x@maryvillecollege.edu.evil"],
    ["domain as a suffix of another name", "x@evil-maryvillecollege.edu"],
    ["extra label before the domain", "x@evil.maryvillecollege.edu"],
    ["extra label before my.", "x@sub.my.maryvillecollege.edu"],
    ["domain in the local part", "maryvillecollege.edu@gmail.com"],
    ["domain after a second @", "x@gmail.com@maryvillecollege.edu"],
    ["quoted local part with @", '"x@maryvillecollege.edu"@gmail.com'],
    ["quoted local part", '"a b"@maryvillecollege.edu'],
    ["two @ signs", "a@b@maryvillecollege.edu"],
    ["no @", "maryvillecollege.edu"],
    ["no local part", "@maryvillecollege.edu"],
    ["no domain", "jane@"],
    ["trailing dot", "jane@maryvillecollege.edu."],
    ["port", "jane@maryvillecollege.edu:25"],
    ["percent hack", "jane%gmail.com@maryvillecollege.edu"],
    ["comma list", "a@maryvillecollege.edu,b@gmail.com"],
    ["space inside", "jane doe@maryvillecollege.edu"],
    ["newline inside", "jane@gmail.com\n@maryvillecollege.edu"],
    ["trailing newline then second address", "jane@maryvillecollege.edu\nb@gmail.com"],
    ["angle brackets", "<jane@maryvillecollege.edu>"],
    ["parenthesised comment", "jane(@gmail.com)@maryvillecollege.edu"],
    ["leading dot", ".jane@maryvillecollege.edu"],
    ["trailing dot in local part", "jane.@maryvillecollege.edu"],
    ["double dot", "ja..ne@maryvillecollege.edu"],
    ["empty", ""],
    ["whitespace only", "   "],
    ["cyrillic a lookalike in the domain", "x@mаryvillecollege.edu"],
    ["cyrillic lookalike in the local part", "jаne@maryvillecollege.edu"],
    ["fullwidth at sign", "x＠maryvillecollege.edu"],
    ["fullwidth dot", "x@maryvillecollege．edu"],
    ["kelvin sign", "K@maryvillecollege.edu"],
    ["dotless i lookalike", "x@maryvillecollege.eduı"],
    ["long s lookalike", "x@ſmy.maryvillecollege.edu"],
    ["zero-width space", "x@maryville​college.edu"],
    ["NUL byte", "x\0@maryvillecollege.edu"],
    ["punycode label", "x@xn--maryvillecollege.edu"],
  ])("rejects %s", (_name, email) => {
    expect(isAllowedEmail(email)).toBe(false);
  });

  it("rejects an address over the 254 character limit and a local part over 64", () => {
    expect(isAllowedEmail(`${"a".repeat(64)}@maryvillecollege.edu`)).toBe(true);
    expect(isAllowedEmail(`${"a".repeat(65)}@maryvillecollege.edu`)).toBe(false);
    expect(isAllowedEmail(`${"a".repeat(300)}@maryvillecollege.edu`)).toBe(false);
  });

  it("rejects anything that is not a string", () => {
    for (const value of [undefined, null, 42, {}, [], ["a@maryvillecollege.edu"], true]) {
      expect(isAllowedEmail(value)).toBe(false);
    }
  });

  it("uses a custom allowlist when given one, and nobody for an empty list", () => {
    expect(isAllowedEmail("a@example.edu", ["example.edu"])).toBe(true);
    expect(isAllowedEmail("a@maryvillecollege.edu", ["example.edu"])).toBe(false);
    expect(isAllowedEmail("a@maryvillecollege.edu", [])).toBe(false);
  });

  it("agrees with the shared case table (also run against the SQL hook)", () => {
    for (const { email, allowed } of ALLOWED_EMAIL_CASES) {
      expect(isAllowedEmail(email), email).toBe(allowed);
    }
  });

  describe("properties", () => {
    const localPart = fc.stringMatching(/^[a-z0-9][a-z0-9_'+-]{0,20}$/);
    const domain = fc.constantFrom(...DEFAULT_ALLOWED_DOMAINS);
    const padding = fc.stringMatching(/^[ \t\n]{0,3}$/);

    // Upper-cases a random subset of the characters.
    const withRandomCase = (s: string) =>
      fc
        .array(fc.boolean(), { minLength: s.length, maxLength: s.length })
        .map((flags) => [...s].map((c, i) => (flags[i] ? c.toUpperCase() : c)).join(""));

    it("accepts any plain local part at an allowed domain, in any case, padded with whitespace", () => {
      fc.assert(
        fc.property(
          fc.tuple(localPart, domain).chain(([l, d]) => withRandomCase(`${l}@${d}`)),
          padding,
          padding,
          (email, pre, post) => isAllowedEmail(`${pre}${email}${post}`),
        ),
      );
    });

    it("rejects an allowed domain with anything stuck on the end", () => {
      fc.assert(
        fc.property(localPart, domain, fc.stringMatching(/^[a-z0-9.@:_-]{1,12}$/), (l, d, junk) => {
          return isAllowedEmail(`${l}@${d}${junk}`) === false;
        }),
      );
    });

    it("rejects an allowed domain with a label stuck on the front", () => {
      fc.assert(
        fc.property(localPart, domain, fc.stringMatching(/^[a-z0-9-]{1,10}$/), (l, d, label) => {
          return isAllowedEmail(`${l}@${label}.${d}`) === false;
        }),
      );
    });

    it("never throws, and anything it accepts has exactly one @ and an allowed domain", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string(),
            fc.string({ unit: "binary" }),
            fc.string({ unit: "grapheme" }),
            // Biased towards the interesting characters.
            fc
              .array(
                fc.constantFrom("a", "b", "@", ".", "maryvillecollege.edu", "my.", " ", "+", '"'),
              )
              .map((parts) => parts.join("")),
          ),
          (s) => {
            const ok = isAllowedEmail(s);
            if (!ok) {
              return true;
            }
            const parts = s.trim().toLowerCase().split("@");
            return parts.length === 2 && DEFAULT_ALLOWED_DOMAINS.includes(parts[1] ?? "");
          },
        ),
        { numRuns: 1000 },
      );
    });

    it("rejects every address containing a non-ASCII character", () => {
      const nonAscii = fc.integer({ min: 0x80, max: 0xd7ff }).map((n) => String.fromCharCode(n));
      fc.assert(
        fc.property(
          localPart,
          nonAscii,
          domain,
          (l, c, d) =>
            isAllowedEmail(`${l}${c}@${d}`) === false &&
            isAllowedEmail(`${c}${l}@${d}`) === false &&
            isAllowedEmail(`${l}@${c}${d}`) === false &&
            isAllowedEmail(`${l}@${d}${c}`) === false,
        ),
      );
    });
  });
});

describe("isAllowedEmail with the allow-any policy (open mode, ADR-0007)", () => {
  it("accepts a well-formed address at any plain host name", () => {
    for (const email of [
      "jane@gmail.com",
      " Jane.Doe+x@Outlook.COM ",
      "a@maryvillecollege.edu",
      "o'neil@sub.example.co.uk",
    ]) {
      expect(isAllowedEmail(email, ANY_DOMAIN), email).toBe(true);
    }
  });

  it("still applies every syntax rule: one @, ASCII, length limits, plain host", () => {
    for (const email of [
      "",
      "jane",
      "jane@",
      "@gmail.com",
      "a@b@gmail.com",
      "jane@localhost",
      "jane@gmail.com.",
      "jane@-gmail.com",
      "jane@gmail.com:25",
      "jane doe@gmail.com",
      "jane@gmail.com\nb@x.com",
      '"a b"@gmail.com',
      ".jane@gmail.com",
      "ja..ne@gmail.com",
      "jаne@gmail.com",
      "x＠gmail.com",
      "<jane@gmail.com>",
      `${"a".repeat(65)}@gmail.com`,
      `a@${"b".repeat(250)}.com`,
      5,
      null,
    ]) {
      expect(isAllowedEmail(email, ANY_DOMAIN), String(email)).toBe(false);
    }
  });

  it("accepts every address the college table accepts", () => {
    for (const { email, allowed } of ALLOWED_EMAIL_CASES) {
      if (allowed) {
        expect(isAllowedEmail(email, ANY_DOMAIN), email).toBe(true);
      }
    }
  });
});
