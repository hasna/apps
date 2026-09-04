# Fleet client-API-key provisioning

A hosted Hasna service is unusable from a station until a **client** key exists
for it at `hasna/oss/<app>/api-key` (Secrets Manager, AWS account
`hasna-internal`, `us-east-1`). Until hasna/apps#1595 nothing provisioned that
key and nothing checked it, so:

- `messages-prod` ran, routed and answered `/health` for days with **no key at
  all** — nothing on any station could call it;
- `projects` and `knowledge` shipped keys that had been **revoked at the
  origin** while the Secrets Manager copy still held the dead value.

Neither failure is visible to `/health` or to uptime monitoring. This directory
is what makes them visible.

## Files

| file | what it is |
|------|------------|
| `hosted-apps.json` | the written inventory: every hosted app, its base URL, its key secret, and how its key is probed |
| `key-provisioning.ts` | the library: registry parsing, probe classification, assessment, minting |
| `fleet-key.ts` | the CLI both callers use |

Tests live in `tooling/ci/tests/standard/fleet-key-provisioning.test.ts` and run
in CI with the standard-adherence suite.

## The two callers

```bash
# Deploy lanes, after a successful rollout (.github/workflows/fleet-key-provision.yml).
bun tooling/fleet/fleet-key.ts provision --app messages

# Daily, across the whole fleet (.github/workflows/fleet-key-drift.yml).
bun tooling/fleet/fleet-key.ts drift

# The inventory itself.
bun tooling/fleet/fleet-key.ts apps [--json] [--source monorepo|external]
```

## How a key is proved to work

Proving a key works needs an *authenticated* request, and pinning one real
route per app would be thirty route tables to keep in sync — a probe that 404s
because a route moved would report a dead key. So the check asks for a path no
app implements (`/v1/__fleet-key-probe__`) and reads the **status**, because
the credential gate runs before routing:

| unkeyed | keyed | verdict |
|---------|-------|---------|
| 401/403 | anything else | the key authenticates |
| 401/403 | 401/403 | the key is dead — revoked, expired, or signed by a rotated secret |
| anything else | — | `/v1/*` is **not** credential-gated; the probe proves nothing |

The unkeyed half is the reason this can be trusted. Without it, a service that
had lost its auth middleware would answer 404 to the keyed probe and be
reported green — a key check that cannot fail is worse than none, because it is
believed. Services that route *before* they authenticate answer 404 either way,
so those entries name a real gated route in `probePath` instead; `hooks`
authenticates by request signature and has no gated route at all, so it carries
a documented `keyCheck: "none"` exemption and is listed as EXEMPT in every
report — its key must still exist.

## Minting

Minting needs the app's signing secret **and** its owner Postgres URL, and that
database is only reachable from inside the VPC. `provision` therefore starts the
app's one-off Fargate task (`mint_key_task_family` in the SSM deploy manifest
`/hasna/deploy/<app>`, the `hasna-ops-mint-key-<app>` family), which runs
`@hasna/contracts issue-key` and writes the result straight to Secrets Manager.
The plaintext never crosses the VPC boundary and never reaches a CI log.

When `@hasna/contracts` ships the operator-only key-lifecycle route
(hasna/apps#1595 part 2, PR hasna/apps#1641), that round trip is replaced by a
single call to the app's own API and the per-app task definitions can go away.
See the `TODO` on `MintTarget` in `key-provisioning.ts`.

## Secrets

No key value is ever printed, written, exported or embedded in an error. Values
move from `aws secretsmanager get-secret-value` stdout into a request header
inside one process. Reports carry app names, HTTP statuses and verdicts only.
