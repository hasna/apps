---
"@hasna/hooks": patch
---

Hooks hardening 0.6.6: sanitized hook child environments (allowlist + name-based deny list, incl. MEMENTOS_* and *_URL/*_URI), loopback-only MCP SSE with auth, event-log redaction at write and read (current key formats: OpenAI project/service and Anthropic key forms, Stripe test/live restricted and secret key forms, Bearer units, URL userinfo, spaced/quoted/multiline values), immutable registry versions with exact-pin installs, verified PG TLS with proper sslmode parsing, fail-closed lock and atomic sync, redirect-refusing URL installs, script_kind honored in registry installs (serve and sync), explicit older pins preserved across syncs, mixed-install failure exit codes, shared semver at the CLI boundary, and doctor bounds reporting in every branch. See apps/hooks/CHANGELOG.md.
