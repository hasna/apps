---
"@hasna/loops": patch
---

Journal runner command failures with the refusal reason (todos e22f6727, PR #680): `logRunnerCommandFailure` previously printed only `{evt, errorType:"error"}` and the background `run` loop never wired `onError`, so a runner installed `--claim-scope bound` against a control plane that does not advertise `runner.claimScope` refused every poll with zero journal output. New `RunnerRefusalError` carries static safe-by-construction messages for refusals this package raises itself; those surface (bounded to 500 chars) while every foreign error keeps the fully opaque line — the postgres-connection-string opacity property is unchanged and its test untouched. The `run` command wires `onError` so service poll failures reach the journal.
