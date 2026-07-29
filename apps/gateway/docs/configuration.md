# Configuration Reference

Gateway config is JSON. `loadGatewayConfig` interpolates `${ENV_VAR}` placeholders before normalization and validation; provider credentials are still read from environment variables at runtime and should not be stored directly in config.

Start with one of the checked-in `gateway.config.*.json` examples. Run `gateway validate --config <path>` after changes.

## Defaults

Omitted top-level values normalize to these local-first defaults:

```json
{
  "runtime": {
    "mode": "local",
    "serviceDiscovery": { "allowLocalProviderEndpoints": true },
    "health": { "requireRuntimeSecrets": false }
  },
  "server": {
    "host": "127.0.0.1",
    "port": 8787,
    "requestTimeoutMs": 60000,
    "maxRequestBodyBytes": 1000000,
    "includeGatewayMetadata": true,
    "maxFallbackAttempts": 3,
    "corsAllowedOrigins": ["http://127.0.0.1:8787", "http://localhost:8787"],
    "responseCache": {
      "enabled": false,
      "ttlMs": 300000,
      "maxEntries": 500,
      "bypassHeader": "x-gateway-cache-bypass"
    }
  },
  "auth": { "apiKeyEnv": "GATEWAY_API_KEY", "required": true },
  "storage": {},
  "policy": {
    "allowTraining": false,
    "allowLogging": false,
    "allowChineseProviders": false,
    "byokOnly": true
  },
  "providers": [],
  "models": [],
  "routes": [],
  "budgets": []
}
```

## Runtime And Server

- `runtime.mode`: `local` or `production-cloud`. Production mode requires gateway auth, non-loopback binding, secret-aware health, and cloud-safe provider URLs.
- `runtime.serviceDiscovery.allowedProviderBaseUrls`: optional exact-origin allowlist for enabled provider base URLs.
- `server.rateLimits.perGatewayKey`: optional `requestsPerMinute` and `tokensPerMinute` limits. Keys are SHA-256 fingerprints of bearer tokens; unauthenticated optional-auth traffic shares an anonymous bucket.
- `server.responseCache`: process-local cache for successful, non-streaming chat completions. It does not cache streams, errors, or embeddings. TTL and maximum entries must be positive. A truthy configured bypass header skips lookup, but successful responses can still populate the cache.
- `server.corsAllowedOrigins`: exact allowed origins. CORS preflight permits `authorization`, `content-type`, `x-gateway-tenant`, and the configured cache bypass header.

`GET /health` and `GET /version` are public. `GET /ready` and every `/v1/*` endpoint enforce gateway auth when `auth.required` is true.

## Providers And Models

Providers declare `id`, `displayName`, `kind`, endpoint/auth settings, regions, and data policy. `baseUrl` takes precedence; `baseUrlEnv` is read only when `baseUrl` is absent, and config validation requires one of the two. `auth` supports bearer, custom-header, and no-auth modes; `headers` supports static values and env-derived values with optional prefixes and required markers.

Models declare a stable gateway `id`, `providerId`, upstream `providerModel`, aliases, and capabilities. Optional context, price, quality, latency, success-rate, and throughput values drive policy filters and smart scoring. The `embeddings` capability is required for embedding routes.

Provider and model presets are appended after explicit user definitions and deduplicated by id, so an explicit definition wins over a preset with the same id. See [Provider adapters](provider-adapters.md) for preset ids and adapter behavior.

## Routes And Request Policy

Routes select one of `explicit`, `fallback`, `cheapest`, `lowest-latency`, `highest-throughput`, `balanced`, or `smart`. They can bind aliases, provider allow/block lists, price and latency ceilings, fallback model ids, and data policy.

Request `gateway` policy can narrow configured policy. It can expand policy only when `policy.allowRequestPolicyExpansion` is true. See [Routing and policy](routing-and-policy.md) for filtering and scoring order.

## Storage And Budgets

- `storage.usageLedgerPath`: append-only local JSONL ledger.
- `storage.cloud.backend: "sqlite"`: SQLite ledger using `sqlitePath`.
- `storage.cloud.backend: "postgres"`: Postgres ledger using `connectionString` or `connectionStringEnv`.

Daily, monthly, and lifetime budgets require cumulative storage. Per-request budgets do not. Budgets support gateway-key, tenant, and model-alias scopes; hard mode rejects exhausted requests, while soft mode records warnings. See [CLI reference](cli.md) for budget maintenance commands.
