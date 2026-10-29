import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { profiles } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-db";
import { DEFAULT_ALLOWED_DOMAINS } from "./auth-email";
import { memberForClaims } from "./auth-flow";
import { ensureProfile } from "./profiles";

const USER_ID = "30000000-0000-4000-8000-000000000001";
const EMAIL = "jane@my.maryvillecollege.edu";

describe("memberForClaims (session re-check on every request)", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await ensureProfile(db, { id: USER_ID, email: EMAIL }, 100);
  });
  afterAll(async () => {
    await close();
  });

  const member = (claims: { sub?: unknown; email?: unknown } | undefined) =>
    memberForClaims(db, claims, DEFAULT_ALLOWED_DOMAINS);

  it("returns the member when sub and a college email match the profile", async () => {
    expect(await member({ sub: USER_ID, email: EMAIL })).toMatchObject({
      id: USER_ID,
      email: EMAIL,
      points: 100,
    });
  });

  it("compares the email case-insensitively and ignoring surrounding spaces", async () => {
    expect(await member({ sub: USER_ID, email: " Jane@My.MaryvilleCollege.edu " })).not.toBeNull();
  });

  it("treats a session whose email moved to a non-college address as signed out", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await member({ sub: USER_ID, email: "jane@gmail.com" })).toBeNull();
    expect(
      await member({ sub: USER_ID, email: "x@evil.maryvillecollege.edu.attacker.com" }),
    ).toBeNull();
    // No address is ever logged.
    expect(JSON.stringify(spy.mock.calls)).not.toContain("gmail");
    spy.mockRestore();
  });

  it("treats a session whose email is another college address (differs from the profile) as signed out", async () => {
    expect(await member({ sub: USER_ID, email: "someone.else@maryvillecollege.edu" })).toBeNull();
  });

  it("treats a missing or non-string email claim as signed out", async () => {
    for (const email of [undefined, null, "", 42, ["jane@my.maryvillecollege.edu"]]) {
      expect(await member({ sub: USER_ID, email }), String(email)).toBeNull();
    }
  });

  it("returns null for a missing claims object, a missing or malformed sub, or an unknown user", async () => {
    expect(await member(undefined)).toBeNull();
    for (const sub of [undefined, 42, "", "not-a-uuid", `${USER_ID}; drop table profiles`]) {
      expect(await member({ sub, email: EMAIL }), String(sub)).toBeNull();
    }
    expect(await member({ sub: "30000000-0000-4000-8000-0000000000ff", email: EMAIL })).toBeNull();
  });

  it("returns null for a suspended member", async () => {
    await db.update(profiles).set({ suspendedAt: new Date() }).where(eq(profiles.id, USER_ID));
    expect(await member({ sub: USER_ID, email: EMAIL })).toBeNull();
    await db.update(profiles).set({ suspendedAt: null }).where(eq(profiles.id, USER_ID));
  });
});
