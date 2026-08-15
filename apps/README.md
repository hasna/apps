# apps/ — member packages

Each directory here is one public `@hasna/<name>` package. **75 members are
imported today**, each landed as its own PR from the public-estate import wave
(todos `28ac4516`); the remaining repos in that census are tracked by the same
wave and land PR-first, never by a bootstrap.

## The four surfaces (every member package)

1. **CLI** — `bin: { "<name>": ... }` — the primary command surface.
2. **MCP server** — a bin that speaks MCP (used by coding agents).
3. **`-serve`** — the server bin (HTTP API / self-hosted serving).
4. **`./sdk`** — the importable module surface for programmatic use.

Naming: directory `apps/<name>` ↔ package `@hasna/<name>`, kebab-case, enforced
by the CI name-conformance gate. Every member keeps `package.json` `private:
false`, `"access": "public"`, and its own tsconfig extending
`../../tsconfig.base.json`.

## Dependencies

Members may depend on published `@hasna/*` registry packages and on other
members via published versions. Never `@hasna-internal/*`, never private
infra. Cross-member `workspace:*` deps are a publish-time hazard (tarball
leak) — see `.claude/rules/publish.md` before adding one.
