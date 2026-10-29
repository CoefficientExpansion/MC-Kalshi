import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseConfig } from "./config";

/**
 * Refresh the Supabase session cookie on the way in (Server Components cannot write cookies), as
 * the Supabase Next.js guide prescribes: `getClaims()` verifies the token and refreshes it when
 * expired; the refreshed cookies go to the request (so this render sees them) and to the response
 * (so the browser keeps them). Does no gating: pages decide what a signed-out visitor sees.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const config = getSupabaseConfig();
  // Nothing to refresh without Supabase, or for a visitor who has never signed in.
  if (!config || !request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) {
    return response;
  }

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Cache headers keep a CDN from serving one member's session cookie to another.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Do not put code between createServerClient and getClaims (Supabase guide): it refreshes here.
  await supabase.auth.getClaims();
  return response;
}
