import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketStateDto } from "@/server/trade-types";
import { dynamic, GET } from "./route";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  session: null as { userId: string; suspended: boolean } | null,
  state: null as unknown,
  load: vi.fn(),
}));
// An Error stands for a failed connection check (getDbChecked throws).
vi.mock("@/db", () => ({
  getDbChecked: async () => {
    if (mocks.db instanceof Error) throw mocks.db;
    return mocks.db;
  },
}));
vi.mock("@/server/auth", () => ({
  getSessionMember: async () => mocks.session,
  getCurrentUser: async () => {
    throw new Error("the state route must use getSessionMember");
  },
}));
vi.mock("@/server/market-state", () => ({ loadMarketState: mocks.load }));

const ID = "3f2b8c1e-9d4a-4b6e-8f10-2a3b4c5d6e7f";
const STATE: MarketStateDto = {
  status: "open",
  closeAt: "2030-01-01T12:00:00.000Z",
  b: 100,
  qYes: 0,
  qNo: 0,
  probabilityYes: 0.5,
  displayPrice: 50,
};

const call = (id = ID) =>
  GET(new Request(`http://localhost/api/markets/${id}/state`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  mocks.db = { fake: true };
  mocks.session = null;
  mocks.load.mockReset();
  mocks.load.mockResolvedValue(STATE);
});

describe("GET /api/markets/[id]/state", () => {
  it("is dynamic", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns the public state with no-store for a signed-out visitor", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(STATE);
    expect(mocks.load).toHaveBeenCalledWith(mocks.db, ID, null);
  });

  it("passes the signed-in member's id", async () => {
    mocks.session = { userId: "00000000-0000-4000-8000-000000000001", suspended: false };
    mocks.load.mockResolvedValue({ ...STATE, balance: 10, position: undefined });
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith(mocks.db, ID, mocks.session.userId);
  });

  it("still gives a suspended member their balance and position", async () => {
    mocks.session = { userId: "00000000-0000-4000-8000-000000000002", suspended: true };
    const position = { contractsYes: 1, contractsNo: 0, costBasisPoints: 50 };
    mocks.load.mockResolvedValue({ ...STATE, balance: 10, position });
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith(mocks.db, ID, mocks.session.userId);
    expect(await res.json()).toMatchObject({ balance: 10, position });
  });

  it("is 404 for an unknown or hidden market", async () => {
    mocks.load.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ code: "not_found" });
  });

  it("is 503 when there is no database", async () => {
    mocks.db = undefined;
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "unconfigured" });
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("is a generic 500 when the connection check fails", async () => {
    mocks.db = new Error("connect timeout postgres://secret@host");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal_error" });
    expect(log.mock.calls.flat().join(" ")).not.toContain("secret");
    expect(mocks.load).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("is a generic 500 when the lookup fails", async () => {
    mocks.load.mockRejectedValue(new Error("connect ECONNREFUSED postgres://secret@host"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toMatch(/secret|ECONNREFUSED/);
    expect(String(log.mock.calls[0]?.[0])).not.toMatch(/secret/);
    log.mockRestore();
  });
});
