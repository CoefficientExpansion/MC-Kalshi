// Supabase connection settings, read from the environment at call time. Everything that touches
// Supabase goes through this, so with the variables unset the app still builds and runs and the
// sign-in page says it is not configured.

export interface SupabaseConfig {
  readonly url: string;
  /** The browser-safe key: Supabase's publishable key, or the legacy anon key (SOP-07). */
  readonly key: string;
}

/** `undefined` unless both the project URL and a browser-safe key are set (and the URL parses). */
export function getSupabaseConfig(
  env: Record<string, string | undefined> = process.env,
): SupabaseConfig | undefined {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  )?.trim();
  if (!url || !key) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return { url, key };
}
