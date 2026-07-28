# Capacity OpenAPI

`accounts.capacity.v1.json` is generated from the runtime document in
`src/http/openapi.ts`, which is also served by `GET /openapi.json`.

Regenerate deterministically with:

```sh
bun openapi/generate.ts
```

The document describes the Fetch handler created by
`createAccountsHttpHandler`; the package does not start a server. It covers only
the clean capacity origin and deliberately omits
legacy profile/tool routes, credential-handle retrieval, provider-login or
device-code ceremonies, lease operations, tenant/signup routes, and all native
reauthentication execution methods.

See [`../docs/http-api.md`](../docs/http-api.md) for route groups, audience and
scope behavior, readiness semantics, and regeneration checks.
