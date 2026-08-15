CREATE SCHEMA IF NOT EXISTS sandboxes_durable_journal_witness;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

REVOKE ALL ON SCHEMA sandboxes_durable_journal_witness FROM PUBLIC;

CREATE TABLE sandboxes_durable_journal_witness.config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  protected_journal_cluster_system_identifier text NOT NULL
    CHECK (protected_journal_cluster_system_identifier ~ '^[1-9][0-9]{0,31}$'),
  witness_cluster_system_identifier text NOT NULL
    CHECK (witness_cluster_system_identifier ~ '^[1-9][0-9]{0,31}$'),
  witness_database_name text NOT NULL,
  witness_database_oid oid NOT NULL,
  restore_domain_sha256 text NOT NULL
    CHECK (restore_domain_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  witness_identity_sha256 text NOT NULL UNIQUE
    CHECK (witness_identity_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signer_principal text NOT NULL,
  signing_key_id text NOT NULL,
  verification_key_sha256 text NOT NULL
    CHECK (verification_key_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  encrypted_at_rest boolean NOT NULL CHECK (encrypted_at_rest),
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (protected_journal_cluster_system_identifier <> witness_cluster_system_identifier)
);

CREATE TABLE sandboxes_durable_journal_witness.receipts (
  journal_identity_sha256 text NOT NULL
    CHECK (journal_identity_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  sequence bigint NOT NULL CHECK (sequence > 0),
  prior_frontier_sha256 text CHECK (
    prior_frontier_sha256 IS NULL OR prior_frontier_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  frontier_sha256 text NOT NULL
    CHECK (frontier_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signed_anchor_sha256 text NOT NULL
    CHECK (signed_anchor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  canonical_receipt_bytes bytea NOT NULL,
  receipt_sha256 text NOT NULL UNIQUE
    CHECK (receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (journal_identity_sha256, sequence),
  UNIQUE (journal_identity_sha256, frontier_sha256),
  UNIQUE (journal_identity_sha256, signed_anchor_sha256),
  CHECK ((sequence = 1 AND prior_frontier_sha256 IS NULL)
    OR (sequence > 1 AND prior_frontier_sha256 IS NOT NULL))
);

CREATE TABLE sandboxes_durable_journal_witness.heads (
  journal_identity_sha256 text PRIMARY KEY
    CHECK (journal_identity_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  head_sequence bigint NOT NULL CHECK (head_sequence > 0),
  head_frontier_sha256 text NOT NULL
    CHECK (head_frontier_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  head_signed_anchor_sha256 text NOT NULL
    CHECK (head_signed_anchor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  head_receipt_sha256 text NOT NULL
    CHECK (head_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  head_receipt_bytes bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (journal_identity_sha256, head_sequence)
    REFERENCES sandboxes_durable_journal_witness.receipts(journal_identity_sha256, sequence),
  FOREIGN KEY (head_receipt_sha256)
    REFERENCES sandboxes_durable_journal_witness.receipts(receipt_sha256)
);

CREATE FUNCTION sandboxes_durable_journal_witness.reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'durable journal witness evidence is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION sandboxes_durable_journal_witness.validate_head_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'durable journal witness head cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.journal_identity_sha256 IS DISTINCT FROM OLD.journal_identity_sha256
    OR NEW.head_sequence <> OLD.head_sequence + 1
    OR NEW.updated_at <= OLD.updated_at
  ) THEN
    RAISE EXCEPTION 'durable journal witness head transition is not contiguous' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sandboxes_durable_journal_witness.receipts receipt
    WHERE receipt.journal_identity_sha256 = NEW.journal_identity_sha256
      AND receipt.sequence = NEW.head_sequence
      AND receipt.frontier_sha256 = NEW.head_frontier_sha256
      AND receipt.signed_anchor_sha256 = NEW.head_signed_anchor_sha256
      AND receipt.receipt_sha256 = NEW.head_receipt_sha256
      AND receipt.canonical_receipt_bytes = NEW.head_receipt_bytes
  ) THEN
    RAISE EXCEPTION 'durable journal witness head lacks exact receipt evidence' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION sandboxes_durable_journal_witness.compare_and_advance(
  p_journal_identity_sha256 text,
  p_expected_sequence bigint,
  p_expected_frontier_sha256 text,
  p_successor_sequence bigint,
  p_successor_frontier_sha256 text,
  p_signed_anchor_sha256 text,
  p_canonical_receipt_bytes bytea,
  p_receipt_sha256 text
) RETURNS TABLE (
  canonical_receipt_bytes bytea,
  receipt_sha256 text,
  sequence bigint,
  frontier_sha256 text,
  prior_frontier_sha256 text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  current_sequence bigint;
  current_frontier text;
  replay sandboxes_durable_journal_witness.receipts%ROWTYPE;
BEGIN
  IF p_journal_identity_sha256 !~ '^sha256:[0-9a-f]{64}$'
    OR p_successor_frontier_sha256 !~ '^sha256:[0-9a-f]{64}$'
    OR p_signed_anchor_sha256 !~ '^sha256:[0-9a-f]{64}$'
    OR p_receipt_sha256 !~ '^sha256:[0-9a-f]{64}$'
    OR p_expected_sequence < 0
    OR p_successor_sequence <> p_expected_sequence + 1
    OR ((p_expected_sequence = 0) <> (p_expected_frontier_sha256 IS NULL))
    OR (p_expected_frontier_sha256 IS NOT NULL
      AND p_expected_frontier_sha256 !~ '^sha256:[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'durable journal witness input is invalid' USING ERRCODE = '22023';
  END IF;
  IF 'sha256:' || encode(public.digest(p_canonical_receipt_bytes, 'sha256'), 'hex')
      <> p_receipt_sha256 THEN
    RAISE EXCEPTION 'durable journal witness receipt digest conflict' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sandboxes_durable_journal_witness.config WHERE singleton) THEN
    RAISE EXCEPTION 'durable journal witness is not initialized' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sandboxes.durable-journal-witness/v1:' || p_journal_identity_sha256, 0)
  );
  SELECT head.head_sequence, head.head_frontier_sha256
    INTO current_sequence, current_frontier
    FROM sandboxes_durable_journal_witness.heads head
    WHERE head.journal_identity_sha256 = p_journal_identity_sha256 FOR UPDATE;

  IF NOT FOUND THEN
    current_sequence := 0;
    current_frontier := NULL;
  END IF;

  IF current_sequence = p_expected_sequence
      AND current_frontier IS NOT DISTINCT FROM p_expected_frontier_sha256 THEN
    INSERT INTO sandboxes_durable_journal_witness.receipts (
      journal_identity_sha256, sequence, prior_frontier_sha256, frontier_sha256,
      signed_anchor_sha256, canonical_receipt_bytes, receipt_sha256
    ) VALUES (
      p_journal_identity_sha256, p_successor_sequence, p_expected_frontier_sha256,
      p_successor_frontier_sha256, p_signed_anchor_sha256,
      p_canonical_receipt_bytes, p_receipt_sha256
    );
    INSERT INTO sandboxes_durable_journal_witness.heads (
      journal_identity_sha256, head_sequence, head_frontier_sha256,
      head_signed_anchor_sha256, head_receipt_sha256, head_receipt_bytes
    ) VALUES (
      p_journal_identity_sha256, p_successor_sequence, p_successor_frontier_sha256,
      p_signed_anchor_sha256, p_receipt_sha256, p_canonical_receipt_bytes
    ) ON CONFLICT (journal_identity_sha256) DO UPDATE SET
      head_sequence = EXCLUDED.head_sequence,
      head_frontier_sha256 = EXCLUDED.head_frontier_sha256,
      head_signed_anchor_sha256 = EXCLUDED.head_signed_anchor_sha256,
      head_receipt_sha256 = EXCLUDED.head_receipt_sha256,
      head_receipt_bytes = EXCLUDED.head_receipt_bytes,
      updated_at = GREATEST(clock_timestamp(),
        sandboxes_durable_journal_witness.heads.updated_at + interval '1 microsecond');
    RETURN QUERY SELECT p_canonical_receipt_bytes, p_receipt_sha256,
      p_successor_sequence, p_successor_frontier_sha256, p_expected_frontier_sha256;
    RETURN;
  END IF;

  IF current_sequence = p_successor_sequence
      AND current_frontier = p_successor_frontier_sha256 THEN
    SELECT * INTO replay FROM sandboxes_durable_journal_witness.receipts receipt
      WHERE receipt.journal_identity_sha256 = p_journal_identity_sha256
        AND receipt.sequence = p_successor_sequence;
    IF FOUND
      AND replay.prior_frontier_sha256 IS NOT DISTINCT FROM p_expected_frontier_sha256
      AND replay.frontier_sha256 = p_successor_frontier_sha256
      AND replay.signed_anchor_sha256 = p_signed_anchor_sha256
      AND replay.receipt_sha256 = p_receipt_sha256
      AND replay.canonical_receipt_bytes = p_canonical_receipt_bytes THEN
      RETURN QUERY SELECT replay.canonical_receipt_bytes, replay.receipt_sha256,
        replay.sequence, replay.frontier_sha256, replay.prior_frontier_sha256;
      RETURN;
    END IF;
  END IF;

  RAISE EXCEPTION 'durable journal witness frontier conflict' USING ERRCODE = '40001';
END;
$$;

CREATE TRIGGER config_immutable BEFORE UPDATE OR DELETE
  ON sandboxes_durable_journal_witness.config FOR EACH ROW
  EXECUTE FUNCTION sandboxes_durable_journal_witness.reject_mutation();

CREATE TRIGGER receipts_immutable BEFORE UPDATE OR DELETE
  ON sandboxes_durable_journal_witness.receipts FOR EACH ROW
  EXECUTE FUNCTION sandboxes_durable_journal_witness.reject_mutation();

CREATE TRIGGER heads_transition_guard BEFORE INSERT OR UPDATE OR DELETE
  ON sandboxes_durable_journal_witness.heads FOR EACH ROW
  EXECUTE FUNCTION sandboxes_durable_journal_witness.validate_head_transition();

REVOKE ALL ON ALL TABLES IN SCHEMA sandboxes_durable_journal_witness FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sandboxes_durable_journal_witness FROM PUBLIC;
