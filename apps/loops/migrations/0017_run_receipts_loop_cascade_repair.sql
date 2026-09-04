-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0017_run_receipts_loop_cascade_repair"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:99be369ecee8da908f97761934887af3d4128ea19041fd6929b6ec5927527a29)

GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner, open_loops_migrator;
SET ROLE open_loops_owner;

DO $run_receipts_loop_cascade_repair$
DECLARE
  doomed TEXT;
  has_cascade BOOLEAN;
BEGIN
  FOR doomed IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = child.relnamespace
     WHERE con.contype = 'f'
       AND ns.nspname = current_schema()
       AND child.relname = 'run_receipts'
       AND parent.relname = 'loops'
       AND con.confdeltype <> 'c'
       AND con.conkey = (
         SELECT array_agg(att.attnum ORDER BY att.attname)
           FROM pg_attribute att
          WHERE att.attrelid = child.oid
            AND att.attname IN ('tenant_id', 'loop_id')
       )
  LOOP
    EXECUTE format('ALTER TABLE run_receipts DROP CONSTRAINT %I', doomed);
  END LOOP;

  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = child.relnamespace
     WHERE con.contype = 'f'
       AND ns.nspname = current_schema()
       AND child.relname = 'run_receipts'
       AND parent.relname = 'loops'
       AND con.confdeltype = 'c'
  ) INTO has_cascade;

  IF NOT has_cascade THEN
    ALTER TABLE run_receipts ADD CONSTRAINT run_receipts_tenant_id_loop_id_fkey
      FOREIGN KEY (tenant_id, loop_id) REFERENCES loops(tenant_id, id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$run_receipts_loop_cascade_repair$;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM open_loops_owner, open_loops_migrator;
GRANT USAGE ON SCHEMA public TO open_loops_owner, open_loops_migrator;
