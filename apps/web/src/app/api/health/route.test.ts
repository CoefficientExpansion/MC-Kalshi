import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// The health route reports what the app would do: a connection the production role guard refuses
// (ADR-0006) is a database error, not "ok".
const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  check: "pass" as "pass" | "refused",
  ping: vi.fn(async () => {}),
}));
vi.mock("@/db", () => ({
  getDb: () => mocks.db,
  getDbChecked: async () => (mocks.check === "refused" ? undefined : mocks.db),
  pingDatabase: mocks.ping,
}));

beforeEach(() => {
  mocks.db = { fake: true };
  mocks.check = "pass";
  mocks.ping.mockClear();
});

describe("GET /api/health", () => {
  it("is unconfigured without a database", async () => {
    mocks.db = undefined;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: "unconfigured" });
  });

  it("is ok when the database answers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: "ok" });
    expect(mocks.ping).toHaveBeenCalledWith(mocks.db);
  });

  it("is a 503 database error when the role guard refuses the connection", async () => {
    mocks.check = "refused";
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, db: "error" });
    expect(mocks.ping).not.toHaveBeenCalled();
  });
});
