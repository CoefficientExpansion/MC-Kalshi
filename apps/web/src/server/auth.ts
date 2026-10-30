import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type Db, getDb, getDbChecked } from "@/db";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "./auth-email";
import {
  type AuthDeps,
  type OtpClient,
  type SessionMember,
  sessionMemberForClaims,
  signOutOf,
} from "./auth-flow";
import type { PasswordAuthDeps, PasswordClient } from "./auth-password";
import { E2E_SESSION_COOKIE, isE2EAuthEnabled, readE2ESession } from "./e2e-auth";
import { getSignupBonusPoints, loadProfileMember, type Member } from "./profiles";
import { getEmailDomainPolicy, getSignInMode } from "./sign-in-mode";

export type { SessionMember } from "./auth-flow";

// Next.js-bound auth: the current member for a request, and the real wiring for `auth-flow.ts`.

/**
 * Adapt Supabase's client to the small interfaces the sign-in flows are written against: the code
 * flow (`auth-flow.ts`) and the open-mode password flow (`auth-password.ts`). Only `{status, code}`
 * of an error and `{id, email}` of a user cross over; never the provider's message text.
 */
export function adaptSupabaseAuth(supabase: SupabaseClient): OtpClient & PasswordClient {
  return {
    async signUp(args) {
      const { data, error } = await supabase.auth.signUp(args);
      return {
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
        hasSession: data.session !== null && data.session !== undefined,
        error: error ? { status: error.status, code: error.code } : null,
      };
    },
    async signInWithPassword(args) {
      const { data, error } = await supabase.auth.signInWithPassword(args);
      return {
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
        error: error ? { status: error.status, code: error.code } : null,
      };
    },
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

/**
 * Everything the sign-in flows need for this request; `client`/`db` are undefined when unset.
 * `open` is true only with `SIGN_IN_MODE=open` (ADR-0007), which also widens `domains` to any.
 */
export async function getAuthDeps(): Promise<
  AuthDeps<OtpClient & PasswordClient> & PasswordAuthDeps
> {
  const supabase = await createSupabaseServerClient();
  return {
    client: supabase ? adaptSupabaseAuth(supabase) : undefined,
    // A failed connection check reads as unconfigured; the sign-in flow then says so.
    db: await getDbChecked().catch(() => undefined),
    domains: getEmailDomainPolicy(),
    bonusPoints: getSignupBonusPoints(),
    open: getSignInMode() === "open",
  };
}

/**
 * True when sign-in can work here: the Supabase variables and a runtime database URL
 * (`DATABASE_URL`, else `POSTGRES_URL`) are all set, and the production guards have not refused it.
 */
export function isSignInConfigured(): boolean {
  return getSupabaseConfig() !== undefined && getDb() !== undefined;
}

/**
 * The verified session's member, suspended or not: `{ userId, profile, suspended }`, or `null`
 * when signed out, without a profile, unconfigured, if the lookup fails, or if the session's email
 * is no longer an allowed address or no longer the profile's (see `sessionMemberForClaims`).
 * The trade action uses it so a suspended member hears `account_suspended`, and the market page
 * passes `suspended` to the order ticket. Never throws. The session is verified with
 * `getClaims()` (signature checked), never read raw from the cookie. Cached per request. With
 * Supabase unset it does not touch cookies, so pages stay static. In CI only, when
 * `isE2EAuthEnabled()` is true, a valid signed `e2e-session` cookie is tried first.
 */
export const getSessionMember = cache(async (): Promise<SessionMember | null> => {
  try {
    const db = await getDbChecked();
    if (!db) {
      return null;
    }
    if (isE2EAuthEnabled()) {
      const e2e = await e2eSessionMember(db);
      if (e2e) {
        return e2e;
      }
    }
    if (!getSupabaseConfig()) {
      return null;
    }
    const supabase = await createSupabaseServerClient();
    const { data } = (await supabase?.auth.getClaims()) ?? {};
    return await sessionMemberForClaims(db, data?.claims, getEmailDomainPolicy());
  } catch (e) {
    console.error(`[auth] current user lookup failed: ${e instanceof Error ? e.name : "unknown"}`);
    return null;
  }
});

/**
 * CI only (`e2e-auth.ts`): the member named by a valid `e2e-session` cookie, or `null`. Called only
 * when `isE2EAuthEnabled()` is true; `readE2ESession` checks the guard again, the HMAC and the
 * expiry. The profile's email must still be an allowed address, as for a real session.
 */
async function e2eSessionMember(db: Db) {
  const store = await cookies();
  const userId = readE2ESession(store.get(E2E_SESSION_COOKIE)?.value);
  if (!userId) {
    return null;
  }
  const found = await loadProfileMember(db, userId);
  if (!found || !isAllowedEmail(found.member.email, getEmailDomainPolicy())) {
    return null;
  }
  return { userId: found.member.id, profile: found.member, suspended: found.suspended };
}

/**
 * The signed-in member (profile plus points balance) for this request: `null` whenever
 * {@link getSessionMember} is, and also for a suspended member. Never throws: the header calls it
 * on every page. Cached per request.
 */
export const getCurrentUser = cache(async (): Promise<Member | null> => {
  const session = await getSessionMember();
  return session && !session.suspended ? session.profile : null;
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
