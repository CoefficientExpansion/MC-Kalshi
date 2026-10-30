import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The sign-in page per SIGN_IN_MODE (ADR-0007, docs/specs/open-signup.md), with sign-in configured.

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/server/auth", () => ({
  isSignInConfigured: () => true,
  getCurrentUser: async () => null,
  getAuthDeps: async () => ({}),
  getPasswordAuthDeps: async () => ({}),
}));

const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ")
    .replace(/\s+/g, " ");

function expectCleanCopy(html: string) {
  const t = text(html);
  expect(t).not.toMatch(/\bbets?\b/i);
  expect(t).not.toMatch(/\$/);
  expect(t).not.toMatch(/cash[\s-]?out/i);
  expect(t).not.toMatch(/\bwager|prize\b/i);
}

async function render(mode: string | undefined) {
  vi.stubEnv("SIGN_IN_MODE", mode);
  const { default: SignInPage } = await import("./page");
  return renderToStaticMarkup(await SignInPage());
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("sign-in page in open mode", () => {
  it("shows one email and password form with Create account and Sign in", async () => {
    const html = await render("open");
    expect((html.match(/<form/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<label[^>]*for="email"[^>]*>Email<\/label>/);
    expect(html).toMatch(/<label[^>]*for="password"[^>]*>Password<\/label>/);
    expect(html).toMatch(/<input[^>]*id="email"[^>]*type="email"[^>]*autoComplete="email"/i);
    expect(html).toMatch(
      /<input[^>]*id="password"[^>]*type="password"[^>]*autoComplete="current-password"/i,
    );
    const button = (label: string) => html.match(new RegExp(`<button([^>]*)>${label}<`))?.[1];
    expect(button("Create account")).toMatch(/type="submit"/);
    expect(button("Create account")).toMatch(/value="sign-up"/);
    expect(button("Create account")).toMatch(/name="intent"/);
    expect(button("Sign in")).toMatch(/value="sign-in"/);
    expect(button("Sign in")).toMatch(/name="intent"/);
    expect(html).not.toMatch(/one-time-code/);
    expect(text(html)).not.toMatch(/6-digit code/);
  });

  it("says this is an open test and points are play money, with clean copy and theme tokens", async () => {
    const html = await render("open");
    const t = text(html);
    expect(t).toMatch(/open test/i);
    expect(t).toMatch(/play money/i);
    expect(t).not.toMatch(/Only @maryvillecollege\.edu/);
    expect(html).not.toMatch(
      /\b(?:bg|text|border)-(?:zinc|gray|slate|red|green|blue|white|black)\b/,
    );
    expectCleanCopy(html);
  });
});

describe("sign-in page in college mode", () => {
  it.each([undefined, "", "OPEN", "college"])(
    "shows the emailed-code form when SIGN_IN_MODE is %s",
    async (mode) => {
      const html = await render(mode);
      expect(text(html)).toMatch(/Send code/);
      expect(text(html)).toMatch(/Only @maryvillecollege\.edu and @my\.maryvillecollege\.edu/);
      expect(html).not.toMatch(/type="password"/);
      expect(text(html)).not.toMatch(/Create account/);
      expectCleanCopy(html);
    },
  );
});
