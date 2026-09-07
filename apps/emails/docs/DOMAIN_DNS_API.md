# Registered domain DNS records

`emails domain dns <domain> --provider <id>` and MCP `get_dns_records` read
`GET /v1/domains/{id}/dns-records`. The account read permission is required.
The API resolves the registered domain's provider using server-held credentials;
clients do not need AWS or Resend credentials. An explicit provider must match
the registered domain. Ambiguous domain names require a provider selector.

The result contains fresh provider records, a recommended DMARC record, the
provider's sending-verification state, and a check timestamp. Reading records
does not publish DNS, register a domain, or prove that every record is deployed.
Use `emails domain verify` or MCP `verify_domain` for the existing provider-backed
verification operation. DNS reads return a bounded failure if the provider is
unavailable, and recheck the domain/provider association before returning data.

For an unregistered domain with no selected provider, the existing generic SPF
and DMARC advice remains available. Non-publishing providers explicitly report
that they do not require their own records. A registered publishing provider
requires the DNS-read API capability; an older server is reported as an error
instead of suggesting that users put provider secrets on their machine.

MCP `setup_domain_for_email` uses the owned-domain setup API. MCP
`setup_cloudflare_dns` uses the Cloudflare setup API, preserving optional MX,
custom MX, registration, and explicit MX-switch choices. Both return the actual
DNS job receipt and report blocked or still-processing jobs as incomplete.
They require the same operator authority and preconfigured server bindings as
the corresponding CLI operations. Purchase contacts/durations and inline
Cloudflare tokens are rejected before submitting a setup request; purchases
belong to the separate registrar workflow and provider secrets stay server-side.
