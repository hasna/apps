# Architecture

The CLI has four layers:

1. `runner` parses global options and emits one stable result envelope.
2. `commands` validates command input and maps it to provider/API operations.
3. `providers` exposes a static built-in cweb manifest plus future type-only verification contracts.
4. `http`, `config`, and `credentials` isolate transport and local state.

The cweb provider is coupled to title `Hasna CWeb CLI API`, OpenAPI version `1.1.0`, and required operations at `/api/v1/openapi.json`. `app cweb capabilities` fetches and validates that document; `apps status` reports compatibility. Install/update plans bind its content hash and refetch before apply. All careers paths are rooted at `/api/v1/orgs/{orgSlug}`.

The parser applies route-specific flag allowlists before runtime construction. High-impact operations persist only a digest-scoped, ten-minute plan marker in protected configuration and consume it before the API request. The transport does not follow redirects, bounds responses, sanitizes remote failures, retains request IDs, and blocks credentialed private destinations after DNS resolution.

Transport dependency injection and in-memory config/credential adapters make command tests deterministic. The distributable is ordinary Node.js ESM compiled by TypeScript and contains no Bun-specific API.
