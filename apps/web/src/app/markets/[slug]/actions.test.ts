import { beforeEach, describe, expect, it, vi } from "vitest";
import { placeTradeAction } from "./actions";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  session: null as { userId: string; suspended: boolean } | null,
  placeTrade: vi.fn(),
}));
// An Error stands for a failed connection check (getDbChecked throws).
vi.mock("@/db", () => ({
  getDbChecked: async () => {
    if (mocks.db instanceof Error) throw mocks.db;
    return mocks.db;
  },
}));
vi.mock("@/server/auth", () => ({ getSessionMember: async () => mocks.session }));
vi.mock("@/server/trading", () => ({ placeTrade: mocks.placeTrade }));

const USER = { id: "00000000-0000-4000-8000-000000000001" };
const SESSION = { userId: USER.id, suspended: false };
const INPUT = { marketId: "3f2b8c1e-9d4a-4b6e-8f10-2a3b4c5d6e7f", amount: 500 };

beforeEach(() => {
  mocks.db = { fake: true };
  mocks.session = SESSION;
  mocks.placeTrade.mockReset();
});

describe("placeTradeAction", () => {
  it("returns unauthenticated for a signed-out session without touching the database", async () => {
    mocks.session = null;
    expect(await placeTradeAction(INPUT)).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(mocks.placeTrade).not.toHaveBeenCalled();
  });

  it("lets placeTrade answer account_suspended for a suspended member (not unauthenticated)", async () => {
    mocks.session = { ...SESSION, suspended: true };
    const outcome = { ok: false, code: "account_suspended", message: "suspended" };
    mocks.placeTrade.mockResolvedValue(outcome);
    expect(await placeTradeAction(INPUT)).toBe(outcome);
    expect(mocks.placeTrade).toHaveBeenCalledWith(mocks.db, USER.id, INPUT);
  });

  it("returns a generic internal_error when the database is not configured", async () => {
    mocks.db = undefined;
    const result = await placeTradeAction(INPUT);
    expect(result).toEqual({
      ok: false,
      code: "internal_error",
      message: expect.not.stringMatching(/DATABASE_URL/),
    });
    expect(mocks.placeTrade).not.toHaveBeenCalled();
  });

  it("returns a generic internal_error when the connection check fails", async () => {
    mocks.db = new Error("connect timeout postgres://secret@host");
    const result = await placeTradeAction(INPUT);
    expect(result).toEqual({
      ok: false,
      code: "internal_error",
      message: expect.not.stringMatching(/secret/),
    });
    expect(mocks.placeTrade).not.toHaveBeenCalled();
  });

  it("calls placeTrade with the session's user and returns its result", async () => {
    const outcome = { ok: false, code: "market_closed", message: "closed" };
    mocks.placeTrade.mockResolvedValue(outcome);
    expect(await placeTradeAction(INPUT)).toBe(outcome);
    expect(mocks.placeTrade).toHaveBeenCalledWith(mocks.db, USER.id, INPUT);
  });

  it("never takes the user id from the input", async () => {
    mocks.placeTrade.mockResolvedValue({ ok: false, code: "invalid_input", message: "x" });
    await placeTradeAction({ ...INPUT, userId: "00000000-0000-4000-8000-000000000999" });
    expect(mocks.placeTrade.mock.calls[0]?.[1]).toBe(USER.id);
  });
});
