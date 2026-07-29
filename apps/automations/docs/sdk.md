# SDK Reference

Install the control plane with its action-contract peer:

```sh
bun add @hasna/automations @hasna/actions
```

`@hasna/contracts` is a direct dependency and provides the shared work-run,
decision, and evidence contracts returned by adapter helpers.

## Export Map

| Import | Surface |
| --- | --- |
| `@hasna/automations` | All public types plus store, path, runtime, contract-adapter, and recipe helpers. |
| `@hasna/automations/store` | `AutomationsStore`, spec validation, examples, and webhook normalization. |
| `@hasna/automations/paths` | Data root, database, PID, and log path helpers. |
| `@hasna/automations/runtime` | OpenLoops runtime binding descriptors. |
| `@hasna/automations/contracts` | `@hasna/contracts` adapters for runs, approval decisions, and evidence refs. |
| `@hasna/automations/recipes` | Launch follow-up recipe rendering and file helpers. |
| `@hasna/automations/cli` | Embeddable `runAutomationsCli`. |
| `@hasna/automations/daemon` | Daemon CLI runner and webhook HTTP helpers. |

## Store

```ts
import { AutomationsStore, exampleAutomationSpec } from "@hasna/automations";

const store = new AutomationsStore();
const automation = store.createAutomation(exampleAutomationSpec());
const materialized = store.materializeEvent({
  id: "evt_1",
  source: "open-events",
  type: "ticket.created",
  data: { priority: "critical" },
}, { automationId: automation.id });
store.close();
```

The store uses SQLite at `<data-root>/automations.db`. Event materialization
matches only active automations with `event` or scoped `webhook` triggers.
Idempotency uses `event.dedupeKey` and falls back to `event.id`. Trigger filters
perform top-level equality and support `{ "not": value }`; they are not a
general expression language.

Every matched action step is enqueued. `dependsOn` gates claiming until its
dependencies succeed. `AutomationActionStep.when` is advisory metadata and is
not evaluated. Manual, schedule, and API trigger kinds validate and persist,
but the current event materializer does not execute them.

`createReplayRequest` persists replay intent for a source run; no current store
worker consumes those records. Use `requeueDeadAction` or `automations dlq
replay` to move a dead action back to the queue.

## Contract Adapters

```ts
import {
  automationRunToWorkRun,
  queuedActionDecisionEnvelopes,
} from "@hasna/automations/contracts";

const decisions = queuedActionDecisionEnvelopes(actions);
const workRun = automationRunToWorkRun(run, { decisions });
```

`automationRunToWorkRun` emits a validated `work_run`. The narrower shared
status vocabulary maps `materialized` to `pending` and `dead` to `failed`,
while preserving the original status in metadata. Evidence strings become
contract evidence pointers or refs without embedding opaque source values in
public ids.

## Recipes And Runtime

`launchFollowupRecipePack` returns five validated specs: T+1/T+3/T+7
engagement checks, non-engaged enrollment, and an uptime watch window.
`writeRecipePack` and `loadRecipeSpecFile` write and validate JSON files.

`listDefaultRuntimeBindings` returns an OpenLoops claim-queue descriptor. It is
metadata only: Automations never invokes agent workflows or owns OpenLoops run
artifacts.
