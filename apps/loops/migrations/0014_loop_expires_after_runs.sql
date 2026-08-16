-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0014_loop_expires_after_runs"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:4c60d6c900c2f3146bd20da3bc3665a0a40e1b7e145433d8944d663da57460d7)

ALTER TABLE loops ADD COLUMN IF NOT EXISTS expires_after_runs INTEGER;
