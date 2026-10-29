import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getDbChecked } from "@/db";
import { getAllowedDomains, isAllowedEmail, normalizeEmail } from "@/server/auth-email";
import {
  E2E_SESSION_COOKIE,
  E2E_SESSION_MAX_AGE_SEC,
  isE2EAuthEnabled,
  signE2ESession,
} from "@/server/e2e-auth";
import { ensureProfile, getSignupBonusPoints, ProfileError } from "@/server/profiles";

// CI-only sign-in for the Playwright suite (docs/specs/m3-trading.md, "Playwright e2e", the
// fallback). A bare 404 unless isE2EAuthEnabled() (never on Vercel). Otherwise an allowed college
// email gets its profile and signup bonus through ensureProfile (the normal first sign-in code)
// and a signed, short-lived `e2e-session` cookie that getSessionMember accepts.
export const dynamic = "force-dynamic";

/** A stable uuid per address, so signing in again is the same member. */
function userIdFor(email: string): string {
  const h = createHash("sha256").update(`mc-kalshi-e2e:${email}`, "utf8").digest("hex");
  const variant = ((Number.parseInt(h[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const refuse = (status: number, code: string) => NextResponse.json({ ok: false, code }, { status });

export async function POST(request: Request): Promise<Response> {
  if (!isE2EAuthEnabled()) {
    return new Response(null, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "invalid_body");
  }
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as { email?: unknown }).email
      : undefined;
  if (typeof raw !== "string" || !isAllowedEmail(raw, getAllowedDomains())) {
    return refuse(400, "not_allowed");
  }
  const db = await getDbChecked().catch(() => undefined);
  if (!db) {
    return refuse(503, "unconfigured");
  }
  const email = normalizeEmail(raw);
  const userId = userIdFor(email);
  try {
    await ensureProfile(db, { id: userId, email }, getSignupBonusPoints());
  } catch (error) {
    if (error instanceof ProfileError) {
      return refuse(409, error.code);
    }
    console.error(`[e2e] session failed: ${error instanceof Error ? error.name : "unknown"}`);
    return refuse(500, "internal_error");
  }

  const secret = process.env.E2E_AUTH_SECRET as string;
  const value = signE2ESession(userId, Date.now() + E2E_SESSION_MAX_AGE_SEC * 1000, secret);
  const response = NextResponse.json({ ok: true, userId });
  response.cookies.set(E2E_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: E2E_SESSION_MAX_AGE_SEC,
    secure: new URL(request.url).protocol === "https:",
  });
  return response;
}
