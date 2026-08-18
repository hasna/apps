# Open-Core Hosted Service Pattern

This pattern applies to `hasna/skills` and other open packages that need a hosted
service without making the OSS core depend on one deployment.

## Package Shape

- The OSS package is the complete user-hosted product. It owns local execution,
  CLI/MCP adapters, public contracts, SDK/client helpers, schemas, validation,
  docs, and local-safe defaults.
- The user-hosted server ships in the OSS package: `skills-server`,
  `skills-worker`, and `skills-migrate` binaries, the implementation in
  `src/server/`, and the SQL schema in `migrations/` (SQLite and Postgres).
  This is the deliberate open-core boundary ruling — see
  `../adr/0001-open-core-boundary.md`.
- The hosted SaaS layer owns the web app, billing, OAuth callbacks,
  multi-tenant infrastructure, observability, secrets, and entitlement
  enforcement.
- The OSS package can be server-aware, but must remain usable without a hosted
  account.

## Onboarding

- Do not prompt during package install.
- Do not prompt a user to choose a deployment variant. There is one product and
  one deployment story: you run it. Setup asks for an API origin, or for nothing.
- In non-interactive and CI contexts, do not silently phone home. Talking to a
  server requires an explicitly configured origin (`SKILLS_API_URL` or the
  `apiUrl` config key) and `SKILLS_API_KEY`.
- Do not introduce names for deployment variants. Running on this machine is not
  a mode; it is the absence of a configured API origin. Keep domains in
  configurable API URLs.

## OSS Client Surface

Good OSS commands:

- `auth login`, `auth logout`, `auth whoami` — remote-client commands
- `run`, `runs list/show`, `exports open` — local execution and local run records
  (`src/cli/commands/runtime.ts`); they never call the Skills API
- `runs status`, `exports download` — the remote-client subcommands
- `push`, `pull`, and registry commands (the instance-local registry surface)
- browse/list commands against the local corpus cache or a configured server

The CLI ships no billing or credits command namespaces: `no-billing-surface.test.ts`
pins the `--help` surface, the MCP contract, and the server route table to zero
billing/payments vocabulary. Billing, credits, checkout, and portal are the hosted
wrapper's surface, never the OSS package's.

Only the remote-client commands (auth, `runs status`, `exports download`, push/pull)
call the configured Skills API, print/open returned URLs, and store scoped local
credentials. The local-execution commands (`run`, `runs list/show`, `exports open`,
browse/list) run on this machine and require no API origin.

Do not put these in OSS:

- Stripe webhook handlers, price enforcement, ledgers, or customer records
- OAuth provider secrets or callback ownership
- multi-tenant entitlement source of truth, or infrastructure beyond the
  user-hosted deployment
- protected server-side source, private prompts, provider routing, or deployment
  automation

The user-hosted server that ships in the OSS package implements the org-scoped
product surface — auth by API key, the published-skill registry, bundles, runs,
logs, artifacts, approvals, audit, and run-output governance. It does not
implement the hosted SaaS layer above.

## Web App

The hosted web app is the account and billing source of truth. It should expose
login, OAuth, device-code approval, billing portal, credit checkout, API keys,
organizations, runs, artifacts, and audit views over the same APIs that CLI and
MCP call.
