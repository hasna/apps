-- SQLite equivalent of the PostgreSQL operation-receipt uniqueness fence.
CREATE UNIQUE INDEX IF NOT EXISTS skills_operator_scope_receipt_idx
  ON skills_audit_events (org_id, target_type, target_id, json_extract(metadata_json, '$.operator_operation_id'))
  WHERE action = 'api_key_scopes_added'
    AND json_extract(metadata_json, '$.operator_operation_id') IS NOT NULL;
