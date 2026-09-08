/** Migration 16: delivery evidence for newly captured, corpus-bound intents only. */
export const EVENTS_OUTBOX_PG_MIGRATION = `
  ALTER TABLE message_redaction_audit ADD COLUMN IF NOT EXISTS events_reconciliation_json TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE conversations_event_outbox DROP CONSTRAINT IF EXISTS conversations_event_outbox_status_check;
  ALTER TABLE conversations_event_outbox ADD CONSTRAINT conversations_event_outbox_status_check
    CHECK(status IN ('pending','spooled','delivered','dead','accepted','quarantined'));

  CREATE TABLE IF NOT EXISTS conversations_event_deliveries (
    outbox_id TEXT PRIMARY KEY REFERENCES conversations_event_outbox(id),
    tenant_id TEXT NOT NULL,
    corpus_id TEXT NOT NULL,
    authority_id TEXT NOT NULL,
    envelope_sha256 TEXT NOT NULL CHECK(envelope_sha256 ~ '^[a-f0-9]{64}$'),
    dedupe_key TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','leased','retryable','accepted','quarantined')),
    sink_id UUID,
    producer_id UUID,
    sink_url TEXT,
    generation BIGINT NOT NULL DEFAULT 0 CHECK(generation >= 0),
    lease_token UUID,
    lease_until TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    external_may_exist BOOLEAN NOT NULL DEFAULT FALSE,
    reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE,
    receipt JSONB,
    error_code TEXT CHECK(error_code IN ('invalid_envelope','source_changed','payload_redacted','sink_changed','unconfirmed_intake','intake_refused')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK((sink_id IS NULL AND producer_id IS NULL AND sink_url IS NULL)
      OR (sink_id IS NOT NULL AND producer_id IS NOT NULL AND sink_url IS NOT NULL)),
    CHECK((state='leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
      OR (state<>'leased' AND lease_token IS NULL AND lease_until IS NULL)),
    CHECK(state<>'accepted' OR receipt IS NOT NULL)
  );
  CREATE INDEX IF NOT EXISTS conversations_event_deliveries_pending
    ON conversations_event_deliveries(state,next_attempt_at,created_at);
  ALTER TABLE conversations_event_deliveries ENABLE ROW LEVEL SECURITY;
  ALTER TABLE conversations_event_deliveries FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS conversations_event_deliveries_corpus ON conversations_event_deliveries;
  CREATE POLICY conversations_event_deliveries_corpus ON conversations_event_deliveries
    USING(EXISTS(SELECT 1 FROM conversations_corpus_binding b WHERE b.singleton
      AND b.tenant_id=conversations_event_deliveries.tenant_id
      AND b.corpus_id=conversations_event_deliveries.corpus_id
      AND b.authority_id=conversations_event_deliveries.authority_id))
    WITH CHECK(EXISTS(SELECT 1 FROM conversations_corpus_binding b WHERE b.singleton
      AND b.tenant_id=conversations_event_deliveries.tenant_id
      AND b.corpus_id=conversations_event_deliveries.corpus_id
      AND b.authority_id=conversations_event_deliveries.authority_id));
  REVOKE ALL ON conversations_event_deliveries FROM PUBLIC;

  CREATE OR REPLACE FUNCTION conversations_guard_event_delivery() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
  BEGIN
    IF TG_OP='DELETE' OR TG_OP='TRUNCATE' THEN
      RAISE EXCEPTION 'event delivery evidence cannot be deleted';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.outbox_id,NEW.tenant_id,NEW.corpus_id,NEW.authority_id,NEW.envelope_sha256,NEW.dedupe_key)
      IS DISTINCT FROM (OLD.outbox_id,OLD.tenant_id,OLD.corpus_id,OLD.authority_id,OLD.envelope_sha256,OLD.dedupe_key) THEN
      RAISE EXCEPTION 'event source intent is immutable';
    END IF;
    IF TG_OP='UPDATE' AND OLD.sink_id IS NOT NULL AND (NEW.sink_id,NEW.producer_id,NEW.sink_url)
      IS DISTINCT FROM (OLD.sink_id,OLD.producer_id,OLD.sink_url) THEN
      RAISE EXCEPTION 'event destination intent is immutable';
    END IF;
    IF TG_OP='UPDATE' AND OLD.receipt IS NOT NULL AND NEW.receipt IS DISTINCT FROM OLD.receipt THEN
      RAISE EXCEPTION 'event acceptance evidence is immutable';
    END IF;
    IF TG_OP='UPDATE' AND (OLD.external_may_exist AND NOT NEW.external_may_exist
      OR OLD.reconciliation_required AND NOT NEW.reconciliation_required) THEN
      RAISE EXCEPTION 'external event evidence cannot be cleared';
    END IF;
    RETURN NEW;
  END; $$;
  DROP TRIGGER IF EXISTS conversations_event_delivery_guard ON conversations_event_deliveries;
  CREATE TRIGGER conversations_event_delivery_guard BEFORE UPDATE OR DELETE ON conversations_event_deliveries
    FOR EACH ROW EXECUTE FUNCTION conversations_guard_event_delivery();
  DROP TRIGGER IF EXISTS conversations_event_delivery_no_truncate ON conversations_event_deliveries;
  CREATE TRIGGER conversations_event_delivery_no_truncate BEFORE TRUNCATE ON conversations_event_deliveries
    FOR EACH STATEMENT EXECUTE FUNCTION conversations_guard_event_delivery();

  CREATE OR REPLACE FUNCTION conversations_invalidate_event_delivery() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
  BEGIN
    IF (NEW.id,NEW.source,NEW.type) IS DISTINCT FROM (OLD.id,OLD.source,OLD.type)
      AND EXISTS(SELECT 1 FROM conversations_event_deliveries WHERE outbox_id=OLD.id) THEN
      RAISE EXCEPTION 'bound event source identity is immutable';
    END IF;
    IF NEW.envelope_json IS DISTINCT FROM OLD.envelope_json THEN
      UPDATE conversations_event_deliveries SET state='quarantined',generation=generation+1,
        lease_token=NULL,lease_until=NULL,error_code='payload_redacted',
        reconciliation_required=reconciliation_required OR external_may_exist OR receipt IS NOT NULL,
        updated_at=clock_timestamp() WHERE outbox_id=OLD.id;
      IF FOUND THEN NEW.status='quarantined'; END IF;
    END IF;
    RETURN NEW;
  END; $$;
  DROP TRIGGER IF EXISTS conversations_event_delivery_invalidation ON conversations_event_outbox;
  CREATE TRIGGER conversations_event_delivery_invalidation BEFORE UPDATE OF envelope_json,id,source,type ON conversations_event_outbox
    FOR EACH ROW EXECUTE FUNCTION conversations_invalidate_event_delivery();
  -- Historical rows have no frozen ownership proof; migration never adopts them.
  INSERT INTO _migrations(id) VALUES(16) ON CONFLICT DO NOTHING;
`;
