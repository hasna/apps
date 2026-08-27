# One Repo, One Product

`@hasna/connectors` now treats connectors as internal modules of a single product instead of separately installed package copies.

## Runtime Model

- Connector code lives inside this repository and ships with the main package.
- Projects enable connectors through `.connectors/manifest.json`.
- Connector commands run through the shared runtime with internal definitions first and legacy CLI fallback for unmigrated connectors.
- Auth, profiles, and token storage live under the connectors data home (resolved through `@hasna/paths`; `~/.hasna/connectors/` until the XDG data home is adopted).

## What Contributors Should Build Against

- Add shared runtime behavior under `src/core/`.
- Register new internal definitions in the core registry instead of relying on CLI help parsing.
- Treat `connectors install` as project enablement, not source copying.
- Keep CLI, MCP, REST, and dashboard hints aligned with `connectors run <name> ...` and the shared auth home.

## Compatibility Rules

- Legacy connector CLIs may still exist while migration is in progress.
- The runner must preserve legacy CLI fallback until each connector is migrated.
- Existing `~/.connectors/` and `~/.connect/` data should continue to work through migration into the effective connectors data home.

## Migration Checklist

1. Define or update the connector in `src/core/`.
2. Expose its command surface through the shared registry.
3. Keep docs in sync with the one-product runtime and shared config home.
4. Add or update regression coverage for CLI, MCP, REST, and installer behavior.
