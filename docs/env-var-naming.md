# Env-var naming standard

Owner: global:global. Established 2026-08-24 (workflow: env-var-naming).
Canonical knowledge item: `hasna-env-var-naming-standard` (tag: convention).

## The rule, in one line

**Harness apps read their environment from `HASNA_<APP>_*` names; products read
their environment from `<BRAND>_*` names; provider credentials keep the
provider's own generic name.**

## Classes

| class | prefix | example | example apps |
|---|---|---|---|
| harness app (`@hasna/*` in `hasna/apps`, internal apps) | `HASNA_<APP>_` | `HASNA_TODOS_DB_PATH`, `HASNA_CONVERSATIONS_AGENT_ID`, `HASNA_EMAILS_MODE` | todos, conversations, mementos, knowledge, secrets, repos, projects, emails, prompts, subscriptions, brain, … |
| product (`hasna-products`, `hasna-internal/platform`) | `<BRAND>_` | `ALUMIA_DATABASE_URL`, `MAILERY_STRIPE_MODE`, `SOCIALIZER_ADMIN_API_KEY` | alumia, mailery, socializer, codewith, todos (product), conversations (product), mementos (product) |
| provider generic (sanctioned as-is) | provider name | `OPENROUTER_API_KEY`, `AWS_PROFILE`, `GITHUB_TOKEN`, `CLOUDFLARE_API_TOKEN`, `ANTHROPIC_API_KEY` | any app consuming that provider |
| cross-app shared machine identity | `HASNA_MACHINE_ID` | `HASNA_MACHINE_ID` | knowledge, loops, snapshots |

## Migration mechanics — never a silent rename

A variable that is renamed from a legacy name to the canonical name MUST keep a
compatibility alias for one deprecation window:

1. **Canonical-first resolution**: `HASNA_<APP>_<VAR>` wins; the legacy
   `<LEGACY>_<VAR>` is read only as a fallback.
2. **Lazy reads**: resolve at call time (a function), never once at module
   load — tests and wrappers legitimately set `process.env` after import.
3. **Never set both with different values.** When both are set, the canonical
   one is authoritative and the discrepancy is an operator error.
4. Deprecate the legacy read only after the window; the README names the
   canonical names and marks the legacy ones as accepted.

Pattern used in this monorepo (see each app's `src/lib/env.ts`):

```ts
const alias = (canonical: string, legacy: string): string | undefined =>
  process.env[canonical] ?? process.env[legacy];

export const env = {
  apiKey: (): string | undefined => alias("HASNA_APP_API_KEY", "LEGACY_API_KEY"),
};
```

## What this corrects (measured 2026-08-24)

A fleet census of ~60 apps found the prefix classes that violate the standard:

- **Unprefixed generics in prompts** (`ORG_ID`, `PROJECT_ID`, `SESSION_ID`,
  `TODOS_PROJECT_ID`): collide across apps → renamed to `HASNA_PROMPTS_*` with
  alias.
- **Legacy-dominant surfaces**: conversations identity contract
  (`CONVERSATIONS_AGENT_ID`/`_SESSION_ID`/`_USE_MACHINE_IDENTITY`), todos
  (16 vars), mementos (7), repos (4), projects (10) — all gained canonical
  reads with legacy fallback.
- **Deferred: emails.** The emails mode surface is on the deployment-mode
  deletion lane (mode-axis ratchet; reading *any* new spelling of the mode
  keys is barred by the ratchet's pinned ceilings), so its env-var naming
  lands after the axis is deleted rather than renaming a dying variable.

Products and the platform tree were already compliant (brand prefix) and are
untouched; the product mementos OSS-compat reads of
`HASNA_MEMENTOS_DATABASE_URL`/`_STORAGE_MODE` are a deliberate exception
(open-core client compat) and are kept.

## Migration checklist for an app

1. Add `src/lib/env.ts` (or extend the existing config module) with the
   canonical-first alias map for every legacy-only read.
2. Replace the read sites; keep help strings leading with canonical names and
   marking legacy acceptance.
3. Update the README env docs to the canonical names.
4. `bunx tsc --noEmit -p tsconfig.json` clean; run the touched modules' tests.
5. Land PR-first; breaking changes carry the alias, never a silent rename.
