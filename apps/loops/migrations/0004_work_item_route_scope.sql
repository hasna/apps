-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0004_work_item_route_scope"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:341e439861d595ce3d069b0106f1f09134042bac0a70f3d00a1374e09f5404d9)

ALTER TABLE workflow_work_items ADD COLUMN IF NOT EXISTS route_scope TEXT;
CREATE INDEX IF NOT EXISTS idx_workflow_work_items_scope ON workflow_work_items(route_scope, status);
