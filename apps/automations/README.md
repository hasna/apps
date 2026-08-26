# @hasna/automations

Deterministic automation control plane and daemon for Hasna open-source apps.

`automations` is the real automation product surface. It owns automation
specs, trigger materialization, deterministic run/action queue state, replay
requests, daemon leases, and release-grade audit boundaries. It uses
`@hasna/actions` as the action contract layer and can hand deterministic action
execution to runtime providers without owning agent workflow invocation.

## Package

```sh
bun add @hasna/automations @hasna/actions
```

```ts
import { AutomationsStore, exampleAutomationSpec } from "@hasna/automations";

const store = new AutomationsStore();
store.createAutomation(exampleAutomationSpec());
console.log(store.status());
store.close();
```

## Documentation

- [CLI reference](docs/cli.md): commands, options, queue semantics, and daemon defaults.
- [SDK reference](docs/sdk.md): exports, store behavior, contract adapters, and recipes.
- [Webhook ingress](docs/webhooks.md): mappings, route lifecycle, signatures, and HTTP responses.
- [Repository and package plan](docs/repo-package-plan.md): package boundaries and follow-up direction.

## CLI

```sh
automations --help
automations --version
automations --json init
automations --json status
automations --json spec example
automations --json validate automation.json
automations --json create automation.json
automations --json list
automations --json simulate automation.json --persist --event-json '{"id":"evt_1","source":"events","type":"ticket.created","data":{"priority":"critical"}}'
automations --json runs list --contract
automations --json runs show <run-id> --contract
automations --json queue lease --runner worker-1
automations --json queue complete <action-id> --runner worker-1 --result-json '{"ok":true}'
automations --json queue fail <action-id> --runner worker-1 --code UPSTREAM_500 --message "upstream failed"
automations --json queue approve <action-id>
automations --json queue reject <action-id> --reason "policy denied"
automations --json dlq list
automations --json dlq replay <action-id>
automations --json webhooks create tickets.escalate-critical --id tickets --path /webhooks/tickets --source events --type ticket.created --data-path data --dedupe-key-header X-Hasna-Event-Id --secret-ref secret://automations/webhooks/tickets
automations --json webhooks event tickets --body-json '{"data":{"priority":"critical"}}' --header X-Hasna-Event-Id:evt_1
automations --json webhooks test tickets --body-json '{"data":{"priority":"critical"}}' --header X-Hasna-Event-Id:evt_1
automations --json webhooks list
automations --json webhooks show tickets
automations --json webhooks disable tickets
automations --json webhooks enable tickets
automations --json webhooks rotate-secret tickets --secret-ref secret://automations/webhooks/tickets-v2
automations --json webhooks archive tickets
automations --json recipes list
automations --json recipes render launch-followup --app-id todos --package @hasna/todos --app-version 1.2.3 --out ./specs --create
automations --json runtimes
automations-daemon --json status
automations-daemon --version
automations-daemon --json run
automations-daemon --json run --once
automations-daemon --json serve --host 127.0.0.1 --port 7391
```

Global `--dir` and `--json` options must appear before the command.

The default data root is `~/.hasna/automations`, resolved through the
`@hasna/paths` resolver. Override it with `HASNA_AUTOMATIONS_DIR` or
`AUTOMATIONS_DATA_DIR`; the XDG data home
(`~/.local/share/hasna/automations`, or `$HASNA_DATA_HOME/automations`) is
adopted once the store has been migrated there or `HASNA_DATA_HOME` is set.

`automations-daemon run` stays alive and maintains the local daemon lease until
it receives `SIGINT` or `SIGTERM`. Use `--once` for smoke checks and tests.

## Release Webhook Smoke

The repeatable installed-package release smoke is captured in
`scripts/release-webhook-smoke.ts`. With no options it installs the version in
`package.json` and its default `@hasna/actions` peer into a disposable project:

```sh
bun run smoke:webhook-release
```

The script installs the requested package spec into a disposable Bun project.
For the historical `@hasna/automations@0.1.1` replay it pins
`@hasna/actions@0.1.0`; other package specs use `@hasna/actions@^0.1.0` unless
`--no-default-peers` is passed. It uses disposable `HASNA_AUTOMATIONS_DIR`
state, creates a fixture automation and signed webhook route, records daemon
heartbeat and `/healthz` checks, sends a signed HTTP `POST`, leases the admitted
action as an OpenLoops runner, and exports a normalized webhook event as dry-run
OpenLoops handoff evidence. It prints JSON evidence with secrets and signatures
redacted, then removes temp directories unless `--keep` is passed.

For local worktree validation after `bun run build`, pass a local package spec
and explicit peer specs:

```sh
bun run smoke:webhook-release -- --package file:$PWD --no-default-peers --peer file:/path/to/actions
```

The OpenLoops handoff check is intentionally dry-run only: it validates the
`automations --json webhooks event ...` envelope and records the exact
`loops --json events handle generic` command that an operator would run, without
creating OpenLoops workflow runs.

## Launch follow-up recipe pack

`automations recipes render launch-followup ...` renders a release-anchored
pack of automation spec templates (distribution apps plan): T+1/T+3/T+7
engagement checks (announce report with a threshold-gated low-engagement task
→ engagement event), enrollment of non-engaged recipients into a mailery
follow-up sequence (policy-gated, suppression-respecting), and an uptime
regression watch-window opened on `release.published`. `--out <dir>` writes
one JSON spec file per recipe and `--create` registers them in the local
store. Programmatic access:
`import { launchFollowupRecipePack } from "@hasna/automations/recipes"`.

Platform semantics the pack is written against:

- **Step conditions**: the control plane enqueues every step of a matched
  automation and gates dispatch only on `dependsOn` success.
  `AutomationActionStep.when` is NOT evaluated anywhere today — treat it as
  advisory metadata pending runner support. The pack therefore places all
  conditional behavior (engagement thresholds via `onLowEngagement`,
  regression detection via `onRegression`) in the input contract of the
  action that owns the data, never in unconditional dependent steps.
- **Schedule triggers**: `schedule.release-offset` triggers are not matched
  by the event pipeline and no scheduler exists yet; the four
  schedule-triggered specs register cleanly but stay inert until the
  follow-up scheduler lane lands. The event-triggered uptime watch
  (`release.published`) becomes live as soon as its
  `uptime.watch-window.open` action is implemented in the action layer.

## Boundaries

- `actions` defines portable action manifests and invocation contracts.
- `events` is trigger ingress.
- `automations` materializes triggers into durable automation runs and
  admitted deterministic action work.
- `loops` owns agent workflow invocation, admission, and workflow run
  artifacts. It can consume explicit event envelopes from OpenAutomations, but
  it is not the automation product.

## Runtime Model

The local store enforces idempotent event-to-run materialization and idempotent
run-step queue rows. Queue workers claim available actions with a lease, mark
them succeeded, retryable, or dead, and can replay dead actions through the DLQ
surface. Event ingestion accepts OpenEvents-compatible envelopes structurally,
so the OpenEvents package remains the trigger ingress boundary.

## Integration Contracts

OpenEvents deliveries are input, not durable automation state. OpenAutomations
uses `event.dedupeKey` first and falls back to `event.id` when building
event-to-run and event-to-action idempotency keys. Replaying the same event
through OpenEvents therefore returns the existing run/action rows. SDK replay
requests record operator intent but do not rematerialize a run or bypass
idempotency; `dlq replay` is the executable replay surface and only requeues a
dead action.

OpenLoops is an optional runtime binding for deterministic OpenAutomations
actions, not the scheduler or control plane for automations. A runtime worker
leases admitted deterministic actions with:

```sh
automations queue lease --runner loops:<worker-id>
```

It must complete or fail the same action with the same runner id before the
lease expires:

```sh
automations queue complete <action-id> --runner loops:<worker-id>
automations queue fail <action-id> --runner loops:<worker-id> --code <code> --message <message>
```

The queue enforces runner ownership and live leases for completion/failure, so
stale workers cannot finalize reclaimed actions (fencing token).

Webhook ingress uses the same materialization path. The daemon accepts `POST`
requests on registered webhook paths, verifies HMAC SHA-256 signatures over the
exact raw request bytes when a route has `secretRef`, normalizes the request
into an event envelope, and then calls the durable materializer. It never stores
raw webhook secrets, raw signatures, request headers, or raw payload blobs by
default. Route state stores secret references, while normalized event envelopes
include a SHA-256 body hash and route metadata; durable run/action metadata does
not copy the raw payload.

At runtime the daemon resolves signed route secrets from route-scoped
environment variables:

```sh
HASNA_AUTOMATIONS_WEBHOOK_SECRET_<ROUTE_ID>
AUTOMATIONS_WEBHOOK_SECRET_<ROUTE_ID>
HASNA_AUTOMATIONS_SECRET_<SECRET_REF_WITHOUT_SECRET_SCHEME>
```

For explicit OpenLoops event workflow routing, export only the normalized event
envelope and pipe it into OpenLoops:

```bash
automations --json webhooks event tickets \
  --body-json '{"data":{"priority":"critical"}}' \
  --header X-Hasna-Event-Id:evt_1 \
  | loops --json events handle generic
```

`webhooks event` and `webhooks test` are local operator commands. They do not
verify HMAC signatures or accept network requests; use `automations-daemon serve`
for signed ingress.

This event-envelope handoff is operator opt-in. OpenAutomations still owns
automation specs, trigger materialization, deterministic action queue state,
approvals, DLQ, and replay. OpenLoops owns agent workflow invocation, admission,
and `.hasna/loops/runs` artifacts when `loops events handle generic` is used.
OpenAutomations never owns task, PR, review, or agent workflow queues.
