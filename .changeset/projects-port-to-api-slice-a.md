---
"@hasna/projects": minor
---

The start surfaces name their actor over the hosted `/v1` API instead of the
on-box database, and `/v1/machines` is finally in the OpenAPI spec.

- `projects start`, `projects_start` and `projects_render_start` resolved the
  attributing agent with `ensureCliAgent()` / `resolveAgentId()`, which read —
  and created rows in — the on-box SQLite agent table. They did it
  unconditionally, so a station running entirely on the hosted registry still
  opened `~/.hasna/projects/projects.db` just to put a name on a start event.
  On a hosted credential all three now resolve an explicitly named actor
  through the shared agent registry (`GET /v1/agents/{id-or-slug}`) and leave
  an unnamed actor to the server, which derives attribution from the bearer
  key — the same rule `projects_agents_assign` and `projects_locations_add`
  already followed. An actor that the hosted registry does not know fails with
  `Agent not found: <name>` instead of quietly inventing a local agent row. The
  on-box registry path (`HASNA_PROJECTS_LOCAL=1`) is unchanged.
- `GET /v1/machines` has been served by `projects-serve` since the canonical
  machine registry landed, but it was missing from `/openapi.json`, so every
  generated client and every reader of the spec believed the machine registry
  had no hosted route. It is now documented (`listMachines`, `MachineList`),
  and a new test fails if any resource family the server dispatches is left out
  of the spec again.
