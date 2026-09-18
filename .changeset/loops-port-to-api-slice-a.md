---
"@hasna/loops": minor
---

loops: route hosted diagnostics and bounded migration import through the authoritative `/v1` API

The existing MCP diagnostics (`loops_doctor`, `loops_health`, `loops_health_scan`, and `loops_diagnose`) now use bounded hosted report builders instead of refusing or consulting the explicitly local store. Hosted doctor is control-plane-only and never spawns local provider/account tooling with hosted credentials. Hosted results identify their backend and disclose inventory/run-history windows; malformed or identity-mismatched API rows refuse instead of becoming empty or unrelated diagnostic evidence.

`loops import <file>` now resolves the authoritative transport before reading the bundle. Hosted previews use bounded `/v1` reads and safe representation-aware comparisons; hosted applies submit only explicit insert/update rows through `POST /v1/import`. The client rejects oversized row sets, incomplete collision windows, malformed count/list responses, mismatched row identities, and untrustworthy mutation receipts. Receipt uncertainty is reported as reconciliation-required rather than inviting a blind retry.

The import route rejects non-object bodies and malformed workflow, loop, schedule, target, and run rows with a stable HTTP 400 before any write. Workflow and run references are verified inside the same SQLite/PostgreSQL transaction that applies the batch, so a later conflict rolls every earlier row back.

The configured app authority remains `https://api.hasna.com/loops`, clients append `/v1` exactly once, and local SQLite remains available only through the explicit `HASNA_LOOPS_LOCAL=1` opt-in.

The hosted import apply now requires the server's `loops.import.v2` receipt, bound to a caller operation id, an exact request digest, and imported/skipped row ids. Deploy the merged server before publishing a client release that enables hosted import.

Import rows now preserve accepted loop bundle identity and pinned-version metadata across both SQLite and PostgreSQL writes. Derived latest-run summaries are rejected instead of accepted-and-ignored, and generated SDK agent targets expose `extraArgs` as an empty tuple to match the server's empty-only contract.
