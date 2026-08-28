# @hasna/tickets

## 0.1.24

### Patch Changes

- Switch @hasna/tickets local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/tickets` default (with the `HASNA_TICKETS_HOME` / `TICKETS_HOME` exact-app overrides) stays the effective home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME`. The pre-`.hasna` legacy `.tickets` store still copy-forwards into the effective root; the install-time postinstall now provisions that same effective root. The dependency is pinned exactly to `@hasna/paths@0.1.0`.

## 0.1.23

### Patch Changes

- fdeb50e: tickets-serve and tickets-mcp answer --help/--version cleanly before any bind or transport connect (todos row 5fcf7a67). Previously `tickets-serve --help`/`--version` fell through to serve() and bound the port (EADDRINUSE when occupied, or bind-and-serve forever), and `tickets-mcp --version`/`--help` entered MCP stdio mode, printed nothing, and exited rc=0 silently when stdin closed.

## 0.1.22

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
