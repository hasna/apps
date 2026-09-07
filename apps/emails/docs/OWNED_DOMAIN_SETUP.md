# Setup for an already-owned domain

`emails domain setup example.com --provider <id>` configures the mail provider
and DNS for an already-owned domain using authenticated Emails API operations.
The server requires an exact tenant/provider/domain Cloudflare zone binding and
server-held mail-provider credentials. It checks the bound zone identity before
writes. No local database, client AWS profile or registrant contact is required.

The old command advertised purchase, Route53 zone creation and mail setup, but
its implementation always refused. That advertised purchase flow has been
removed. `--skip-buy` remains an optional compatibility spelling; setup never
buys a domain, creates a registrar portfolio row as ownership proof, creates a
hosted zone or changes nameservers. Purchase/registrant arguments are hidden
compatibility options that fail before API access without echoing their values.
Review `domains route53 buy --help` for the separate registrar workflow; Emails
does not invoke it or pass it credentials/contact information.

SES setup can register the domain identity in the bound provider account. Resend
setup requires an existing account-visible domain identity: it will not submit
registration, since an ambiguous registration retry cannot currently be made
safe through the available upstream contract. Missing identities return a
blocked receipt before any DNS publication. No sending or inbox delivery is
claimed merely because a provider domain or a DNS record exists.

Root MX is preserved by default. `--mx` requests only the inbound endpoint
explicitly configured in the server binding; replacing an existing root MX also
requires `--force-mx-switch`. Use `--dry-run` for a binding-only plan without
provider calls or writes. A real run uses the durable domain DNS job, lease and
binding guards. Repeat the same setup to resume or inspect its ID with
`emails domain dns-job <id>`. Ambiguous DNS acceptance requires readback of the
original plan before further mutations.

`--wait --timeout 600` waits for sending verification, up to 900 seconds. A
pending, blocked or processing receipt is printed and exits unsuccessfully;
only a valid dry-run plan or confirmed DNS publication plus provider sending
verification reports success. This does not provision an inbox worker or prove
roundtrip mail delivery.

The generated SDK method `setupOwnedDomain` calls operator-only
`POST /v1/domains/setup`. Its contract contains domain/provider and DNS options,
not purchase or registrant fields. Existing provider-connection and DNS receipts
remain the source of progress; no second orchestration database is introduced.
