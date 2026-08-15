---
name: skill-testers-qa
description: "Use @hasna/testers for a serious AI-native QA pass on a web app or repo. Trigger for requests like test this app, QA this feature, run testers, check the preview, validate auth/pages, run local or sandbox browser tests, or find and fix product bugs."
user_invocable: true
---

# skill-testers-qa

Use `testers` as the execution surface for app QA. This is broader than unit
testing: it checks real pages, browser behavior, generated scenarios, repo-native
tests, screenshots, console/network failures, personas, accessibility, and
regressions. If bugs are found and the user asked for fixes, fix them and rerun.

## Start

1. Create or update a `todos` task and post a short start message:
   ```bash
   todos add "QA <app or feature>" --project "$(pwd)" --priority high --tags qa,testers
   conversations send --space "<project-or-testers>" "Starting QA: <scope>"
   ```
2. Identify the target:
   - If the user gave a URL, use it.
   - If the app is local, discover the dev command and port from `package.json`,
     `.env`, server docs, or existing process state. Start/restart it yourself.
   - On multi-machine work, bind servers to `0.0.0.0` and use
     `http://<machine>:<port>`.
3. Run setup checks:
   ```bash
   testers doctor
   testers project list --json || true
   testers list --json || true
   testers repo discover . --json || true
   ```
   Do not print API keys or secrets. If no provider key is available, either use
   deterministic/repo-native tests or fix the key setup through the approved
   secrets workflow.

## Choose The Run

- Fast default pass: `testers quick-qa <url> --json --output /tmp/testers-quick-qa.json`
- Fast default without AI smoke: `testers quick-qa <url> --no-smoke --json`
- Fast default with accessibility: `testers quick-qa <url> --a11y AA --json`
- Existing scenarios: `testers run <url> --json --output /tmp/testers-run.json`
- No scenarios yet: `testers run <url> --auto-generate --json --output /tmp/testers-run.json`
- Focused feature: `testers generate <url> --focus "<area>" --save`, then run by
  tag or scenario.
- Fast CI smoke: `testers run <url> --smoke --minimal --json`
- Accessibility: `testers run <url> --a11y AA --json`
- Selector churn: add `--self-heal` when the goal is to repair flaky selectors.
- Changed files only: `testers run-affected <url>` or `testers run <url> --diff`.
- Repo-native Playwright: `testers repo prepare .` then `testers repo run .`.
- Larger or risky workflow: create/run a sandbox workflow with
  `skill-testers-workflow`.

Prefer provider-specific model IDs when useful:
- Cerebras: `--model qwen-*` or `--model llama-*`
- Z.AI GLM: `--model glm-5.1`
- OpenAI: `--model gpt-*`
- Google: `--model gemini-*`
- Anthropic/default: Claude model IDs or presets

## Investigate Failures

After a run:

```bash
testers runs --json
testers results <run-id> --json
testers screenshots <run-or-result-id> --json
testers report <run-id>
```

Classify each failure before editing:
- App bug: user-visible error, broken route, console/network failure, bad UI state.
- Test bug: stale selector, wrong assumption, missing auth/persona/setup.
- Environment bug: server down, database not migrated, missing provider key.

If it is an app bug, reproduce with the smallest scenario or browser step,
write a regression test where the repo has an appropriate test layer, fix the
root cause, rerun the failing scenario, then rerun the relevant suite.

## Done

The task is done only when:
- The target URL/app was actually exercised.
- Results, screenshots or report IDs are recorded in the task/comment.
- Bugs found during a fix request are fixed and reverified.
- The final run is green or remaining failures are scoped, reproduced, and
  intentionally tracked as follow-up tasks.
