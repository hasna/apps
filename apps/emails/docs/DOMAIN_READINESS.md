# Domain readiness

Ordinary Emails CLI, terminal UI, and MCP operations are authenticated clients
of the selected `/v1` authority. The standalone `emails-serve` process owns the
server backend: `EMAILS_DATABASE_URL` selects operator PostgreSQL, while an unset
value retains the loopback SQLite dashboard. Provider integrations are
capabilities, not deployment modes.

AWS SES/S3/SNS/SQS, Route53, Cloudflare, and Resend use operator-supplied
credentials and server-side bindings. A sending domain is ready only after
ownership, DKIM, SPF, and provider evidence is valid. Inbound readiness also
requires an active route and a durable source such as SES to S3/SQS.

## Inspection and mutation commands

```bash
emails domain dns example.com --provider <provider>
emails domain check example.com
emails domain readiness example.com
emails domain connect example.com --provider <provider>
emails domain setup-cloudflare example.com
emails address provision user@example.com
emails provision up example.com
```

`domain dns` prints the desired records. `domain check` reads public DNS.
`domain connect`, `setup-cloudflare`, `address provision`, and `provision up`
use authenticated server capabilities and durable receipts; they refuse before
claiming success when the server is too old, a provider binding is absent, or
publication/verification remains incomplete. Existing MX is preserved unless an
explicit inbound change is requested. `domain buy` is an explicit registrar
purchase, and `domain adopt` refuses to replace a foreign root MX unless
`--force-mx-switch` is supplied.

Hosted API clients configure `HASNA_EMAILS_API_URL` and one of
`EMAILS_SESSION_TOKEN`, `EMAILS_IDP_TOKEN`, or `HASNA_EMAILS_API_KEY`. The
retired `EMAILS_SELF_HOSTED_URL` / `EMAILS_SELF_HOSTED_API_KEY` client aliases
are refused by name. No endpoint, account, database, bucket, or secret path is
supplied by the package.
