# Project Dashboards

The package exposes two related dashboard surfaces.

## Capability Projection

`projectActionCapability(manifest, options)` creates a
`hasna.project_action_capability.v1` projection safe for a dashboard to render.
It includes identity, risk, resource and scope metadata, confirmation and
preflight information, approval/idempotency/rollback indicators, audit and
evidence metadata, blockers, links, and JSON metadata. It intentionally omits
executor bindings, commands, environment values, and implementation details.

`projectActionCapabilities` maps the same projection over an array. Options can
set `projectId`, override `manifestRef`, and change the default `/api/actions`
base path used to construct the server run URL.

The execution policy is `server-issued-run` only when
`projectActionBoundaryBlockers` returns no blockers. Execution is unavailable
when any of these apply:

- dry-run preview is unsupported;
- dry-run is not the default;
- the confirmation title is empty;
- `action.previewed` is absent from advertised audit events;
- a medium, high, or critical action has no approval requirement; or
- a critical action lacks a fail-closed guardrail.

This projection is descriptive. A server must still register the definition,
authorize the actor, create the run, and enforce approval and guardrail policy.

## Project Panel CLI

`actions project-panel --project <slug> --contract` emits a bounded
`hasna.project_panel.v1` panel. It matches explicit `projectId`, `project`, or
`project_id` metadata first. Manifests can also match with `scope.level` set to
`project` and the slug in `resource.identifiers`; runs for matched action ids are
then included.

Manifest items are emitted before recent run items and consume the shared limit.
The panel contains provider metadata, action/run counts, capability references,
and `ready` or `empty` state. It does not execute an action.
