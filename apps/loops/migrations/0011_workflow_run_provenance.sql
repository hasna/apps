-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0011_workflow_run_provenance"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:5011c78d0d2cbf3fbcc601ce2bdea4a39cdde21cb9df931ca5c9c1dc3cd7e5b6)

ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS workflow_definition_hash TEXT;
