CREATE TABLE sandboxes_disposable_task_journal.tasks_v2 (
  idempotency_key_sha256 text PRIMARY KEY
    CHECK (idempotency_key_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  operation_digest text NOT NULL UNIQUE
    CHECK (operation_digest ~ '^sha256:[0-9a-f]{64}$'),
  dispatch_id text NOT NULL UNIQUE CHECK (dispatch_id ~ '^dt2_[0-9a-f]{64}$'),
  canonical_intent_sha256 text NOT NULL
    CHECK (canonical_intent_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  canonical_intent_bytes bytea NOT NULL,
  source_manifest_sha256 text NOT NULL
    CHECK (source_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  input_manifest_sha256 text NOT NULL
    CHECK (input_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  checkpoint_policy_sha256 text NOT NULL
    CHECK (checkpoint_policy_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (provider IN ('e2b', 'daytona_cloud')),
  provider_metadata_scope_sha256 text NOT NULL
    CHECK (provider_metadata_scope_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  provider_creation_token_sha256 text NOT NULL
    CHECK (provider_creation_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  immutable_fingerprint_sha256 text NOT NULL
    CHECK (immutable_fingerprint_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  allocation_lease_epoch bigint NOT NULL CHECK (allocation_lease_epoch > 0),
  allocation_claim_fence_sha256 text NOT NULL
    CHECK (allocation_claim_fence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  allocation_ownership_nonce_sha256 text NOT NULL
    CHECK (allocation_ownership_nonce_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  effect_claim_sha256 text NOT NULL
    CHECK (effect_claim_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  sandbox_prepare_anchor_sha256 text NOT NULL
    CHECK (sandbox_prepare_anchor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  prepared_sha256 text NOT NULL
    CHECK (prepared_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('PREPARED', 'DISPATCH_INTENT', 'QUARANTINED')),
  lease_epoch bigint NOT NULL CHECK (lease_epoch > 0),
  claim_fence_sha256 text NOT NULL
    CHECK (claim_fence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  lease_owner_sha256 text NOT NULL
    CHECK (lease_owner_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  lease_expires_at timestamptz NOT NULL,
  ownership_nonce_sha256 text NOT NULL
    CHECK (ownership_nonce_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  canonical_consume_input_bytes bytea,
  consume_input_sha256 text
    CHECK (consume_input_sha256 IS NULL OR consume_input_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  canonical_authority_envelope_bytes bytea,
  authority_envelope_sha256 text
    CHECK (authority_envelope_sha256 IS NULL OR authority_envelope_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  canonical_authorization_receipt_bytes bytea,
  authorization_consumption_receipt_sha256 text
    CHECK (authorization_consumption_receipt_sha256 IS NULL OR
      authorization_consumption_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  dispatch_intent_anchor_sha256 text
    CHECK (dispatch_intent_anchor_sha256 IS NULL OR
      dispatch_intent_anchor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  quarantine_reason text,
  quarantine_evidence_sha256 text
    CHECK (quarantine_evidence_sha256 IS NULL OR
      quarantine_evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((canonical_consume_input_bytes IS NULL) = (consume_input_sha256 IS NULL)),
  CHECK ((canonical_authority_envelope_bytes IS NULL) = (authority_envelope_sha256 IS NULL)),
  CHECK ((canonical_authorization_receipt_bytes IS NULL) =
    (authorization_consumption_receipt_sha256 IS NULL)),
  CHECK ((consume_input_sha256 IS NULL) = (authority_envelope_sha256 IS NULL)),
  CHECK ((consume_input_sha256 IS NULL) = (authorization_consumption_receipt_sha256 IS NULL)),
  CHECK ((consume_input_sha256 IS NULL) = (dispatch_intent_anchor_sha256 IS NULL)),
  CHECK ((state = 'PREPARED') = (dispatch_intent_anchor_sha256 IS NULL)),
  CHECK ((state = 'QUARANTINED') = (quarantine_reason IS NOT NULL)),
  CHECK ((quarantine_reason IS NULL) = (quarantine_evidence_sha256 IS NULL))
);

CREATE TABLE sandboxes_disposable_task_journal.events_v2 (
  journal_sequence bigint PRIMARY KEY CHECK (journal_sequence > 0),
  prior_frontier_sha256 text CHECK (
    prior_frontier_sha256 IS NULL OR prior_frontier_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  frontier_sha256 text NOT NULL UNIQUE
    CHECK (frontier_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  record_kind text NOT NULL CHECK (record_kind IN (
    'PREPARED', 'CLAIMED', 'DISPATCH_INTENT', 'QUARANTINED'
  )),
  dispatch_id text NOT NULL CHECK (dispatch_id ~ '^dt2_[0-9a-f]{64}$'),
  canonical_intent_sha256 text NOT NULL
    CHECK (canonical_intent_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  record_bytes bytea NOT NULL,
  record_sha256 text NOT NULL CHECK (record_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signed_anchor_bytes bytea NOT NULL,
  signed_anchor_sha256 text NOT NULL UNIQUE
    CHECK (signed_anchor_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION sandboxes_disposable_task_journal.guard_task_v2_update()
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
  IF OLD.state = 'PREPARED' AND NEW.state NOT IN ('PREPARED', 'DISPATCH_INTENT') THEN
    RAISE EXCEPTION 'invalid disposable task v2 transition';
  END IF;
  IF OLD.state = 'DISPATCH_INTENT' AND NEW.state NOT IN ('DISPATCH_INTENT', 'QUARANTINED') THEN
    RAISE EXCEPTION 'invalid disposable task v2 transition';
  END IF;
  IF OLD.state = 'QUARANTINED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal disposable task v2 row is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.append_event_v2(
  p_sequence bigint, p_prior text, p_frontier text, p_kind text,
  p_dispatch_id text, p_intent text, p_record bytea, p_record_sha text,
  p_anchor bytea, p_anchor_sha text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_head bigint; current_frontier text; current_witnessed bigint;
BEGIN
  SELECT head_sequence, head_frontier_sha256, witnessed_sequence
    INTO current_head, current_frontier, current_witnessed
    FROM sandboxes_disposable_task_journal.store WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'journal store is not initialized'; END IF;
  IF current_head <> current_witnessed THEN RAISE EXCEPTION 'journal head is awaiting external witness'; END IF;
  IF p_sequence <> current_head + 1 OR p_prior IS DISTINCT FROM current_frontier THEN
    RAISE EXCEPTION 'journal frontier conflict';
  END IF;
  IF 'sha256:' || encode(public.digest(p_record, 'sha256'), 'hex') <> p_record_sha
    OR 'sha256:' || encode(public.digest(p_anchor, 'sha256'), 'hex') <> p_anchor_sha THEN
    RAISE EXCEPTION 'journal event byte digest conflict';
  END IF;
  INSERT INTO sandboxes_disposable_task_journal.events_v2
    (journal_sequence, prior_frontier_sha256, frontier_sha256, record_kind,
     dispatch_id, canonical_intent_sha256, record_bytes, record_sha256,
     signed_anchor_bytes, signed_anchor_sha256)
  VALUES (p_sequence, p_prior, p_frontier, p_kind, p_dispatch_id, p_intent,
    p_record, p_record_sha, p_anchor, p_anchor_sha);
  UPDATE sandboxes_disposable_task_journal.store
    SET head_sequence = p_sequence, head_frontier_sha256 = p_frontier WHERE singleton;
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.insert_prepared_v2(
  p_idempotency text, p_operation text, p_dispatch_id text, p_intent text,
  p_intent_bytes bytea, p_source text, p_input text, p_checkpoint text,
  p_provider text, p_scope text, p_creation text, p_fingerprint text,
  p_epoch bigint, p_fence text, p_ownership text, p_effect text,
  p_prepare_anchor text, p_prepared_sha text, p_owner text, p_expires timestamptz,
  p_sequence bigint, p_prior text, p_frontier text, p_record bytea,
  p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_prepare_anchor <> p_anchor_sha THEN
    RAISE EXCEPTION 'disposable task v2 prepare anchor conflict';
  END IF;
  INSERT INTO sandboxes_disposable_task_journal.tasks_v2
    (idempotency_key_sha256, operation_digest, dispatch_id, canonical_intent_sha256,
     canonical_intent_bytes, source_manifest_sha256, input_manifest_sha256,
     checkpoint_policy_sha256, provider, provider_metadata_scope_sha256,
     provider_creation_token_sha256, immutable_fingerprint_sha256,
     allocation_lease_epoch, allocation_claim_fence_sha256,
     allocation_ownership_nonce_sha256, effect_claim_sha256,
     sandbox_prepare_anchor_sha256, prepared_sha256, state, lease_epoch,
     claim_fence_sha256, lease_owner_sha256, lease_expires_at, ownership_nonce_sha256)
  VALUES (p_idempotency, p_operation, p_dispatch_id, p_intent, p_intent_bytes,
    p_source, p_input, p_checkpoint, p_provider, p_scope, p_creation, p_fingerprint,
    p_epoch, p_fence, p_ownership, p_effect, p_prepare_anchor, p_prepared_sha,
    'PREPARED', p_epoch, p_fence, p_owner, p_expires, p_ownership);
  PERFORM sandboxes_disposable_task_journal.append_event_v2(p_sequence, p_prior,
    p_frontier, 'PREPARED', p_dispatch_id, p_intent, p_record, p_record_sha,
    p_anchor, p_anchor_sha);
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.takeover_claim_v2(
  p_dispatch_id text, p_intent text, p_old_fence text, p_epoch bigint,
  p_fence text, p_ownership text, p_owner text, p_expires timestamptz,
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
    AND claim_fence_sha256 = p_old_fence AND lease_epoch + 1 = p_epoch
    AND lease_expires_at <= clock_timestamp()
    AND state IN ('PREPARED', 'DISPATCH_INTENT')
  RETURNING state INTO prior_state;
  IF prior_state IS NULL THEN RAISE EXCEPTION 'stale disposable task v2 takeover'; END IF;
  PERFORM sandboxes_disposable_task_journal.append_event_v2(p_sequence, p_prior,
    p_frontier, 'CLAIMED', p_dispatch_id, p_intent, p_record, p_record_sha,
    p_anchor, p_anchor_sha);
  RETURN prior_state;
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.bind_authorization_and_mark_intent_v2(
  p_dispatch_id text, p_intent text, p_prepare_anchor text, p_fence text,
  p_epoch bigint, p_effect text, p_consume bytea, p_consume_sha text,
  p_envelope bytea, p_envelope_sha text, p_receipt bytea, p_receipt_sha text,
  p_intent_anchor text, p_sequence bigint, p_prior text, p_frontier text,
  p_record bytea, p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_state text; stored_prepare_anchor text; stored_effect text;
  old_consume bytea; old_consume_sha text; old_envelope bytea; old_envelope_sha text;
  old_receipt bytea; old_receipt_sha text; old_intent_anchor text; current_expiry timestamptz;
BEGIN
  SELECT state, sandbox_prepare_anchor_sha256, effect_claim_sha256,
    canonical_consume_input_bytes, consume_input_sha256,
    canonical_authority_envelope_bytes, authority_envelope_sha256,
    canonical_authorization_receipt_bytes, authorization_consumption_receipt_sha256,
    dispatch_intent_anchor_sha256, lease_expires_at
  INTO current_state, stored_prepare_anchor, stored_effect, old_consume, old_consume_sha,
    old_envelope, old_envelope_sha, old_receipt, old_receipt_sha, old_intent_anchor, current_expiry
  FROM sandboxes_disposable_task_journal.tasks_v2
  WHERE dispatch_id = p_dispatch_id AND canonical_intent_sha256 = p_intent
    AND claim_fence_sha256 = p_fence AND lease_epoch = p_epoch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'stale disposable task v2 claim'; END IF;
  IF p_intent_anchor <> p_anchor_sha THEN
    RAISE EXCEPTION 'disposable task v2 dispatch intent anchor conflict';
  END IF;
  IF stored_prepare_anchor <> p_prepare_anchor OR stored_effect <> p_effect THEN
    RAISE EXCEPTION 'disposable task v2 immutable binding conflict';
  END IF;
  IF current_state = 'DISPATCH_INTENT' THEN
    IF old_consume = p_consume AND old_consume_sha = p_consume_sha
      AND old_envelope = p_envelope AND old_envelope_sha = p_envelope_sha
      AND old_receipt = p_receipt AND old_receipt_sha = p_receipt_sha
      AND old_intent_anchor = p_intent_anchor THEN RETURN 0; END IF;
    RAISE EXCEPTION 'disposable task v2 authorization conflict';
  END IF;
  IF current_state <> 'PREPARED' THEN RAISE EXCEPTION 'invalid disposable task v2 transition'; END IF;
  IF current_expiry <= clock_timestamp() THEN RAISE EXCEPTION 'stale disposable task v2 claim'; END IF;
  IF 'sha256:' || encode(public.digest(p_consume, 'sha256'), 'hex') <> p_consume_sha
    OR 'sha256:' || encode(public.digest(p_envelope, 'sha256'), 'hex') <> p_envelope_sha
    OR 'sha256:' || encode(public.digest(p_receipt, 'sha256'), 'hex') <> p_receipt_sha THEN
    RAISE EXCEPTION 'disposable task v2 artifact digest conflict';
  END IF;
  UPDATE sandboxes_disposable_task_journal.tasks_v2 SET state = 'DISPATCH_INTENT',
    canonical_consume_input_bytes = p_consume, consume_input_sha256 = p_consume_sha,
    canonical_authority_envelope_bytes = p_envelope, authority_envelope_sha256 = p_envelope_sha,
    canonical_authorization_receipt_bytes = p_receipt,
    authorization_consumption_receipt_sha256 = p_receipt_sha,
    dispatch_intent_anchor_sha256 = p_intent_anchor, updated_at = clock_timestamp()
  WHERE dispatch_id = p_dispatch_id;
  PERFORM sandboxes_disposable_task_journal.append_event_v2(p_sequence, p_prior,
    p_frontier, 'DISPATCH_INTENT', p_dispatch_id, p_intent, p_record, p_record_sha,
    p_anchor, p_anchor_sha);
  RETURN 1;
END;
$$;

CREATE FUNCTION sandboxes_disposable_task_journal.quarantine_authorization_v2(
  p_dispatch_id text, p_intent text, p_fence text, p_epoch bigint,
  p_reason text, p_evidence text,
  p_sequence bigint, p_prior text, p_frontier text, p_record bytea,
  p_record_sha text, p_anchor bytea, p_anchor_sha text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE current_state text; old_reason text; old_evidence text; current_expiry timestamptz;
BEGIN
  SELECT state, quarantine_reason, quarantine_evidence_sha256, lease_expires_at
    INTO current_state, old_reason, old_evidence, current_expiry
  FROM sandboxes_disposable_task_journal.tasks_v2
  WHERE dispatch_id = p_dispatch_id AND canonical_intent_sha256 = p_intent
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
    updated_at = clock_timestamp() WHERE dispatch_id = p_dispatch_id;
  PERFORM sandboxes_disposable_task_journal.append_event_v2(p_sequence, p_prior,
    p_frontier, 'QUARANTINED', p_dispatch_id, p_intent, p_record, p_record_sha,
    p_anchor, p_anchor_sha);
  RETURN 1;
END;
$$;

CREATE TRIGGER events_v2_immutable BEFORE UPDATE OR DELETE
ON sandboxes_disposable_task_journal.events_v2 FOR EACH ROW
EXECUTE FUNCTION sandboxes_disposable_task_journal.reject_mutation();

CREATE TRIGGER tasks_v2_delete_guard BEFORE DELETE
ON sandboxes_disposable_task_journal.tasks_v2 FOR EACH ROW
EXECUTE FUNCTION sandboxes_disposable_task_journal.reject_mutation();

CREATE TRIGGER tasks_v2_update_guard BEFORE UPDATE
ON sandboxes_disposable_task_journal.tasks_v2 FOR EACH ROW
EXECUTE FUNCTION sandboxes_disposable_task_journal.guard_task_v2_update();

REVOKE ALL ON sandboxes_disposable_task_journal.tasks_v2,
  sandboxes_disposable_task_journal.events_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION
  sandboxes_disposable_task_journal.guard_task_v2_update(),
  sandboxes_disposable_task_journal.append_event_v2(bigint,text,text,text,text,text,bytea,text,bytea,text),
  sandboxes_disposable_task_journal.insert_prepared_v2(text,text,text,text,bytea,text,text,text,text,text,text,text,bigint,text,text,text,text,text,text,timestamptz,bigint,text,text,bytea,text,bytea,text),
  sandboxes_disposable_task_journal.takeover_claim_v2(text,text,text,bigint,text,text,text,timestamptz,bigint,text,text,bytea,text,bytea,text),
  sandboxes_disposable_task_journal.bind_authorization_and_mark_intent_v2(text,text,text,text,bigint,text,bytea,text,bytea,text,bytea,text,text,bigint,text,text,bytea,text,bytea,text),
  sandboxes_disposable_task_journal.quarantine_authorization_v2(text,text,text,bigint,text,text,bigint,text,text,bytea,text,bytea,text)
FROM PUBLIC;
