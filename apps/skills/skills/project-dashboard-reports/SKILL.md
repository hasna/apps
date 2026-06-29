---
name: project-dashboard-reports
description: Use when creating, validating, serving, or documenting Hasna agent-managed project dashboards and JSON Render reports with the Projects CLI, provider panels, .hasna/project layout, or #iproj-* project channels.
---

# Project Dashboard Reports

Use the Projects-owned dashboard surface for agent-managed project folders.
Do not build a one-off app or chat UI unless `open-projects` cannot express the
surface.

## Canonical Layout

- Project folder: `Workspace/<division>/project/<project-slug>`
- Dashboard root: `.hasna/project/`
- Render manifest: `.hasna/project/dashboard/render.json`
- Latest snapshot: `.hasna/project/dashboard/snapshots/latest.snapshot.json`
- Conversation channel: CLI name `iproj-<project-slug>`, human display
  `#iproj-<project-slug>`

Project folders may contain private documents. Dashboard JSON should use ids,
counts, statuses, resource refs, evidence refs, and redacted summaries rather
than raw emails, contract clauses, account numbers, identity documents, or
credentials.

## Viewer Workflow

Use the explicit dashboard namespace:

```bash
projects dashboard snapshot <project> --write --json
projects dashboard render <project> --json
projects dashboard validate <project> --json
PROJECTS_DASHBOARD_TOKEN=<token> projects dashboard serve <project> --host 0.0.0.0 --port <port>
```

`snapshot`, `render`, and `validate` are read-only unless `--write` is passed.
For non-loopback serving, use `--token`, `PROJECTS_DASHBOARD_TOKEN`, or an
explicit `--trust-network` choice. Do not put dashboard access tokens in URLs,
tasks, reports, render specs, or chat messages.

## Provider Panels

Provider CLIs should emit bounded `hasna.project_panel.v1` JSON:

```bash
todos project-panel --project <project> --json --contract
files project-panel --project <project> --json --contract
mailery status project-panel --project <project> --limit 20 --json --contract
conversations project-panel --project <project> --limit 30 --json --contract
knowledge project-panel --project <project> --scope project --limit 30 --json --contract
mementos --json project-panel --project <project> --contract
reports project-panel --project <project> --json --contract
```

Run provider commands from the project cwd when project-local stores matter.
Mailery remains workspace-scoped until explicit project-email mapping exists.
Providers should degrade to unavailable/error panels instead of dumping raw
content.

## Agent Workflow

- Track work in `todos`; use messages only for coordination.
- Use durable Codewith goals or goal plans for long-running project work.
- Route new implementation and verification through fresh task-triggered agents,
  not existing tmux panes.
- Record evidence as task ids, project ids, commit ids, local artifact paths, and
  dashboard URLs.
- Update durable knowledge with stable architecture or policy decisions, but do
  not store secrets or raw private document text as knowledge.

## Done Criteria

- `projects dashboard validate <project> --json` passes.
- Dashboard render is a React Flow/JSON Render canvas from `open-projects`.
- Provider failures are visible as bounded error/unavailable panels.
- Sensitive content appears only as redacted summaries and ids.
- The task has validation evidence and the served dashboard URL when requested.
