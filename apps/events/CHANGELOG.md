# @hasna/events

## 0.1.18

### Patch Changes

- e951bd9: Return a failing exit code for failed channel test deliveries in both the standalone and embedded Commander CLIs, preserving success/skipped exit codes and delivery output. Honor the existing explicit private-webhook administrator allowlist in default embedded CLI clients as well as the standalone CLI; SDK defaults and custom client policies remain unchanged.
- 8e7403f: Switch @hasna/events local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/events` default (with the `HASNA_EVENTS_DIR` / `HASNA_EVENTS_HOME` exact-app overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.

## 0.1.17

### Patch Changes

- Switch @hasna/events local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/events` default (with the `HASNA_EVENTS_DIR` / `HASNA_EVENTS_HOME` exact-app overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.1.16

### Patch Changes

- b630c48: First release from the hasna/apps monorepo. The package was imported from hasna/events with history preserved (import capsule 718653fff, import merge 46dda5e8b). Release-relevant changes since 0.1.15:
  - The shipped fixture `fixtures/hasna.app_event.v1.json` changes `source.app` and `actor.id` from `open-todos` to `todos` (open- prefix retirement). Consumers that validate events against the shipped fixture see the new identifiers.
  - The prepack release-gate path changed: `scripts/artifact-scan.ts` now resolves the `contracts` CLI through the installed package's own declared bin (`import.meta.resolve`), not `node_modules/.bin`, which dies with ENOENT for workspace-linked members in a fresh checkout.
  - One absorption test-robustness edit (retry-chunking test determinism under parallel load).
  - Monorepo workspace wiring and version ownership (0.1.16).
