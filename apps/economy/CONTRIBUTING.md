# Contributing

Thanks for contributing to Hasna Economy.

## Development Setup

Use Bun for package management and validation.

```bash
bun install
bun test
bun run typecheck
bun run build
```

Dashboard work lives under `dashboard/` and SDK work lives under `sdk/`. Run package-local commands from those directories when changing those packages.

## Release And Package Hygiene

Before proposing a release change:

- keep unrelated local work separate;
- do not commit local databases, private telemetry, `.env` files, credentials, logs, or machine-specific state;
- verify `bun pm pack --dry-run --ignore-scripts` for publishable packages;
- verify package entry points after `bun run build`;
- update `CHANGELOG.md` for user-visible package changes;
- keep package metadata, license fields, and release notes consistent with Apache-2.0.

## Pull Requests

Each pull request should describe the behavior change, validation commands, package/release impact, and any known migration or compatibility concern. Include tests when behavior changes, especially around ingest, billing, packaging, CLI commands, and server APIs.

## Code Style

Follow the existing TypeScript style. Prefer small, direct modules over broad refactors. Use structured APIs for data parsing and keep changes scoped to the behavior under review.

## Security

Report vulnerabilities according to [SECURITY.md](SECURITY.md). Do not publish private exploit details in public issues or pull requests.
