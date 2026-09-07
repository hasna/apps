# Account-backed CLI domain setup

`domain add`, `domains add`, `domain adopt`, and `aws setup-inbound` use the
saved Emails account URL and credential. AWS identity, provider secrets, buckets,
and receipt rules are owned by the service. These commands do not change local
mail/source configuration or create a client mail database.

Inbound defaults come from registered active S3 sources in the account. Bucket,
region, prefix, and provider options filter that registry; ambiguous selection
requires explicit selectors. A source may omit provider metadata if the service's
authoritative ingest binding supplies it. The setup endpoint validates the exact
tenant/domain/source/provider/cloud binding before mutation. Register the source
and configure the service binding first. No local bucket default is required.

Domain add/adopt uses the provider connection API, then the SES setup API when
inbound is requested. An incomplete or failed later step returns a nonzero exit
status while preserving the earlier connection and any partial setup receipt.
A verified sending connection is not a promise that DNS, receiving, or delivery
has been verified. `adopt --sync` performs a bounded initial sync through the
existing authenticated ingestion API, retaining counts and continuation state.

`--send-only` / `--no-inbound` skips source selection and inbound setup. Sandbox
send-only domains remain valid API registry rows, explicitly marked
`registration_only`, `provider_contacted: false`, and `receiving_configured: false`.
They do not invoke provider connection APIs. Dry-run performs registry reads and
reports a plan; it does not claim that the server's private binding was checked.

`aws status` and `domain readiness` report account registry observations, timestamps,
and explicit unknown live AWS/receiving readiness. They do not use the machine's
AWS profile and do not fabricate an active receipt rule set. Global `--profile`
continues to select saved Emails account credentials. Legacy domain-type labels
are hidden compatibility inputs; non-account labels are rejected before writes.
Subdomain catch-all and MX ownership switching are separate authorization scopes:
use the explicit DNS setup operation for `--force-mx-switch`. Domain-specific
alias targets requested by `adopt --catch-all <target>` remain supported.
