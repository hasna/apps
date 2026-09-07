# Connect an already-owned domain

`emails domain connect` and `emails domains connect` use the authenticated Emails
API to register an already-owned domain with its configured mail provider and
record DNS publication tasks in the shared registry. A tenant operator with write
permission must run the command. Provider credentials stay on the server.

```bash
emails domain connect example.com --provider <id> --dry-run
emails domains connect example.com --provider <id> --dns-provider cloudflare
emails domain connect example.com --provider <id> --no-register-provider
```

`--dns-provider` accepts `manual`, `cloudflare`, or `route53` as a label for the
operator's DNS publication work. Connect never publishes DNS, changes inbound MX,
purchases a domain, or sets up cloud infrastructure. Review the returned records
and merge SPF changes with any existing policy instead of adding competing SPF
records. Receiving and tracking records returned by a provider are excluded from
this sending-domain workflow.

The provider must be active, registered in the same account, and backed by a
matching server SES or Resend binding. An existing domain bound to another
provider must be transferred explicitly first. Connect never reads provider
credentials from the client and never creates a local database. The formerly
nonfunctional `--domain-type` option is removed from these two commands; there
is one shared API registry.

Dry-run resolves account references and server capabilities without provider
calls or writes. Normal connection first reads the provider's domain registry;
it registers a missing domain only when registration is enabled. Resend discovery
reads every page. Provider failures are distinct from authoritative absence, so
an unavailable registry cannot trigger registration by mistake.

The response contains a connection ID, DNS tasks with MX priorities where needed,
and the provider's observed sending-verification status. Pending verification is
not ready mail delivery. New domain rows remain unverified and pending until the
explicit `domain verify` / enable operations establish the relevant capabilities.
Connect preserves an existing domain's readiness and inbound routing. Empty or
malformed DNS evidence produces a blocked receipt without publication tasks.
Custom DKIM setups that supply no usable provider DKIM records require operator
review in the provider console before retrying.

Connection attempts are serialized by account/provider/domain. Inflight inputs
remain frozen, and an expiring lease fences stale registry writes. Repeating
connect refreshes evidence, reads the provider before another registration, and
updates the durable receipt. A provider-side registration cannot be rolled back
by a later database failure; a blocked receipt says so, and retry reconciles it
before attempting creation again. Registry changes, DNS tasks, and the audit
event commit together. No background worker is required for connect.

API routes are `POST /v1/domains/connect` and
`GET /v1/domain-connections/{id}`. The latter requires tenant operator read
permission and can inspect blocked or processing attempts from another client.
SDK methods are `connectDomain` and `getDomainConnection`; library helpers are
`connectDomain` and `inspectDomainConnection`.
