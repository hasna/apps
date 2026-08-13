# apps/ — member packages

Each directory here is one public `@hasna/<name>` package. **This folder is
intentionally empty** during the phase-0 skeleton: the 85 member repos are
imported by dedicated lanes, each landing as its own PR, never by this
bootstrap.

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
