# Domain purchase + Cloudflare DNS delegation (open-domains)

Automated domain acquisition with DNS managed by the configured DNS provider.
Cloudflare is the default example, but Route 53 DNS and other provider adapters
can be selected where supported.

## Flow: `domains domain buy <name> --wait --dns cloudflare`
1. **Check availability** + price (`r53CheckAvailability`, Route53).
2. **Register** (`r53RegisterDomain`) with the configured registrant contact; poll
   the operation to terminal (`pollRegistrationUntilDone`).
3. **Create/reuse Cloudflare zone** (`cfEnsureZone`) → read its assigned nameservers.
4. **Delegate** the registrar's NS to Cloudflare (`r53UpdateNameservers` via
   `delegateDomainToCloudflare`). DNS is now authoritative in Cloudflare.

## Provider capability matrix (2026)
| Provider | Buy | DNS | Gated | Notes |
|---|---|---|---|---|
| **route53** | ✅ | ✅ | no | Primary buy — full self-serve API, no volume gate. |
| **cloudflare** | — | ✅ | no | DNS only; common default DNS provider. |
| **namecheap** | ✅ | ✅ | no | Requires API access + whitelisted IP. |
| **godaddy** | — | ⚠️ | yes | Availability remains threshold-gated; DNS/domain management is available for qualifying accounts; no direct CLI purchase adapter. |
| **brandsight** | ⚠️ | ✅ | yes | GoDaddy Corporate Domains — enterprise-contract-only; portfolio, registration, renewal, nameserver, and DNS operations use the official v2 API when the account contract permits them. |
| **sedo** | recorded only | — | yes | Marketplace/listing API. Purchases are recorded in the portfolio; Sedo is not registrar DNS in this CLI. |

`selectBuyRegistrar()` defaults to route53 and refuses gated providers;
`selectDnsProvider()` defaults to cloudflare but accepts an explicit non-gated
DNS provider preference.

`domains domain buy` also gates non-Route53 registrar purchases through the
capability matrix. Gated/contract-only registrars require `--allow-gated`, and
unsupported registrars should be recorded with `--price` instead of attempting a
direct automated registration.

## DNS Delegation Rule
For portfolios that choose Cloudflare DNS, `reconcileNsDrift` sweeps the
portfolio, flags any domain whose registrar NS are not Cloudflare, and (with
`fix:true`) re-delegates to the zone's Cloudflare NS.

## Desired DNS State
`domains dns plan|diff|apply <domain> --provider <provider> --file state.json`
uses a shared operation model:

```json
{
  "domain": "example.com",
  "records": [
    { "type": "A", "name": "@", "value": "192.0.2.10", "ttl": 300 },
    { "type": "TXT", "name": "@", "value": "v=spf1 -all", "ttl": 300 }
  ]
}
```

`apply` requires `--yes`. If desired state omits live records, the delete plan is
blocked unless `--allow-delete` is present. Even with `--allow-delete`, provider
paths that cannot guarantee delete convergence without partial mutation are
refused before any write. Non-delete applies read live records again after
provider writes and fail if the provider did not converge to the desired state.

## Optional CLI Groups
The OSS default CLI loads core portfolio, DNS, provider, doctor, MCP, server, and
Route 53 commands. Heavier surfaces are opt-in:

```bash
domains extras
DOMAINS_COMMAND_GROUPS=marketplace,storage domains --help
DOMAINS_ENABLE_EXTRAS=1 domains --help
```

Optional groups include Brandsight monitoring, Sedo marketplace, storage sync,
events, owner/history/research/outreach workflows, provisioning daemon helpers,
wallet, and the interactive TUI.

## Provisioning lifecycle + status
State machine: `requested → registered → cf_zone_ready → ns_delegated →
ns_propagated → dns_managed → ready`. `domains provision status <name>` derives the
current state live (registration, zone, registrar NS, public NS, zone active). The
domain daemon (`reconcileDomainTick` / `runDomainDaemon`) advances domains
transition-by-transition.

## Credentials (`domains doctor`)
- **Route53**: `AWS_PROFILE` or `AWS_ACCESS_KEY_ID`/`SECRET` (region us-east-1).
- **Cloudflare**: `CLOUDFLARE_API_TOKEN` *or* `CLOUDFLARE_API_KEY`+`CLOUDFLARE_EMAIL`
  + `CLOUDFLARE_ACCOUNT_ID` to create zones.
- **Brandsight/GoDaddy**: detected but gated.

## Integration contract
`@hasna/domains` exports: `r53CheckAvailability`, `r53RegisterDomain`,
`r53GetRegistrationStatus`, `r53UpdateNameservers`, `cfCreateZone`/`cfGetZone`/
`cfEnsureZone`, `delegateDomainToCloudflare`, `selectBuyRegistrar`/`selectDnsProvider`/
`canBuy`, `classifyRegistrationStatus`/`pollRegistrationUntilDone`.
