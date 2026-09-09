# Domain DNS publication through the account API

`emails domain setup-cloudflare <domain> --provider <id>` publishes the registered mail provider's sending DNS records in an existing, active Cloudflare zone. `emails provision domain <domain> --provider <id>` also registers the SES identity when needed and configures its MAIL FROM subdomain (default `mail.<domain>`). Both commands require a tenant operator and keep credentials and durable jobs on the server.

The operator must configure `EMAILS_DNS_BINDINGS` on the service. Its JSON array contains exact `tenant_id`, `provider_id`, `domain`, `zone_id`, `zone_name` and `token_env` references. `token_env` names the server environment entry holding the Cloudflare token; it is not the token value. The token needs DNS edit and zone read access to the specific zone. Cross-tenant overlapping zones or domain authority are refused. Provider credentials use the existing server mail-provider binding. These commands do not accept a client Cloudflare token.

Examples:

```sh
emails domain setup-cloudflare example.com --provider provider-id --dry-run
emails domain setup-cloudflare example.com --provider provider-id --register-ses
emails provision domain example.com --provider provider-id --mail-from mail --wait --timeout 600
emails domain dns-job job-id --json
```

Dry-run resolves account references and server bindings without provider calls, job creation or writes. Execution reads the complete DNS inventory and provider evidence before creating missing records. Existing records are preserved; conflicting SPF, DKIM, CNAME or MAIL FROM records require explicit review. A different configured MAIL FROM domain is also refused. `--wait` polls sending verification for the bounded timeout; pending propagation or verification is reported honestly.

Root MX stays unchanged by default. Optional `--mx` on setup or `--add-mx` on provision requires `inbound_mx` in the exact server binding, matching the selected SES region. An existing incompatible root MX blocks the operation before provider mutations. `--force-mx-switch` explicitly authorizes replacing those root MX records with that bound endpoint at priority 10. Setup's `--mx-server` is an assertion of this same bound target. Publishing an MX record does not establish the receiving source, SES receipt rules, queue, address ownership or delivery readiness; use the separate address and receiver setup workflows.

Each domain has an account-shared DNS job with leased execution, a fixed request and binding fingerprint, and durable phase/plan receipts. Interrupted or ambiguous DNS batches must be confirmed in Cloudflare's inventory before another mutation is allowed. Repeating the original command reconciles that receipt. Changing the request or binding while acceptance is uncertain is refused. Configuration changes, expired leases and failed readback prevent further writes and readiness promotion. A failed final database transaction can leave successful external DNS changes; retry reconciles them without recreating records.

Cloudflare batch publication uses its [batch records API](https://developers.cloudflare.com/dns/manage-dns-records/how-to/batch-record-changes/). The provider applies the batch in one database transaction, but DNS propagation is still asynchronous. Complete inventory reads follow the provider's [pagination contract](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/), with finite page, response, task and batch bounds that fail closed when exceeded.

This workflow requires an already-owned domain and an existing Cloudflare zone. It does not purchase domains, create zones, change registrar delegation or create inbound infrastructure. SES registration and MAIL FROM configuration are supported; setup can also publish DNS for an already-registered Resend identity. Sending verification is separate from inbound routing, and publishing sending DNS does not create an inbound route or enable a disabled domain.

Provisioning uses SES `REJECT_MESSAGE` behavior for the requested MAIL FROM domain, so sending verification remains pending until SES reports that domain verified as well as the identity/DKIM checks. SES can reject delivery while its MAIL FROM status is pending or failed; see [MAIL FROM attributes](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_MailFromAttributes.html).
