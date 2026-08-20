# @hasna/events

## 0.1.16

### Patch Changes

- b630c48: First release from the hasna/apps monorepo. The package was imported from hasna/events with history preserved (import capsule 718653fff, import merge 46dda5e8b). Release-relevant changes since 0.1.15:
  - The shipped fixture `fixtures/hasna.app_event.v1.json` changes `source.app` and `actor.id` from `open-todos` to `todos` (open- prefix retirement). Consumers that validate events against the shipped fixture see the new identifiers.
  - The prepack release-gate path changed: `scripts/artifact-scan.ts` now resolves the `contracts` CLI through the installed package's own declared bin (`import.meta.resolve`), not `node_modules/.bin`, which dies with ENOENT for workspace-linked members in a fresh checkout.
  - One absorption test-robustness edit (retry-chunking test determinism under parallel load).
  - Monorepo workspace wiring and version ownership (0.1.16).
