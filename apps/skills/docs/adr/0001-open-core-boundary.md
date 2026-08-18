# ADR-0001 — The server-in-OSS is the intended unified surface; the open-core boundary is drawn at the user-hosted product

- Status: **Accepted** (recorded by the skills local+cloud unification plan, 2026-08-18)
- Date: 2026-08-18
- Deciders: skills local+cloud unification plan (8022d27f-fc09-437a-aa72-93eb8ad9517c); recorded by task T13
  (55140781-61ac-40dd-9c7f-a493d0a8e45b), whose instruction was to convene the decision ONCE and record the
  ruling as a dated ADR. The task states the recommended resolution: the server-in-OSS is already shipped and
  deployed, and the deployed reality is the strongest evidence for the decision.
- Task: [55140781](https://hasna.todos) — "T13 Reconcile architecture docs + record the open-core boundary ruling"
- Supersedes the *implied* ruling (never recorded) that the hosted server must live in a private wrapper — the
  claim found in `docs/architecture/database-schema-audit.md`, `docs/architecture/open-core-saas-pattern.md`, and
  `docs/architecture/package-ownership-sync-strategy.md` before this ADR, and contradicted by the shipped tree.

## Context

`@hasna/skills` ships the complete user-hosted product in the open package: the CLI (`skills`), the MCP server
(`skills-mcp`), the product server (`skills-server`), the run worker (`skills-worker`), the migration runner
(`skills-migrate`), the implementation in `src/server/`, and the SQL schema as migrations in `migrations/`
(SQLite and Postgres, 13 tables: organizations, users, organization_members, api_keys, skills_registry,
skills_bundles, skills_runs, skills_run_logs, skills_artifacts, skills_approvals, skills_audit_events,
skills_lifecycle_receipts, skills_credit_reservations).

Three architecture docs contradicted that shipped reality:

- `database-schema-audit.md` claimed "There is no hosted product database schema in this repo".
- `open-core-saas-pattern.md` assigned "auth servers, ... databases, workers, queues" to a hosted service outside
  the OSS package.
- `package-ownership-sync-strategy.md` assigned the Server API and Server workers to a "Private service wrapper".

The package's own onboarding text had already ratified the direction this ADR records: *"There is one product
and one deployment story: you run it. Setup asks for an API origin, or for nothing."* The conflict was between
that ratified sentence and the three stale documents, and a reading agent could not tell which was true. The
task's acceptance criterion is that the docs match shipped code and that a reading agent can reproduce
documented behavior.

## Options

### A) Server-in-OSS is the unified surface (chosen)

The open package is the full user-hosted product: CLI, MCP, server, worker, migrations, and corpus. The
open-core boundary is drawn between the user-hosted product (in the OSS package) and the hosted SaaS layer
(web app, billing, multi-tenant infrastructure, OAuth provider callbacks — outside the OSS package).

Pros: matches the shipped and deployed tree with zero rework; one engine, one corpus, one route table, one
schema to review; every machine that installs `@hasna/skills` can run the whole product; a hosted wrapper, if
one is ever built, consumes the released package rather than duplicating it — exactly the consumption model
`package-ownership-sync-strategy.md` already mandates for wrappers.
Cons: the OSS package carries server code that a user may never run; that is the accepted cost of one product
with one deployment story.

### B) Move the server to a private wrapper

Split the product server out of the open package into a private repo or package.

Pros: the OSS package shrinks to a client.
Cons: contradicts the shipped and deployed reality (the server has shipped and been exercised on the fleet);
creates a duplicate engine, which `package-ownership-sync-strategy.md` rejects by name (permanent fork,
generated source copy, monorepo ownership transfer); forces an un-ship of a working surface; puts the route
table and schema out of reach of the community that runs the package.

## Decision

**The server-in-OSS is the intended unified surface.** `@hasna/skills` ships the complete user-hosted product —
CLI, MCP, `skills-server`, `skills-worker`, `skills-migrate`, `src/server/`, and the 13-table SQL schema — and
this is a deliberate, reviewed ruling, not an accident of history.

The open-core boundary is:

- **In the OSS package:** local execution, CLI/MCP adapters, the user-hosted server with its org-scoped schema
  (organizations, api keys, published-skill registry, bundles, runs, logs, artifacts, approvals, audit,
  lifecycle receipts, credit reservations), validation, docs, and the bundled corpus.
- **Outside the OSS package:** the hosted SaaS layer — web app, billing and entitlement source of truth,
  OAuth provider secrets and callbacks, Stripe webhook handlers, multi-tenant infrastructure beyond the
  org-scoped user-hosted schema, and deployment automation secrets.

Why A over B: the deployed reality is the decision's evidence — the server already ships and runs from the open
package, the package's own onboarding text ratifies one product with one deployment story, and moving it to a
private wrapper would create exactly the duplicate-engine failure the ownership strategy exists to prevent.

## Consequences

- The three architecture docs and the README are corrected to describe the shipped reality: the server and its
  schema live in the OSS package; the route table in the README lists every served route.
- `skills push`/`skills pull`/`skills registry sync` remain the instance-local registry surface; the hosted
  SaaS story (web app, billing) stays outside the package, unchanged by this ruling.
- The two-way local↔registry reconciliation verb is planned (plan task T9, 8022d27f) but not shipped; the
  README route table marks it not shipped rather than documenting a route that does not exist.
- REVISIT-WHEN: if a hosted multi-tenant SaaS is actually stood up, it is built as a wrapper consuming
  `@hasna/skills` through released package APIs (per `package-ownership-sync-strategy.md`), never by moving the
  server out of the OSS package.
