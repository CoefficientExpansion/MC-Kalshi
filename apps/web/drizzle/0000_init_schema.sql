CREATE TYPE "public"."account_type" AS ENUM('user', 'market_pool', 'house');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'upheld', 'flipped', 'voided');--> statement-breakpoint
CREATE TYPE "public"."ledger_reason" AS ENUM('signup_bonus', 'stipend', 'trade', 'payout', 'void_refund', 'admin_adjustment');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('proposed', 'open', 'closed', 'resolved', 'finalized', 'voided', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('YES', 'NO');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('member', 'moderator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('YES', 'NO');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"points" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_type" "account_type" NOT NULL,
	"account_id" uuid NOT NULL,
	"delta_points" bigint NOT NULL,
	"reason" "ledger_reason" NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_house_account" CHECK ("ledger_entries"."account_type" <> 'house' or "ledger_entries"."account_id" = '00000000-0000-0000-0000-000000000000')
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"rules" text NOT NULL,
	"category_id" uuid NOT NULL,
	"status" "market_status" DEFAULT 'proposed' NOT NULL,
	"outcome" "outcome",
	"b" integer DEFAULT 100 NOT NULL,
	"q_yes" numeric(18, 6) DEFAULT '0' NOT NULL,
	"q_no" numeric(18, 6) DEFAULT '0' NOT NULL,
	"close_at" timestamp with time zone NOT NULL,
	"resolve_by" timestamp with time zone,
	"created_by" uuid,
	"resolved_by" uuid,
	"resolution_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "markets_slug_unique" UNIQUE("slug"),
	CONSTRAINT "markets_b_range" CHECK ("markets"."b" between 50 and 500)
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"market_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"contracts_yes" numeric(18, 6) DEFAULT '0' NOT NULL,
	"contracts_no" numeric(18, 6) DEFAULT '0' NOT NULL,
	"cost_basis_points" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "positions_market_id_user_id_pk" PRIMARY KEY("market_id","user_id"),
	CONSTRAINT "positions_contracts_nonnegative" CHECK ("positions"."contracts_yes" >= 0 and "positions"."contracts_no" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"market_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"prob_yes" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "role" DEFAULT 'member' NOT NULL,
	"suspended_at" timestamp with time zone,
	"leaderboard_opt_out" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"side" "side" NOT NULL,
	"contracts" numeric(18, 6) NOT NULL,
	"cost_points" bigint NOT NULL,
	"prob_before" double precision NOT NULL,
	"prob_after" double precision NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_contracts_nonzero" CHECK ("trades"."contracts" <> 0),
	CONSTRAINT "trades_prob_range" CHECK ("trades"."prob_before" between 0 and 1 and "trades"."prob_after" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_resolved_by_profiles_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_type","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_signup_bonus_uq" ON "ledger_entries" USING btree ("account_id") WHERE "ledger_entries"."reason" = 'signup_bonus' and "ledger_entries"."account_type" = 'user';--> statement-breakpoint
CREATE INDEX "markets_status_close_at_idx" ON "markets" USING btree ("status","close_at");--> statement-breakpoint
CREATE INDEX "price_snapshots_market_at_idx" ON "price_snapshots" USING btree ("market_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_user_idempotency_key_uq" ON "trades" USING btree ("user_id","idempotency_key");