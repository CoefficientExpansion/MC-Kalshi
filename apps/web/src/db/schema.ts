import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Data model: docs/architecture.md §7. Row Level Security and the append-only triggers live in
// a hand-written migration (drizzle/*_rls_and_append_only.sql), not here.

/** Points are whole numbers; a safe-integer JS number is exact up to 2^53. */
const points = (name: string) => bigint(name, { mode: "number" });
/** Contract amounts and AMM state: 6 decimal places, returned as strings (parse at the boundary). */
const contracts = (name: string) => numeric(name, { precision: 18, scale: 6 });
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// Enums mirror architecture §4. Adding a value is an ADR-worthy migration.
export const roleEnum = pgEnum("role", ["member", "moderator", "admin"]);
export const marketStatusEnum = pgEnum("market_status", [
  "proposed",
  "open",
  "closed",
  "resolved",
  "finalized",
  "voided",
  "rejected",
]);
export const outcomeEnum = pgEnum("outcome", ["YES", "NO"]);
export const sideEnum = pgEnum("side", ["YES", "NO"]);
export const accountTypeEnum = pgEnum("account_type", ["user", "market_pool", "house"]);
export const ledgerReasonEnum = pgEnum("ledger_reason", [
  "signup_bonus",
  "stipend",
  "trade",
  "payout",
  "void_refund",
  "admin_adjustment",
]);
export const disputeStatusEnum = pgEnum("dispute_status", ["open", "upheld", "flipped", "voided"]);

/**
 * The single house account has no row of its own, so it uses the nil UUID as `account_id`
 * (a CHECK on `ledger_entries` pins this).
 */
export const HOUSE_ACCOUNT_ID = "00000000-0000-0000-0000-000000000000";

// `id` is the Supabase `auth.users.id`, copied in on first sign-in (M2b). No FK to the `auth`
// schema so the migrations also run on PGlite.
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: roleEnum("role").notNull().default("member"),
  suspendedAt: timestamptz("suspended_at"),
  leaderboardOptOut: boolean("leaderboard_opt_out").notNull().default(false),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => profiles.id),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

/**
 * A cache of SUM(ledger_entries.delta_points) per user; only `postTransfer` writes it. Never
 * negative (architecture §6 "Balance floor"): a transfer that would overdraw fails as a whole.
 */
export const balances = pgTable(
  "balances",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => profiles.id),
    points: points("points").notNull().default(0),
  },
  (t) => [check("balances_points_nonnegative", sql`${t.points} >= 0`)],
);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const markets = pgTable(
  "markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    /** Plain-English resolution criteria. */
    rules: text("rules").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    status: marketStatusEnum("status").notNull().default("proposed"),
    outcome: outcomeEnum("outcome"),
    /**
     * LMSR liquidity in contracts: default 100, moderators choose 50–500 (engine `B_MIN`/`B_MAX`,
     * architecture §5).
     */
    b: integer("b").notNull().default(100),
    qYes: contracts("q_yes").notNull().default("0"),
    qNo: contracts("q_no").notNull().default("0"),
    closeAt: timestamptz("close_at").notNull(),
    resolveBy: timestamptz("resolve_by"),
    createdBy: uuid("created_by").references(() => profiles.id),
    resolvedBy: uuid("resolved_by").references(() => profiles.id),
    resolutionSource: text("resolution_source"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    openedAt: timestamptz("opened_at"),
    closedAt: timestamptz("closed_at"),
    resolvedAt: timestamptz("resolved_at"),
    finalizedAt: timestamptz("finalized_at"),
  },
  (t) => [
    check("markets_b_range", sql`${t.b} between 50 and 500`),
    // A settled market has an outcome; every other status (voided included) has none.
    check(
      "markets_outcome_matches_status",
      sql`(${t.status} in ('resolved', 'finalized')) = (${t.outcome} is not null)`,
    ),
    index("markets_status_close_at_idx").on(t.status, t.closeAt),
  ],
);

/** Immutable: one row per fill (UPDATE/DELETE raise). Corrections are new rows. */
export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    side: sideEnum("side").notNull(),
    /** Signed: positive buys, negative sells. */
    contracts: contracts("contracts").notNull(),
    /** Signed: positive is points paid by the user. */
    costPoints: points("cost_points").notNull(),
    probBefore: doublePrecision("prob_before").notNull(),
    probAfter: doublePrecision("prob_after").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    /** Hash of the normalized request, so a replayed idempotency key can be compared in full. */
    requestFingerprint: text("request_fingerprint").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trades_user_idempotency_key_uq").on(t.userId, t.idempotencyKey),
    index("trades_market_id_idx").on(t.marketId),
    // Rate limit and portfolio history: a user's recent trades.
    index("trades_user_created_at_idx").on(t.userId, t.createdAt),
    check("trades_contracts_nonzero", sql`${t.contracts} <> 0`),
    check(
      "trades_prob_range",
      sql`${t.probBefore} between 0 and 1 and ${t.probAfter} between 0 and 1`,
    ),
  ],
);

export const positions = pgTable(
  "positions",
  {
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    contractsYes: contracts("contracts_yes").notNull().default("0"),
    contractsNo: contracts("contracts_no").notNull().default("0"),
    /** Net points paid in (signed); what a void refunds. */
    costBasisPoints: points("cost_basis_points").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.marketId, t.userId] }),
    index("positions_user_id_idx").on(t.userId),
    check("positions_contracts_nonnegative", sql`${t.contractsYes} >= 0 and ${t.contractsNo} >= 0`),
  ],
);

/**
 * Append-only double-entry ledger; SUM(delta_points) over all rows is always 0. Only
 * `postTransfer` inserts here. `account_id` is polymorphic (profile id, market id, or the house
 * nil UUID), so it has no foreign key.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    accountType: accountTypeEnum("account_type").notNull(),
    accountId: uuid("account_id").notNull(),
    deltaPoints: points("delta_points").notNull(),
    reason: ledgerReasonEnum("reason").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_account_idx").on(t.accountType, t.accountId),
    index("ledger_entries_ref_idx").on(t.refType, t.refId),
    check(
      "ledger_entries_house_account",
      sql`${t.accountType} <> 'house' or ${t.accountId} = '${sql.raw(HOUSE_ACCOUNT_ID)}'`,
    ),
    // Backstop for `grantSignupBonus`: one signup bonus per user, even under a race.
    uniqueIndex("ledger_entries_signup_bonus_uq")
      .on(t.accountId)
      .where(sql`${t.reason} = 'signup_bonus' and ${t.accountType} = 'user'`),
  ],
);

export const disputes = pgTable("disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketId: uuid("market_id")
    .notNull()
    .references(() => markets.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id),
  reason: text("reason").notNull(),
  status: disputeStatusEnum("status").notNull().default("open"),
  decidedBy: uuid("decided_by").references(() => profiles.id),
  decisionNote: text("decision_note"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  decidedAt: timestamptz("decided_at"),
});

/** Every moderator/admin action. */
export const auditLog = pgTable("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => profiles.id),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  payload: jsonb("payload"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

/** Written on every trade; feeds the price chart. */
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    at: timestamptz("at").notNull().defaultNow(),
    probabilityYes: doublePrecision("prob_yes").notNull(),
  },
  (t) => [index("price_snapshots_market_at_idx").on(t.marketId, t.at)],
);

export type Profile = typeof profiles.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Market = typeof markets.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
