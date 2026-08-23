# @hasna/markdown

## 0.1.21

### Patch Changes

- Add the `./sdk` importable module surface: the four-surface conformance gate requires an `./sdk` export (`exports["./sdk"] !== undefined` in the standard census); markdown was a recorded WARN exception (census `SDK_EXCEPTIONS`, P5 lane c7ce8b75). The existing `sdk/` package (client for OMP) is now built into `sdk/dist` and exported as `@hasna/markdown`'s `./sdk` subpath, and markdown is removed from the census SDK exception list.

## 0.1.20

### Patch Changes

- 2b87a81: Hermeticize six test suites (21a04472): economy ingest/sync tests stash the ambient Accounts API key, testers CLI/MCP tests stash the ambient Testers API env, attachments stash ambient API/todos keys and split the server harness out of the test file, shield routes CRUD modules through a db-access seam, hooks disable ambient core.hooksPath for fixture commits, markdown skips the per-package lockfile this monorepo layout does not have, and testers pins @hasna/browser to the published 0.5.29.

## 0.1.19

### Patch Changes

- d7d615b: Pin @hasna/contracts to the published 0.13.3 (was ^0.13.0; 0.13.0 is unpublished, which makes the standard-suite conformance validator cannot-run) and align hasna.contract.json kitVersion to the declared contracts kit 0.13.1. Todos d175d558.
