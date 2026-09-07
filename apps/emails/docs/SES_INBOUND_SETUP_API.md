# SES inbound setup through the account API

MCP `setup_ses_inbound` calls `POST /v1/inbox/setup-ses-inbound`. The caller must
be a tenant owner/admin or use an operator API key (`emails:*`). Ordinary write
keys cannot configure cloud resources. The client sends domain, bucket and any
explicit region/prefix/catch-all selector; it does not use local AWS credentials.

An operator must configure one matching `EMAILS_INGEST_BINDINGS` row with tenant,
source, SES provider, domain, bucket, prefix, region, queue URL, receipt rule set,
and receipt rule name. The queue URL pins the AWS account and region; setup does
not create or consume a queue. The server confirms its STS identity before any
mutation. The registered domain/provider and active S3 source must match that
binding. Explicit client selectors must match it exactly.

Setup creates the bound bucket if absent, blocks public access on new buckets,
adds a narrowly scoped SES write grant while preserving other policy statements,
and creates the bound receipt rule/set if absent. Existing buckets must already
block public access. Conflicting policy grants, Deny policies, different active
rule sets, incompatible rules and earlier blocking receipt actions require
operator review instead of being overwritten. If no receipt rule set is active,
the explicitly bound set is activated only if its enabled rules are restricted to
the bound domain. Disabled unrelated rules remain disabled. The rule inventory is
compared again immediately before activation. Tenant/operator authorization and
the current server binding are checked again before each mutation. Existing unrelated rule actions remain
unchanged. Policy/rule updates use AWS read/modify/write operations, so operators
must avoid concurrent out-of-band changes; conflicting readback fails verification.

The result reports `ok`, `verified`, confirmed `changed` steps, `attempted` steps,
and `changes_may_have_applied`. A timeout after an AWS mutation can leave a change
applied even without a successful response. Inspect and retry the same binding;
no rollback or successful completion is fabricated. `worker_started` and
`delivery_tested` are always false. Start the existing ingest worker separately.

`catch_all: true` is rejected before writes: the current binding authorizes one
exact domain, not arbitrary subdomains. Subdomain routing needs a separately
reviewed authorization contract. This API does not purchase domains, publish MX,
wire SNS/SQS notifications, or change the deployment's AWS authority.
