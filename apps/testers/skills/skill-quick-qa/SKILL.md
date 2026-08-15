---
name: skill-quick-qa
description: "Run a quick testers-powered QA pass, fix every bug found when the user asked for fixes, and verify the final app behavior. Trigger for quick QA, smoke test this, check the app, run browser QA, or find and fix product bugs."
user_invocable: true
---

# skill-quick-qa

Use `testers` as the primary execution surface. This skill is for a fast but
real QA pass: server health, console/runtime errors, broken links, performance,
optional accessibility, and optional autonomous smoke exploration.

This is not a report-only skill when the user asks for fixes. Find issues, turn
them into tracked tasks, fix the root cause, rerun the failing check, then rerun
the quick QA pass.

## Start

1. Create or update the active `todos` task and add a progress comment.
2. Determine the app URL:
   - Use the URL from the user when provided.
   - Otherwise inspect the repo for a dev command and port, start the server
     yourself, and use `http://<machine>:<port>` for remote machine access.
   - Bind local dev servers to `0.0.0.0` when another machine needs to reach
     them.
3. Confirm the server is answering before running browser checks:
   ```bash
   curl -fsS "<url>" >/tmp/testers-health.html
   testers doctor
   ```

## Run The Quick Pass

Default:

```bash
testers quick-qa "<url>" --json --output /tmp/testers-quick-qa.json
```

Use these variants when they fit:

```bash
testers quick-qa "<url>" --no-smoke --json --output /tmp/testers-quick-qa.json
testers quick-qa "<url>" --a11y AA --json --output /tmp/testers-quick-qa.json
testers quick-qa "<url>" --page / --page /login --page /dashboard --json
testers quick-qa "<url>" --skip perf --skip smoke --json
```

Use `testers quick-check` only as an alias for `testers quick-qa`.

If `testers quick-qa` is not available in the installed CLI, update/publish
`@hasna/testers` from `open-testers` instead of falling back to unrelated
browser tools.

## Fix Loop

For each failing issue:

1. Record the failing URL, check name, severity, message, screenshot/report ID,
   and command in the task comment.
2. Classify the failure:
   - App bug: broken route, UI state, console/network/runtime failure, bad auth.
   - Test setup bug: stale scenario, missing auth, missing seed data.
   - Environment bug: server down, migrations missing, provider key unavailable.
3. Fix the smallest root cause and add a regression test at the repo's natural
   test layer.
4. Rerun the narrow failing command.
5. Rerun `testers quick-qa`.

For deeper flows that quick QA cannot cover, switch to `skill-testers-qa` or
`skill-testers-workflow` and use saved scenarios/workflows rather than ad hoc
manual clicking.

## Done

Only report completion when:
- `testers quick-qa` has run against the target app.
- Bugs found in a fix request are fixed and reverified.
- The final command, output file/report, and remaining tracked issues are posted
  to the active task.
- Any remaining failures have explicit follow-up tasks with evidence.
