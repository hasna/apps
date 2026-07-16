# Architecture

The CLI has four layers:

1. `runner` parses global options and emits one stable result envelope.
2. `commands` validates command input and maps it to provider/API operations.
3. `providers` exposes a static built-in cweb manifest plus future type-only verification contracts.
4. `http`, `config`, and `credentials` isolate transport and local state.

The cweb provider is coupled to OpenAPI `1.1.0` at `/api/v1/openapi.json`. All careers paths are rooted at `/api/v1/orgs/{orgSlug}`. The CLI does not invent a capabilities endpoint; capabilities are the reviewed local manifest tied to that OpenAPI version.

Transport dependency injection and in-memory config/credential adapters make command tests deterministic. The distributable is ordinary Node.js ESM compiled by TypeScript and contains no Bun-specific API.
