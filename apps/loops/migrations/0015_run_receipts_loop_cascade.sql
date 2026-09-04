-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0015_run_receipts_loop_cascade"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:ac4ebc03cdf15383a7fd2f6ad12253cee4ddf68011b9d65c22e15d85693d3492)

GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner, open_loops_migrator;
SET ROLE open_loops_owner;

ALTER TABLE run_receipts DROP CONSTRAINT run_receipts_tenant_id_loop_id_fkey;
ALTER TABLE run_receipts ADD CONSTRAINT run_receipts_tenant_id_loop_id_fkey
  FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id) ON DELETE CASCADE NOT VALID;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM open_loops_owner, open_loops_migrator;
GRANT USAGE ON SCHEMA public TO open_loops_owner, open_loops_migrator;
