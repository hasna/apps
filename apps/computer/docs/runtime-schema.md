# Runtime Schema

The durable runtime is the non-UI control-plane ledger for autonomous computer work. It is separate from legacy `sessions` and `action_logs` so the planner can model goals, workflows, approvals, resource locks, replay, and retained artifacts without depending on a single provider loop.

## Tables

- `runtime_goals`: operator goal record with a title, original prompt, lifecycle status, and timestamps.
- `workflow_definitions`: versioned workflow templates stored as JSON.
- `workflow_runs`: one execution of a goal or workflow. Status values are `pending`, `running`, `waiting_on_approval`, `paused`, `cancelling`, `cancelled`, `failed`, `completed`, and `max_steps_exceeded`.
- `run_steps`: ordered replayable steps for a workflow run. The `(run_id, step_index)` pair is unique.
- `observations`: screenshots, accessibility snapshots, browser states, terminal output, or other step/run observations.
- `approvals`: pending and resolved operator approvals for capabilities that cannot proceed automatically.
- `resource_leases`: exclusive active locks for resources such as `computer_display`, `terminal_session`, `browser_extension_session`, and `fleet_machine`. A partial unique index enforces one active controller per resource.
- `artifacts`: retained evidence such as screenshots, traces, logs, and reports with optional hashes and metadata.
- `policy_decisions`: durable allow/deny records for runtime-level policy decisions.
- `model_usage`: phase-level token and cost records for planner, executor, verifier, and provider-native model calls.
- `audit_events`: append-only transport-level security and policy audit events.

Coordinate-bearing observations should record the source space (`screenshot`, `scaled_screenshot`, `browser_viewport`, or `native_display`) and target display bounds when known, so model/browser-local points can be replayed without guessing multi-monitor offsets or screenshot scale.

## Migration Shape

SQLite bootstraps these tables in `getDb()` and keeps foreign keys enabled. PostgreSQL storage sync creates the equivalent remote shape through `PG_MIGRATIONS`, using `JSONB` for JSON payload columns and the same active lease uniqueness rule.

Runtime tables are included in `STORAGE_TABLES` so push, pull, and bidirectional sync cover both legacy sessions, model usage, and the durable run graph.

## Status Rules

Legal run transitions are enforced in `src/agent/runtime.ts`. Terminal states are `cancelled`, `failed`, `completed`, and `max_steps_exceeded`; terminal runs cannot be resumed by direct transition. Max-step exhaustion is represented as `max_steps_exceeded`, not as `completed` with an error.
