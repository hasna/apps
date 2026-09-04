-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0015_run_receipts_loop_cascade"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:ff6fd3f324b819a31e29cb8772895726cb8bfb5cebaff4bc0fda4cf7d239bb51)

GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner, open_loops_migrator;
SET ROLE open_loops_owner;

-- IF EXISTS: the constraint being dropped is the UNNAMED foreign key added by
-- 0010_tenant_enforce, so its name is whatever Postgres auto-assigned. A
-- database restored (or originally built) with that key under another name -
-- pg_dump of a hand-repaired schema, a logical restore - would otherwise abort
-- this migration's whole transaction on a name mismatch. Dropping is
-- best-effort; the ADD below is what this migration is actually for, and it
-- fails loudly if a same-named constraint really is still there.
ALTER TABLE run_receipts DROP CONSTRAINT IF EXISTS run_receipts_tenant_id_loop_id_fkey;
ALTER TABLE run_receipts ADD CONSTRAINT run_receipts_tenant_id_loop_id_fkey
  FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id) ON DELETE CASCADE NOT VALID;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM open_loops_owner, open_loops_migrator;
GRANT USAGE ON SCHEMA public TO open_loops_owner, open_loops_migrator;
