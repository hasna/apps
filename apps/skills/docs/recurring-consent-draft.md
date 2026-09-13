# Recurring consent draft v1

This SDK slice defines wire shapes for review. It does not implement recurring
spending, activation, a scheduler or a new HTTP route. Parsing a request or matching
a hash never authenticates a person, grants authority or reserves credits.

Terms bind deployment, tenant, approving user, immutable schedule revision,
canonical skill/version, runtime policy and the input/argument hash. They require
all credit and occurrence limits, lifetime, cadence and revocation semantics.
No limit, skill eligibility, approval freshness or service-policy default is
chosen. The draft proposes whole-hour UTC intervals, UTC calendar days without
rollover, and revocation that stops new execution attempts while already
authorized attempts may settle existing reservations. Those choices still need
product review before the feature is offered or enabled.

`recurringConsentTermsHash` parses strict terms and hashes UTF-8 bytes of
`skills:recurring-consent:terms:v1\n` followed by the existing canonical JSON
serializer's output. Every field participates. Object key order is canonical;
arrays, strings and canonical millisecond UTC instants retain their exact values.
Unknown fields, coercion, omitted fields and noncanonical timestamps are refused.
The input/argument hash must be computed and bound by the server from retained
validated input; accepting a supplied hash does not prove its preimage or owner.

Credit quantities use the existing reservation/store wire range, integers from
0 through 2147483647. This is representation compatibility, not an offered
spending allowance. The same upper bound on counts, cadence and grace is an
explicit draft wire bound; it does not set production policy. Zero-credit grants
still require positive occurrence limits. Credit caps remain independent: a
per-run cap larger than a total cap does not raise the total cap. Admission must
check every bound, pending plus settled exposure and account availability in one
transaction, using checked wide arithmetic. This module performs no allocation.

Preview validation checks the terms hash, finite approval deadline, exact
half-open UTC days, and ordered, unique due slots anchored inside the lifetime.
The draft slot list is illustrative and may include slots before preview creation
or approval expiry. Successful parsing does not promise future dispatch or permit
backlog replay. The eventual service must choose upcoming slots and enforce its
database-clock, missed-slot and grace rules at activation/admission; this schema
does not infer those authorization decisions from caller-supplied timestamps.
Its 100-slot bound limits response size; it neither schedules 100 occurrences nor
defines production cadence, lifetime or count policy. The quote is an observation,
not a future price lock. Policy must independently restrict grace, cadence,
lifetime, count, skills, current time and approval/quote freshness.

An activation request includes an affirmative recurring-spend acceptance and
opaque challenge/assertion references. Neither a true boolean nor well-formed
references authorize activation. The service must resolve them against a fresh,
non-impersonated owner/admin customer session; bind tenant/user/deployment/draft
and terms; recheck current price and authority; enforce expiry and single use;
and commit activation, idempotency and audit atomically. API keys cannot activate,
renew or raise consent. JWT issuance time alone is not fresh human approval.

Remaining work includes preview request/input handling and response operations,
older-server refusal, real human approval handoff, durable tenant-constrained
records, budget/ledger transactions, execution fences, revocation reconciliation,
bounded database-clock polling and installed customer-surface acceptance. No
existing local cron flag, one-shot approval, subscription or API key is upgraded
to recurring authority by this draft. Applications must keep the capability
disabled until the complete implementation and its release gates are accepted.
