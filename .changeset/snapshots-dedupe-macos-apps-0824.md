---
"@hasna/snapshots": patch
---

`snapshots capture` fails on macOS with "UNIQUE constraint failed: snapshot_resources.snapshot_id, snapshot_resources.resource_id" when System Events reports the same app more than once in one capture (station04 runs two Ghostty processes, so `osascript` returns `ghostty` twice and both map to the id `app:ghostty`). The osascript path of `captureMacApps` mapped every name to an id with no dedupe, so the second insert of the same (snapshot_id, resource_id) pair violated the composite primary key inside the save transaction and no snapshot was written.

- `captureMacApps` now builds resources through a new exported `macAppResources(names, now)` helper that dedupes by resource id (a seen-set), mirroring the existing dedupe of the process-path fallback (which dedupes by app path) and the Linux `wmctrl` path (which dedupes by window class).
- The defensive save-side dedupe (`ON CONFLICT(snapshot_id, resource_id) DO NOTHING`, landed in 0.1.6) already makes such duplicates a silent no-op; this removes the duplicate at the capture source so captures never emit them.
- Regression tests: the station04 two-`ghostty` fixture collapses to one resource; case-variant names that slug to one id collapse; distinct apps stay distinct; a mixed duplicate list emits zero duplicate ids; an empty list emits nothing.
