-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0007_work_item_gate_deaths"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:95ac3c0dfeef6f6e6d4bd8b92473d19aabae0c83ebc3b1f4409d84fc0bbfa11c)

ALTER TABLE workflow_work_items ADD COLUMN IF NOT EXISTS gate_deaths INTEGER NOT NULL DEFAULT 0;
