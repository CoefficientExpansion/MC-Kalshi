import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { balances, HOUSE_ACCOUNT_ID, type LedgerEntry, ledgerEntries } from "@/db/schema";
import type { AnyDb } from "@/db/types";

// The only code that writes `ledger_entries` or `balances` (architecture §4, §6). Points are whole
// numbers held as JS numbers, so every amount must be a safe integer.

type AccountType = LedgerEntry["accountType"];
type LedgerReason = LedgerEntry["reason"];

export interface TransferEntry {
  readonly accountType: AccountType;
  readonly accountId: string;
  /** Signed whole points: positive credits the account, negative debits it. */
  readonly deltaPoints: number;
}

export interface Transfer {
  readonly entries: readonly TransferEntry[];
  readonly reason: LedgerReason;
  /** What caused the transfer (for example `trade` and the trade id). */
  readonly refType?: string;
  readonly refId?: string;
}

/** A transfer was refused before anything was written. */
export class LedgerError extends Error {
  override readonly name = "LedgerError";
}

/** Throws `LedgerError` unless the transfer is well-formed and sums to exactly zero. */
function assertBalanced({ entries }: Transfer): void {
  if (entries.length < 2) {
    throw new LedgerError("a transfer needs at least two entries");
  }
  let sum = BigInt(0);
  const net = new Map<string, number>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.deltaPoints)) {
      throw new LedgerError(`deltaPoints must be a safe integer, got ${entry.deltaPoints}`);
    }
    if (entry.accountType === "house" && entry.accountId !== HOUSE_ACCOUNT_ID) {
      throw new LedgerError("house entries must use HOUSE_ACCOUNT_ID");
    }
    // BigInt so that the zero-sum test itself cannot lose precision near 2^53.
    sum += BigInt(entry.deltaPoints);
    const key = `${entry.accountType}:${entry.accountId}`;
    const total = (net.get(key) ?? 0) + entry.deltaPoints;
    if (!Number.isSafeInteger(total)) {
      throw new LedgerError(`net change for ${key} is not a safe integer`);
    }
    net.set(key, total);
  }
  if (sum !== BigInt(0)) {
    throw new LedgerError(`entries must sum to 0, got ${sum}`);
  }
}

/**
 * Append balanced entries to the ledger and apply the same deltas to the `balances` cache of every
 * `user` account touched. Validation happens before any write; the writes run in their own
 * (nested, when `tx` is already a transaction) transaction, so a failure part-way leaves nothing
 * behind even if the caller passed the bare database. Returns the inserted rows.
 */
export async function postTransfer(tx: AnyDb, transfer: Transfer): Promise<LedgerEntry[]> {
  assertBalanced(transfer);
  return tx.transaction(async (inner) => {
    const rows = await inner
      .insert(ledgerEntries)
      .values(
        transfer.entries.map((e) => ({
          accountType: e.accountType,
          accountId: e.accountId,
          deltaPoints: e.deltaPoints,
          reason: transfer.reason,
          refType: transfer.refType,
          refId: transfer.refId,
        })),
      )
      .returning();

    const perUser = new Map<string, number>();
    for (const e of transfer.entries) {
      if (e.accountType === "user") {
        perUser.set(e.accountId, (perUser.get(e.accountId) ?? 0) + e.deltaPoints);
      }
    }
    // Per user, sorted (a stable lock order avoids deadlocks between concurrent transfers): make
    // sure the row exists, then add the delta. Not one upsert: Postgres checks the
    // `points >= 0` CHECK on the proposed insert row before ON CONFLICT, so a debit would always
    // fail. An overdraft fails the UPDATE with check_violation and the whole transfer rolls back.
    for (const [userId, delta] of [...perUser].sort(([a], [b]) => a.localeCompare(b))) {
      await inner.insert(balances).values({ userId, points: 0 }).onConflictDoNothing();
      await inner
        .update(balances)
        .set({ points: sql`${balances.points} + ${delta}` })
        .where(eq(balances.userId, userId));
    }
    return rows;
  });
}

/**
 * Credit a new member's signup bonus (`house → user`). Returns `false` and writes nothing when the
 * user already has one. The `balances` row is locked first so two concurrent calls serialize; a
 * partial unique index on the ledger is the backstop.
 */
export async function grantSignupBonus(
  tx: AnyDb,
  userId: string,
  points: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(points) || points <= 0) {
    throw new LedgerError(`signup bonus must be a positive whole number, got ${points}`);
  }
  return tx.transaction(async (inner) => {
    await inner.insert(balances).values({ userId, points: 0 }).onConflictDoNothing();
    await inner.select().from(balances).where(eq(balances.userId, userId)).for("update");
    const existing = await inner
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.accountType, "user"),
          eq(ledgerEntries.accountId, userId),
          eq(ledgerEntries.reason, "signup_bonus"),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return false;
    }
    await postTransfer(inner, {
      entries: [
        { accountType: "house", accountId: HOUSE_ACCOUNT_ID, deltaPoints: -points },
        { accountType: "user", accountId: userId, deltaPoints: points },
      ],
      reason: "signup_bonus",
      refType: "profile",
      refId: userId,
    });
    return true;
  });
}

export interface BalanceMismatch {
  readonly userId: string;
  /** What `balances` says. */
  readonly cached: number;
  /** What the ledger says. */
  readonly ledger: number;
}

export interface LedgerInvariants {
  /** SUM(delta_points) over every row; must be 0. */
  readonly ledgerSum: number;
  /** Users whose cached balance differs from their ledger sum; must be empty. */
  readonly mismatches: BalanceMismatch[];
}

/** The scheduled integrity check (architecture §9): zero total, and cache equals ledger per user. */
export async function checkLedgerInvariants(db: AnyDb): Promise<LedgerInvariants> {
  const [total] = await db
    .select({ sum: sql<string>`coalesce(sum(${ledgerEntries.deltaPoints}), 0)` })
    .from(ledgerEntries);

  const perUser = db
    .select({
      userId: ledgerEntries.accountId,
      total: sql<string>`sum(${ledgerEntries.deltaPoints})`.as("total"),
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.accountType, "user"))
    .groupBy(ledgerEntries.accountId)
    .as("per_user");

  const cached = sql<string>`coalesce(${balances.points}, 0)`;
  const fromLedger = sql<string>`coalesce(${perUser.total}, 0)`;
  const rows = await db
    .select({
      userId: sql<string>`coalesce(${balances.userId}, ${perUser.userId})`,
      cached,
      ledger: fromLedger,
    })
    .from(balances)
    .fullJoin(perUser, eq(balances.userId, perUser.userId))
    .where(sql`${cached} <> ${fromLedger}`)
    .orderBy(sql`1`);

  return {
    ledgerSum: Number(total?.sum ?? 0),
    mismatches: rows.map((r) => ({
      userId: r.userId,
      cached: Number(r.cached),
      ledger: Number(r.ledger),
    })),
  };
}
