---
name: skill-testers-workflow
description: "Create, run, and maintain reusable @hasna/testers workflows for deterministic scripts, agentic goal loops, personas, local execution, and sandbox execution. Trigger when asked to map workflows, test a user journey, run a script, use sandboxes, or make repeatable QA flows."
user_invocable: true
---

# skill-testers-workflow

Use this when a QA request is more than a one-off page check: auth flows,
project creation, chat prompts, connector setup, billing, admin actions,
multi-persona behavior, non-deterministic AI interactions, or any flow that
should be saved and rerun.

## Model The Workflow First

1. Name the user-visible journey, not the implementation detail.
2. Split deterministic checks from agentic/non-deterministic steps.
3. Decide the execution target:
   - `local`: fast, cheap, good for simple flows and local dev servers.
   - `sandbox`: bigger, slower, better for isolated repo setup, long-running
     workflows, destructive tests, or tests that need a clean machine.
4. Decide whether this should be:
   - Scenarios: stored steps run by `testers run`.
   - A workflow: reusable saved bundle with tags/personas/goal/sandbox config.
   - A hybrid script: TypeScript file run by `testers run-script`.
   - A goal loop: `testers workflow agent`, which can create open-todos next
     actions from observed failures.

## Create Scenarios

For manual scenario steps:

```bash
testers add "User can create a project" \
  --description "Creates a project from the dashboard and verifies it appears" \
  --steps "Open the dashboard" \
  --steps "Click New project" \
  --steps "Enter a unique project name" \
  --steps "Save the project" \
  --steps "Verify the project appears in the list" \
  --tag projects --tag smoke --priority high
```

For AI-generated coverage:

```bash
testers generate "<url>" --focus "<journey or area>" --save --json
testers list --tag "<tag>" --json
```

For recorded sessions:

```bash
testers record "<url>"
testers convert "<recording-or-har-file>" --model "<model>" --json
```

## Save A Workflow

Local workflow:

```bash
testers workflow create "<name>" \
  --description "<what the journey proves>" \
  --tag "<tag>" \
  --goal "<agentic testing goal if needed>" \
  --success "<observable success criterion>" \
  --target local \
  --json
```

Sandbox workflow:

```bash
testers workflow create "<name>" \
  --description "<what the journey proves>" \
  --tag "<tag>" \
  --goal "<agentic testing goal if needed>" \
  --success "<observable success criterion>" \
  --target sandbox \
  --sandbox-provider e2b \
  --sandbox-package @hasna/testers \
  --sandbox-setup-command "<repo setup command>" \
  --sandbox-cleanup delete \
  --json
```

Run or inspect before launching:

```bash
testers workflow show <id> --json
testers workflow run <id> --url "<url>" --dry-run --json
testers workflow run <id> --url "<url>" --model "<model>" --json
testers workflow agent <id> --url "<url>" --model "<model>" --json
```

## Hybrid Scripts

Use `testers run-script` when part of the flow is deterministic Playwright-like
automation and part needs AI judgment. Keep scripts in the app repo near other
tests, not in global config.

```bash
testers run-script tests/qa/<workflow>.ts --url "<url>" --json
```

Hybrid scripts should export `HybridScenario[]` and keep selectors stable
through roles, labels, or `data-testid`.

## Maintenance Rules

- Store reusable workflows/scenarios in `testers`; do not leave them only in
  chat history.
- Prefer tags that map to product areas: `auth`, `projects`, `billing`,
  `connectors`, `admin`, `chat`, `smoke`, `regression`.
- Use personas for role-sensitive behavior instead of hardcoding user state.
- Never store secrets in workflow descriptions, steps, scripts, or generated
  JSON. Use env vars or the approved secrets workflow.
- If a workflow fails because the app is wrong, fix the app and rerun. If it
  fails because the workflow is stale, update the workflow and record why.

## Done

Done means the workflow is saved or the script exists, a dry-run plan was
checked, at least one real run was executed, and the result/report is attached
or summarized in the active `todos` task.
