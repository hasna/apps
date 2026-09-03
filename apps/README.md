# apps/ — member packages

Each directory here is one public `@hasna/<name>` package. **75 members are
counted today** (measured by the name-conformance gate,
`bun tooling/ci/check-names.ts`, 2026-08-26), each landed as its own PR from
the public-estate import wave (todos `28ac4516`); the remaining repos in that
census are tracked by the same wave and land PR-first, never by a bootstrap.

## The four surfaces (target standard)

1. **CLI** — `bin: { "<name>": ... }` — the primary command surface.
2. **MCP server** — a bin that speaks MCP (used by coding agents).
3. **`-serve`** — the server bin (HTTP API / self-hosted serving).
4. **`./sdk`** — the importable module surface for programmatic use.

Not every member ships all four today — 25 of 75 do. Remaining gaps are
tracked by the manifest lane (todos `41208cbe`) and the SDK lane
(todos `c7ce8b75`).

Naming: directory `apps/<name>` ↔ package `@hasna/<name>`, kebab-case, enforced
by the CI name-conformance gate. Every member publishes with
`"access": "public"` in its `publishConfig`; the one explicit
`"private": false` declaration is `apps/notes` (a publishing member), and
extending `../../tsconfig.base.json` is the exception, not the rule — only
`apps/workflows` does.

## Dependencies

Members may depend on published `@hasna/*` registry packages and on other
members via published versions. Never `@hasna-internal/*`, never private
infra. Cross-member `workspace:*` deps are a publish-time hazard (tarball
leak) — see `.claude/rules/publish.md` before adding one.
