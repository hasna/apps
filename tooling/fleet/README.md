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

## Minting, and what will never be overwritten

`provision` mints when the secret is **missing**. It does **not** replace a
secret that exists and was merely refused, and that asymmetry is deliberate:

| assessment | what provisioning does |
|------------|------------------------|
| `verified` / `exempt` | nothing |
| `missing` | mint — no secret exists, nothing can be invalidated |
| `rejected` | **refuse**, report, exit non-zero — unless `--allow-rotate` |
| `unverifiable` | never touch the secret; the probe proved nothing |

`hasna/oss/<app>/api-key` holds one shared client key, and stations do not read
it live: an operator copies it by hand into the macOS Keychain
(`hasna.credentials.<app>.api-key`). Overwriting it invalidates every station's
copy at once, silently, until somebody re-pulls. And `rejected` is a *heuristic*
— it is reached from a keyed 401 **or 403**, and a 403 is also what a valid key
that simply lacks the probed path's scope returns (`loops` answers 403 on the
default probe path). Rotating on that reading would destroy a live key to fix a
permission that was never broken.

So a refusal is loud and cheap; a wrong rotation is silent and expensive.
`--allow-rotate` (workflow input `allow_rotate: true`) opts in, and even then
provisioning re-probes to confirm the refusal before writing, and publishes a
rotation notice — job summary, `::warning::` annotation, and a `rotated=true`
step output — telling station operators their Keychain copy is now stale.

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

## Rollout: what is not in this repository

The checker is here; the AWS side is in `infra-live` — **none of it exists
yet**, verified against `infra-live@1ab5ad4` — and until it lands both lanes
would fail for reasons no deploy caused. Both therefore sit behind a
**rollout switch**, off by default, that still says loudly on every run that the
key was not checked — a disabled check that is quiet is the exact failure
hasna/apps#1595 was filed about. Delete the switches once the prerequisites are
real.

| lane | switch | prerequisites |
|------|--------|---------------|
| `fleet-key-provision.yml` (5 deploy lanes) | `FLEET_KEY_PROVISION_ENABLED=true` | `<app>-prod-gha-deploy` gains `secretsmanager:GetSecretValue` on `hasna/oss/<app>/api-key`, `ecs:RunTask`/`ecs:DescribeTasks` and `iam:PassRole` for the mint task; `/hasna/deploy/<app>` carries `mint_key_task_family` |
| `fleet-key-drift.yml` (daily) | `FLEET_KEY_DRIFT_ENABLED=true` | `fleet-key-audit-gha` exists (or `FLEET_KEY_AUDIT_ROLE` names it), read-only on `hasna/oss/*/api-key`, trusting the OIDC subject `repo:hasna/apps:ref:refs/heads/main` |

The drift lane declares **no** `environment:`, unlike the deploy lanes: a
scheduled audit that a deployment approval gate can hold is an audit that
silently stops running, and 06:17 has nobody to approve it.

### Who is doing the infra half

Disclosure without an assignee is how two disabled lanes become background
noise, so the prerequisites are tracked, not just described:

| issue | what it covers |
|-------|----------------|
| [hasna-internal/infra-live#46](https://github.com/hasna-internal/infra-live/issues/46) | the `secretsmanager:GetSecretValue` grant on `deploy-oidc-role`, the `hasna-ops-mint-key-<app>` task family + `ecs:RunTask`/`iam:PassRole` for it, `mint_key_task_family` in the SSM manifest, and the `fleet-key-audit-gha` audit role |
| [hasna/apps#1768](https://github.com/hasna/apps/issues/1768) | flipping the two repository variables on, watching one real deploy, and **deleting both switches** |

What `infra-live@1ab5ad4` actually has today, for whoever picks that up:
`infra/modules/deploy-oidc-role/main.tf` — instantiated by conversations,
mementos, projects and skills — carries **no** `secretsmanager` statement of any
kind, scopes `ecs:RunTask` to `${migration_task_family}:*` (`main.tf:111,345`),
and passes only the app's own task/execution roles. Nothing named
`hasna-ops-mint-key`, `mint_key_task_family` or `fleet-key-audit` exists in the
repository. Until that changes, `fleet-key` reports an `AccessDenied` as a
**PREREQUISITE MISSING** naming the exact grant, never as a finding about a key.

### messages is not finished by this repository

hasna/apps#1595 was filed for `messages`, and `messages` is the one app this
repo cannot provision: it has **no deploy lane here**. The contracts gate in
`apps/messages/src/server/auth.ts` reaches production only through an
out-of-repo deploy. Sequence, in order:

1. deploy a `messages` build carrying that gate, with `API_KEY_SIGNING_SECRET`
   in the task environment (until then the origin still answers the old
   static-key error and would refuse a contracts-minted key);
2. mint `hasna/oss/messages/api-key` with the in-VPC `hasna-ops-mint-key-messages`
   task;
3. confirm `bun tooling/fleet/fleet-key.ts drift --apps messages` is green.

Until 1 and 2, the daily report names `messages` every day (once the drift lane
is enabled at all). That is the check working, not the check failing — and it is why #1595's acceptance items (a) and
(c) are ops outcomes tracked beyond the pull request that added this directory.
