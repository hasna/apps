# Changelog

## Unreleased

- Run typechecking, builds, and tests in GitHub Actions for pushes and pull requests.

## 0.1.54

- Switch local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/context` data home (with the `HASNA_CONTEXT_DATA_DIR` / `CONTEXT_DATA_DIR` exact-app overrides layered on top of the existing `HASNA_CONTEXT_DB_PATH` / `CONTEXT_DB_PATH` store overrides) stays the effective data home until the store has been migrated to the XDG data home or the operator sets `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. Dependency pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.1.53

- Publish previously-merged work from the PR drain (npm `latest` was stuck at 0.1.52 from
  2026-06-29 while `main` had since advanced).
- Add v2 context hub contracts (#1): v2 storage, query pipeline, open-knowledge adapter,
  types, Postgres migrations, and architecture docs.
