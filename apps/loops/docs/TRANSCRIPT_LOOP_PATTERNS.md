# Transcript-Driven Loop Patterns

This guide turns long-form transcripts, meeting recordings, interviews, and product feedback videos into durable Loops work. It pairs `iapp-transcriber` for media ingestion with Loops workflows for recurring review, implementation, and verification.

The pattern came from reviewing a Claude Code fireside chat transcript. The useful operational takeaway was not just "use agents more"; it was that recurring agents need narrow scope, evidence, review gates, and clear ROI. In Loops terms, that means using workflows and goals to move from transcript insight to scheduled loop safely.

## Baseline Workflow

Start with the checked-in workflow template. Copy it into the target repo, replace `/path/to/repo` with that repo's absolute path, and provide `TRANSCRIBER_SOURCE_URL` through the runner environment or a private, uncommitted workflow copy before storing or scheduling it. Do not commit private or signed media URLs.

```bash
mkdir -p /path/to/repo/.loops
cp /path/to/loops/docs/workflows/transcript-feedback-to-loops.json /path/to/repo/.loops/transcript-feedback-to-loops.json
loops workflows validate /path/to/repo/.loops/transcript-feedback-to-loops.json --preflight
loops workflows create /path/to/repo/.loops/transcript-feedback-to-loops.json
loops workflows run transcript-feedback-to-loops --show-output
```

The transcribe step writes `.loops/transcripts/latest-transcript.json`. The transcript path is fixed so later agent steps read the same artifact the command step produced. Edit the copied workflow if you need a different artifact path. Set `TRANSCRIBER_PROVIDER` in the `transcribe-media` target env to choose another provider. For multi-speaker recordings, update the transcriber command to request diarization when the selected provider supports it. If no recurring loop candidates are generated, the validation step exits successfully after recording that there is nothing to validate.

The workflow includes non-shell `check-transcriber` and `check-loops` command steps so `loops workflows validate --preflight` can catch those missing CLIs. Shell command bodies, provider credentials, and media access are still checked by the transcriber step at runtime.

The ingestion template intentionally does not wrap the whole workflow in a Loops goal. Goal wrappers execute the underlying target for each ready goal-plan node, which is useful for implementation workflows but too surprising for media ingestion. Use goals in the generated follow-up workflows after the transcript has been converted into a concrete backlog.

Schedule the workflow only after a manual run produces useful backlog items:

```bash
loops create workflow transcript-feedback-weekly \
  --workflow transcript-feedback-to-loops \
  --cron "0 9 * * 1" \
  --attempts 2 \
  --retry-delay 10m \
  --lease 2h
```

## Loop Candidates

Transcript and feedback sources usually produce recurring work in a few durable categories:

- Code review and security: scan recent changes, identify risky diffs, and open focused remediation PRs.
- Customer or community feedback: summarize new feedback, cluster issues, and create small implementation tasks.
- Maintenance PRs: remove stale tests, reduce duplication, update docs, and fix flaky workflows.
- CI optimization: inspect slow jobs, propose changes, and validate runtime improvements with before/after evidence.
- Knowledge capture: turn important discussions into reusable docs, prompts, or skills.

Use an agent loop when judgment is needed. Use a command loop when the task is deterministic. Use a workflow when the loop needs ordered steps, separate accounts, or a validation gate.

## Guardrails

Only transcribe media you are authorized to access. Keep source metadata with transcript artifacts so reviewers can trace where an insight came from.

Every loop candidate should name:

- Cadence and trigger.
- Allowed repository paths and whether writes are permitted.
- Agent provider and account profile, if needed.
- Verification command or evidence artifact.
- Stop condition or archive condition.
- Human review point before scheduling or merging changes.

For loops that can mutate code, prefer a disposable worktree and prompts that explicitly limit write scope. Start with a one-shot smoke schedule before switching to a recurring cadence.

## Example Follow-Up Loops

Review and security loop:

```bash
loops create agent repo-review-daily \
  --provider codewith \
  --cron "0 8 * * 1-5" \
  --cwd /path/to/repo \
  --prompt "Review recent changes for correctness, security, and missing tests. Report concrete findings first. Do not modify files."
```

Maintenance PR loop:

```bash
loops create agent maintenance-pr-weekly \
  --provider codewith \
  --cron "0 10 * * 2" \
  --cwd /path/to/repo \
  --prompt "Find one small maintenance improvement, implement it, and run targeted verification. Keep changes scoped and reviewable."
```

CI optimization workflow loop:

```bash
loops workflows validate docs/workflows/generated/ci-optimization.json --preflight
loops workflows create docs/workflows/generated/ci-optimization.json
loops create workflow ci-optimization-monthly \
  --workflow ci-optimization \
  --cron "0 11 1 * *" \
  --attempts 2 \
  --retry-delay 15m
```
