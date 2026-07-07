-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0006_work_item_machine_id"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:80887626208cbb3659a436e6e26c56f0b0229f0bcb8d292de51738ee99ed11d1)

ALTER TABLE workflow_work_items ADD COLUMN IF NOT EXISTS machine_id TEXT;
CREATE INDEX IF NOT EXISTS idx_workflow_work_items_machine ON workflow_work_items(machine_id, status);
