---
"@hasna/todos": minor
---

Five CLI verbs get a hosted `/v1` arm instead of writing to the local store (PORT-TO-API slice A3)

`pin`, `steal`, `redistribute`, `import <github-url>` and `export` reached `src/db/*` with no hosted
arm, so under a hosted credential they mutated this machine's private store while the rest of the CLI
was already remote-only:

- `pin` escalates through `PATCH /v1/tasks/{id}` with the version it just read.
- `steal` finds the stale task on the shared store (`GET /v1/tasks`), then unlocks, locks and starts it
  (`POST /v1/tasks/{id}/{unlock,lock,start}`), so the steal is visible fleet-wide. It will not take a
  task the requesting agent already holds.
- `redistribute` releases the stale set on the shared store and claims through
  `POST /v1/tasks/next/claim`; releasing locally used to leave the shared row locked.
- `import <github-url>` still fetches the issue with `gh` locally, but writes the task with
  `POST /v1/tasks`.
- `export --format json` reads `GET /v1/tasks`. `--format md` and `--format bridge` are built from a
  whole-store local bridge bundle that has no `/v1` equivalent, so they now refuse with a message
  pointing at `--format json` rather than emitting a bundle assembled from an empty local store.

These verbs remain listed as `local-only` in `src/cli/stage-a.ts`, which is owned by another change in
flight; the hosted arms land first and the routing entry follows.
