import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAllowedDomains } from "./auth-email";
import { type AuthDeps, type OtpClient, signOutOf } from "./auth-flow";
import { getSignupBonusPoints, loadMember, type Member } from "./profiles";

// Next.js-bound auth: the current member for a request, and the real wiring for `auth-flow.ts`.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Adapt Supabase's client to the small interface the sign-in flow is written against. */
function adaptSupabaseAuth(supabase: SupabaseClient): OtpClient {
  return {
    async signInWithOtp(args) {
      const { error } = await supabase.auth.signInWithOtp(args);
      return { error: error ? { status: error.status, code: error.code } : null };
    },
    async verifyOtp(args) {
      const { data, error } = await supabase.auth.verifyOtp(args);
      return {
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
        error: error ? { status: error.status, code: error.code } : null,
      };
    },
    async signOut(scope) {
      const { error } = await supabase.auth.signOut({ scope: scope ?? "local" });
      return { error: error ? { status: error.status, code: error.code } : null };
    },
  };
}

/** Everything the sign-in flow needs for this request; `client`/`db` are undefined when unset. */
export async function getAuthDeps(): Promise<AuthDeps> {
  const supabase = await createSupabaseServerClient();
  return {
    client: supabase ? adaptSupabaseAuth(supabase) : undefined,
    db: getDb(),
    domains: getAllowedDomains(),
    bonusPoints: getSignupBonusPoints(),
  };
}

/** True when sign-in can work here: Supabase variables and `DATABASE_URL` are all set. */
export function isSignInConfigured(): boolean {
  return getSupabaseConfig() !== undefined && getDb() !== undefined;
}

/**
 * The signed-in member (profile plus points balance) for this request, or `null` when signed out,
 * suspended, unconfigured, or if the lookup fails. Never throws: the header calls it on every page.
 * The session is verified with `getClaims()` (signature checked), never read raw from the cookie.
 * Cached per request. With Supabase unset it does not touch cookies, so pages stay static.
 */
export const getCurrentUser = cache(async (): Promise<Member | null> => {
  const db = getDb();
  if (!db || !getSupabaseConfig()) {
    return null;
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = (await supabase?.auth.getClaims()) ?? {};
    const sub = data?.claims.sub;
    if (typeof sub !== "string" || !UUID.test(sub)) {
      return null;
    }
    return await loadMember(db, sub);
  } catch (e) {
    console.error(`[auth] current user lookup failed: ${e instanceof Error ? e.name : "unknown"}`);
    return null;
  }
});

/** For pages and actions that need a member: sends everyone else to the sign-in page. */
export async function requireUser(): Promise<Member> {
  const member = await getCurrentUser();
  if (!member) {
    redirect("/sign-in");
  }
  return member;
}

/** End this session. Safe to call when signed out or unconfigured. */
export async function signOutCurrent(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await signOutOf(supabase ? adaptSupabaseAuth(supabase) : undefined);
}
