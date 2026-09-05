# Open-Core Hosted Service Pattern

This pattern applies to `hasna/skills` and other open packages that need a hosted
service without making the OSS core depend on one deployment.

## Package Shape

- The OSS package owns local execution, CLI/MCP adapters, public contracts,
  SDK/client helpers, schemas, validation, docs, and local-safe defaults.
- The hosted service owns auth servers, OAuth callbacks, billing, databases,
  workers, queues, deployment, observability, secrets, and entitlement
  enforcement.
- The OSS package can be server-aware, but must remain usable without a hosted
  account.

## Onboarding

- Do not prompt during package install.
- Do not prompt a user to choose a deployment variant. There is one product and
  one deployment story: you run it. Setup asks for an API origin, or for nothing.
- In non-interactive and CI contexts, do not silently phone home. Talking to a
  server requires a credential the shared ladder can resolve; with none, nothing
  is sent and the CLI says it is running locally.
- Do not introduce names for deployment variants. Running on this machine is not
  a mode; it is the absence of a configured API origin. Keep domains in
  configurable API URLs.

## OSS Client Surface

Good OSS commands:

- `auth login`, `auth signup`, `auth whoami` — the API-backed auth commands;
  they call the configured Skills API, print/open returned URLs, and store
  scoped local credentials
- `auth logout` — local credential removal (`src/cli/commands/auth.ts`,
  `clearAuthConfig()`); no API call
- `run`, `runs list`, `runs show`, `exports open` — local execution and local
  run records (`src/cli/commands/runtime.ts`); they require no API origin
- `runs status`, `exports download` — the remote-client run subcommands; they
  require API access
- `list`/`ls`, `search`/`s`, `categories`, `tags` — the browse surface; the
  default read path is folder UNION cloud. Whenever the shared ladder resolves a
  credential (and therefore an authority),
  `getBrowseRegistry()` (`src/cli/commands/list.ts`) merges the authenticated
  remote registry into the local corpus through `mergeRemoteRegistry()`
  (`src/lib/remote-registry.ts`); an unconfigured or auth-missing install keeps
  the local corpus (fail closed). `--remote` makes the merge mandatory and
  errors without a configured origin.
- `push`, `pull` — send and fetch corpus skills to/from the configured Skills
  instance (`src/cli/commands/publish.ts`, `src/lib/pull.ts`); they require a
  configured origin
- `registry sync` — generates a deterministic registry sync artifact from the
  local corpus (instance-local)

The CLI ships no billing or credits command namespaces: `no-billing-surface.test.ts`
pins the CLI `--help` surface, the MCP contract, and the server route table to zero
billing/payments vocabulary. Billing, credits, checkout, and portal are the hosted
wrapper's surface, never the OSS package's.

Do not put these in OSS:

- Stripe webhook handlers, price enforcement, ledgers, or customer records
- OAuth provider secrets or callback ownership
- tenant database logic, entitlement source of truth, workers, or queues
- protected server-side source, private prompts, provider routing, or deployment
  automation

## Web App

The hosted web app is the account and billing source of truth. It should expose
login, OAuth, device-code approval, billing portal, credit checkout, API keys,
organizations, runs, artifacts, and audit views over the same APIs that CLI and
MCP call.
