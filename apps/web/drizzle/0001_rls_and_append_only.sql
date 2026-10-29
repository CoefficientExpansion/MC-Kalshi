-- Custom migration (hand-written): Row Level Security and append-only enforcement.
-- See docs/specs/m2a-data-layer.md and docs/architecture.md §7, §9.

-- Deny-all: RLS on, no policies, so the public anon/authenticated roles read and write nothing
-- through the Data API. The app connects as the table owner (`postgres`), which bypasses RLS.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "markets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "disputes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Append-only: triggers fire for every role, the table owner included, unlike a revoked grant.
-- A void or correction is a new compensating row, never an edit.
CREATE FUNCTION "forbid_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();--> statement-breakpoint
CREATE TRIGGER "ledger_entries_no_truncate"
  BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "forbid_mutation"();--> statement-breakpoint
CREATE TRIGGER "trades_append_only"
  BEFORE UPDATE OR DELETE ON "trades"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();--> statement-breakpoint
CREATE TRIGGER "trades_no_truncate"
  BEFORE TRUNCATE ON "trades"
  FOR EACH STATEMENT EXECUTE FUNCTION "forbid_mutation"();
