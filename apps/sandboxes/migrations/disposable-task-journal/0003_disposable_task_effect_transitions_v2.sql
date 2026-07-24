ALTER TABLE sandboxes_disposable_task_journal.tasks_v2
  DROP CONSTRAINT tasks_v2_state_check;

ALTER TABLE sandboxes_disposable_task_journal.tasks_v2
  ADD COLUMN provider_fingerprint_sha256 text
    CHECK (provider_fingerprint_sha256 IS NULL OR
      provider_fingerprint_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN provider_dispatch_anchor_sha256 text
    CHECK (provider_dispatch_anchor_sha256 IS NULL OR
      provider_dispatch_anchor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN provider_allocation_sha256 text
    CHECK (provider_allocation_sha256 IS NULL OR
      provider_allocation_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN result_bundle_sha256 text
    CHECK (result_bundle_sha256 IS NULL OR
      result_bundle_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN checkpoint_handoff_sha256 text
    CHECK (checkpoint_handoff_sha256 IS NULL OR
      checkpoint_handoff_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN result_persisted_anchor_sha256 text
    CHECK (result_persisted_anchor_sha256 IS NULL OR
      result_persisted_anchor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT tasks_v2_state_effects_check CHECK (state IN (
    'PREPARED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED', 'QUARANTINED'
  )),
  ADD CONSTRAINT tasks_v2_dispatch_effect_fields_check CHECK (
    (state IN ('DISPATCHED', 'RESULT_PERSISTED')) =
      (provider_fingerprint_sha256 IS NOT NULL) AND
    (provider_fingerprint_sha256 IS NULL) = (provider_dispatch_anchor_sha256 IS NULL) AND
    (provider_fingerprint_sha256 IS NULL) = (provider_allocation_sha256 IS NULL)
  ),
  ADD CONSTRAINT tasks_v2_result_effect_fields_check CHECK (
    (result_bundle_sha256 IS NULL) = (checkpoint_handoff_sha256 IS NULL) AND
    (result_bundle_sha256 IS NULL) = (result_persisted_anchor_sha256 IS NULL) AND
    (state = 'RESULT_PERSISTED') = (result_bundle_sha256 IS NOT NULL)
  );

ALTER TABLE sandboxes_disposable_task_journal.events_v2
  DROP CONSTRAINT events_v2_record_kind_check,
  ADD CONSTRAINT events_v2_record_kind_effects_check CHECK (record_kind IN (
    'PREPARED', 'CLAIMED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED',
    'QUARANTINED'
  ));

CREATE OR REPLACE FUNCTION sandboxes_disposable_task_journal.guard_task_v2_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.idempotency_key_sha256 IS DISTINCT FROM OLD.idempotency_key_sha256
    OR NEW.operation_digest IS DISTINCT FROM OLD.operation_digest
    OR NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id
    OR NEW.canonical_intent_sha256 IS DISTINCT FROM OLD.canonical_intent_sha256
    OR NEW.canonical_intent_bytes IS DISTINCT FROM OLD.canonical_intent_bytes
    OR NEW.source_manifest_sha256 IS DISTINCT FROM OLD.source_manifest_sha256
    OR NEW.input_manifest_sha256 IS DISTINCT FROM OLD.input_manifest_sha256
    OR NEW.checkpoint_policy_sha256 IS DISTINCT FROM OLD.checkpoint_policy_sha256
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.provider_metadata_scope_sha256 IS DISTINCT FROM OLD.provider_metadata_scope_sha256
    OR NEW.provider_creation_token_sha256 IS DISTINCT FROM OLD.provider_creation_token_sha256
    OR NEW.immutable_fingerprint_sha256 IS DISTINCT FROM OLD.immutable_fingerprint_sha256
    OR NEW.allocation_lease_epoch IS DISTINCT FROM OLD.allocation_lease_epoch
    OR NEW.allocation_claim_fence_sha256 IS DISTINCT FROM OLD.allocation_claim_fence_sha256
    OR NEW.allocation_ownership_nonce_sha256 IS DISTINCT FROM OLD.allocation_ownership_nonce_sha256
    OR NEW.effect_claim_sha256 IS DISTINCT FROM OLD.effect_claim_sha256
    OR NEW.sandbox_prepare_anchor_sha256 IS DISTINCT FROM OLD.sandbox_prepare_anchor_sha256
    OR NEW.prepared_sha256 IS DISTINCT FROM OLD.prepared_sha256
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'immutable disposable task v2 binding changed';
  END IF;
  IF OLD.canonical_consume_input_bytes IS NOT NULL AND (
    NEW.canonical_consume_input_bytes IS DISTINCT FROM OLD.canonical_consume_input_bytes
    OR NEW.consume_input_sha256 IS DISTINCT FROM OLD.consume_input_sha256
    OR NEW.canonical_authority_envelope_bytes IS DISTINCT FROM OLD.canonical_authority_envelope_bytes
    OR NEW.authority_envelope_sha256 IS DISTINCT FROM OLD.authority_envelope_sha256
    OR NEW.canonical_authorization_receipt_bytes IS DISTINCT FROM OLD.canonical_authorization_receipt_bytes
    OR NEW.authorization_consumption_receipt_sha256 IS DISTINCT FROM OLD.authorization_consumption_receipt_sha256
    OR NEW.dispatch_intent_anchor_sha256 IS DISTINCT FROM OLD.dispatch_intent_anchor_sha256
  ) THEN RAISE EXCEPTION 'immutable disposable task v2 authorization changed'; END IF;
  IF OLD.provider_fingerprint_sha256 IS NOT NULL AND (
    NEW.provider_fingerprint_sha256 IS DISTINCT FROM OLD.provider_fingerprint_sha256
    OR NEW.provider_dispatch_anchor_sha256 IS DISTINCT FROM OLD.provider_dispatch_anchor_sha256
    OR NEW.provider_allocation_sha256 IS DISTINCT FROM OLD.provider_allocation_sha256
  ) THEN RAISE EXCEPTION 'immutable disposable task v2 provider effect changed'; END IF;
  IF OLD.result_bundle_sha256 IS NOT NULL AND (
    NEW.result_bundle_sha256 IS DISTINCT FROM OLD.result_bundle_sha256
    OR NEW.checkpoint_handoff_sha256 IS DISTINCT FROM OLD.checkpoint_handoff_sha256
    OR NEW.result_persisted_anchor_sha256 IS DISTINCT FROM OLD.result_persisted_anchor_sha256
  ) THEN RAISE EXCEPTION 'immutable disposable task v2 persisted result changed'; END IF;
  IF OLD.state = 'PREPARED' AND NEW.state NOT IN ('PREPARED', 'DISPATCH_INTENT') THEN
    RAISE EXCEPTION 'invalid disposable task v2 transition';
  END IF;
  IF OLD.state = 'DISPATCH_INTENT' AND NEW.state NOT IN ('DISPATCH_INTENT', 'DISPATCHED', 'QUARANTINED') THEN
    RAISE EXCEPTION 'invalid disposable task v2 transition';
  END IF;
  IF OLD.state = 'DISPATCHED' AND NEW.state NOT IN ('DISPATCHED', 'RESULT_PERSISTED') THEN
    RAISE EXCEPTION 'invalid disposable task v2 transition';
  END IF;
  IF OLD.state = 'RESULT_PERSISTED' AND NEW.state <> 'RESULT_PERSISTED' THEN
    RAISE EXCEPTION 'terminal disposable task v2 state changed';
  END IF;
  IF OLD.state = 'QUARANTINED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal disposable task v2 row is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION sandboxes_disposable_task_journal.takeover_claim_v2(
  text,text,text,bigint,text,text,text,timestamptz,bigint,text,text,bytea,text,bytea,text
);

CREATE FUNCTION sandboxes_disposable_task_journal.takeover_claim_v2(
  p_dispatch_id text, p_intent text, p_prepare_anchor text, p_effect text,
  p_old_fence text, p_epoch bigint, p_fence text, p_ownership text,
  p_owner text, p_expires timestamptz,
  p_sequence bigint, p_prior text, p_frontier text, p_record bytea,
  p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE prior_state text;
BEGIN
  UPDATE sandboxes_disposable_task_journal.tasks_v2 SET lease_epoch = p_epoch,
    claim_fence_sha256 = p_fence, ownership_nonce_sha256 = p_ownership,
    lease_owner_sha256 = p_owner, lease_expires_at = p_expires,
    updated_at = clock_timestamp()
  WHERE dispatch_id = p_dispatch_id AND canonical_intent_sha256 = p_intent
    AND sandbox_prepare_anchor_sha256 = p_prepare_anchor
    AND effect_claim_sha256 = p_effect
    AND claim_fence_sha256 = p_old_fence AND lease_epoch + 1 = p_epoch
    AND lease_expires_at <= clock_timestamp()
    AND state IN ('PREPARED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED')
  RETURNING state INTO prior_state;
  IF prior_state IS NULL THEN RAISE EXCEPTION 'stale disposable task v2 takeover'; END IF;
  PERFORM sandboxes_disposable_task_journal.append_event_v2(p_sequence, p_prior,
    p_frontier, 'CLAIMED', p_dispatch_id, p_intent, p_record, p_record_sha,
    p_anchor, p_anchor_sha);
  RETURN prior_state;
END;
$$;

DROP FUNCTION sandboxes_disposable_task_journal.quarantine_authorization_v2(
  text,text,text,bigint,text,text,bigint,text,text,bytea,text,bytea,text
);

CREATE FUNCTION sandboxes_disposable_task_journal.quarantine_authorization_v2(
  p_dispatch_id text, p_intent text, p_prepare_anchor text, p_effect text,
  p_fence text, p_epoch bigint, p_reason text, p_evidence text,
  p_sequence bigint, p_prior text, p_frontier text, p_record bytea,
  p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_state text; old_reason text; old_evidence text; current_expiry timestamptz;
BEGIN
  SELECT state, quarantine_reason, quarantine_evidence_sha256, lease_expires_at
    INTO current_state, old_reason, old_evidence, current_expiry
  FROM sandboxes_disposable_task_journal.tasks_v2
  WHERE dispatch_id = p_dispatch_id AND canonical_intent_sha256 = p_intent
    AND sandbox_prepare_anchor_sha256 = p_prepare_anchor
    AND effect_claim_sha256 = p_effect
    AND claim_fence_sha256 = p_fence AND lease_epoch = p_epoch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale disposable task v2 claim'; END IF;
  IF current_state = 'QUARANTINED' THEN
    IF old_reason = p_reason AND old_evidence = p_evidence THEN RETURN 0; END IF;
    RAISE EXCEPTION 'disposable task v2 quarantine conflict';
  END IF;
  IF current_state <> 'DISPATCH_INTENT' THEN RAISE EXCEPTION 'invalid disposable task v2 transition'; END IF;
  IF current_expiry <= clock_timestamp() THEN RAISE EXCEPTION 'stale disposable task v2 claim'; END IF;
  UPDATE sandboxes_disposable_task_journal.tasks_v2 SET state = 'QUARANTINED',
    quarantine_reason = p_reason, quarantine_evidence_sha256 = p_evidence,
    updated_at = clock_timestamp()
  WHERE dispatch_id = p_dispatch_id AND canonical_intent_sha256 = p_intent
    AND claim_fence_sha256 = p_fence AND lease_epoch = p_epoch
    AND state = 'DISPATCH_INTENT';
  IF NOT FOUND THEN RAISE EXCEPTION 'disposable task v2 quarantine compare-and-swap conflict'; END IF;
  PERFORM sandboxes_disposable_task_journal.append_event_v2(p_sequence, p_prior,
    p_frontier, 'QUARANTINED', p_dispatch_id, p_intent, p_record, p_record_sha,
    p_anchor, p_anchor_sha);
  RETURN 1;
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.mark_dispatched_intent_v2(
  p_dispatch_id text, p_intent text, p_prepare_anchor text, p_effect text,
  p_intent_anchor text, p_receipt text, p_fence text, p_epoch bigint,
  p_expected_state text, p_fingerprint text, p_scope text,
  p_sequence bigint, p_prior text, p_frontier text, p_record bytea,
  p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_state text; stored_prepare text; stored_effect text;
  stored_intent_anchor text; stored_receipt text; stored_scope text;
  stored_fingerprint text; stored_dispatch_anchor text; stored_allocation text;
  current_expiry timestamptz;
BEGIN
  SELECT state, sandbox_prepare_anchor_sha256, effect_claim_sha256,
    dispatch_intent_anchor_sha256, authorization_consumption_receipt_sha256,
    provider_metadata_scope_sha256, provider_fingerprint_sha256,
    provider_dispatch_anchor_sha256, provider_allocation_sha256, lease_expires_at
  INTO current_state, stored_prepare, stored_effect, stored_intent_anchor,
    stored_receipt, stored_scope, stored_fingerprint, stored_dispatch_anchor,
    stored_allocation, current_expiry
  FROM sandboxes_disposable_task_journal.tasks_v2
  WHERE dispatch_id = p_dispatch_id AND canonical_intent_sha256 = p_intent
    AND claim_fence_sha256 = p_fence AND lease_epoch = p_epoch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale disposable task v2 claim'; END IF;
  IF stored_prepare <> p_prepare_anchor OR stored_effect <> p_effect
    OR stored_intent_anchor <> p_intent_anchor OR stored_receipt <> p_receipt
    OR stored_scope <> p_scope THEN
    RAISE EXCEPTION 'disposable task v2 dispatch binding conflict';
  END IF;
  IF current_state IN ('DISPATCHED', 'RESULT_PERSISTED') THEN
    IF stored_fingerprint = p_fingerprint AND stored_dispatch_anchor IS NOT NULL
      AND stored_allocation IS NOT NULL THEN RETURN 0; END IF;
    RAISE EXCEPTION 'disposable task v2 provider fingerprint conflict';
  END IF;
  IF p_expected_state <> 'DISPATCH_INTENT' OR current_state <> p_expected_state THEN
    RAISE EXCEPTION 'invalid disposable task v2 transition';
  END IF;
  IF current_expiry <= clock_timestamp() THEN RAISE EXCEPTION 'stale disposable task v2 claim'; END IF;
  IF p_fingerprint !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'disposable task v2 provider fingerprint conflict';
  END IF;
  UPDATE sandboxes_disposable_task_journal.tasks_v2 SET state = 'DISPATCHED',
    provider_fingerprint_sha256 = p_fingerprint,
    provider_dispatch_anchor_sha256 = p_anchor_sha,
    provider_allocation_sha256 = p_record_sha, updated_at = clock_timestamp()
  WHERE dispatch_id = p_dispatch_id AND canonical_intent_sha256 = p_intent
    AND claim_fence_sha256 = p_fence AND lease_epoch = p_epoch
    AND state = p_expected_state;
  IF NOT FOUND THEN RAISE EXCEPTION 'disposable task v2 dispatch compare-and-swap conflict'; END IF;
  PERFORM sandboxes_disposable_task_journal.append_event_v2(p_sequence, p_prior,
    p_frontier, 'DISPATCHED', p_dispatch_id, p_intent, p_record, p_record_sha,
    p_anchor, p_anchor_sha);
  RETURN 1;
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.mark_result_persisted_intent_v2(
  p_dispatch_id text, p_intent text, p_prepare_anchor text, p_effect text,
  p_intent_anchor text, p_receipt text, p_fence text, p_epoch bigint,
  p_expected_state text, p_fingerprint text, p_dispatch_anchor text,
  p_allocation text, p_result text, p_handoff text,
  p_sequence bigint, p_prior text, p_frontier text, p_record bytea,
  p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_state text; stored_prepare text; stored_effect text;
  stored_intent_anchor text; stored_receipt text; stored_fingerprint text;
  stored_dispatch_anchor text; stored_allocation text; old_result text; old_handoff text;
  old_result_anchor text; current_expiry timestamptz;
BEGIN
  SELECT state, sandbox_prepare_anchor_sha256, effect_claim_sha256,
    dispatch_intent_anchor_sha256, authorization_consumption_receipt_sha256,
    provider_fingerprint_sha256, provider_dispatch_anchor_sha256,
    provider_allocation_sha256, result_bundle_sha256,
    checkpoint_handoff_sha256, result_persisted_anchor_sha256, lease_expires_at
  INTO current_state, stored_prepare, stored_effect, stored_intent_anchor,
    stored_receipt, stored_fingerprint, stored_dispatch_anchor, stored_allocation, old_result,
    old_handoff, old_result_anchor, current_expiry
  FROM sandboxes_disposable_task_journal.tasks_v2
  WHERE dispatch_id = p_dispatch_id AND canonical_intent_sha256 = p_intent
    AND claim_fence_sha256 = p_fence AND lease_epoch = p_epoch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale disposable task v2 claim'; END IF;
  IF stored_prepare <> p_prepare_anchor OR stored_effect <> p_effect
    OR stored_intent_anchor <> p_intent_anchor OR stored_receipt <> p_receipt
    OR stored_fingerprint <> p_fingerprint OR stored_dispatch_anchor <> p_dispatch_anchor
    OR stored_allocation <> p_allocation THEN
    RAISE EXCEPTION 'disposable task v2 persisted result binding conflict';
  END IF;
  IF current_state = 'RESULT_PERSISTED' THEN
    IF old_result = p_result AND old_handoff = p_handoff
      AND old_result_anchor IS NOT NULL THEN RETURN 0; END IF;
    RAISE EXCEPTION 'disposable task v2 durable result conflict';
  END IF;
  IF p_expected_state <> 'DISPATCHED' OR current_state <> p_expected_state THEN
    RAISE EXCEPTION 'invalid disposable task v2 transition';
  END IF;
  IF current_expiry <= clock_timestamp() THEN RAISE EXCEPTION 'stale disposable task v2 claim'; END IF;
  UPDATE sandboxes_disposable_task_journal.tasks_v2 SET state = 'RESULT_PERSISTED',
    result_bundle_sha256 = p_result, checkpoint_handoff_sha256 = p_handoff,
    result_persisted_anchor_sha256 = p_anchor_sha, updated_at = clock_timestamp()
  WHERE dispatch_id = p_dispatch_id AND canonical_intent_sha256 = p_intent
    AND claim_fence_sha256 = p_fence AND lease_epoch = p_epoch
    AND state = p_expected_state;
  IF NOT FOUND THEN RAISE EXCEPTION 'disposable task v2 result compare-and-swap conflict'; END IF;
  PERFORM sandboxes_disposable_task_journal.append_event_v2(p_sequence, p_prior,
    p_frontier, 'RESULT_PERSISTED', p_dispatch_id, p_intent, p_record,
    p_record_sha, p_anchor, p_anchor_sha);
  RETURN 1;
END;
$$;

REVOKE ALL ON FUNCTION
  sandboxes_disposable_task_journal.takeover_claim_v2(text,text,text,text,text,bigint,text,text,text,timestamptz,bigint,text,text,bytea,text,bytea,text),
  sandboxes_disposable_task_journal.quarantine_authorization_v2(text,text,text,text,text,bigint,text,text,bigint,text,text,bytea,text,bytea,text),
  sandboxes_disposable_task_journal.mark_dispatched_intent_v2(text,text,text,text,text,text,text,bigint,text,text,text,bigint,text,text,bytea,text,bytea,text),
  sandboxes_disposable_task_journal.mark_result_persisted_intent_v2(text,text,text,text,text,text,text,bigint,text,text,text,text,text,text,bigint,text,text,bytea,text,bytea,text)
FROM PUBLIC;
