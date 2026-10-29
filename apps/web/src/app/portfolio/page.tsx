import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/market/notice";
import { StatusBadge } from "@/components/market/status-badge";
import { getDb } from "@/db";
import { formatAbsolute, statusBadge } from "@/lib/market-format";
import { formatContracts, formatPoints } from "@/lib/trade-copy";
import { getSessionMember } from "@/server/auth";
import { getPortfolio, type Portfolio } from "@/server/portfolio";

// The member's holdings and last 20 trades (docs/specs/m3-trading.md, "Positions and portfolio").
// Signed-out visitors go to the sign-in page. A suspended member may still look (read-only).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Portfolio" };

const SHELL = "mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 sm:px-8";
const H2 = "font-display text-2xl font-semibold";
const TH = "px-3 py-2 text-left font-semibold";
const TD = "px-3 py-2 tabular-nums";

const signed = (n: number) =>
  n > 0 ? `+${formatPoints(n)}` : n < 0 ? `−${formatPoints(-n)}` : formatPoints(0);

function Summary({ p }: { p: Portfolio }) {
  const items = [
    { label: "Balance", value: formatPoints(p.balance) },
    { label: "Open positions", value: `about ${formatPoints(p.positionsValue)}` },
    { label: "Total", value: `about ${formatPoints(p.total)}` },
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {items.map((i) => (
        <div
          key={i.label}
          className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4"
        >
          <dt className="font-display text-sm font-semibold uppercase tracking-widest">
            {i.label}
          </dt>
          <dd className="text-2xl font-semibold tabular-nums">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Positions({ p, now }: { p: Portfolio; now: Date }) {
  if (p.positions.length === 0) {
    return (
      <p>
        You hold no contracts yet.{" "}
        <Link href="/" className="font-semibold text-brand-ink underline underline-offset-2">
          Browse markets
        </Link>
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-surface">
          <tr>
            <th scope="col" className={TH}>
              Market
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={TH}>
              YES
            </th>
            <th scope="col" className={TH}>
              NO
            </th>
            <th scope="col" className={TH}>
              Cost basis
            </th>
            <th scope="col" className={TH}>
              Value now
            </th>
            <th scope="col" className={TH}>
              Pays if YES
            </th>
            <th scope="col" className={TH}>
              Pays if NO
            </th>
            <th scope="col" className={TH}>
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {p.positions.map((r) => (
            <tr key={r.marketId} className="border-t border-border">
              <th scope="row" className="px-3 py-2 text-left font-normal">
                <Link
                  href={`/markets/${r.slug}`}
                  className="font-semibold text-brand-ink underline-offset-2 hover:underline"
                >
                  {r.title}
                </Link>
              </th>
              <td className="px-3 py-2">
                <StatusBadge badge={statusBadge(r, now)} />
              </td>
              <td className={TD}>{formatContracts(r.contractsYes)}</td>
              <td className={TD}>{formatContracts(r.contractsNo)}</td>
              <td className={TD}>{formatPoints(r.costBasisPoints)}</td>
              <td className={TD}>about {formatPoints(r.valueNow)}</td>
              <td className={TD}>{formatPoints(r.paysIfYes)}</td>
              <td className={TD}>{formatPoints(r.paysIfNo)}</td>
              <td className={TD}>{signed(r.change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Trades({ p }: { p: Portfolio }) {
  if (p.trades.length === 0) return <p>No trades yet.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-surface">
          <tr>
            <th scope="col" className={TH}>
              Market
            </th>
            <th scope="col" className={TH}>
              Trade
            </th>
            <th scope="col" className={TH}>
              Contracts
            </th>
            <th scope="col" className={TH}>
              Points
            </th>
            <th scope="col" className={TH}>
              Price
            </th>
            <th scope="col" className={TH}>
              Time
            </th>
          </tr>
        </thead>
        <tbody>
          {p.trades.map((t) => (
            <tr key={t.id} className="border-t border-border">
              <td className="px-3 py-2">
                <Link
                  href={`/markets/${t.slug}`}
                  className="text-brand-ink underline-offset-2 hover:underline"
                >
                  {t.title}
                </Link>
              </td>
              <td className="px-3 py-2 font-semibold">
                {t.contracts > 0 ? "Buy" : "Sell"}{" "}
                <span className={t.side === "YES" ? "text-yes" : "text-no"}>{t.side}</span>
              </td>
              <td className={TD}>{formatContracts(t.contracts)}</td>
              <td className={TD}>
                {t.costPoints >= 0 ? "paid" : "received"} {formatPoints(Math.abs(t.costPoints))}
              </td>
              <td className={TD}>{t.avgPrice} pts</td>
              <td className="px-3 py-2">
                <time dateTime={t.createdAt.toISOString()}>{formatAbsolute(t.createdAt)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PortfolioPage() {
  const session = await getSessionMember();
  const db = getDb();
  if (!session || !db) redirect("/sign-in");

  let portfolio: Portfolio;
  try {
    portfolio = await getPortfolio(db, session.userId);
  } catch (error) {
    console.error(
      `[portfolio] loading failed (${error instanceof Error ? error.name : typeof error})`,
    );
    return (
      <div className={SHELL}>
        <Notice
          title="Your portfolio is unavailable right now"
          headingLevel={1}
          action={{ href: "/", label: "Back to markets" }}
        >
          We could not load it. Please try again in a minute.
        </Notice>
      </div>
    );
  }
  const now = new Date();
  return (
    <div className={SHELL}>
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-bold">Portfolio</h1>
        <p className="text-sm">
          Values are about what your contracts are worth at today&apos;s prices; selling a large
          position moves the price.
        </p>
      </header>
      <Summary p={portfolio} />
      <section aria-labelledby="positions-heading" className="flex flex-col gap-3">
        <h2 id="positions-heading" className={H2}>
          Positions
        </h2>
        <Positions p={portfolio} now={now} />
      </section>
      <section aria-labelledby="trades-heading" className="flex flex-col gap-3">
        <h2 id="trades-heading" className={H2}>
          Recent trades
        </h2>
        <Trades p={portfolio} />
      </section>
    </div>
  );
}
