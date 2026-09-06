# @hasna/instructions-sdk

Zero-dependency TypeScript clients for Instructions HTTP services. The package
works anywhere a standards-compatible `fetch` implementation is available.

## Install

```bash
bun add @hasna/instructions-sdk
```

## Resolver-wired `/v1` client (`@hasna/instructions-sdk/resolve`)

The preferred way to build the hosted client on Node/Bun: credentials and the
service authority come from the ONE shared `@hasna/contracts` resolver
(hasna/apps#1720), resolved fresh on EVERY request — a rotated key heals a
long-lived client without rebuilding it.

```typescript
import { createInstructionsV1ClientFromEnv } from "@hasna/instructions-sdk/resolve";

const client = createInstructionsV1ClientFromEnv(); // env -> Keychain -> disk -> HASNA_INSTRUCTIONS_API_KEY

const { configs = [] } = await client.listConfigs({ category: "rules" });
```

Resolution precedence (per request):

1. an explicit argument — `apiKey` / `baseUrl` (see the explicit-URL rule below);
2. a deliberate env pointer — `HASNA_INSTRUCTIONS_API_KEY_OVERRIDE`,
   `HASNA_PROFILE`, `HASNA_INSTRUCTIONS_API_KEY_REF`;
3. the macOS Keychain — `hasna.credentials.instructions.api-key` (account
   `HASNA_STATION` → `hostname -s` → `$USER`);
4. disk — `~/.hasna/instructions/config/credentials`, owner-only 0400/0600
   (`HASNA_HOME` / `HASNA_CONFIG_HOME` move the root);
5. `HASNA_INSTRUCTIONS_API_KEY` in the environment.

The authority follows `HASNA_INSTRUCTIONS_API_URL`, the Keychain `api-url`
item, the credentials file, and otherwise defaults to the fleet gateway
`https://api.hasna.com/instructions`. `resolveInstructionsSdkTransport(options)`
reports WHICH tier supplied the credential (never the value). Retired
locations (`~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna`,
`$XDG_CONFIG_HOME`) are never read.

**Explicit-URL rule (hasna/apps#1794):** an explicit `baseUrl` without an
explicit `apiKey` THROWS — the SDK never attaches the machine's fleet key to an
authority the caller chose itself:

```typescript
// ✅ pinned pair — sent verbatim
createInstructionsV1ClientFromEnv({ baseUrl: "https://instructions.example.com", apiKey: "..." });

// ❌ throws: never silently uses the ambient fleet key for an explicit authority
createInstructionsV1ClientFromEnv({ baseUrl: "https://instructions.example.com" });
```

No credential anywhere also throws; there is no local mode and no
unauthenticated client on this surface. The unprefixed
`INSTRUCTIONS_API_URL` / `INSTRUCTIONS_API_KEY` spellings are accepted for one
release as silent aliases of the canonical names.

## Supported `/v1` client (`@hasna/instructions-sdk`)

The main entry stays zero-dependency and browser-safe. `InstructionsV1Client`
is generated from `src/server/openapi.ts` and calls the authenticated `/v1` API
exposed by `instructions-serve`.

```typescript
import {
  InstructionsV1Client,
  InstructionsV1ApiError,
} from "@hasna/instructions-sdk";

const client = new InstructionsV1Client({
  baseUrl: "https://instructions.example.com",
  apiKey: process.env.HASNA_INSTRUCTIONS_API_KEY,
});

const { configs = [] } = await client.listConfigs({ category: "rules" });
const { config } = await client.getConfig(configs[0]!.slug!);

try {
  await client.updateConfig(config!.id!, { description: "Canonical rules" });
} catch (error) {
  if (error instanceof InstructionsV1ApiError) {
    console.error(error.status, error.body);
  }
}
```

The API key is sent as `x-api-key`. You can provide a custom `fetch` and extra
headers:

```typescript
const client = new InstructionsV1Client({
  baseUrl: "http://localhost:3457",
  apiKey: "...",
  fetch: globalThis.fetch,
  headers: { "x-request-source": "automation" },
});
```

The generated client currently exposes the operations present in the served
OpenAPI document:

| Method | HTTP operation |
| --- | --- |
| `listConfigs(query?, init?)` | `GET /v1/configs` |
| `createConfig(body, init?)` | `POST /v1/configs` |
| `getConfig(id, init?)` | `GET /v1/configs/:id` |
| `updateConfig(id, body, init?)` | `PATCH /v1/configs/:id` |
| `deleteConfig(id, init?)` | `DELETE /v1/configs/:id` |
| `listSnapshots(id, init?)` | `GET /v1/configs/:id/snapshots` |
| `createSnapshot(id, init?)` | `POST /v1/configs/:id/snapshots` |
| `listProfiles(init?)` | `GET /v1/profiles` |
| `createProfile(body, init?)` | `POST /v1/profiles` |
| `resolveProfile(query?, init?)` | `GET /v1/profiles/resolve` |
| `getProfile(id, query?, init?)` | `GET /v1/profiles/:id` |
| `deleteProfile(id, init?)` | `DELETE /v1/profiles/:id` |
| `getProfileConfigBindings(id, init?)` | `GET /v1/profiles/:id/bindings` |
| `addConfigToProfile(id, body, init?)` | `POST /v1/profiles/:id/configs` |
| `setProfileConfigBinding(id, configId, body, init?)` | `PUT /v1/profiles/:id/configs/:configId` |
| `removeConfigFromProfile(id, configId, init?)` | `DELETE /v1/profiles/:id/configs/:configId` |
| `getProfileAssetBindings(id, init?)` | `GET /v1/profiles/:id/assets` |
| `addAssetToProfile(id, body, init?)` | `POST /v1/profiles/:id/assets` |
| `setProfileAssetBinding(id, assetKey, body, init?)` | `PUT /v1/profiles/:id/assets/:assetKey` |
| `removeAssetFromProfile(id, assetKey, init?)` | `DELETE /v1/profiles/:id/assets/:assetKey` |
| `getStats(init?)` | `GET /v1/stats` |

Responses retain the server envelopes, for example `{ config }` or
`{ configs, count }`. IDs are URL-encoded by the client. Non-2xx responses
throw `InstructionsV1ApiError` with `status` and parsed `body` fields.

The runtime server has additional routes that are not yet in the OpenAPI
document or generated client. See the repository's [HTTP API
reference](../docs/http-api.md) and use direct HTTP for those operations.

## Legacy `ConfigsClient`

The package still exports `ConfigsClient` as a compatibility client for the
former local `/api` service. It targets routes such as `/api/configs`,
`/api/sync`, and `/api/profiles`.

Current `instructions-serve` does **not** mount `/api`, so do not use
`ConfigsClient` with it. `ConfigsClient` also has no `fromEnv()` helper and does
not read `CONFIGS_URL`; pass `baseUrl` explicitly when using a separate legacy
server.

## Regeneration

From the repository root:

```bash
bun run generate:sdk
```

This rebuilds `sdk/src/v1.generated.ts` from the same OpenAPI document served
at `/openapi.json`. Do not edit the generated file by hand.

## License

Apache-2.0
