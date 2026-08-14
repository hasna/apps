# Local Roadmaps

Roadmaps are local planning records for grouping tasks, plans, runs,
milestones, and release labels. They are useful when an agent needs a stable
release-oriented plan without a hosted project tracker.

```bash
todos roadmaps create "Public package launch" --release v1 --json
todos roadmaps milestones add <roadmap-id> "Docs and examples" --tasks <task-id> --due 2026-06-01 --release v1 --json
todos roadmaps releases set <roadmap-id> v1 --milestones <milestone-id> --tasks <task-id> --release-version 1.0.0 --json
todos roadmaps show <roadmap-id> --json
todos roadmaps show <roadmap-id> --format markdown
todos roadmaps export <roadmap-id> --out roadmap.json
todos roadmaps import roadmap.json --apply --json
```

The summary includes task counts, completed and blocked counts, linked plans,
linked runs, milestone blockers, release groups, percent complete, and
readiness. Readiness is derived from local task statuses and dependency
blockers:

- `empty`: no linked tasks.
- `blocked`: at least one linked task has an incomplete dependency.
- `complete`: all linked tasks are completed.
- `in_progress`: at least one linked task is in progress.
- `ready`: linked tasks have no blockers and none are active yet.

MCP clients use the same surface with `create_roadmap`, `list_roadmaps`,
`get_roadmap_summary`, `update_roadmap`, `delete_roadmap`,
`create_milestone`, `update_milestone`, `delete_milestone`,
`set_release_group`, `export_roadmap`, and `import_roadmap`.
