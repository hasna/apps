# Goals — apps

> Goals registry — per the Hasna goals convention (knowledge: `hasna-goals-file-convention`).
> This exact file lives at `.hasna/goals/goals.md` in the project workspaces and repository
> clones covered by the rollout (owner directive 2026-08-30, task 43f7ddad); new workspaces
> and repos receive it as part of their scaffolding.
> A goal is NOT a todos task. Goals live HERE; the work that executes a goal lives in Hasna Todos
> (plans, task lists, tasks) and is LINKED from each goal below.

## Ownership

- **Sole owning durable agent: `TBD — set when goals are assigned (owner directive 2026-08-30)`** — the only agent responsible for completing the goals in this file.
- When Andrei names the owning agent, that agent records itself as Owner below and updates this file.
- Every other agent may READ this file; they work toward these goals only when the owning agent or Andrei tells them to.

## Coordination-loop duty — mandatory (every agent)

Every coordination loop an agent sets up MUST include this prompt verbatim:

> GOALS CHECK: read `.hasna/goals/goals.md` on every firing. Is each listed goal done?
> For time-sensitive goals, compare the target against the current time (Europe/Bucharest).
> Dispatch a verification workflow when a goal is newly claimed done or when its Last checked
> is stale — never unconditionally on every firing. Only the goal's owning agent advances or
> updates goals; every other agent reports what it observes.

## Goal registry

| Goal | Owner | Linked todos plan / task list / task | Target (Europe/Bucharest) | Status | Last checked |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

## Goal fields

- **Goal** — one-line outcome the owning agent is responsible for.
- **Owner** — the one durable agent in charge of completing this goal.
- **Linked** — the todos plan id, task list and/or task ids that execute the goal (goals themselves are never tasks).
- **Target** — date or `none`; a date makes the goal time-sensitive (checked against time on every loop firing).
- **Status** — `open` / `in_progress` / `done` / `blocked`.
- **Last checked** — date the goal was last verified by a workflow.