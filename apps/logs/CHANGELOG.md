# Changelog

## 0.4.5

- chore(reconcile): bring `main` up to the published npm line. `main` had diverged
  behind the registry — it sat at 0.3.36 (tip `082c698`, "route ALL log reads+writes
  to cloud API in self_hosted mode") while npm `latest` was 0.4.4. The published tag
  `npm/logs/v0.4.4` was 8 commits ahead of `main` (Store unification / `LocalStore` +
  `ApiStore`, cloud `/v1` data-plane parity + `POST /v1/events` ingest, `watch --server`
  SSE fix, FTS5 query sanitization, releases 0.4.2/0.4.3), and `main` had **zero**
  commits that were not already on the tag. `main` was therefore a strict ancestor of
  the published tag, so this reconcile is a clean fast-forward — no main-only commits
  needed re-applying and no history was lost. Version bumped 0.4.4 → 0.4.5 so `main`
  now sits at / above the published line. No functional code changes in this release.
