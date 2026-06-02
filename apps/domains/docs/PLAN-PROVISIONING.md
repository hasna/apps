# Domain purchase + Cloudflare DNS delegation (open-domains)

Automated domain acquisition with **DNS always managed in Cloudflare**, regardless
of registrar.

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
| **cloudflare** | — | ✅ | no | DNS only; **always our DNS**. |
| **namecheap** | ✅ | ✅ | no | Requires API access + whitelisted IP. |
| **godaddy** | ⚠️ | ⚠️ | yes | Retail Domains API gated (≥10 / DDC) since 2024. |
| **brandsight** | ⚠️ | ⚠️ | yes | GoDaddy Corporate Domains — enterprise/contract-only. |

`selectBuyRegistrar()` defaults to route53 and refuses gated providers;
`selectDnsProvider()` is always `cloudflare`.

## Always-Cloudflare-DNS rule
Every domain's nameservers must point to Cloudflare. `reconcileNsDrift` sweeps the
portfolio, flags any domain whose registrar NS aren't Cloudflare, and (with
`fix:true`) re-delegates to the zone's Cloudflare NS.

## Provisioning lifecycle + status
State machine: `requested → registered → cf_zone_ready → ns_delegated →
ns_propagated → dns_managed → ready`. `domains provision status <name>` derives the
current state live (registration, zone, registrar NS, public NS, zone active). The
domain daemon (`reconcileDomainTick` / `runDomainDaemon`) advances domains
transition-by-transition.

## Credentials (`domains doctor`)
- **Route53**: `AWS_PROFILE` or `AWS_ACCESS_KEY_ID`/`SECRET` (region us-east-1).
- **Cloudflare**: `CLOUDFLARE_API_TOKEN` *or* `CLOUDFLARE_API_KEY`+`CLOUDFLARE_EMAIL`
  (vault: `HASNAXYZ_CLOUDFLARE_LIVE_*`) + `CLOUDFLARE_ACCOUNT_ID` to create zones.
- **Brandsight/GoDaddy**: detected but gated.

## Integration contract (consumed by open-emails)
`@hasna/domains` exports: `r53CheckAvailability`, `r53RegisterDomain`,
`r53GetRegistrationStatus`, `r53UpdateNameservers`, `cfCreateZone`/`cfGetZone`/
`cfEnsureZone`, `delegateDomainToCloudflare`, `selectBuyRegistrar`/`selectDnsProvider`/
`canBuy`, `classifyRegistrationStatus`/`pollRegistrationUntilDone`.
