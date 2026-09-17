-- Durable request idempotency for retryable Instructions mutations.
-- The receipt row and domain write commit in the same PostgreSQL transaction.
CREATE TABLE IF NOT EXISTS instruction_idempotency_receipts (
    principal TEXT NOT NULL,
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_sha256 TEXT NOT NULL,
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (principal, operation, idempotency_key),
    CHECK (length(principal) BETWEEN 1 AND 512),
    CHECK (length(operation) BETWEEN 1 AND 255),
    CHECK (length(idempotency_key) BETWEEN 1 AND 255),
    CHECK (length(request_sha256) = 64),
    CHECK (
      (response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
      OR
      (response_status BETWEEN 200 AND 599 AND response_body IS NOT NULL AND completed_at IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS instruction_idempotency_receipts_created_at_idx
  ON instruction_idempotency_receipts (created_at);
