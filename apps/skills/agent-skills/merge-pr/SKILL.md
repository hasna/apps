---
name: merge-pr
description: Merge a GitHub pull request, merge when green, use a merge queue, or decide whether a pull request is mergeable. Use only for explicit merge intent, not ordinary review.
---

# Merge PR

Keep merge authority tied to fresh exact-head evidence. Read
[merge-safety.md](references/merge-safety.md) before an actual merge.

## Modes

- `preflight`: read-only advice; never fetch, checkout, push, comment, label,
  approve, close, enqueue, or merge.
- `immediate-merge`: merge now after every gate passes.
- `auto-merge`: use only when the user explicitly requested delayed merge.
- `merge-queue`: follow the repository queue; it is not a merge strategy.

## Required contract

For an actual merge:

1. Reuse the owning native goal/plan and exact Todo. Freeze one nonblank
   `acceptance_scope`; record the cumulative repair-cycle count.
2. Declare `routine` or `elevated`. Unknown is elevated and cannot authorize a
   merge. Every risk tier requires exactly one independent exact-head artifact.
   Review depth scales with risk, while the cumulative repair-cycle cap remains
   one for routine and two for elevated. A head change invalidates the artifact
   without resetting the cap.
3. Before review starts, write the task-owned fixed reviewer set as JSON with
   exactly one reviewer descriptor. The descriptor contains a
   `reviewer_identity`, a `reviewer_run_id`, or both. Keep worker, fixed
   reviewer, and executor distinct. The artifact must name the repository,
   PR, exact head SHA, frozen scope, the same reviewer descriptor, timestamp,
   verdict, checked risks, and blocking findings. Missing, surplus, duplicate,
   or substitute reviewers fail closed even when their artifact says GO.
4. Immediately before execution, re-read the PR, exact head, checks, the
   authenticated provider principal, PR author, provider review state,
   draft/conflict state, base/protection policy, and queue behavior. The exact
   fixed independent artifact is the review authority; provider review fields
   may be empty only when the freshly captured `provider_principal` exactly
   matches `pr_author`. Never fabricate provider review metadata. Explicit
   provider blocking states still fail closed. Do not use stale preflight as
   merge authority.
5. Generate the command with
   `scripts/merge_pr_guard.py build --preflight <fresh.json>
   --fixed-reviewers <task-owned-fixed-reviewers.json>
   --task-id <todo-id> --acceptance-scope <frozen-scope>
   --repair-cycle-count <cumulative-count> ...`. Never hand compose a squash
   command.
6. Execute the returned argv exactly once. It always includes
   `--match-head-commit`; it never includes admin, force, direct-main push, or
   branch deletion. Use auto mode only with explicit delayed intent.
7. Run `scripts/merge_pr_guard.py postverify` against the provider result and
   save its required receipt. For auto or queue mode, wait until the provider
   reports `MERGED`; enablement or enqueue is not merge completion. Do not
   report clean until postverify exits zero.

## Squash message rule

Every squash command must carry an explicit one-line subject and explicit body.
An omitted body becomes the empty string. Custom bodies retain their text after
line-ending normalization. Subject or body input containing a
`Co-Authored-By` trailer, with any case or whitespace variation, fails before
merge; never strip and continue.

```bash
printf '%s\n' \
  '{"reviewers":[{"reviewer_identity":"fixed-reviewer","reviewer_run_id":"run-123"}]}' \
  > /path/to/task-owned-fixed-reviewers.json

python3 agent-skills/merge-pr/scripts/merge_pr_guard.py build \
  --preflight /path/to/fresh-preflight.json \
  --fixed-reviewers /path/to/task-owned-fixed-reviewers.json \
  --task-id "00000000-0000-4000-8000-000000000000" \
  --acceptance-scope "task-owned-frozen-scope" \
  --repair-cycle-count 0 \
  --strategy squash \
  --subject "fix: preserve merge provenance" \
  --body ""
```

This guard authorizes explicit squash merges and policy-owned merge queues.
Merge and rebase strategies need a different guard that verifies every
resulting commit, so this workflow rejects them.

## Postverify

Postverify must query the actual provider merge commit, not source commits or a
locally predicted message. It writes a durable `clean` or `failed` receipt,
including message digest and forbidden-trailer line numbers without echoing the
message. Here `clean` means trailer-clean, not byte-for-byte equality with the
requested message. A synthesized trailer is a failed result. Fixture mode is
test-only, marks receipts non-authoritative, and can never complete a live
merge. Pass the build result's task, mode, scope, cycle count, base, exact head,
preflight digest, fixed-reviewer-set digest, and command-argv digest to
postverify. Postverify must also read the exact preflight, task-owned fixed
reviewer set, and saved command-plan JSON; it recomputes their digests and
rejects any field, reviewer-set, message, or argv mismatch before querying the
provider.

Never rewrite protected-main history, revert, force push, or delete the branch
in response. Record the failure and escalate through the owning task.
