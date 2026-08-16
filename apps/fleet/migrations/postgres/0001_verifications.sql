CREATE TABLE IF NOT EXISTS fleet_verifications (
  id TEXT PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL,
  fraction TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fleet_verifications_observed_at_idx
  ON fleet_verifications(observed_at);
