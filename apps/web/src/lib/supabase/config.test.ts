import { describe, expect, it } from "vitest";
import { getSupabaseConfig } from "./config";

describe("getSupabaseConfig", () => {
  it("is undefined when nothing is set", () => {
    expect(getSupabaseConfig({})).toBeUndefined();
  });

  it("is undefined when only one of the two is set", () => {
    expect(
      getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" }),
    ).toBeUndefined();
    expect(getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toBeUndefined();
  });

  it("is undefined for blank values and URLs that do not parse", () => {
    expect(
      getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: " ", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" }),
    ).toBeUndefined();
    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "not a url",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "k",
      }),
    ).toBeUndefined();
    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "javascript:alert(1)",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "k",
      }),
    ).toBeUndefined();
  });

  it("accepts the anon key, and prefers the publishable key when both are set", () => {
    const url = "https://x.supabase.co";
    expect(
      getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }),
    ).toEqual({
      url,
      key: "anon",
    });
    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pub",
      }),
    ).toEqual({ url, key: "pub" });
  });
});
