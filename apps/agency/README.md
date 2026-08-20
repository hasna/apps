# @hasna/agency

Unified management CLI for all `@hasna/*` open-source packages.

## Install

```bash
bun install -g @hasna/agency
```

## Usage

```bash
agency status          # table of all @hasna/* packages: version, DB size, MCP/HTTP status
agency doctor          # health checks: dirs, configs, RDS, versions, MCP binaries
agency init            # create data dirs, optionally configure RDS, install packages
agency update          # update installed @hasna/* packages
agency sync status     # sync status against remote PostgreSQL (via @hasna/cloud)
agency mcp list        # list known MCP server binaries
agency backup create   # tarball backup of ~/.hasna
agency db check        # verify SQLite database files
agency connect claude  # auto-wire MCP servers into AI tool configs
agency playground <svc># interactive MCP tool testing REPL
agency logs            # unified log stream across services
agency search <query>  # cross-service search across SQLite databases
agency export          # export ~/.hasna data as tarball or JSON
agency import <file>   # restore from an exported archive
agency new service <n> # scaffold a new @hasna/* package
agency release         # bump, build, commit, push, publish @hasna/* repos
```

## Reconstruction provenance

This package's source was lost upstream (the published tarball shipped only
`package.json` + a bundled `dist/index.js`, and the repository was deleted).
The source in `src/` is reconstructed from the published `@hasna/agency@0.3.1`
bundle (2026-08-20, row 91a7b09d), split into real modules. Parity notes:

- The CLI verb surface is identical to 0.3.1: `status, doctor, init, update,
  sync, mcp, backup, db, connect, playground, logs, search, export, import,
  new, release`.
- `src/db/database.ts` and `src/db/pg-migrations.ts` are reimplemented from
  the scaffold-template strings embedded in the bundle (the tarball shipped
  no db module; the runtime CLI never imported one).
- The embedded `REGISTRY` (45 packages) is extracted verbatim and is STALE BY
  DESIGN — it covers roughly a quarter of first-party packages and is not a
  live census.
- One deliberate deviation: the 0.3.1 `init` prompt defaulted to a live
  internal RDS endpoint; the reconstructed source does not carry that
  internal-infra string (environment variables remain the operative path).

## License

Apache-2.0
