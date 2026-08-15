CREATE SCHEMA IF NOT EXISTS sandboxes_disposable_task_journal;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

REVOKE ALL ON SCHEMA sandboxes_disposable_task_journal FROM PUBLIC;

CREATE TABLE sandboxes_disposable_task_journal.store (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  journal_cluster_system_identifier text NOT NULL
    CHECK (journal_cluster_system_identifier ~ '^[1-9][0-9]{0,31}$'),
  journal_database_name text NOT NULL,
  journal_database_oid oid NOT NULL,
  journal_identity_sha256 text NOT NULL UNIQUE
    CHECK (journal_identity_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  restore_domain_sha256 text NOT NULL
    CHECK (restore_domain_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  external_head_witness_sha256 text NOT NULL
    CHECK (external_head_witness_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  witness_verification_key_sha256 text NOT NULL
    CHECK (witness_verification_key_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  encrypted_at_rest boolean NOT NULL CHECK (encrypted_at_rest),
  signer_principal text NOT NULL,
  signing_key_id text NOT NULL,
  verification_key_sha256 text NOT NULL
    CHECK (verification_key_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  head_sequence bigint NOT NULL DEFAULT 0 CHECK (head_sequence >= 0),
  head_frontier_sha256 text CHECK (
    head_frontier_sha256 IS NULL OR head_frontier_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  witnessed_sequence bigint NOT NULL DEFAULT 0 CHECK (witnessed_sequence >= 0),
  witnessed_frontier_sha256 text CHECK (
    witnessed_frontier_sha256 IS NULL OR witnessed_frontier_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  witness_receipt_bytes bytea,
  witness_receipt_sha256 text CHECK (
    witness_receipt_sha256 IS NULL OR witness_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  CHECK ((head_sequence = 0 AND head_frontier_sha256 IS NULL)
    OR (head_sequence > 0 AND head_frontier_sha256 IS NOT NULL)),
  CHECK ((witnessed_sequence = 0 AND witnessed_frontier_sha256 IS NULL)
    OR (witnessed_sequence > 0 AND witnessed_frontier_sha256 IS NOT NULL)),
  CHECK ((witnessed_sequence = 0) = (witness_receipt_bytes IS NULL)),
  CHECK ((witness_receipt_bytes IS NULL) = (witness_receipt_sha256 IS NULL)),
  CHECK (witnessed_sequence <= head_sequence),
  CHECK (head_sequence - witnessed_sequence <= 1)
);

CREATE TABLE sandboxes_disposable_task_journal.tasks (
  idempotency_key_sha256 text PRIMARY KEY
    CHECK (idempotency_key_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  operation_digest text NOT NULL UNIQUE
    CHECK (operation_digest ~ '^sha256:[0-9a-f]{64}$'),
  dispatch_id text NOT NULL UNIQUE CHECK (dispatch_id ~ '^dt_[0-9a-f]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  canonical_request_bytes bytea NOT NULL,
  authority_consume_input_bytes bytea NOT NULL,
  authority_consume_input_sha256 text NOT NULL
    CHECK (authority_consume_input_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  authority_envelope_sha256 text NOT NULL
    CHECK (authority_envelope_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  source_manifest_sha256 text NOT NULL
    CHECK (source_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  input_manifest_sha256 text NOT NULL
    CHECK (input_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (provider IN ('e2b', 'daytona_cloud')),
  provider_metadata_scope_sha256 text NOT NULL
    CHECK (provider_metadata_scope_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  provider_creation_token_sha256 text NOT NULL
    CHECK (provider_creation_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  immutable_fingerprint_sha256 text NOT NULL
    CHECK (immutable_fingerprint_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  ownership_nonce_sha256 text NOT NULL
    CHECK (ownership_nonce_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  allocation_lease_epoch bigint NOT NULL CHECK (allocation_lease_epoch > 0),
  allocation_claim_fence_sha256 text NOT NULL
    CHECK (allocation_claim_fence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  allocation_ownership_nonce_sha256 text NOT NULL
    CHECK (allocation_ownership_nonce_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  effect_claim_sha256 text NOT NULL
    CHECK (effect_claim_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  dispatch_intent_anchor_sha256 text
    CHECK (dispatch_intent_anchor_sha256 IS NULL OR
      dispatch_intent_anchor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  dispatch_anchor_sha256 text NOT NULL
    CHECK (dispatch_anchor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN (
    'PREPARED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED', 'OUTCOME', 'QUARANTINED'
  )),
  lease_epoch bigint NOT NULL CHECK (lease_epoch > 0),
  claim_fence_sha256 text NOT NULL
    CHECK (claim_fence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  lease_owner_sha256 text NOT NULL
    CHECK (lease_owner_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  lease_expires_at timestamptz NOT NULL,
  authorization_receipt_bytes bytea,
  authorization_consumption_receipt_sha256 text
    CHECK (authorization_consumption_receipt_sha256 IS NULL OR
      authorization_consumption_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  provider_fingerprint_sha256 text
    CHECK (provider_fingerprint_sha256 IS NULL OR
      provider_fingerprint_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  effect_lease_epoch bigint CHECK (effect_lease_epoch IS NULL OR effect_lease_epoch > 0),
  effect_claim_fence_sha256 text
    CHECK (effect_claim_fence_sha256 IS NULL OR effect_claim_fence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  effect_ownership_nonce_sha256 text
    CHECK (effect_ownership_nonce_sha256 IS NULL OR effect_ownership_nonce_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_bundle_sha256 text
    CHECK (result_bundle_sha256 IS NULL OR result_bundle_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  checkpoint_handoff_sha256 text
    CHECK (checkpoint_handoff_sha256 IS NULL OR
      checkpoint_handoff_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_persisted_anchor_sha256 text
    CHECK (result_persisted_anchor_sha256 IS NULL OR
      result_persisted_anchor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  outcome_kind text CHECK (outcome_kind IS NULL OR outcome_kind IN (
    'succeeded', 'failed_no_effect', 'failed_contained'
  )),
  execution_receipt_bytes bytea,
  execution_receipt_sha256 text
    CHECK (execution_receipt_sha256 IS NULL OR
      execution_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  failure_code text,
  failure_evidence_sha256 text
    CHECK (failure_evidence_sha256 IS NULL OR
      failure_evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  quarantine_reason text,
  quarantine_evidence_sha256 text
    CHECK (quarantine_evidence_sha256 IS NULL OR
      quarantine_evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  outcome_anchor_bytes bytea,
  outcome_anchor_sha256 text
    CHECK (outcome_anchor_sha256 IS NULL OR outcome_anchor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((authorization_receipt_bytes IS NULL) =
    (authorization_consumption_receipt_sha256 IS NULL)),
  CHECK ((authorization_consumption_receipt_sha256 IS NULL) =
    (dispatch_intent_anchor_sha256 IS NULL)),
  CHECK ((result_bundle_sha256 IS NULL) = (checkpoint_handoff_sha256 IS NULL)),
  CHECK ((authorization_consumption_receipt_sha256 IS NULL) = (effect_lease_epoch IS NULL)),
  CHECK ((authorization_consumption_receipt_sha256 IS NULL) = (effect_claim_fence_sha256 IS NULL)),
  CHECK ((authorization_consumption_receipt_sha256 IS NULL) = (effect_ownership_nonce_sha256 IS NULL)),
  CHECK ((result_bundle_sha256 IS NULL) = (result_persisted_anchor_sha256 IS NULL)),
  CHECK ((state = 'OUTCOME') = (outcome_kind IS NOT NULL)),
  CHECK ((state = 'QUARANTINED') = (quarantine_reason IS NOT NULL)),
  CHECK ((state IN ('OUTCOME', 'QUARANTINED')) = (outcome_anchor_bytes IS NOT NULL)),
  CHECK ((outcome_anchor_bytes IS NULL) = (outcome_anchor_sha256 IS NULL)),
  CHECK ((state = 'OUTCOME' AND outcome_kind = 'succeeded') =
    (execution_receipt_bytes IS NOT NULL)),
  CHECK ((execution_receipt_bytes IS NULL) = (execution_receipt_sha256 IS NULL)),
  CHECK ((state = 'OUTCOME' AND outcome_kind <> 'succeeded') =
    (failure_code IS NOT NULL AND failure_evidence_sha256 IS NOT NULL)),
  CHECK ((state = 'QUARANTINED') = (quarantine_evidence_sha256 IS NOT NULL))
);

CREATE TABLE sandboxes_disposable_task_journal.events (
  journal_sequence bigint PRIMARY KEY CHECK (journal_sequence > 0),
  prior_frontier_sha256 text CHECK (
    prior_frontier_sha256 IS NULL OR prior_frontier_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  frontier_sha256 text NOT NULL UNIQUE
    CHECK (frontier_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  record_kind text NOT NULL CHECK (record_kind IN (
    'PREPARED', 'CLAIMED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED',
    'OUTCOME', 'QUARANTINED'
  )),
  dispatch_id text NOT NULL CHECK (dispatch_id ~ '^dt_[0-9a-f]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  record_bytes bytea NOT NULL,
  record_sha256 text NOT NULL CHECK (record_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signed_anchor_bytes bytea NOT NULL,
  signed_anchor_sha256 text NOT NULL UNIQUE
    CHECK (signed_anchor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION sandboxes_disposable_task_journal.reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'disposable task journal rows are append-only';
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.append_event(
  p_sequence bigint, p_prior text, p_frontier text, p_kind text,
  p_dispatch_id text, p_request text, p_record bytea, p_record_sha text,
  p_anchor bytea, p_anchor_sha text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_head bigint; current_frontier text; current_witnessed bigint;
BEGIN
  SELECT head_sequence, head_frontier_sha256, witnessed_sequence
    INTO current_head, current_frontier, current_witnessed
    FROM sandboxes_disposable_task_journal.store WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'journal store is not initialized'; END IF;
  IF current_head <> current_witnessed THEN
    RAISE EXCEPTION 'journal head is awaiting external witness';
  END IF;
  IF p_sequence <> current_head + 1 OR p_prior IS DISTINCT FROM current_frontier THEN
    RAISE EXCEPTION 'journal frontier conflict';
  END IF;
  IF 'sha256:' || encode(public.digest(p_record, 'sha256'), 'hex') <> p_record_sha
    OR 'sha256:' || encode(public.digest(p_anchor, 'sha256'), 'hex') <> p_anchor_sha THEN
    RAISE EXCEPTION 'journal event byte digest conflict';
  END IF;
  INSERT INTO sandboxes_disposable_task_journal.events
    (journal_sequence, prior_frontier_sha256, frontier_sha256, record_kind,
     dispatch_id, request_sha256, record_bytes, record_sha256,
     signed_anchor_bytes, signed_anchor_sha256)
  VALUES (p_sequence, p_prior, p_frontier, p_kind, p_dispatch_id, p_request,
    p_record, p_record_sha, p_anchor, p_anchor_sha);
  UPDATE sandboxes_disposable_task_journal.store
    SET head_sequence = p_sequence, head_frontier_sha256 = p_frontier WHERE singleton;
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.insert_prepared(
  p_idempotency text, p_operation text, p_dispatch_id text, p_request text,
  p_request_bytes bytea, p_consume_input bytea, p_consume_input_sha text,
  p_authority text, p_source text, p_input text,
  p_provider text, p_scope text, p_creation text, p_fingerprint text,
  p_ownership_nonce text, p_effect_claim text, p_dispatch_anchor text, p_epoch bigint, p_fence text,
  p_owner text, p_expires timestamptz,
  p_sequence bigint, p_prior text, p_frontier text, p_record bytea,
  p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO sandboxes_disposable_task_journal.tasks
    (idempotency_key_sha256, operation_digest, dispatch_id, request_sha256,
     canonical_request_bytes, authority_consume_input_bytes, authority_consume_input_sha256,
     authority_envelope_sha256, source_manifest_sha256, input_manifest_sha256,
     provider, provider_metadata_scope_sha256,
     provider_creation_token_sha256, immutable_fingerprint_sha256,
     ownership_nonce_sha256, allocation_lease_epoch,
     allocation_claim_fence_sha256, allocation_ownership_nonce_sha256,
     effect_claim_sha256, dispatch_anchor_sha256, state, lease_epoch,
     claim_fence_sha256, lease_owner_sha256, lease_expires_at)
  VALUES (p_idempotency, p_operation, p_dispatch_id, p_request,
    p_request_bytes, p_consume_input, p_consume_input_sha,
    p_authority, p_source, p_input, p_provider, p_scope,
    p_creation, p_fingerprint, p_ownership_nonce, p_epoch, p_fence,
    p_ownership_nonce, p_effect_claim, p_dispatch_anchor, 'PREPARED', p_epoch,
    p_fence, p_owner, p_expires);
  PERFORM sandboxes_disposable_task_journal.append_event(p_sequence, p_prior,
    p_frontier, 'PREPARED', p_dispatch_id, p_request, p_record, p_record_sha,
    p_anchor, p_anchor_sha);
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.takeover_claim(
  p_dispatch_id text, p_request text, p_old_fence text, p_epoch bigint,
  p_fence text, p_ownership_nonce text, p_owner text, p_expires timestamptz,
  p_sequence bigint, p_prior text, p_frontier text, p_record bytea,
  p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE prior_state text;
BEGIN
  UPDATE sandboxes_disposable_task_journal.tasks SET lease_epoch = p_epoch,
    claim_fence_sha256 = p_fence, ownership_nonce_sha256 = p_ownership_nonce,
    lease_owner_sha256 = p_owner,
    lease_expires_at = p_expires, updated_at = clock_timestamp()
  WHERE dispatch_id = p_dispatch_id AND request_sha256 = p_request
    AND claim_fence_sha256 = p_old_fence AND lease_epoch + 1 = p_epoch
    AND lease_expires_at <= clock_timestamp()
    AND state IN ('PREPARED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED')
  RETURNING state INTO prior_state;
  IF prior_state IS NULL THEN RAISE EXCEPTION 'stale disposable task claim'; END IF;
  PERFORM sandboxes_disposable_task_journal.append_event(p_sequence, p_prior,
    p_frontier, 'CLAIMED', p_dispatch_id, p_request, p_record, p_record_sha,
    p_anchor, p_anchor_sha);
  RETURN prior_state;
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.bind_authorization_and_mark_intent(
  p_dispatch_id text, p_request text, p_fence text, p_epoch bigint,
  p_effect_claim text, p_receipt bytea, p_receipt_sha text, p_intent_anchor text,
  p_sequence bigint, p_prior text, p_frontier text, p_record bytea,
  p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE existing_sha text; existing_effect text; existing_intent text; current_state text;
  allocation_epoch bigint; allocation_fence text; allocation_nonce text; current_nonce text;
BEGIN
  IF 'sha256:' || encode(public.digest(p_receipt, 'sha256'), 'hex') <> p_receipt_sha
    OR p_intent_anchor <> p_anchor_sha THEN
    RAISE EXCEPTION 'dispatch intent byte binding conflict';
  END IF;
  SELECT authorization_consumption_receipt_sha256, effect_claim_sha256,
    dispatch_intent_anchor_sha256, state, allocation_lease_epoch,
    allocation_claim_fence_sha256, allocation_ownership_nonce_sha256, ownership_nonce_sha256
    INTO existing_sha, existing_effect, existing_intent, current_state, allocation_epoch,
      allocation_fence, allocation_nonce, current_nonce
    FROM sandboxes_disposable_task_journal.tasks
    WHERE dispatch_id = p_dispatch_id AND request_sha256 = p_request
      AND claim_fence_sha256 = p_fence AND lease_epoch = p_epoch
      AND lease_expires_at > clock_timestamp()
      AND state IN ('PREPARED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale disposable task claim'; END IF;
  IF existing_sha IS NOT NULL THEN
    IF existing_sha = p_receipt_sha AND existing_effect = p_effect_claim
      AND existing_intent = p_intent_anchor THEN RETURN 0; END IF;
    RAISE EXCEPTION 'authorization receipt conflict';
  END IF;
  IF current_state <> 'PREPARED' OR existing_effect <> p_effect_claim
    OR p_epoch <> allocation_epoch OR p_fence <> allocation_fence OR current_nonce <> allocation_nonce THEN
    RAISE EXCEPTION 'authorization receipt is missing after provider intent';
  END IF;
  UPDATE sandboxes_disposable_task_journal.tasks
    SET state = 'DISPATCH_INTENT', authorization_receipt_bytes = p_receipt,
      authorization_consumption_receipt_sha256 = p_receipt_sha,
      dispatch_intent_anchor_sha256 = p_intent_anchor,
      effect_lease_epoch = lease_epoch,
      effect_claim_fence_sha256 = claim_fence_sha256,
      effect_ownership_nonce_sha256 = ownership_nonce_sha256,
      updated_at = clock_timestamp() WHERE dispatch_id = p_dispatch_id;
  PERFORM sandboxes_disposable_task_journal.append_event(p_sequence, p_prior,
    p_frontier, 'DISPATCH_INTENT', p_dispatch_id, p_request, p_record, p_record_sha,
    p_anchor, p_anchor_sha);
  RETURN 1;
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.mark_dispatched(
  p_dispatch_id text, p_request text, p_fence text, p_epoch bigint,
  p_fingerprint text, p_scope text,
  p_sequence bigint, p_prior text, p_frontier text, p_record bytea,
  p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_state text; stored_fingerprint text; expected_scope text; auth_sha text;
BEGIN
  SELECT state, provider_fingerprint_sha256, provider_metadata_scope_sha256,
    authorization_consumption_receipt_sha256
    INTO current_state, stored_fingerprint, expected_scope, auth_sha
    FROM sandboxes_disposable_task_journal.tasks
    WHERE dispatch_id = p_dispatch_id AND request_sha256 = p_request
      AND claim_fence_sha256 = p_fence AND lease_epoch = p_epoch
      AND lease_expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale disposable task claim'; END IF;
  IF p_fingerprint !~ '^sha256:[0-9a-f]{64}$' OR expected_scope <> p_scope OR auth_sha IS NULL THEN
    RAISE EXCEPTION 'disposable task dispatch binding conflict';
  END IF;
  IF current_state = 'DISPATCHED' THEN
    IF stored_fingerprint = p_fingerprint THEN RETURN 0; END IF;
    RAISE EXCEPTION 'provider fingerprint conflict';
  END IF;
  IF current_state <> 'DISPATCH_INTENT' THEN RAISE EXCEPTION 'invalid disposable task transition'; END IF;
  UPDATE sandboxes_disposable_task_journal.tasks
    SET state = 'DISPATCHED', provider_fingerprint_sha256 = p_fingerprint,
      updated_at = clock_timestamp() WHERE dispatch_id = p_dispatch_id;
  PERFORM sandboxes_disposable_task_journal.append_event(p_sequence, p_prior,
    p_frontier, 'DISPATCHED', p_dispatch_id, p_request, p_record, p_record_sha,
    p_anchor, p_anchor_sha);
  RETURN 1;
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.mark_result_persisted(
  p_dispatch_id text, p_request text, p_fence text, p_epoch bigint,
  p_result text, p_handoff text,
  p_result_anchor text, p_sequence bigint, p_prior text, p_frontier text,
  p_record bytea, p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_state text; old_result text; old_handoff text;
BEGIN
  SELECT state, result_bundle_sha256, checkpoint_handoff_sha256
    INTO current_state, old_result, old_handoff
    FROM sandboxes_disposable_task_journal.tasks
    WHERE dispatch_id = p_dispatch_id AND request_sha256 = p_request
      AND claim_fence_sha256 = p_fence AND lease_epoch = p_epoch
      AND lease_expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale disposable task claim'; END IF;
  IF current_state = 'RESULT_PERSISTED' THEN
    IF old_result = p_result AND old_handoff = p_handoff THEN RETURN 0; END IF;
    RAISE EXCEPTION 'durable result conflict';
  END IF;
  IF current_state <> 'DISPATCHED' THEN RAISE EXCEPTION 'invalid disposable task transition'; END IF;
  UPDATE sandboxes_disposable_task_journal.tasks SET state = 'RESULT_PERSISTED',
    result_bundle_sha256 = p_result, checkpoint_handoff_sha256 = p_handoff,
    result_persisted_anchor_sha256 = p_result_anchor, updated_at = clock_timestamp()
    WHERE dispatch_id = p_dispatch_id;
  PERFORM sandboxes_disposable_task_journal.append_event(p_sequence, p_prior,
    p_frontier, 'RESULT_PERSISTED', p_dispatch_id, p_request, p_record,
    p_record_sha, p_anchor, p_anchor_sha);
  RETURN 1;
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.commit_terminal(
  p_dispatch_id text, p_request text, p_fence text, p_epoch bigint,
  p_state text, p_outcome text,
  p_execution bytea, p_execution_sha text, p_failure_code text, p_failure_evidence text,
  p_quarantine_reason text, p_quarantine_evidence text,
  p_outcome_anchor bytea, p_outcome_anchor_sha text,
  p_sequence bigint, p_prior text, p_frontier text, p_kind text, p_record bytea,
  p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_state text;
BEGIN
  SELECT state INTO current_state FROM sandboxes_disposable_task_journal.tasks
    WHERE dispatch_id = p_dispatch_id AND request_sha256 = p_request
      AND claim_fence_sha256 = p_fence AND lease_epoch = p_epoch
      AND lease_expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale disposable task claim'; END IF;
  IF current_state IN ('OUTCOME', 'QUARANTINED') THEN RETURN 0; END IF;
  IF p_state = 'OUTCOME' AND p_outcome = 'succeeded' AND current_state <> 'RESULT_PERSISTED' THEN
    RAISE EXCEPTION 'success requires durable result';
  END IF;
  IF p_state = 'OUTCOME' AND p_outcome <> 'succeeded'
    AND current_state NOT IN ('PREPARED', 'DISPATCH_INTENT', 'DISPATCHED') THEN
    RAISE EXCEPTION 'failed terminal transition is invalid';
  END IF;
  IF p_state = 'QUARANTINED'
    AND current_state NOT IN ('PREPARED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED') THEN
    RAISE EXCEPTION 'quarantine transition is invalid';
  END IF;
  UPDATE sandboxes_disposable_task_journal.tasks SET state = p_state,
    outcome_kind = p_outcome, execution_receipt_bytes = p_execution,
    execution_receipt_sha256 = p_execution_sha, failure_code = p_failure_code,
    failure_evidence_sha256 = p_failure_evidence,
    quarantine_reason = p_quarantine_reason,
    quarantine_evidence_sha256 = p_quarantine_evidence,
    outcome_anchor_bytes = p_outcome_anchor,
    outcome_anchor_sha256 = p_outcome_anchor_sha, updated_at = clock_timestamp()
    WHERE dispatch_id = p_dispatch_id;
  PERFORM sandboxes_disposable_task_journal.append_event(p_sequence, p_prior,
    p_frontier, p_kind, p_dispatch_id, p_request, p_record, p_record_sha,
    p_anchor, p_anchor_sha);
  RETURN 1;
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.acknowledge_witness(
  p_sequence bigint, p_frontier text, p_receipt bytea, p_receipt_sha text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_sequence <= 0
    OR p_frontier !~ '^sha256:[0-9a-f]{64}$'
    OR p_receipt IS NULL
    OR p_receipt_sha !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'external witness acknowledgement input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF 'sha256:' || encode(public.digest(p_receipt, 'sha256'), 'hex') <> p_receipt_sha THEN
    RAISE EXCEPTION 'external witness receipt digest conflict' USING ERRCODE = '23514';
  END IF;
  UPDATE sandboxes_disposable_task_journal.store
    SET witnessed_sequence = p_sequence, witnessed_frontier_sha256 = p_frontier,
      witness_receipt_bytes = p_receipt, witness_receipt_sha256 = p_receipt_sha
    WHERE singleton AND head_sequence = p_sequence AND head_frontier_sha256 = p_frontier
      AND witnessed_sequence = p_sequence - 1;
  IF FOUND THEN RETURN; END IF;

  PERFORM 1 FROM sandboxes_disposable_task_journal.store
    WHERE singleton
      AND head_sequence = p_sequence
      AND head_frontier_sha256 = p_frontier
      AND witnessed_sequence = p_sequence
      AND witnessed_frontier_sha256 = p_frontier
      AND witness_receipt_bytes = p_receipt
      AND witness_receipt_sha256 = p_receipt_sha
    FOR UPDATE;
  IF FOUND THEN RETURN; END IF;

  RAISE EXCEPTION 'external witness acknowledgement conflict' USING ERRCODE = '40001';
END;
$$;

CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE
  ON sandboxes_disposable_task_journal.events FOR EACH ROW
  EXECUTE FUNCTION sandboxes_disposable_task_journal.reject_mutation();

CREATE TRIGGER store_delete_guard BEFORE DELETE
  ON sandboxes_disposable_task_journal.store FOR EACH ROW
  EXECUTE FUNCTION sandboxes_disposable_task_journal.reject_mutation();

CREATE TRIGGER tasks_delete_guard BEFORE DELETE
  ON sandboxes_disposable_task_journal.tasks FOR EACH ROW
  EXECUTE FUNCTION sandboxes_disposable_task_journal.reject_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA sandboxes_disposable_task_journal FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sandboxes_disposable_task_journal FROM PUBLIC;
