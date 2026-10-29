import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketStateDto } from "@/server/trade-types";
import {
  fetchMarketState,
  MARKET_STATE_POLL_MS,
  parseMarketState,
  startMarketStatePolling,
} from "./use-market-state";

const STATE: MarketStateDto = {
  status: "open",
  closeAt: "2026-11-12T04:59:00.000Z",
  b: 100,
  qYes: 9.761859,
  qNo: 0,
  probabilityYes: 0.524,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("parseMarketState", () => {
  it("accepts the public shape and the signed-in extras", () => {
    expect(parseMarketState(STATE)).toEqual(STATE);
    const signedIn = {
      ...STATE,
      balance: 9500,
      position: { contractsYes: 9.761859, contractsNo: 0, costBasisPoints: 500 },
    };
    expect(parseMarketState(signedIn)).toEqual(signedIn);
  });

  it("drops unknown fields", () => {
    expect(parseMarketState({ ...STATE, email: "x@maryvillecollege.edu" })).toEqual(STATE);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["an array", []],
    ["a missing q", { ...STATE, qYes: undefined }],
    ["a string b", { ...STATE, b: "100" }],
    ["a NaN probability", { ...STATE, probabilityYes: Number.NaN }],
    ["a bad position", { ...STATE, position: { contractsYes: 1 } }],
    ["a bad balance", { ...STATE, balance: "9500" }],
    ["no status", { ...STATE, status: 3 }],
  ])("rejects %s", (_, body) => {
    expect(parseMarketState(body)).toBeNull();
  });
});

describe("fetchMarketState", () => {
  it("asks for no-store and parses the body", async () => {
    const fetchImpl = vi.fn(async () => json(STATE));
    expect(await fetchMarketState("abc-123", fetchImpl)).toEqual(STATE);
    expect(fetchImpl).toHaveBeenCalledWith("/api/markets/abc-123/state", {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: undefined,
    });
  });

  it.each([404, 503, 500])("returns null for HTTP %i", async (status) => {
    expect(await fetchMarketState("m", async () => json({ error: "x" }, status))).toBeNull();
  });

  it("returns null for a network error or a non-JSON body", async () => {
    expect(
      await fetchMarketState("m", async () => {
        throw new TypeError("offline");
      }),
    ).toBeNull();
    expect(
      await fetchMarketState("m", async () => new Response("<html>", { status: 200 })),
    ).toBeNull();
  });

  it("encodes the id into the path", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => json(STATE));
    await fetchMarketState("a/b", fetchImpl);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/markets/a%2Fb/state");
  });
});

describe("startMarketStatePolling", () => {
  let visible: boolean;
  let listeners: (() => void)[];
  const setVisible = (v: boolean) => {
    visible = v;
    for (const l of listeners) l();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    visible = true;
    listeners = [];
  });
  afterEach(() => vi.useRealTimers());

  function start(fetchState: () => Promise<MarketStateDto | null> = vi.fn(async () => STATE)) {
    const onState = vi.fn();
    const stop = startMarketStatePolling({
      fetchState,
      onState,
      isVisible: () => visible,
      subscribeVisibility: (cb) => {
        listeners.push(cb);
        return () => {
          listeners = listeners.filter((l) => l !== cb);
        };
      },
    });
    return { fetchState, onState, stop };
  }

  it("polls every 3 s while visible", async () => {
    expect(MARKET_STATE_POLL_MS).toBe(3000);
    const { fetchState, onState } = start();
    expect(fetchState).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchState).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenCalledWith(STATE);
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchState).toHaveBeenCalledTimes(3);
  });

  it("stops while hidden and refreshes at once when visible again", async () => {
    const { fetchState } = start();
    setVisible(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchState).not.toHaveBeenCalled();
    setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchState).toHaveBeenCalledTimes(2);
  });

  it("keeps the last state and keeps polling through failures", async () => {
    const fetchState = vi
      .fn<() => Promise<MarketStateDto | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(STATE);
    const { onState } = start(fetchState);
    await vi.advanceTimersByTimeAsync(6000);
    expect(onState).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(onState).toHaveBeenCalledTimes(1);
  });

  it("never overlaps requests, and stops for good when stopped", async () => {
    let resolve: (s: MarketStateDto) => void = () => {};
    const fetchState = vi.fn(
      () =>
        new Promise<MarketStateDto>((r) => {
          resolve = r;
        }),
    );
    const { onState, stop } = start(fetchState);
    await vi.advanceTimersByTimeAsync(3000);
    setVisible(false);
    setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchState).toHaveBeenCalledTimes(1);
    stop();
    resolve(STATE);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onState).not.toHaveBeenCalled();
    expect(fetchState).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
