# `@hasna/cli` — unified dispatcher for @hasna apps

The unified Hasna CLI. It is a **pure spawn dispatcher**: it resolves an
installed `@hasna` app's binary and runs it with byte-exact argv passthrough,
inherited stdio and environment, and propagated exit codes. It never parses
app args, rewrites flags, touches the environment, or resolves credentials —
each app keeps its own configuration, secrets, and auth.

- Zero runtime dependencies (`node:child_process`, `node:fs`, `node:os`,
  `node:path` only).
- Built with `bun build --target bun` into a single `dist/cli/index.js`.

## Usage

```
hasna app <name> [args...]   run an installed @hasna app (args pass through unchanged)
hasna app                    list installed @hasna apps
hasna apps list              list installed @hasna apps
hasna apps status <name>     show the installed version of an app
hasna apps install <name>    install an app (bun install -g @hasna/<name>)
hasna apps update <name>     update an app (bun add -g @hasna/<name>@latest)
hasna doctor                 check the global install dir and PATH for known apps
hasna version                print the hasna CLI version
hasna --help                 this help
```

Apps resolve by binary name in `PATH` first, then through a small discovery
table for packages whose bin name differs from the package name (`shield` →
`shield.sh`, `signatures` → `open-signatures`, `instructions` → `configs`
alias, `events` → `hasna-events`, `identities`). `apps list` scans
`~/.bun/install/global/node_modules/@hasna/*` (with an npm-global fallback),
skipping `.bak`/`.old`/`.pre-*` backups and packages without bin entries.

Exit codes: `0` success, `1` usage or check failure, `127` app not found.

## Relationship to older @hasna/cli versions

- The deprecated npm package `@hasna/cli` **0.1.0** is a separate lineage; its
  development moved to `@hasna/agency`. This package does not inherit it.
- The rescued cweb/careers CLI content that previously lived on this
  repository's `main` branch (version 0.2.0, internal GitHub Packages
  distribution) is preserved on the **`cweb-legacy`** branch, including its
  `docs/` (architecture, threat-model) and release machinery.

## Development

```bash
bun install
bun run build   # bun build src/cli/index.ts --target bun --outfile dist/cli/index.js
bun test        # 21 tests, hermetic (fixture bins + fixture global dir)
```

License: Apache-2.0.
