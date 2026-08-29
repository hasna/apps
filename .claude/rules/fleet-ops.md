# Fleet-ops lessons — lane machinery, record discipline, CLI quirks

Measured 2026-08-29 on station01 while operating the standing lanes
(task-drain, pr-drain, leak-scan, stale-tasks, deploy-apps, publish-all,
hotfix-drain, closed-pr-audit, github-issues-to-todos, propagate-lanes,
ship-latest). Each item below cost a real failure or a near-miss before it was
understood. Bind on every agent that runs, audits, or fixes the standing lanes.

## 1. The 5-minute coordination loop is a standing mechanism — verify it exists

A completed deploy-apps run sat **80 minutes** without a relaunch because the
5-minute coordination loop was absent from the session's crons (only the
10-min health check existed). The standing-lanes mandate ("relaunch on
completion") has no teeth if the loop that implements it is gone.

- Any session running standing lanes must have the 5-min loop scheduled
  (every 5 min, off the :00/:30 marks), and must check its existence at
  session start — a lost loop is silent until a lane goes quiet.
- The 10-min health cron is the backstop: a lane whose newest transcript is
  >~75 min old, or a completed run with no fresh dispatch, is a BUG row
  (tags bug,workflows) with the exact resume command, one #apps line, and an
  immediate fresh dispatch.
- The loop's quiet floor is 15 min: a lane with a transcript younger than
  15 min is live and is never relaunched (one effective run per lane).

## 2. Fresh-dispatch, never resume, for completed lanes

`resumeFromRunId` on a **completed** workflow run replays and terminates — it
does not relaunch. The correct relaunch is a fresh `Workflow({scriptPath})`.
Keep a run-id→lane map (append on every dispatch) and a last-dispatch state
file; the map plus the 15-min floor prevents double dispatch.

## 3. Run-id→lane map is authoritative — transcript grep mislabels

A transcript-grep classifier labels **closed-pr-audit** as **hotfix-drain**
because the audit lane's prompt text names the drain lanes. Grep is only a
fallback for run ids not in the map. When auditing lane runs, consult the
map first, always.

## 4. todos status-changing ops need an agent identity

`todos complete <id>` without `--agent <name>` (or `TODOS_AGENT_ID`) fails
rc=1: "Cannot complete a task without an agent identity". The error reads
like a config bug; it is not. Pass `--agent <name>` on every
start/complete/update that changes status or locks.

## 5. The todos CLI writes a cert warning to stdout before JSON

"warn: ignoring extra certs from .../rds-ca-bundle.pem" precedes the JSON
document. A naive `jq -r '.id' file` fails (exit 5) because the first line is
not JSON. Parse defensively: `grep -o '"id":"[a-f0-9-]*"'`, or strip the
first line before jq. This applies to every `todos ... --json` read.

## 6. Rows are the record — close a row when its condition clears

When pr-drain rebases a stale PR, its `updatedAt` refreshes and it drops out
of the stale set; the filed STALE-PR row's condition has cleared. Complete
the row with a note naming the rebase pass ("CLEARED: pr-drain rebase pass
2026-08-29 touched hasna/apps#<n>"). Never leave a cleared-condition row
pending, and never re-file a rowed PR.

## 7. Held-set discipline

Decision-held PRs are never re-filed by health passes. The held set is part
of the record; a health pass that does not know the current held set must
check the pending rows for the PR before filing (dedupe by PR number in the
title), not assume.

## 8. Blocked / survey-only are measured states, not errors

The deploy lane's blocked list (a candidate with `-serve` + Dockerfile but no
`*-prod` ECS service; `@hasna/context` additionally unpublished on npm) and
survey-only run results are the lane's recorded state. They are not BUG rows
and not anomalies — the lane records them in its own result and the health
cron reports them as state.

## 9. Mementos cloud 403 on station01 — fall back locally, dedupe first

The mementos cloud API returns 403 Host-not-allowed on station01 (defect
O15-04621, fix tracked in its own task). When it fires: save to the local
store as the fallback and **dedupe against existing local rows** (the deploy
lane found its own row at version 4 instead of re-filing). Never file a
duplicate row for an already-tracked defect; file-and-delete is waste.

## 10. Health-pass filing shape

One row per uncovered stale PR (tags health,workflows, exact PR number,
"no activity since <ts> (>48h)"); one #apps line per anomaly class; rows ARE
the record; capture-path discipline (redirect to files, never pipe large
reads). The UNVERIFIED row class is the publish/deploy lane's gate record —
flag only when the row has no pending confirm, and never file a duplicate
row for an already-flagged class.
