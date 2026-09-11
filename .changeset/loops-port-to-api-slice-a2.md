---
"@hasna/loops": minor
---

loops: `expectations`, `hygiene names|duplicates|scripts|route-tasks`, `health route-tasks` and `ui` now work against the hosted API

These seven surfaces refused outright on a hosted connection and otherwise read this machine's SQLite file, so
on a station whose loops live in the control plane they answered about the wrong population. Each one now reads
the hosted `/v1` inventory, with the classifiers and the renderer unchanged:

- `loops expectations [idOrName]` evaluates the same deterministic expectations over hosted loops and runs.
- `loops hygiene names` plans canonical names from the hosted inventory, and `--apply` renames through
  `POST /v1/loops/{id}/rename`, then re-reads the inventory so the report reflects what the control plane now
  holds. A hosted rename has no local database backup to take, and the command says so instead of implying one.
- `loops hygiene duplicates`, `loops hygiene scripts` and `loops hygiene route-tasks` classify the hosted
  inventory; the todos routing they perform is unchanged.
- `loops health route-tasks` builds its health report from `/v1` and routes the same findings.
- `loops ui` re-reads every frame from `/v1` — rows, running runs, and all five counters come from the count
  routes rather than the length of a page — and a failed read fails the frame rather than leaving the previous
  frame on screen looking current.

Every hosted answer names the backend it read and lists what it could not read (for example the inventory page
cap), rather than presenting a truncated sweep as a clean result. The local file store remains reachable exactly
as before behind the explicit local opt-in.
