import { eq } from "drizzle-orm";
import { balances, type Profile, profiles } from "@/db/schema";
import type { AnyDb } from "@/db/types";
import { normalizeEmail } from "./auth-email";
import { grantSignupBonus } from "./ledger";

// Profiles are created on first sign-in (architecture §6). The signup bonus is a ledger entry,
// so everything that credits points goes through `grantSignupBonus`/`postTransfer` (hard constraint 3).

export const DEFAULT_SIGNUP_BONUS_POINTS = 10_000;
const MAX_DISPLAY_NAME_LENGTH = 40;

/** A positive whole number of points, else the default. */
export function parseSignupBonus(raw: string | undefined): number {
  const text = raw?.trim() ?? "";
  if (!/^\d+$/.test(text)) {
    return DEFAULT_SIGNUP_BONUS_POINTS;
  }
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_SIGNUP_BONUS_POINTS;
}

/** `SIGNUP_BONUS_POINTS` from the environment (until a `settings` table exists, SOP-07). */
export function getSignupBonusPoints(
  env: Record<string, string | undefined> = process.env,
): number {
  return parseSignupBonus(env.SIGNUP_BONUS_POINTS);
}

/**
 * First display name for a new member: the email local part without any `+tag`, at most 40
 * characters. It shows on the leaderboard (SOP-09), so members can rename themselves (M5).
 */
export function defaultDisplayName(email: string): string {
  const local = normalizeEmail(email).split("@")[0] ?? "";
  const untagged = local.split("+")[0] ?? "";
  return (untagged === "" ? local : untagged).slice(0, MAX_DISPLAY_NAME_LENGTH);
}

/** The profile could not be created for a reason a person must resolve. */
export class ProfileError extends Error {
  override readonly name = "ProfileError";
  constructor(
    readonly code: "email_taken",
    message: string,
  ) {
    super(message);
  }
}

export interface EnsuredProfile {
  readonly profile: Profile;
  /** `true` when this call inserted the row. */
  readonly created: boolean;
  /** `true` when this call credited the signup bonus. */
  readonly bonusGranted: boolean;
}

/**
 * Create the member's profile on first sign-in and credit the signup bonus, in one transaction:
 * a failure leaves neither. Idempotent: a repeat sign-in changes nothing (the bonus is granted
 * once per user). An existing row is returned untouched, so an edited display name or a role
 * survives. A suspended profile gets no grant. Throws `ProfileError("email_taken")` when another
 * user id already owns the address.
 */
export async function ensureProfile(
  db: AnyDb,
  user: { readonly id: string; readonly email: string },
  bonusPoints: number,
): Promise<EnsuredProfile> {
  const email = normalizeEmail(user.email);
  return db.transaction(async (tx) => {
    // No conflict target: skips a repeat id and an address already owned by someone else; the
    // select below tells the two apart.
    const inserted = await tx
      .insert(profiles)
      .values({ id: user.id, email, displayName: defaultDisplayName(email) })
      .onConflictDoNothing()
      .returning({ id: profiles.id });

    const [profile] = await tx.select().from(profiles).where(eq(profiles.id, user.id));
    if (!profile) {
      throw new ProfileError("email_taken", "that email already belongs to another account");
    }
    const bonusGranted = profile.suspendedAt
      ? false
      : await grantSignupBonus(tx, user.id, bonusPoints);
    return { profile, created: inserted.length > 0, bonusGranted };
  });
}

/** What the header and account pages need about the signed-in person. */
export interface Member {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Profile["role"];
  readonly points: number;
}

/** Profile plus balance, or `null` for an unknown or suspended user. */
export async function loadMember(db: AnyDb, id: string): Promise<Member | null> {
  const [row] = await db
    .select({ profile: profiles, points: balances.points })
    .from(profiles)
    .leftJoin(balances, eq(balances.userId, profiles.id))
    .where(eq(profiles.id, id));
  if (!row || row.profile.suspendedAt) {
    return null;
  }
  const { profile } = row;
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName,
    role: profile.role,
    points: row.points ?? 0,
  };
}
