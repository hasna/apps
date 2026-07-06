import { defineMigration, type Migration } from "../generated/storage-kit/migrations.js";

/**
 * Ordered, forward-only cloud (Postgres) migration plan (BUILD-SPEC §4.3).
 * Applied via the vendored storage-kit MigrationLedger in cloud mode. The local
 * SQLite schema (db/schema.ts) is the logical equivalent; these are the
 * Postgres-dialect statements. Never rewrite an applied migration — add a new
 * one with the next id.
 */
export const CLOUD_MIGRATIONS: readonly Migration[] = [
  defineMigration(
    "0001-core",
    `
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      entity_slug TEXT,
      stripe_customer_id TEXT,
      email TEXT NOT NULL,
      name TEXT,
      currency TEXT NOT NULL DEFAULT 'usd',
      delinquent INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      stripe_subscription_id TEXT,
      plan TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      subscription_id TEXT REFERENCES subscriptions(id),
      stripe_invoice_id TEXT,
      amount_due INTEGER NOT NULL DEFAULT 0,
      amount_paid INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL DEFAULT 'draft',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      due_date TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS dunning_policies (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rules_json TEXT NOT NULL DEFAULT '{}',
      pre_dunning_hours INTEGER NOT NULL DEFAULT 72,
      max_attempts INTEGER NOT NULL DEFAULT 4,
      downgrade_plan TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS dunning_runs (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      policy_id TEXT NOT NULL REFERENCES dunning_policies(id),
      attempt INTEGER NOT NULL DEFAULT 0,
      decline_code TEXT,
      outcome TEXT NOT NULL DEFAULT 'scheduled',
      scheduled_at TIMESTAMPTZ,
      executed_at TIMESTAMPTZ,
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      stripe_event_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      payload_json TEXT NOT NULL DEFAULT '{}',
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      processed_at TIMESTAMPTZ
    );
    `,
  ),
  defineMigration(
    "0002-audit",
    `
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      entity_id TEXT,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id TEXT,
      detail TEXT,
      prev_hash TEXT NOT NULL,
      row_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- In Postgres, append-only is enforced by REVOKE UPDATE, DELETE ON audit_log
    -- FROM the app role (managed by infra role grants, BUILD-SPEC §4.7).
    `,
  ),
];

export function migrationIds(): string[] {
  return CLOUD_MIGRATIONS.map((m) => m.id);
}
