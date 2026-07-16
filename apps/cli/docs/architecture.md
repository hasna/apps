# Architecture

The CLI has four layers:

1. `runner` parses global options and emits one stable result envelope.
2. `commands` validates command input and maps it to provider/API operations.
3. `providers` exposes a static built-in cweb manifest plus future type-only verification contracts.
4. `http`, `config`, and `credentials` isolate transport and local state.

The cweb provider is coupled to title `Hasna CWeb CLI API`, minimum semantic API version `1.1.0`, and required operations at `/api/v1/openapi.json`. `app cweb capabilities` fetches and validates that document; `apps status` reports compatibility. Install/update plans bind its content hash and refetch before apply. All careers paths are rooted at `/api/v1/orgs/{orgSlug}`.

The parser applies route-specific flag allowlists before runtime construction. High-impact operations persist a digest-scoped ten-minute plan, atomically reserve it during apply, reject concurrent apply or in-flight replanning, reuse an unchanged pending plan without resetting expiry, and consume it on success or a validated non-application response: authentication, permission, validation, not-found, conflict, precondition, request-size, or rate-limit. Network/TLS/timeout, redirect, 5xx, interrupted/invalid/oversized response, and unclassified remote failures remain in flight because the server may still be handling an already-sent request. In-flight reservations are never automatically released or reclaimed, even after expiry or process death. The private `plans list|show|resolve` surface provides explicit local-only reconciliation after an operator verifies remote state; resolving `not-applied` creates a fresh ten-minute pending window, while `applied` consumes the record. Plan-state lock contention gets three bounded, deterministically jittered attempts. If the remote mutation succeeds but local consumption still cannot be persisted, the CLI returns partial exit 9 with the request ID and leaves the reservation fail-closed. Ordinary config mutations and plan transitions share one atomic lock/update discipline with dead-owner, age-bounded stale-lock recovery; retry code never removes a live lock.

The transport treats 3xx as remote errors, never follows redirects, bounds responses, sanitizes remote failures, retains request IDs, blocks non-public destinations after DNS resolution, and pins the validated address to prevent rebinding between validation and connection.

Transport dependency injection and in-memory config/credential adapters make command tests deterministic. The distributable is ordinary Node.js ESM compiled by TypeScript and contains no Bun-specific API.
