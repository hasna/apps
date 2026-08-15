# Contributing

Use Bun for local development.

```bash
bun install
bun run build
bun run typecheck
bun test
```

Adapter changes must include:

- manifest/schema coverage
- dry-run behavior
- safety class and runner capability declarations
- parser tests or fixture outputs
- documentation for required dependencies and network/cost behavior

Release-blocking checks:

```bash
bun run typecheck
bun test
bun run build
bun run pack:check
```

Before any commit or push, run the workspace mandatory staged-files secret scan.

Do not commit credentials, local `.hasna/` data, `.connect/` tokens, or `.secrets/`.
