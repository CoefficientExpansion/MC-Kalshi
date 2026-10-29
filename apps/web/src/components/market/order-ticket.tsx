"use client";

import { displayPrice, EMPTY_POSITION, type Position, type Side } from "@mc-kalshi/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pointsLabel } from "@/lib/market-format";
import {
  buildTradeInput,
  type KeyedOrder,
  keyFor,
  orderFromQuote,
  orderFromRequote,
  outcomeOf,
  type TicketLock,
  type TicketOrder,
} from "@/lib/ticket-order";
import {
  buildTicketQuote,
  maxAmountText,
  type TicketState,
  type TicketTab,
  type TicketUnit,
} from "@/lib/ticket-quote";
import { requoteRows, submitLabel, TICKET_COPY } from "@/lib/trade-copy";
import { useMarketState } from "@/lib/use-market-state";
import type {
  MarketStateDto,
  Requote,
  TradeInput,
  TradeResult,
  TradeSuccess,
} from "@/server/trade-types";
import {
  OrderTicketView,
  type TicketGate,
  type TicketStatus,
  type Tolerance,
} from "./order-ticket-view";

// The order ticket (docs/specs/m3-trading.md, "Order ticket (UI)"): a card from 1024 px, and
// below that YES/NO buttons that open the same ticket as a bottom sheet (a modal <dialog>: the
// page behind is inert, so focus stays inside, and Escape closes it). The quote is recomputed
// from whatever market state the parent passes, so a fresh poll updates the numbers on screen.

/** The signed-in member's balance and position in this market; null when signed out. */
export interface TicketAccount {
  readonly balance: number;
  readonly position: Position;
}

export interface OrderTicketProps {
  readonly marketId: string;
  readonly market: MarketStateDto;
  readonly account: TicketAccount | null;
  /** The member is suspended (the page knows this from the profile). */
  readonly suspended?: boolean;
  /** placeTradeAction, passed in by the page. */
  readonly submit: (input: TradeInput) => Promise<TradeResult>;
  readonly onTraded?: (result: TradeSuccess) => void;
  readonly signInHref?: string;
  /** Server time at render (ms), so the first client render agrees on whether trading closed. */
  readonly now?: number;
  /** For tests: the initial amount, tab and side. */
  readonly initial?: {
    readonly amountText?: string;
    readonly tab?: TicketTab;
    readonly side?: Side;
  };
}

const DEBOUNCE_MS = 150;
const DESKTOP_QUERY = "(min-width: 1024px)";

function useDebounced<T>(value: T, ms: number): [T, (v: T) => void] {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return [debounced, setDebounced];
}

interface ActiveRequote {
  readonly order: TicketOrder;
  readonly requote: Requote;
}

export function OrderTicket(props: OrderTicketProps) {
  const { market, account, marketId, submit, onTraded } = props;
  const [tab, setTab] = useState<TicketTab>(props.initial?.tab ?? "buy");
  const [side, setSide] = useState<Side>(props.initial?.side ?? "YES");
  const [unit, setUnit] = useState<TicketUnit>("points");
  const [amountText, setAmountText] = useState(props.initial?.amountText ?? "");
  const [quotedText, flushQuotedText] = useDebounced(amountText, DEBOUNCE_MS);
  const [tolerance, setTolerance] = useState<Tolerance>(2);
  const [status, setStatus] = useState<TicketStatus>({ kind: "idle" });
  const [requote, setRequote] = useState<ActiveRequote | null>(null);
  const [lock, setLock] = useState<TicketLock | null>(null);
  const [retryOrder, setRetryOrder] = useState<TicketOrder | null>(null);
  const [nowMs, setNowMs] = useState(() => props.now ?? Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);
  const keyRef = useRef<KeyedOrder | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const signedIn = account !== null && lock !== "signed_out";
  const state: TicketState = useMemo(
    () => ({
      b: market.b,
      qYes: market.qYes,
      qNo: market.qNo,
      balance: signedIn ? (market.balance ?? account?.balance ?? null) : null,
      position: signedIn ? (market.position ?? account?.position ?? EMPTY_POSITION) : null,
    }),
    [market, account, signedIn],
  );

  const result = useMemo(
    () => buildTicketQuote(state, tab, side, unit, quotedText),
    [state, tab, side, unit, quotedText],
  );

  const closed =
    lock === "closed" || market.status !== "open" || Date.parse(market.closeAt) <= nowMs;
  const gate: TicketGate = closed
    ? "closed"
    : props.suspended || lock === "suspended"
      ? "suspended"
      : signedIn
        ? "open"
        : "signed_out";

  const yesPrice = displayPrice(market.probabilityYes);
  const held = state.position
    ? side === "YES"
      ? state.position.contractsYes
      : state.position.contractsNo
    : null;
  const maxText = maxAmountText(state, tab, side, unit);

  /** Any edit drops the requote and the last message; the key follows from the new order. */
  const edited = useCallback(() => {
    setRequote(null);
    setRetryOrder(null);
    setStatus((s) => (s.kind === "pending" ? s : { kind: "idle" }));
  }, []);

  const onSubmit = useCallback(async () => {
    if (pendingRef.current || gate !== "open") return;
    let order: TicketOrder;
    if (requote) {
      order = orderFromRequote(requote.order, requote.requote);
    } else if (retryOrder) {
      // After a network error, resend the very same order (same key), even if a poll moved the
      // price meanwhile: the first attempt may have landed, and a new key could trade twice.
      order = retryOrder;
    } else {
      // Quote what is in the box now, so a click inside the debounce window sends what it shows.
      flushQuotedText(amountText);
      const fresh = buildTicketQuote(state, tab, side, unit, amountText);
      if (!fresh.ok) return;
      order = orderFromQuote(fresh.quote, tolerance);
    }
    const keyed = keyFor(keyRef.current, marketId, order, () => crypto.randomUUID());
    keyRef.current = keyed;
    pendingRef.current = true;
    setStatus({ kind: "pending" });
    let answer: TradeResult;
    try {
      answer = await submit(buildTradeInput(marketId, order, keyed.key));
    } catch {
      // Network error or timeout: keep the key, so retrying the same order cannot trade twice.
      pendingRef.current = false;
      setRetryOrder(order);
      setStatus({ kind: "error", message: TICKET_COPY.networkError });
      return;
    }
    pendingRef.current = false;
    setRetryOrder(null);
    const outcome = outcomeOf(answer, order);
    if (outcome.kind === "success") {
      keyRef.current = null;
      setRequote(null);
      setAmountText("");
      flushQuotedText("");
      setStatus({ kind: "success", message: outcome.message });
      if (answer.ok) onTraded?.(answer);
      return;
    }
    if (outcome.kind === "requote") {
      // Never resubmit on its own: show the new price and wait for the member to confirm it.
      setRequote({ order, requote: outcome.requote });
      setStatus({ kind: "requote", message: outcome.message, avgPrice: outcome.requote.avgPrice });
      return;
    }
    if (outcome.dropKey) keyRef.current = null;
    if (outcome.lock) setLock(outcome.lock);
    setStatus({ kind: "error", message: outcome.message });
  }, [
    gate,
    requote,
    retryOrder,
    flushQuotedText,
    amountText,
    state,
    tab,
    side,
    unit,
    tolerance,
    marketId,
    submit,
    onTraded,
  ]);

  // Bottom sheet: open as a modal dialog; close it if the window grows to the desktop layout.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (sheetOpen && !dialog.open) dialog.showModal();
    if (!sheetOpen && dialog.open) dialog.close();
  }, [sheetOpen]);

  useEffect(() => {
    if (!sheetOpen || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => {
      if (mq.matches) setSheetOpen(false);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [sheetOpen]);

  const openSheet = (s: Side) => {
    if (tab !== "buy" || s !== side) edited();
    setTab("buy");
    setSide(s);
    setSheetOpen(true);
  };

  const view = (
    <OrderTicketView
      tab={tab}
      side={side}
      unit={unit}
      amountText={amountText}
      tolerance={tolerance}
      yesPrice={yesPrice}
      gate={gate}
      balance={state.balance ?? null}
      held={held}
      result={result}
      requoteRows={requote ? requoteRows(requote.order, requote.requote, held) : null}
      status={status}
      canMax={maxText !== null && gate === "open"}
      signInHref={props.signInHref ?? "/sign-in"}
      onTab={(t) => {
        edited();
        setTab(t);
        setAmountText("");
        flushQuotedText("");
      }}
      onSide={(s) => {
        edited();
        setSide(s);
      }}
      onUnit={(u) => {
        edited();
        setUnit(u);
        setAmountText("");
        flushQuotedText("");
      }}
      onAmount={(text) => {
        edited();
        setAmountText(text);
      }}
      onMax={() => {
        if (maxText === null) return;
        edited();
        setAmountText(maxText);
        flushQuotedText(maxText);
      }}
      onTolerance={(t) => {
        edited();
        setTolerance(t);
      }}
      onSubmit={() => void onSubmit()}
    />
  );

  return (
    <>
      <section
        aria-label={TICKET_COPY.title}
        className="hidden rounded-lg border border-border bg-surface p-4 lg:block"
      >
        {sheetOpen ? null : view}
      </section>

      <div className="grid grid-cols-2 gap-2 lg:hidden">
        {(["YES", "NO"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-haspopup="dialog"
            onClick={() => openSheet(s)}
            className={`flex min-h-14 flex-col items-center justify-center rounded-md px-3 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2 ${
              s === "YES" ? "bg-yes text-on-yes" : "bg-no text-on-no"
            }`}
          >
            <span>{submitLabel("buy", s, false)}</span>
            <span className="tabular-nums">
              {pointsLabel(s === "YES" ? yesPrice : 100 - yesPrice)}
            </span>
          </button>
        ))}
      </div>

      <dialog
        ref={dialogRef}
        aria-label={TICKET_COPY.title}
        onClose={() => setSheetOpen(false)}
        className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-lg border border-border bg-surface p-4 text-foreground backdrop:bg-brand-dark/60 lg:hidden"
      >
        {sheetOpen ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="ml-auto inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-brand-ink underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            >
              {TICKET_COPY.close}
            </button>
            {view}
          </div>
        ) : null}
      </dialog>
    </>
  );
}

/**
 * The ticket with its own 3 s polling: fresh {b, qYes, qNo} (and balance and position when signed
 * in) recompute the quote, and a successful trade applies its result at once.
 */
export function LiveOrderTicket(props: OrderTicketProps) {
  const { state, apply } = useMarketState(props.marketId, props.market);
  const { onTraded } = props;
  const handleTraded = useCallback(
    (result: TradeSuccess) => {
      apply({
        qYes: result.market.qYes,
        qNo: result.market.qNo,
        probabilityYes: result.market.probabilityYes,
        displayPrice: result.market.displayPrice,
        balance: result.balance,
        position: result.position,
      });
      onTraded?.(result);
    },
    [apply, onTraded],
  );
  return <OrderTicket {...props} market={state} onTraded={handleTraded} />;
}
