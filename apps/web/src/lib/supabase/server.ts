import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";

// Server only (Server Components, Server Actions, Route Handlers). A new client per request: it is
// bound to this request's cookies. Pattern from Supabase's Next.js SSR guide (see docs/specs/m2b-auth.md).

/** The Supabase client for this request, or `undefined` when Supabase is not configured. */
export async function createSupabaseServerClient(): Promise<SupabaseClient | undefined> {
  const config = getSupabaseConfig();
  if (!config) {
    return undefined;
  }
  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. The proxy refreshes the session on every
          // request, so this is safe to ignore there; Server Actions and Route Handlers can write.
        }
      },
    },
  });
}
