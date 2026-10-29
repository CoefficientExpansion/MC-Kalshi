import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balances, ledgerEntries, profiles } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-db";
import { checkLedgerInvariants, LedgerError } from "./ledger";
import {
  DEFAULT_SIGNUP_BONUS_POINTS,
  defaultDisplayName,
  ensureProfile,
  getSignupBonusPoints,
  loadMember,
  ProfileError,
  parseSignupBonus,
} from "./profiles";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("signup bonus setting", () => {
  it("defaults to 10000 when unset, blank or invalid", () => {
    expect(DEFAULT_SIGNUP_BONUS_POINTS).toBe(10_000);
    for (const raw of [
      undefined,
      "",
      "  ",
      "abc",
      "0",
      "-5",
      "1.5",
      "1e3",
      "NaN",
      "9007199254740993",
    ]) {
      expect(parseSignupBonus(raw), String(raw)).toBe(10_000);
    }
  });

  it("reads a positive whole number from SIGNUP_BONUS_POINTS", () => {
    expect(parseSignupBonus("2500")).toBe(2500);
    expect(parseSignupBonus(" 500 ")).toBe(500);
    expect(getSignupBonusPoints({ SIGNUP_BONUS_POINTS: "42" })).toBe(42);
    expect(getSignupBonusPoints({})).toBe(10_000);
  });
});

describe("defaultDisplayName", () => {
  it("is the email local part, without a +tag", () => {
    expect(defaultDisplayName("jane.doe@my.maryvillecollege.edu")).toBe("jane.doe");
    expect(defaultDisplayName("Jane+kalshi@maryvillecollege.edu")).toBe("jane");
    expect(defaultDisplayName("+x@maryvillecollege.edu")).toBe("+x");
  });

  it("is capped at 40 characters", () => {
    expect(defaultDisplayName(`${"a".repeat(60)}@maryvillecollege.edu`)).toHaveLength(40);
  });
});

describe("ensureProfile", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });

  const points = async (userId: string) =>
    (await db.select().from(balances).where(eq(balances.userId, userId)))[0]?.points;
  const bonusRows = async (userId: string) =>
    (await db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, userId))).filter(
      (r) => r.reason === "signup_bonus",
    );

  it("creates the profile and credits the bonus on first sign-in", async () => {
    const result = await ensureProfile(
      db,
      { id: id(1), email: "  Jane.Doe@My.MaryvilleCollege.edu " },
      10_000,
    );
    expect(result.created).toBe(true);
    expect(result.bonusGranted).toBe(true);
    expect(result.profile).toMatchObject({
      id: id(1),
      email: "jane.doe@my.maryvillecollege.edu",
      displayName: "jane.doe",
      role: "member",
      suspendedAt: null,
      leaderboardOptOut: false,
    });
    expect(await points(id(1))).toBe(10_000);
    expect(await bonusRows(id(1))).toHaveLength(1);
  });

  it("changes nothing on a repeat sign-in", async () => {
    await ensureProfile(db, { id: id(2), email: "b@maryvillecollege.edu" }, 10_000);
    const again = await ensureProfile(db, { id: id(2), email: "b@maryvillecollege.edu" }, 10_000);
    expect(again.created).toBe(false);
    expect(again.bonusGranted).toBe(false);
    expect(await points(id(2))).toBe(10_000);
    expect(await bonusRows(id(2))).toHaveLength(1);
    expect(
      await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, id(2))),
    ).toHaveLength(1);
  });

  it("does not overwrite an edited display name or role on a repeat sign-in", async () => {
    await ensureProfile(db, { id: id(3), email: "c@maryvillecollege.edu" }, 100);
    await db
      .update(profiles)
      .set({ displayName: "Cee", role: "moderator" })
      .where(eq(profiles.id, id(3)));
    const again = await ensureProfile(db, { id: id(3), email: "c@maryvillecollege.edu" }, 100);
    expect(again.profile).toMatchObject({ displayName: "Cee", role: "moderator" });
  });

  it("keeps the ledger consistent (sum zero, cache equals ledger)", async () => {
    await ensureProfile(db, { id: id(4), email: "d@maryvillecollege.edu" }, 777);
    await ensureProfile(db, { id: id(4), email: "d@maryvillecollege.edu" }, 777);
    expect(await checkLedgerInvariants(db)).toEqual({ ledgerSum: 0, mismatches: [] });
  });

  it("is atomic: if the bonus fails, no profile is left behind", async () => {
    await expect(
      ensureProfile(db, { id: id(5), email: "e@maryvillecollege.edu" }, 0),
    ).rejects.toBeInstanceOf(LedgerError);
    expect(
      await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, id(5))),
    ).toEqual([]);
    expect(await points(id(5))).toBeUndefined();
  });

  it("refuses a different user id for an email that already has a profile", async () => {
    await ensureProfile(db, { id: id(6), email: "f@maryvillecollege.edu" }, 100);
    const attempt = ensureProfile(db, { id: id(7), email: "F@maryvillecollege.edu" }, 100);
    await expect(attempt).rejects.toBeInstanceOf(ProfileError);
    await expect(attempt).rejects.toMatchObject({ code: "email_taken" });
    expect(
      await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, id(7))),
    ).toEqual([]);
    expect(await points(id(7))).toBeUndefined();
  });

  it("returns a suspended profile as it is and grants nothing", async () => {
    await ensureProfile(db, { id: id(8), email: "g@maryvillecollege.edu" }, 100);
    await db
      .update(profiles)
      .set({ suspendedAt: new Date() })
      .where(eq(profiles.id, id(8)));
    const again = await ensureProfile(db, { id: id(8), email: "g@maryvillecollege.edu" }, 100);
    expect(again.profile.suspendedAt).toBeInstanceOf(Date);
    expect(again.bonusGranted).toBe(false);
    expect(await bonusRows(id(8))).toHaveLength(1);
  });

  it("works inside a caller's transaction", async () => {
    await db.transaction(async (tx) => {
      const r = await ensureProfile(tx, { id: id(9), email: "h@maryvillecollege.edu" }, 50);
      expect(r.bonusGranted).toBe(true);
    });
    expect(await points(id(9))).toBe(50);
  });
});

describe("loadMember", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });

  it("returns the profile with its balance", async () => {
    await ensureProfile(db, { id: id(1), email: "a@my.maryvillecollege.edu" }, 1234);
    expect(await loadMember(db, id(1))).toEqual({
      id: id(1),
      email: "a@my.maryvillecollege.edu",
      displayName: "a",
      role: "member",
      points: 1234,
    });
  });

  it("returns null for an unknown user", async () => {
    expect(await loadMember(db, id(99))).toBeNull();
  });

  it("returns null for a suspended user", async () => {
    await ensureProfile(db, { id: id(2), email: "b@my.maryvillecollege.edu" }, 10);
    await db
      .update(profiles)
      .set({ suspendedAt: new Date() })
      .where(eq(profiles.id, id(2)));
    expect(await loadMember(db, id(2))).toBeNull();
  });

  it("reports 0 points for a profile with no balance row", async () => {
    await db
      .insert(profiles)
      .values({ id: id(3), email: "c@my.maryvillecollege.edu", displayName: "c" });
    expect((await loadMember(db, id(3)))?.points).toBe(0);
  });
});
