import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// `connection()` only works inside a Next.js request.
vi.mock("next/server", () => ({ connection: async () => {} }));

// Hard constraint 1 (CLAUDE.md): UI copy never says "bet", "$", or "cash out". Also checks that the
// page builds and renders with every Supabase variable unset.

const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ");

function expectCleanCopy(html: string) {
  const t = text(html);
  expect(t).not.toMatch(/\bbets?\b/i);
  expect(t).not.toMatch(/\$/);
  expect(t).not.toMatch(/cash[\s-]?out/i);
  expect(t).not.toMatch(/\bwager|prize\b/i);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("sign-in page", () => {
  it("shows a not-configured notice, and no form, when Supabase is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("DATABASE_URL", "");
    const { default: SignInPage } = await import("./page");
    const html = renderToStaticMarkup(await SignInPage());
    expect(text(html)).toMatch(/Sign-in is not set up on this server yet/);
    expect(html).not.toMatch(/<form/);
    expect(text(html)).toMatch(/Unofficial student project/);
    expectCleanCopy(html);
  });

  it("names the college in plain body text only, never as a styled wordmark", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("DATABASE_URL", "");
    const { default: SignInPage } = await import("./page");
    const html = renderToStaticMarkup(await SignInPage());
    expect(html).toContain('<p class="text-base">For the Maryville College community</p>');
    for (const m of html.matchAll(/<[^>]*class="([^"]*)"[^>]*>[^<]*Maryville College/g)) {
      expect(m[1]).not.toMatch(/uppercase|font-display|tracking-|text-brand/);
    }
  });

  it("renders the email step of the form with theme tokens only", async () => {
    const { SignInForm } = await import("./sign-in-form");
    const html = renderToStaticMarkup(createElement(SignInForm));
    expect(text(html)).toMatch(/Maryville College email/);
    expect(text(html)).toMatch(/Send code/);
    expect(html).toMatch(/type="email"/);
    expect(html).not.toMatch(
      /\b(?:bg|text|border)-(?:zinc|gray|slate|red|green|blue|white|black)\b/,
    );
    expectCleanCopy(html);
  });
});
