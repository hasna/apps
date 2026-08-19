-- b27cc4a0 (accounts elegant display): per-machine authentication status for
-- a profile. First-class JSONB map keyed by machine id:
--   { "<machineId>": { authenticated, checkedAt, detail? } }
--
-- Deliberately NOT inside `metadata` (flat scalars only per metadataSchema in
-- src/types.ts): per-machine auth state is a structured record of facts, and
-- stuffing it into metadata would abuse a schema that means something else.
-- Same reasoning the 0007 migration used to give `aliases` its own JSONB
-- column, and the same JSONB precedent (metadata in 0001, aliases in 0007).
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS auth_status JSONB NOT NULL DEFAULT '{}'::jsonb;
