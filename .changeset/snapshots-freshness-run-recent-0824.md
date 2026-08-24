---
"@hasna/snapshots": patch
---

Capture freshness now keys off capture-RUN recency instead of newest-UNIQUE-snapshot age (todos 27f3d817). `snapshots capture` dedups identical state by design, so on a stable machine the newest unique snapshot ages past the 900s freshness threshold while the */5 capture cron is alive — the deployed freshness alarm was posting [INCIDENT] every 5 minutes on station02/03/04.

- `snapshots capture` now records a capture run on EVERY attempt, including when the capture dedups (new `capture_runs` table; every attempt writes a row with `created_at`, snapshot id, duplicate-of, resource/diagnostic counts, and status).
- New `snapshots runs` verb lists capture runs (most recent first).
- New `snapshots freshness` verb reports `ok` based on the age of the latest capture run against the threshold (default 900s, `--threshold`), alongside the newest-snapshot ages for context. Exit code: 0 fresh, 1 stale/no-runs verdict, 2 could not determine.
- Canonical deployed wrapper `ops/snapshots-freshness.sh` posts INCIDENT only on a genuine verdict (no runs ever, or last run stale). A "could not read the status" (exit 2) is logged and NOT posted, so a transient CLI/DB read error no longer produces a false "NO snapshots exist in the local store" INCIDENT.
