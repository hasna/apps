CREATE TABLE IF NOT EXISTS fleet_verifications (
  id TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  fraction TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS fleet_verifications_observed_at_idx
  ON fleet_verifications(observed_at);
