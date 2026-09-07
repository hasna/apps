/**
 * rc.6 tenancy schema program, byte-exact (O15-00684).
 *
 * The prod knowledge DB ledger (knowledge-prod, oss-fleet-prod) was written by the
 * pre-monorepo image @hasnaxyz/knowledge 1.0.0-rc.6 (deployed 2026-08-11), whose
 * apply-cloud-migrations.mjs applied these statements under
 * knowledge_tenancy_001..062 AFTER the api-key migrations. The current build does
 * not apply tenancy from its own schema program, but the ledger guard refuses
 * every deploy while these rows are unrecognized — and fresh installs need the
 * tenant columns for FCAME-1 guarded writes (the authority trigger requires
 * NEW.tenant_id). Defining the exact rc.6 statements under the same ids makes
 * the checksums match the applied rows (skipped on prod) and gives fresh
 * installs the same schema the fleet runs.
 *
 * APPEND-ONLY: these ids are pinned by tests/fixtures/legacy-ledger-checksums.json.
 * Edit nothing here in place; append new statements under new ids only.
 */
export declare const LEGACY_TENANCY_MIGRATIONS: string[];
