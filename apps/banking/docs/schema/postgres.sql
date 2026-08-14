-- @hasna/banking production-store reference schema.
--
-- This file is a public-safe schema artifact. Production implementations should
-- run intent reservation, approval checks, provider outbox enqueue, and audit
-- append inside one SERIALIZABLE transaction. Use advisory locks keyed by
-- idempotency key or intent id before provider side effects.

create table if not exists banking_idempotency_reservations (
  key text primary key,
  payload_hash text not null,
  first_intent_id text,
  created_at timestamptz not null default now(),
  unique (key, payload_hash)
);

create table if not exists banking_intents (
  id text primary key,
  provider_id text not null,
  intent_type text not null,
  status text not null,
  idempotency_key text not null references banking_idempotency_reservations(key),
  payload_hash text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (idempotency_key, payload_hash)
    references banking_idempotency_reservations(key, payload_hash)
);

create unique index if not exists banking_intents_idempotency_payload_idx
  on banking_intents (idempotency_key, payload_hash);

create table if not exists banking_approvals (
  id text primary key,
  intent_id text not null references banking_intents(id),
  decision text not null check (decision in ('granted', 'rejected', 'expired')),
  requested_by jsonb not null,
  decided_by jsonb not null,
  intent_idempotency_key text not null,
  intent_payload_hash text not null,
  policy_snapshot jsonb not null,
  signature_ref text,
  reason text,
  expires_at timestamptz not null,
  decided_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists banking_provider_events (
  id text primary key,
  provider_id text not null,
  kind text not null,
  provider_object_id text not null,
  occurred_at timestamptz not null,
  amount jsonb,
  raw_hash text not null unique,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create table if not exists banking_reconciliation_records (
  id text primary key,
  intent_id text references banking_intents(id),
  provider_event_id text not null references banking_provider_events(id),
  status text not null check (status in ('pending', 'matched', 'mismatch', 'indeterminate')),
  reasons jsonb not null,
  checked_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists banking_audit_events (
  id text primary key,
  type text not null,
  actor jsonb not null,
  subject_id text not null,
  metadata jsonb not null,
  previous_hash text,
  hash text not null unique,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists banking_audit_subject_idx
  on banking_audit_events (subject_id, occurred_at);

create table if not exists banking_outbox_entries (
  id text primary key,
  topic text not null,
  status text not null check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists banking_outbox_pending_idx
  on banking_outbox_entries (status, created_at)
  where status = 'pending';
