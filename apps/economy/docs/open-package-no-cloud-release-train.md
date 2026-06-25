# Open Package No-Cloud Release Train

This runbook applies to every top-level `open-[name]` repo under
`/home/hasna/workspace/hasna/opensource`. The goal is to remove `@hasna/cloud`
as a runtime dependency while keeping local-first OSS packages useful, and
keeping optional remote AWS RDS/S3 support repo-native.

Use `docs/open-package-storage-boundary.md` for the architecture contract and
`docs/no-cloud-release-gate-template.md` for the per-repo release gate.

## Current Public Package State

Checked with `npm view <package>@latest` and dependency metadata on
2026-06-07 after both no-cloud release trains.

| Package | npm latest | Source repo | Public status |
| --- | ---: | --- | --- |
| `@hasna/accounts` | `0.1.6` | `open-accounts` | clean; no forbidden direct dependencies |
| `@hasna/assistants` | `1.1.148` | `open-assistants-legacy` | clean; no forbidden direct dependencies |
| `@hasna/attachments` | `1.0.27` | `open-attachments` | clean; no forbidden direct dependencies |
| `@hasna/brains` | `0.0.27` | `open-brains` | clean; no forbidden direct dependencies |
| `@hasna/browser` | `0.4.13` | `open-browser` | clean; no forbidden direct dependencies |
| `@hasna/calendar` | `0.1.4` | `open-calendar` | clean; no forbidden direct dependencies |
| `@hasna/coders` | `0.2.7` | `open-coders` | clean; no forbidden direct dependencies |
| `@hasna/computer` | `0.1.8` | `open-computer` | clean; no forbidden direct dependencies |
| `@hasna/configs` | `0.2.34` | `open-configs` | clean; no forbidden direct dependencies |
| `@hasna/connectors` | `1.3.34` | `open-connectors` | clean; no forbidden direct dependencies |
| `@hasna/contacts` | `0.6.19` | `open-contacts` | clean; no forbidden direct dependencies |
| `@hasna/context` | `0.1.12` | `open-context` | clean; no forbidden direct dependencies |
| `@hasna/conversations` | `0.2.52` | `open-conversations` | clean; no forbidden direct dependencies |
| `@hasna/crawl` | `0.4.8` | `open-crawl` | clean; no forbidden direct dependencies |
| `@hasna/deployment` | `0.0.11` | `open-deployment` | clean; no forbidden direct dependencies |
| `@hasna/domains` | `0.0.20` | `open-domains` | clean; no forbidden direct dependencies |
| `@hasna/economy` | `0.2.31` | `open-economy` | clean; no forbidden direct dependencies |
| `@hasna/emails` | `0.6.7` | `open-emails` | clean; no forbidden direct dependencies |
| `@hasna/evals` | `0.1.25` | `open-evals` | clean; no forbidden direct dependencies |
| `@hasna/files` | `0.2.36` | `open-files` | clean; no forbidden direct dependencies |
| `@hasna/hooks` | `0.2.16` | `open-hooks` | clean; no forbidden direct dependencies |
| `@hasna/knowledge` | `0.2.3` | `open-knowledge` | clean; no forbidden direct dependencies |
| `@hasna/logs` | `0.3.24` | `open-logs` | clean; no forbidden direct dependencies |
| `@hasna/machines` | `0.0.14` | `open-machines` | clean; no forbidden direct dependencies |
| `@hasna/markdown` | `0.1.7` | `open-markdown` | clean; no forbidden direct dependencies |
| `@hasna/mcps` | `0.0.21` | `open-mcps` | clean; no forbidden direct dependencies |
| `@hasna/mementos` | `0.14.37` | `open-mementos` | clean; no forbidden direct dependencies |
| `@hasna/microservices` | `0.0.26` | `open-microservices` | clean; no forbidden direct dependencies |
| `@hasna/monitor` | `0.1.13` | `open-monitor` | clean; no forbidden direct dependencies |
| `@hasna/projects` | `0.1.55` | `open-projects` | clean; no forbidden direct dependencies |
| `@hasna/prompts` | `0.3.23` | `open-prompts` | clean; no forbidden direct dependencies |
| `@hasna/recordings` | `0.1.23` | `open-recordings` | clean; no forbidden direct dependencies |
| `@hasna/repos` | `0.1.10` | `open-repos` | clean; no forbidden direct dependencies |
| `@hasna/sandboxes` | `0.1.29` | `open-sandboxes` | clean; no forbidden direct dependencies |
| `@hasna/search` | `0.0.8` | `open-search` | clean; no forbidden direct dependencies |
| `@hasna/secrets` | `0.1.25` | `open-secrets` | clean; no forbidden direct dependencies |
| `@hasna/shield` | `0.1.16` | `open-security` | clean; no forbidden direct dependencies |
| `@hasna/servers` | `0.1.10` | `open-servers` | clean; no forbidden direct dependencies |
| `@hasna/sessions` | `0.11.25` | `open-sessions` | clean; no forbidden direct dependencies |
| `@hasna/shortlinks` | `0.1.10` | `open-shortlinks` | clean; no forbidden direct dependencies |
| `@hasna/skills` | `0.1.41` | `open-skills` | clean; no forbidden direct dependencies |
| `@hasna/styles` | `0.1.5` | `open-styles` | clean; no forbidden direct dependencies |
| `@hasna/swarm` | `0.0.4` | `open-swarm` | clean; no forbidden direct dependencies |
| `@hasna/telephony` | `0.1.5` | `open-telephony` | clean; no forbidden direct dependencies |
| `@hasna/terminal` | `4.3.10` | `open-terminal` | clean; no forbidden direct dependencies |
| `@hasna/testers` | `0.0.66` | `open-testers` | clean; no forbidden direct dependencies |
| `@hasna/tickets` | `0.1.9` | `open-tickets` | clean; no forbidden direct dependencies |
| `@hasna/todos` | `0.11.52` | `open-todos` | clean; no forbidden direct dependencies |
| `@hasna/ui` | `0.0.1` | `open-ui` | clean; no forbidden direct dependencies |
| `@hasna/wallets` | `0.1.8` | none found | deprecated; still cloud-coupled, but no top-level `open-*` or `platform-*` package depends on it |

Local source/package and lockfile scans currently show no `@hasna/cloud`,
`open-cloud`, or `@hasna/wallets` runtime manifest or lockfile dependencies
outside `open-cloud` itself. Platform package and lockfile scans under
`/home/hasna/workspace/hasnatools/platform/platform-*` also return no forbidden
package entries.

## Published Order

Published in dependency order so downstream lock refreshes represent the real
public runtime graph.

1. Foundation packages with stale public metadata:
   `connectors`, `conversations`, `mementos`, `sessions`, `logs`, `contacts`.
2. Domain and remote-support packages:
   `domains`, `sandboxes`.
3. Packages that aggregate or depend on the foundation packages:
   `browser`, `emails`, `economy`, `coders`, `assistants`, `testers`.
4. Clean direct packages that still appeared in stale downstream locks were
   refreshed where needed: `todos`, `skills`, `projects`, `files`.
5. Second public package train published clean versions for stale npm metadata:
   `attachments`, `brains`, `calendar`, `computer`, `configs`, `context`,
   `crawl`, `deployment`, `evals`, `hooks`, `machines`, `markdown`, `mcps`,
   `prompts`, `recordings`, `repos`, `search`, `secrets`, `shield`,
   `servers`, `shortlinks`, `styles`, `swarm`, `telephony`, `terminal`, and
   `tickets`.
6. Wallet decision completed:
   no maintained local `open-wallets` source was found, so `@hasna/wallets`
   was deprecated on npm. Keep wallet integrations env-selected only until a
   new no-cloud source package is created.
7. Downstream lock refresh completed for `open-browser`,
   `open-assistants-legacy`, `open-domains`, `open-emails`, `open-files`,
   `open-economy`, and `open-testers`.
8. Platform lock refresh completed for `platform-connectors`,
   `platform-conversations`, `platform-mcps`, and `platform-webcrawl`.
9. `@hasna/cloud@0.1.35` was published as a dependency-free archive stub and
   the npm package line was deprecated. `open-cloud` remains only as a local
   reference/archive repo while wrapper migrations finish.

## Open Cloud Archive State

`@hasna/cloud@latest` is now `0.1.35`. It ships only:

- `README.md`
- `LICENSE`
- `archive/index.js`
- `archive/index.d.ts`
- `archive/cli.js`
- `archive/mcp.js`

It has no runtime dependencies and no postinstall. Both CLI binaries print a
deprecation message and exit. All `@hasna/cloud` versions are npm-deprecated
with the message that open packages must use repo-native local SQLite/file
storage and explicit remote adapters instead.

`@hasna/wallets` is also npm-deprecated because no maintained no-cloud source
repo exists locally. Do not reintroduce it as a direct dependency. Create a new
wallet source package or keep wallet behavior behind explicit env-selected
integration modules.

## Per-Repo Release Gate

Run this before every publish candidate:

```bash
rg -n '@hasna/cloud|open-cloud|@hasna/wallets' . \
  --glob 'package.json' \
  --glob '*.ts' \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!coverage/**' \
  --glob '!**/.next/**'

bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
npm pack --dry-run --json --ignore-scripts
```

Use repo-native equivalents where the repo does not have every script. If a
repo has a known unrelated typecheck failure, record it in the task comment and
prove the changed surface with focused tests plus build.

The packed public package must not contain:

- `@hasna/cloud`
- `open-cloud`
- private `platform-*` package names
- private hosted API URLs
- secret-like literals
- default hosted mode behavior

## Downstream Lock Refresh Gate

After the publish train, refresh downstream packages in this order. This pass
was completed on 2026-06-07.

1. `open-domains` after `contacts` and the wallet decision.
2. `open-emails` after `connectors`, `contacts`, `domains`, and wallet.
3. `open-files` after `connectors`.
4. `open-browser` after `connectors`, `conversations`, `mementos`,
   `sessions`, `skills`, and `todos`.
5. `open-economy` after `projects`.
6. `open-assistants-legacy` after `logs` and `skills`.
7. `open-testers` after `browser`, `connectors`, `contacts`,
   `conversations`, `mementos`, `projects`, `sandboxes`, `sessions`,
   `skills`, and `todos`.

For each downstream repo:

```bash
bun install
rg -n '@hasna/cloud|open-cloud|@hasna/wallets' bun.lock package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null
bun run typecheck
bun test
bun run build
```

The lockfile search must return no cloud or wallet package entries unless the
repo explicitly documents an env-selected external wallet module.

## Verification Notes

- `open-browser`: `bun run typecheck` passed. Full `bun test` had transient
  Playwright/SQLite local runtime failures; rerunning the failed
  `src/lib/screenshot-v4.test.ts` and `src/lib/network.test.ts` files passed,
  and `bun run build` passed.
- `open-assistants-legacy`: `bun run typecheck` passed, focused MCP/logs tests
  passed, and `bun run build` passed. The full existing `bun test` suite still
  has unrelated web/client/session failures.
- `open-coders`: build and focused integration verification passed during the
  no-cloud change. Full typecheck has unrelated existing failures.
- Second train packages: `bun install --frozen-lockfile`, `bun run typecheck`
  where present, `bun run test`, `bun run build`, package/lock forbidden scans,
  and `npm pack --dry-run --json --ignore-scripts` passed before publish.
- `platform-webcrawl`, `platform-conversations`, `platform-connectors`, and
  `platform-mcps`: package/lock forbidden scans are clean after refresh.
  `platform-webcrawl` and `platform-conversations` passed typecheck/test/build;
  `platform-connectors` and `platform-mcps` passed full typecheck/test/build
  after upstream version pin updates.

## SaaS Wrapper Follow-Up

Each `platform-[name]` wrapper must consume the public `open-[name]` package API
and own SaaS-only concerns:

- auth and accounts
- billing and entitlements
- tenant isolation
- hosted RDS/Postgres and S3/object storage
- workers, queues, webhooks, and deployment
- private secrets and observability

Do not reintroduce `@hasna/cloud` as a shared runtime package in the wrappers.
Shared ideas from `open-cloud` should become templates, docs, or repo-native
interfaces.
