# @hasna/releases

## 0.1.4

### Patch Changes

- 6356ce6: Resolve configured Changesets changelog modules from the Releases runtime when a target workspace has no installed dependencies.

## 0.1.3

### Patch Changes

- Complete the open- prefix retirement (commit d3984b0f1) in the output surfaces that still emitted it: the reconcile report schema identity changes from `open-releases.reconcile.v1` to `releases.reconcile.v1`, the fanout outbox entry schema changes from `open-releases.fanout-task.v1` to `releases.fanout-task.v1`, the fanout changelog task description names `changelog` instead of `open-changelog`, and the default app id derived from an npm package name is now the prefixless slug (`@hasna/todos` → `todos` instead of `open-todos`). Consumers that match these exact schema identity strings or join on the derived app id must switch to the prefixless forms; the `v1` schema versions are otherwise unchanged.

## 0.1.2

### Patch Changes

- 616b872: Add a fail-closed selective Changesets candidate planner that accepts explicit Changeset IDs and a package allowlist, validates dependency closure before writes, supports dry-run and apply, and preserves unrelated Changesets and manifests byte-for-byte.
- Updated dependencies [b630c48]
  - @hasna/events@0.1.16
