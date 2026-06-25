# Platform Open-Core Inventory

Date: 2026-06-08

Scope:

- Platform repos: `/home/hasna/workspace/hasnatools/platform/platform-*`
- Open repos: `/home/hasna/workspace/hasna/opensource/open-*`
- Goal: classify each platform repo against an open-core owner so hosted SaaS state stays in `platform-*` and reusable local-first product logic stays in `open-*`.

## Classification Rules

- `wrapper`: private SaaS wrapper consuming a public `@hasna/*` package from an `open-*` repo.
- `alias wrapper`: private wrapper with a product name that maps to a differently named open core.
- `public misplaced`: public package or local-first core living under `platform-*`; should move or be renamed into `open-*`.
- `product-only`: hosted/product scaffold with no open-core dependency yet.
- `brief`: planning/spec repo with no runnable package manifest.
- `empty`: shell repo with no product files beyond Git metadata.
- `legacy`: historical reference only.

## Wrapper Repos

| Platform repo | Classification | Open-core owner | Package evidence | Notes |
| --- | --- | --- | --- | --- |
| `platform-assistants` | wrapper | `open-assistants` / `@hasna/assistants` | root dependency `@hasna/assistants@1.1.148` | Private wrapper boundary exists; upstream storage subpath depends on publishing refreshed public package. |
| `platform-attach` | alias wrapper | `open-attachments` / `@hasna/attachments` | root dependency `@hasna/attachments@1.0.27` | Product name is singular `attach`; open-core name is attachments. |
| `platform-connectors` | wrapper | `open-connectors` / `@hasna/connectors` | root dependency `@hasna/connectors@1.3.34` | Hosted connector auth, billing, approvals, and governance stay private. |
| `platform-conversations` | wrapper | `open-conversations` / `@hasna/conversations` | root dependency `@hasna/conversations@0.2.52` | README states it wraps the open package. |
| `platform-mcps` | wrapper | `open-mcps` / `@hasna/mcps` | root dependency `@hasna/mcps@0.0.21` | Private MCP SaaS wrapper. |
| `platform-mementos` | wrapper | `open-mementos` / `@hasna/mementos` | root dependency alias `@hasnatools/open-mementos-core` to `npm:@hasna/mementos@0.14.37`; workspace package also exists | Wrapper should consume only the public package path; avoid growing the embedded workspace copy. |
| `platform-outputs` | alias wrapper | `open-files` / `@hasna/files` | root dependency `@hasna/files@0.2.36` | Product name is outputs; core owner is files. |
| `platform-repositories` | alias wrapper | `open-repos` / `@hasna/repos` | root dependency `@hasna/repos@0.1.10` | Product name is repositories; core owner is repos. |
| `platform-researcher` | wrapper | `open-researcher` / `@hasna/researcher` | root dependency `@hasna/researcher@0.1.6` | Private hosted research wrapper. |
| `platform-skills` | wrapper | `open-skills` / `@hasna/skills` | root dependency `@hasna/skills@0.1.41` | Active SaaS wrapper. |
| `platform-styles` | wrapper | `open-styles` / `@hasna/styles` | root dependency `@hasna/styles@0.1.5` | Private hosted style profile wrapper. |
| `platform-todos` | wrapper | `open-todos` / `@hasna/todos` | root dependency `@hasna/todos@0.11.52` | Hosted todos platform over public local-first package. |
| `platform-webcrawl` | alias wrapper | `open-crawl` / `@hasna/crawl` | root dependency `@hasna/crawl@0.4.8` | Product name is webcrawl; core owner is crawl. |

## Misplaced Public Packages

| Platform repo | Classification | Current package | Recommended next step |
| --- | --- | --- | --- |
| `platform-matematica` | public misplaced | `@hasna/matematica@0.0.2` | Move or rename to `open-matematica` if this is intended to be public local-first core. Keep any future hosted UI/API in `platform-matematica`. |

### Matematica Placement Decision

Decision: `platform-matematica` should become `open-matematica` in the local workspace layout.

Reason:

- It publishes the public package `@hasna/matematica`.
- Its Git remote is already `https://github.com/hasnatools/matematica.git`, not a `platform-*` remote.
- Its package metadata is public (`publishConfig.access = public`) and MIT licensed.
- Its README describes a BYOK, local-ledger-first CLI with no bundled hosted compute, API keys, provider accounts, SaaS auth, billing, tenants, or production database.

Non-destructive migration plan:

1. Move the clean checkout from `/home/hasna/workspace/hasnatools/platform/platform-matematica` to `/home/hasna/workspace/hasna/opensource/open-matematica`.
2. Keep the package name `@hasna/matematica`, repository URL `https://github.com/hasnatools/matematica.git`, and public npm publishing policy.
3. Leave `platform-matematica` absent until a hosted product wrapper exists. If a hosted wrapper is later needed, create a fresh private `platform-matematica` that depends on `@hasna/matematica` and owns only accounts, auth, billing, tenants, hosted database, queues, deployment, dashboard, and observability.
4. After the move, rerun `bun test`, `bun run release:check`, and `npm pack --dry-run --json --ignore-scripts` from `open-matematica`.

## Product-Only Scaffolds

| Platform repo | Classification | Notes | Recommended next step |
| --- | --- | --- | --- |
| `platform-123invoiceco` | product-only | Full private SaaS scaffold for invoice management, no `@hasna/*` open-core dependency. | Decide whether invoice parsing, invoice data model, or local CLI belongs in a new open core, likely `open-invoices` or `open-123invoice`. Until then keep it product-only. |
| `platform-easyformai` | product-only | Full private SaaS scaffold for AI form building, no `@hasna/*` open-core dependency. | Decide whether form schema, local form runner, or CLI belongs in a new open core, likely `open-forms` or `open-easyform`. Until then keep it product-only. |
| `platform-nopen` | product-only | Restricted, unlicensed hosted product with Postgres/RLS, auth, billing, Cloudflare domains/deploy, dashboard, and no public open-core dependency. | Keep as `platform-nopen` until a reusable local-first mini-site/deployment core is intentionally extracted, likely `open-nopen` or smaller cores around domains/deployment. |

### Nopen Extraction Decision

Decision: do not move `platform-nopen` wholesale into `open-nopen`.

Reason:

- The package is restricted and unlicensed.
- The repository contains hosted SaaS product concerns: device auth, Google OAuth, Stripe credits/Connect, Postgres/RLS tenant isolation, production deploy scripts, dashboard, API server, MCP auth flow, rate limits, email, Cloudflare credentials, domain purchase, Workers deployment, and scheduler/daemon operations.
- Existing open packages already cover adjacent reusable areas: `open-domains` / `@hasna/domains`, `open-deployment` / `@hasna/deployment`, `open-skills` / `@hasna/skills`, and `open-todos` / `@hasna/todos`.

Extraction boundary if an OSS core is created:

- Candidate public package: `open-nopen` / `@hasna/nopen-core` or `@hasna/nopen` only after the hosted package name is resolved.
- Public core may own reusable local primitives:
  - `SiteSpec` schema and site kind types.
  - HTML and Cloudflare Worker module rendering from a site spec.
  - deployment safety scan for generated Worker modules.
  - architect result schema and local fallback goal generation.
  - provider-neutral interfaces for domain suggestion, deployment, and generated-site health checks.
- Public core must not own hosted product concerns:
  - Postgres/RLS schemas and migrations.
  - users, tenants, auth, API tokens, device-code login, Google OAuth, and dashboard sessions.
  - Stripe credits, Connect, subscriptions, and platform take-rate logic.
  - Cloudflare account credentials, domain purchase execution, production deploy scripts, and platform scheduler leadership.
  - hosted API/MCP server auth, rate limits, email delivery, and SaaS observability.

Preferred near-term work: make `platform-nopen` consume `@hasna/domains` and `@hasna/deployment` for domain/deploy adapter contracts before creating a new `open-nopen` package. Create `open-nopen` only when the site-spec/render/safety primitives become useful outside the hosted product.

## Legacy

| Platform repo | Classification | Notes |
| --- | --- | --- |
| `platform-skills-legacy` | legacy | README says active open-core work belongs in `open-skills` and active SaaS wrapper work belongs in `platform-skills`. Do not add new storage integration here. |

## Briefs And Empty Shells

These repos have no root `package.json`. Treat them as planning/product briefs until code is added.

Brief/spec repos:

- `platform-123invoice`
- `platform-123resume`
- `platform-5l`
- `platform-biosense`
- `platform-bookwriter`
- `platform-debugly`
- `platform-dynamicquiz`
- `platform-easyform`
- `platform-easyschedule`
- `platform-easytemplate`
- `platform-easywords`
- `platform-enlarger`
- `platform-gymnast`
- `platform-instalang`
- `platform-mailery`
- `platform-memeshare`
- `platform-microprocessor`
- `platform-musictokens`
- `platform-recipient`
- `platform-safespend`
- `platform-socializer`
- `platform-speeding`
- `platform-subtly`
- `platform-takemyorder`
- `platform-textweb`
- `platform-validverify`

Empty shell repos:

- `platform-dispatch`
- `platform-extensions`
- `platform-plugins`
- `platform-prds`
- `platform-templates`

Rule for this group: when runnable code or durable user data is introduced, create or identify the `open-*` owner before adding hosted auth, billing, tenant, or production database concerns.

## Follow-Up Tasks

1. Move or rename the public `@hasna/matematica` core from `platform-matematica` into `open-matematica`, or explicitly document why the local path remains an exception.
2. Decide whether `platform-123invoiceco` needs an `open-invoices` or `open-123invoice` core.
3. Decide whether `platform-easyformai` needs an `open-forms` or `open-easyform` core.
4. Make `platform-nopen` consume `@hasna/domains` and `@hasna/deployment` for domain/deploy adapter contracts before creating a new `open-nopen` package.
5. Normalize alias wrapper naming only if product naming is not intentional: `outputs` -> `files`, `repositories` -> `repos`, `webcrawl` -> `crawl`, `attach` -> `attachments`.
6. For every brief repo that becomes runnable, create the public `open-*` core first when reusable local-first logic or durable user data exists.

## Verification Commands

```bash
find /home/hasna/workspace/hasnatools/platform -maxdepth 1 -type d -name 'platform-*' -printf '%f\n' | sort
find /home/hasna/workspace/hasna/opensource -maxdepth 1 -type d -name 'open-*' -printf '%f\n' | sort
find /home/hasna/workspace/hasnatools/platform -maxdepth 2 -name package.json -path '*/platform-*/*' -print | sort
```
