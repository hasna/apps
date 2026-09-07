---
"@hasna/skills": patch
---

Every command works in any transport — the storage-mode axis is fully retired
(owner directive 2026-08-15). No command may be transport-gated, and a
deployment of this repo's own server must answer every command the CLI
registers, from the fleet gateway to an operator's own `skills-server`.

- **The shipped server now serves the full client contract** under both the
  fleet `/v1` dialect and the legacy `/api/v1` prefix (same dispatch table):
  `capabilities`, skill quotes, the updated-since feed with a deterministic
  compound cursor, run resume, artifact `/download`, input upload admission
  (authenticated) + byte PUT (target-keyed, credential-free by design), the
  deterministic zero-credit billing/credits contract (`billing status|usage|
  invoices`, `credits packs`; checkout/portal answer
  `SUBSCRIPTION_CHECKOUT_UNAVAILABLE` instead of inventing a payment link), and
  `account profile` / `workspaces current` updates.
- **Passwordless auth is served end to end** by the shipped server:
  `POST /api/auth/login|verify|device/start|device/token` plus API-key
  list/create/revoke on every store backend (memory/sqlite/postgres). A
  mailer-less server returns the verification code in the login response (and
  on its console); the CLI prints it when present. Device grants confirm on
  first poll (no browser surface on the deterministic server).
- **`skills run` subcommands read local records without a server**:
  `runs logs` and `runs artifacts` serve local run records; `runs cancel` and
  `runs resume` answer finished local records truthfully and route linked
  remote runs by their recorded remote id; `exports download` resolves local
  ids to their remote run.
- **`skills feedback` records to one on-box store in every transport** — the
  legacy api-mode JSONL branch is gone.
- **Operator URLs in the fleet `/v1` dialect normalize like `/api/v1` bases.**
- **Test-suite hermeticity:** the suite now blinds the credential ladder's
  disk tier (a developer machine with a working `~/.hasna/skills/config/credentials`
  no longer runs parts of the suite in hosted mode), and new hermetic suites
  pin the transport-parity invariants: the command tree is identical under the
  local opt-in and a hosted credential, no transport-requirement vocabulary
  appears in the CLI surface, and the server's full surface is exercised
  against every store backend.