# Integration Notes

`orgs` is a graph and context layer. It stores refs, ownership edges,
delegation edges, resolver evidence, and privacy-safe snapshots. It does not
own source records that belong to sibling packages.

## Ownership Matrix

| Domain | Source of Truth | orgs Responsibility |
| --- | --- | --- |
| Human, agent, service, and organization identity records | `identities` | Store `identityRef` pointers and use public IDs in snapshots. Do not copy documents, contact points, traits, voice, image, or private metadata. |
| Project/workspace records, locations, and project-agent assignments | `projects` | Store `projectRef` pointers and graph ownership/stewardship edges. Do not duplicate workspace state or filesystem locations. |
| Machine manifests, topology, workspace routes, and machine-project assignment envelopes | `machines` | Store `machineRef` pointers plus cacheable dispatch/resolver evidence. Treat stale machine refs as warnings. |
| Live sessions and transient panes | `sessions` | Store optional resolver snapshots only. Do not treat live pane state as durable truth. |
| Prompt dispatch and target validation | `dispatch` | Return candidate machine/target refs and refusal reasons. Dispatch still performs live target checks before delivery. |
| Task orgs, reports-to fields, project roles, and todo assignments | `todos` | Provide bridge/import/export context. `todos` remains the task execution source of truth. |
| Events and webhook delivery | `events` | Keep local audit JSONL now; future adapters may emit graph-change events through `events`. |
| Action actor context | `actions` | Use `actor_context` edges and member refs. No hard dependency while `actions` is still a placeholder. |
| Guardrail policy context | `guardrails` | Use `policy_context` edges and external refs. No hard dependency while `guardrails` is still a placeholder. |

## Delegation Resolution

Delegation is intentionally two-stage:

1. `orgs` answers who is allowed or recommended for a scoped delegation.
2. `dispatch` verifies live machine and tmux target safety before typing
   anything.

`orgs resolve` returns:

- eligible targets
- relationship authority
- scope and capabilities
- dispatch target evidence when present
- refusal reasons for inactive, stale, busy, missing, or mismatched targets
- warnings when evidence is stale or absent

This keeps durable org authority separate from live terminal safety.

## Snapshot Contract

Agent snapshots are designed for prompt context. They are concise and
privacy-safe:

- external metadata is stripped
- identity documents are excluded
- contact points are excluded
- private machine/project payloads are excluded
- stale refs and unavailable dispatch targets become warnings

Consumers should treat a snapshot as advisory context, not as authorization to
execute an action. Action and dispatch systems still need their own policy and
runtime checks.

## Bridge Guidance

Bridge integrations should be explicit and reversible:

- Import from `identities` by creating or refreshing member `identityRef`
  fields.
- Import from `projects` by creating project refs and optional ownership
  edges.
- Import from `machines` by creating machine refs and resolver evidence.
- Import from `todos` by mapping task orgs and `reports_to` metadata into
  typed `reports_to` edges.
- Export to `actions` as actor/context refs, not embedded member objects.
- Export to `guardrails` as policy-context refs, not embedded policy
  bodies.

If a bridge cannot prove freshness or authority, it should set `stale: true`
on the external ref or lower relationship `confidence`.

## Storage Compatibility

The native store lives in the effective orgs data root, resolved by the
`@hasna/paths` resolver. The legacy default is `~/.hasna/orgs/orgs.json`; the
resolver (XDG) data home `~/.local/share/hasna/orgs/orgs.json` is adopted once
`HASNA_DATA_HOME` is set or the store already exists there. `HASNA_ORGS_HOME`
sets an exact data root that wins over both. Some local environments may also
contain a legacy or alternate `~/.hasna/orgs/orgs.db`. `orgs status` reports
only metadata evidence for that SQLite file when the active JSON store is
missing or empty: path, existence, size, modified time, and reason. It never
reads SQLite rows or emits private source data.

Follow-ups that should stay explicit rather than implicit:

- Add a reviewed `orgs migrate sqlite` or bridge import command if SQLite data
  needs to become JSON graph data.
- Add refresh/update bridge commands for sibling systems only when freshness and
  authority rules are defined.
- Restore registry install instructions only after an authorized publish and a
  successful `bun run verify:published`.
