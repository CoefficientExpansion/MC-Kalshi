import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketStateDto } from "@/server/trade-types";

// Live market state for the order ticket (docs/specs/m3-trading.md, "Polling"): GET
// /api/markets/[id]/state every 3 s while the tab is visible, nothing while it is hidden. A 404,
// 503, network error or malformed body keeps the last good state; the next tick tries again.

export const MARKET_STATE_POLL_MS = 3000;

const STATUSES = new Set<string>([
  "proposed",
  "rejected",
  "open",
  "closed",
  "resolved",
  "finalized",
  "voided",
]);

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** The state body as a MarketStateDto with only known fields, or null when it is malformed. */
export function parseMarketState(body: unknown): MarketStateDto | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const r = body as Record<string, unknown>;
  if (typeof r.status !== "string" || !STATUSES.has(r.status) || typeof r.closeAt !== "string") {
    return null;
  }
  if (!finite(r.b) || !finite(r.qYes) || !finite(r.qNo) || !finite(r.probabilityYes)) return null;
  const state: MarketStateDto = {
    status: r.status as MarketStateDto["status"],
    closeAt: r.closeAt,
    b: r.b,
    qYes: r.qYes,
    qNo: r.qNo,
    probabilityYes: r.probabilityYes,
  };
  if (r.balance !== undefined && !finite(r.balance)) return null;
  let position: MarketStateDto["position"];
  if (r.position !== undefined) {
    const p = r.position as Record<string, unknown> | null;
    if (
      typeof p !== "object" ||
      p === null ||
      !finite(p.contractsYes) ||
      !finite(p.contractsNo) ||
      !finite(p.costBasisPoints)
    ) {
      return null;
    }
    position = {
      contractsYes: p.contractsYes,
      contractsNo: p.contractsNo,
      costBasisPoints: p.costBasisPoints,
    };
  }
  return {
    ...state,
    ...(finite(r.balance) ? { balance: r.balance } : {}),
    ...(position ? { position } : {}),
  };
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** One state request; null for any failure (never throws). */
export async function fetchMarketState(
  marketId: string,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<MarketStateDto | null> {
  try {
    const res = await fetchImpl(`/api/markets/${encodeURIComponent(marketId)}/state`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
    if (!res.ok) return null;
    return parseMarketState(await res.json());
  } catch {
    return null;
  }
}

export interface PollingDeps {
  readonly fetchState: (signal: AbortSignal) => Promise<MarketStateDto | null>;
  readonly onState: (state: MarketStateDto) => void;
  readonly isVisible: () => boolean;
  /** Calls `cb` on every visibility change; returns the unsubscribe function. */
  readonly subscribeVisibility: (cb: () => void) => () => void;
  readonly intervalMs?: number;
}

/**
 * Polls while visible: the first request one interval after start (the page rendered fresh
 * state), then one interval after each answer, so requests never overlap. Hidden stops the timer;
 * visible again refreshes at once. Returns `stop`, which also aborts a request in flight.
 */
export function startMarketStatePolling(deps: PollingDeps): () => void {
  const intervalMs = deps.intervalMs ?? MARKET_STATE_POLL_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | null = null;
  let stopped = false;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    clear();
    if (!stopped && deps.isVisible()) timer = setTimeout(tick, intervalMs);
  };
  async function tick() {
    timer = undefined;
    if (stopped || inFlight || !deps.isVisible()) return;
    const controller = new AbortController();
    inFlight = controller;
    try {
      const state = await deps.fetchState(controller.signal);
      if (!stopped && state) deps.onState(state);
    } catch {
      // Keep the last good state; the next tick tries again.
    } finally {
      inFlight = null;
    }
    schedule();
  }

  const unsubscribe = deps.subscribeVisibility(() => {
    clear();
    if (deps.isVisible()) void tick();
  });
  schedule();

  return () => {
    stopped = true;
    clear();
    inFlight?.abort();
    unsubscribe();
  };
}

export interface LiveMarketState {
  readonly state: MarketStateDto;
  /**
   * Merges fresh fields (for example from a trade result) at once. A poll that was already in
   * flight is dropped, so it cannot put the older state back.
   */
  readonly apply: (patch: Partial<MarketStateDto>) => void;
}

/** The latest MarketStateDto for `marketId`, starting from the server-rendered `initial`. */
export function useMarketState(
  marketId: string,
  initial: MarketStateDto,
  intervalMs: number = MARKET_STATE_POLL_MS,
): LiveMarketState {
  const [state, setState] = useState(initial);
  const version = useRef(0);

  useEffect(() => {
    return startMarketStatePolling({
      intervalMs,
      fetchState: async (signal) => {
        const startedAt = version.current;
        const fresh = await fetchMarketState(marketId, fetch, signal);
        return fresh && startedAt === version.current ? fresh : null;
      },
      onState: setState,
      isVisible: () => document.visibilityState === "visible",
      subscribeVisibility: (cb) => {
        document.addEventListener("visibilitychange", cb);
        return () => document.removeEventListener("visibilitychange", cb);
      },
    });
  }, [marketId, intervalMs]);

  const apply = useCallback((patch: Partial<MarketStateDto>) => {
    version.current += 1;
    setState((s) => ({ ...s, ...patch }));
  }, []);

  return { state, apply };
}
