# SDK Lifecycle

Import the complete API from `@hasna/actions` or the curated SDK surface from
`@hasna/actions/sdk`.

```ts
import {
  ActionsClient,
  createTypeScriptAction
} from "@hasna/actions";

const action = createTypeScriptAction({
  manifest,
  input: inputSchema,
  output: outputSchema,
  preview: async ({ input }) => ({ summary: `Would update ${input.id}` }),
  execute: async ({ input }) => ({ updated: input.id })
});

const client = new ActionsClient();
await client.register(action);
```

`new ActionsClient()` uses the default SQLite store at the effective actions
data home — the legacy `~/.hasna/actions/actions.db` default, resolved through
`@hasna/paths`, until the XDG data home is adopted (store migrated there or
`HASNA_DATA_HOME` set) — backed by `bun:sqlite`. Outside Bun, pass an
explicit store such as `new JsonActionsStore()`:

```ts
import { ActionsClient, JsonActionsStore } from "@hasna/actions";

const client = new ActionsClient({ store: new JsonActionsStore() });
```

Registration stores the manifest and keeps the executable definition in the
current `ActionsClient`. A manifest loaded from storage is inspectable but is
not executable until its definition is registered in that process.

## Methods

- `register(definition)` validates and stores a definition's manifest.
- `listManifests()` and `getManifest(id)` inspect manifests.
- `plan(request)` validates adapted input, applies idempotency, creates the run
  and plan, stores it, and emits `action.planned`.
- `preview(runId)` runs guardrails, creates a preview, and emits
  `action.previewed`, or denies the run.
- `approve(runId, decision)` records an approval and moves the run to `approved`
  only when every requirement is satisfied.
- `deny(runId, decision)` records a denial and sets the run to `denied`.
- `execute(runId, options)` checks denial, dry-run, approvals, and guardrails
  before invoking the executor.
- `run(request, options)` composes plan, preview, optional auto-approval, and
  execution. A request or manifest-default dry-run returns after preview.
- `getRun`, `listRuns`, and `listAuditEvents` inspect persisted state.

## State Transitions

A normal mutation follows:

```text
planned -> previewed -> awaiting_approval -> approved -> executing -> succeeded
```

Runs without outstanding approvals can move directly from `previewed` to
`executing`. Guardrails or an operator can set `denied`. Executor errors set
`failed`; when `rollbackOnFailure` is true and the executor supplies `rollback`,
the rollback preview is stored and status becomes `rolled_back`. Dry-runs remain
`previewed`, including calls to `execute` for a stored dry-run.

## Idempotency

When `idempotency.required` is true, planning without a key throws. A repeated
key returns the newest existing run for that action unless its status is
`failed`, `denied`, or `cancelled`. The returned copy sets `dedupedFromRunId` to
the existing run id. Stores do not automatically enforce retention metadata.

## Guardrails and Approvals

Guardrail hooks run during preview and again immediately before execution. A
fail-closed manifest with no configured hooks is denied. Hooks run in order;
the first denial stops evaluation, while warnings and metadata are combined.

The SDK evaluates approval counts and optional role requirements. It does not
authenticate actors or resolve organizational authority; the host must supply
trusted actor records and decide who may call `approve` or `deny`.

## Audit and Evidence

Lifecycle events are appended to the store and then sent to each configured
audit sink. Sink failures propagate to the caller. Request evidence is copied
onto `run.evidence`; preview evidence remains nested under `run.preview`, and
executor output remains under `run.output`. The client does not merge those
fields or independently verify manifest evidence requirements.

The current lifecycle can emit `action.planned`, `action.previewed`,
`action.awaiting_approval`, `action.approved`, `action.denied`,
`action.executing`, `action.executed`, `action.failed`, and
`action.rolled_back`.
