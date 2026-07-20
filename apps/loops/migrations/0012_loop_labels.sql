-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0012_loop_labels"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:d2fa64d1ff97fc9225667e9e6045bbbae13acca2fad74ca79ecbc6bcf20f1521)

ALTER TABLE loops ADD COLUMN IF NOT EXISTS labels_json JSONB NOT NULL DEFAULT '[]'::jsonb;
