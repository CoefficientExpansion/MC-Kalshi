import type { Side } from "@mc-kalshi/engine";
import Link from "next/link";
import { type FormEvent, type ReactNode, useId } from "react";
import type { TicketQuoteResult, TicketTab, TicketUnit } from "@/lib/ticket-quote";
import {
  formatContracts,
  formatPoints,
  impactWarning,
  inputProblem,
  type QuoteRow,
  quoteRows,
  requoteSubmitLabel,
  sideSegmentLabel,
  submitLabel,
  TICKET_COPY,
  toleranceOption,
} from "@/lib/trade-copy";

// The order ticket's markup (docs/specs/m3-trading.md, "Order ticket (UI)"). Stateless: the
// client container `order-ticket.tsx` owns the state and renders this both in the desktop card
// and in the mobile bottom sheet. Tokens and copy follow docs/design/theme.md.

/** What the ticket may do: trade, or one of the states that stop it. */
export type TicketGate = "open" | "closed" | "suspended" | "signed_out";

export type TicketStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "requote"; readonly message: string; readonly avgPrice: number };

export const TOLERANCES = [1, 2, 5] as const;
export type Tolerance = (typeof TOLERANCES)[number];

export interface TicketViewProps {
  readonly tab: TicketTab;
  readonly side: Side;
  readonly unit: TicketUnit;
  readonly amountText: string;
  readonly tolerance: Tolerance;
  /** YES price in whole points (1–99); NO is 100 minus it. */
  readonly yesPrice: number;
  readonly gate: TicketGate;
  /** Signed in only. */
  readonly balance: number | null;
  /** Contracts held on the chosen side; null when signed out. */
  readonly held: number | null;
  readonly result: TicketQuoteResult;
  /** The server's fresh quote rows after a slippage reject, shown instead of the local quote. */
  readonly requoteRows: readonly QuoteRow[] | null;
  readonly status: TicketStatus;
  readonly canMax: boolean;
  readonly signInHref: string;
  readonly onTab: (tab: TicketTab) => void;
  readonly onSide: (side: Side) => void;
  readonly onUnit: (unit: TicketUnit) => void;
  readonly onAmount: (text: string) => void;
  readonly onMax: () => void;
  readonly onTolerance: (t: Tolerance) => void;
  readonly onSubmit: () => void;
}

const FOCUS_RING = "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-ink";
const LEGEND = "font-display text-sm font-semibold uppercase tracking-widest text-brand-ink";

function Choice<T extends string>({
  name,
  value,
  checked,
  onChange,
  className,
  children,
}: {
  name: string;
  value: T;
  checked: boolean;
  onChange: (value: T) => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-1 cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="peer sr-only"
      />
      <span
        className={`${className} ${FOCUS_RING} peer-disabled:cursor-not-allowed peer-disabled:opacity-60`}
      >
        {children}
      </span>
    </label>
  );
}

const SIDE_STYLE: Record<Side, { on: string; off: string; button: string }> = {
  YES: {
    on: "border-yes bg-yes text-on-yes",
    off: "border-yes bg-background text-yes",
    button: "bg-yes text-on-yes",
  },
  NO: {
    on: "border-no bg-no text-on-no",
    off: "border-no bg-background text-no",
    button: "bg-no text-on-no",
  },
};

function Rows({ rows }: { rows: readonly QuoteRow[] }) {
  return (
    <dl className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-wrap gap-x-3">
          <dt>{row.label}</dt>
          <dd className="ml-auto text-right font-semibold tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The ticket form. Ids come from useId, so the card and the sheet can both be mounted. */
export function OrderTicketView(props: TicketViewProps) {
  const { tab, side, unit, amountText, tolerance, yesPrice, gate, balance, held, result, status } =
    props;
  const id = useId();
  const titleId = `${id}-title`;
  const amountId = `${id}-amount`;
  const hintId = `${id}-hint`;
  const problemId = `${id}-problem`;
  const toleranceId = `${id}-tolerance`;

  const pending = status.kind === "pending";
  const closed = gate === "closed";
  const quote = result.ok ? result.quote : "quote" in result ? result.quote : undefined;
  const problem = result.ok ? null : inputProblem(result, side);
  const rows = props.requoteRows ?? (quote ? quoteRows(quote) : null);
  const highImpact = props.requoteRows === null && result.ok && result.quote.highImpact;
  const canSubmit = gate === "open" && !pending && (props.requoteRows !== null || result.ok);
  const amountLabel =
    tab === "sell"
      ? TICKET_COPY.amountContracts
      : unit === "points"
        ? TICKET_COPY.amountPoints
        : TICKET_COPY.amountContractsBuy;

  const buttonText = pending
    ? TICKET_COPY.pending
    : status.kind === "requote"
      ? requoteSubmitLabel(tab, status.avgPrice)
      : submitLabel(tab, side, highImpact);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (canSubmit) props.onSubmit();
  };

  return (
    <form
      aria-labelledby={titleId}
      aria-busy={pending}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
    >
      <h2 id={titleId} className="font-display text-2xl font-semibold">
        {TICKET_COPY.title}
      </h2>

      <fieldset disabled={closed || pending} className="flex min-w-0 flex-col gap-4">
        <fieldset>
          <legend className="sr-only">{TICKET_COPY.orderType}</legend>
          <div className="flex border-b border-border">
            {(["buy", "sell"] as const).map((t) => (
              <Choice
                key={t}
                name={`${id}-tab`}
                value={t}
                checked={tab === t}
                onChange={props.onTab}
                className={`flex min-h-11 flex-1 items-center justify-center border-b-2 font-semibold ${
                  tab === t
                    ? "border-accent text-foreground"
                    : "border-transparent font-normal text-foreground"
                }`}
              >
                {t === "buy" ? TICKET_COPY.buy : TICKET_COPY.sell}
              </Choice>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className={LEGEND}>{TICKET_COPY.outcome}</legend>
          <div className="mt-2 flex gap-2">
            {(["YES", "NO"] as const).map((s) => (
              <Choice
                key={s}
                name={`${id}-side`}
                value={s}
                checked={side === s}
                onChange={props.onSide}
                className={`flex min-h-11 flex-1 items-center justify-center rounded-md border-2 px-3 font-semibold tabular-nums ${
                  side === s ? SIDE_STYLE[s].on : SIDE_STYLE[s].off
                }`}
              >
                {sideSegmentLabel(s, s === "YES" ? yesPrice : 100 - yesPrice)}
              </Choice>
            ))}
          </div>
        </fieldset>

        {tab === "buy" ? (
          <fieldset>
            <legend className={LEGEND}>{TICKET_COPY.unit}</legend>
            <div className="mt-2 flex rounded-md border border-border p-0.5">
              {(["points", "contracts"] as const).map((u) => (
                <Choice
                  key={u}
                  name={`${id}-unit`}
                  value={u}
                  checked={unit === u}
                  onChange={props.onUnit}
                  className={`flex min-h-9 flex-1 items-center justify-center rounded text-sm font-semibold ${
                    unit === u
                      ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                      : "font-normal text-foreground"
                  }`}
                >
                  {u === "points" ? TICKET_COPY.points : TICKET_COPY.contracts}
                </Choice>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor={amountId} className="text-sm font-semibold">
            {amountLabel}
          </label>
          <div className="flex gap-2">
            <input
              id={amountId}
              type="text"
              inputMode={tab === "buy" && unit === "points" ? "numeric" : "decimal"}
              autoComplete="off"
              spellCheck={false}
              placeholder="0"
              value={amountText}
              onChange={(e) => props.onAmount(e.target.value)}
              aria-invalid={problem !== null}
              aria-describedby={`${hintId}${problem ? ` ${problemId}` : ""}`}
              className="block w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-lg font-semibold tabular-nums text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink disabled:opacity-60"
            />
            <button
              type="button"
              onClick={props.onMax}
              disabled={!props.canMax}
              aria-label={TICKET_COPY.maxLabel}
              className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-semibold text-brand-ink hover:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {TICKET_COPY.max}
            </button>
          </div>
          <p id={hintId} className="text-sm">
            {tab === "sell" && held !== null
              ? `${TICKET_COPY.holding} ${formatContracts(held)} ${side} contracts`
              : balance !== null
                ? `${TICKET_COPY.balance} ${formatPoints(balance)}`
                : TICKET_COPY.playMoney}
          </p>
        </div>
      </fieldset>

      <div aria-live="polite" className="flex flex-col gap-3">
        {problem ? (
          <p id={problemId} className="text-sm font-semibold text-danger">
            {problem}
          </p>
        ) : null}
        {highImpact && quote ? (
          <p className="self-start rounded-full bg-warning px-3 py-0.5 text-sm font-semibold text-on-accent">
            {impactWarning(quote)}
          </p>
        ) : null}
        {rows ? (
          <section
            aria-label={TICKET_COPY.quoteHeading}
            className="rounded-md border border-border bg-background p-3"
          >
            <Rows rows={rows} />
          </section>
        ) : null}
      </div>

      {status.kind === "error" || status.kind === "requote" ? (
        <p
          role="alert"
          className="rounded-md border border-danger px-3 py-2 text-sm font-semibold text-danger"
        >
          {status.message}
        </p>
      ) : null}
      {status.kind === "success" ? (
        <p
          role="status"
          className="rounded-md border border-success px-3 py-2 text-sm font-semibold text-foreground"
        >
          {status.message}
        </p>
      ) : null}

      {gate === "closed" ? (
        <p className="rounded-md border border-border bg-background px-3 py-2">
          <span className="block font-semibold">{TICKET_COPY.closed}</span>
          <span className="text-sm">{TICKET_COPY.closedNote}</span>
        </p>
      ) : gate === "suspended" ? (
        <p className="rounded-md border border-border bg-background px-3 py-2 font-semibold">
          {TICKET_COPY.suspended}
        </p>
      ) : gate === "signed_out" ? (
        <div className="flex flex-col gap-2">
          <Link
            href={props.signInHref}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-accent px-4 font-semibold text-on-accent hover:bg-accent-dark hover:text-on-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2"
          >
            {TICKET_COPY.signIn}
          </Link>
          <p className="text-sm">{TICKET_COPY.signInNote}</p>
        </div>
      ) : (
        <button
          type="submit"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md px-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${SIDE_STYLE[side].button}`}
        >
          {pending ? (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          ) : null}
          {buttonText}
        </button>
      )}

      {gate === "open" ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-brand-ink">
            {TICKET_COPY.advanced}
          </summary>
          <div className="mt-2 flex flex-col gap-1">
            <label htmlFor={toleranceId} className="font-semibold">
              {TICKET_COPY.tolerance}
            </label>
            <select
              id={toleranceId}
              value={tolerance}
              disabled={pending}
              onChange={(e) => props.onTolerance(Number(e.target.value) as Tolerance)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            >
              {TOLERANCES.map((t) => (
                <option key={t} value={t}>
                  {toleranceOption(t)}
                </option>
              ))}
            </select>
            <p>{TICKET_COPY.toleranceHelp}</p>
          </div>
        </details>
      ) : null}
    </form>
  );
}
