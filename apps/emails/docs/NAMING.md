# Naming: this product is Hasna Emails, not Mailery

Status: binding. Owner ruling by Andrei Hasna, 2026-07-27.

## The ruling

The owner's verbatim wording is recorded in the Knowledge entry
`k_ms2x7nlw_ek0nrh` (tag `convention`), not quoted here: it uses the commercial
vocabulary that this package's own boundary guard bans from every tracked file
(`scripts/no-cloud-scan-lib.mjs`, "hosted implementation vocabulary"). Quoting
it verbatim in this file would turn CI red. That is the guard working, not a
problem to route around.

In substance: Mailery is retired as a brand name for this product, which is
renamed to Hasna Emails; Mailery becomes a different, unrelated commercial
product.

Stated as rules:

1. The OSS email core is **Hasna Emails**. It is the repository
   `hasna/apps` (member `apps/emails`), the npm package `@hasna/emails`, and
   the `emails`, `emails-mcp`, and `emails-serve` bins.
2. **`@hasna/mailery` is not this package, and never may be.** It was the
   abandoned 0.6.x line (0.6.20-0.6.116, last published 2026-07-08) when this
   ruling was written; since 2026-09 it is the separate Mailery product's own
   public CLI (see "Mailery is a different product"). Either way the rule is
   the same and now has two reasons: this tree must never be published under
   that name.
3. **Mailery is reserved for a separate, unrelated future commercial product**
   and **must not be used to refer to the email product** — not in docs, not in
   code, not in commit messages, not in issue titles, not in conversation.

Hasna Emails is the display/brand name. It does not change the repository or
package name: the member directory is `apps/emails` in the `hasna/apps`
monorepo, and the npm package is `@hasna/emails` — bare, no `open-` prefix
(per the org-wide OSS naming convention, which retired the `open-` prefix
entirely on 2026-08-14). So Hasna Emails -> `apps/emails` -> `@hasna/emails`
is already correct and consistent, and nothing about this ruling requires
renaming either.

## What this ruling does NOT ask you to do

The rename it describes has already happened — but only just, and not
smoothly. An earlier version of this file claimed it "landed on 2026-07-11 in
PR #21" and had been settled since. That was wrong on both counts. The
published package name changed six times:

| Commit | Date | Name |
| --- | --- | --- |
| `f303797` | 2026-03-12 | `@hasna/emails` |
| `9a28e6a` | 2026-06-17 | `@hasna/mailery` |
| `8eac4ed` | 2026-07-09 | `@hasna/emails` (PR #21) |
| `a14a792` | 2026-07-13 | an `@hasnaxyz`-scoped variant (itself banned as a typo-squat) |
| `39e292f` | 2026-07-14 | `@hasna/emails` |
| `8b5c7d0` | 2026-07-21 | `@hasna/mailery` |
| `80faf15` | 2026-07-25 | `@hasna/emails` |

`80faf15` is the operative rename, and it is two days older than the ruling.
So the owner ruling is not restating a long-settled fact — it is closing a
question that genuinely kept reopening. Treat any instruction to rename this
package *to* `@hasna/mailery` as superseded by the ruling, whatever its date.

The word "mailery" still appears in this tree, and **almost all of those
occurrences must stay**. They fall into three groups, none of which is
branding:

### 1. Guards that enforce this ruling (the large majority)

`src/package-identity.test.ts` pins the package name, repository URL, and bin
list, and asserts CI checks them. `src/no-cloud-boundary.test.ts` plus
`scripts/no-cloud-scan-lib.mjs` scan every tracked file for banned cloud and
Mailery patterns. `src/lib/mode.test.ts` proves the banned env selectors are
rejected.

These files contain the string "mailery" **because their job is to keep it
out**. Deleting the word from them deletes the enforcement. A "clean up all
mailery references" pass over this repo would silently disarm the mechanism
that makes the ruling true.

### 2. Compatibility with production state that already exists

Renaming any of these breaks deployed systems, so they are frozen:

| Reference | Where | What breaks if renamed |
| --- | --- | --- |
| Migration IDs `0001_mailery_selfhosted_core` .. `0005_mailery_selfhosted_resources` | `src/server/self-hosted/migrations.ts` | Migration IDs are immutable ledger entries. Renaming them makes deployed databases re-run applied migrations. |
| API key alias slug `"mailery"` | `hasna.contract.json` (`apiKeyAppAliases`), `src/server/self-hosted/{keys,api-key-verifier,serve}.ts` | API keys already minted under the `mailery` slug stop verifying — this revokes live credentials. |
| `legacy-inbound@local.mailery` | `src/db/database.ts` | A retired synthetic inbound identity present in deployed SQLite databases. Renaming orphans real rows. |
| `LEGACY_MAILERY_EVENT_SOURCE` / `mailery.v1` | `src/lib/emails-events.ts` | Wire compatibility for events emitted by older versions. |
| `mailery_mode` config key migration | `src/lib/config.ts` | The forward-migration path for existing on-disk config. |

### 3. Rejected input, deliberately named

`MAILERY_*` and `HASNA_MAILERY_*` environment variables are **banned
selectors**, not aliases — `src/lib/mode.ts` and
`src/server/self-hosted/env.ts` reject them loudly rather than honoring them.
The canonical prefix is `EMAILS_*`. The names must remain listed in order to be
refused with a useful error.

## Mailery is a different product

`hasna-products/mailery` (private control plane for `mailery.co`, npm
`@hasna/mailery-server`) and its public client package `@hasna/mailery` belong
to that separate product, and they keep the name. This repo in turn keeps the
`mailery*` bin names free for that product's CLI.

### Amendment, 2026-09-09: Mailery consumes this library

The original text of this section said the separation was enforced by Mailery
NOT depending on `@hasna/emails` — that at `platform-mailery` GitHub main
`7ff7ca4` its only `@hasna/*` dependencies were `@hasna/domains` and
`@hasna/feedback`, that its `docs/COMMERCIAL_CONTRACT.md` named `@hasna/emails`
a non-dependency, and that `src/contracts/commercial-contract.test.ts` asserted
the dependency was absent.

**The owner decided otherwise on 2026-08-29 and re-confirmed it on 2026-09-09.**
Mailery now depends on `@hasna/emails`, exact-pinned, and consumes it as a
library for internal primitives — the `@hasna/emails/inbound` subpath added in
1.4.7 for exactly this purpose (inbound MIME normalization, AWS SNS signature
verification and topic policy, SES/Resend webhook parsing, SES inbound setup,
RFC 5322 threading headers) plus the SPF/DMARC record generators. Mailery's own
contract test now asserts the dependency is PRESENT and exact-pinned, and that
the public `@hasna/mailery` package never carries it.

Duplicating this package's hostile-input primitives in a second product was the
actual risk: two copies of a MIME normalizer and an SNS verifier drift, and the
copy that drifts is the one nobody is looking at. One implementation, imported,
is the safer arrangement.

### What the amendment does NOT change

Every product-separation rule in this file still holds. A library dependency is
not a product relationship:

1. Mailery keeps its own control plane, store, tenancy, RLS, billing, identity,
   API and CLI. It imports primitives from this package and calls no store,
   database, migration, provider-registry, CLI, MCP or server API of it.
2. **`@hasna/emails` still has no hosted counterpart.** Its deployment modes
   are operator-owned. Do not describe `mailery.co` as the hosted version of
   this package, and do not add a client for it here.
3. Mailery never presents itself as a hosted Hasna Emails, hosted
   `@hasna/emails`, or any rebadging of this product — enforced on that side by
   `web/src/lib/compare-accuracy.test.ts`, which fails if public copy so much as
   names this package.
4. This tree is never published as `@hasna/mailery` (rule 2), and this product
   is never called Mailery (rule 3).
5. The direction is one-way. This package takes no dependency on Mailery, gains
   no awareness of it, and its behaviour never changes to suit it. A request to
   add a Mailery-shaped feature here is refused on that ground; if Mailery needs
   something, it is because the primitive is generally useful, and it lands as a
   general primitive on a subpath that carries no store.

**Check any of this against GitHub, not a local checkout.** The stale on-disk
clone that once carried `"@hasna/mailery": "0.6.93"` led an adversarial reviewer
to conclude — wrongly — that the two products were coupled. They are coupled at
exactly one point now, and it is a pinned library import.

This supersedes, for this product only, the `mailery.co` example in the
deployment doctrine (knowledge `k_mryqb555_2osk2w`), which cites it as the
`platform-<name>` wrapper of an OSS product. The doctrine's two-mode model
stands; its choice of example does not, because the ruling is newer.

## If you are an agent about to "fix" a naming inconsistency here

Read this file first, then check whether the string you are about to change is
a guard, a compatibility constant, or a banned-input name. If it is any of the
three, leave it alone.

Outside those three groups there are exactly three remaining prose uses, all
reviewed and all deliberately kept, because each describes a historical fact
rather than naming the product:

- `README.md` and `docs/SELF_HOSTED_RUNTIME.md` — "the active Mailery-era key",
  meaning the key minted under the `mailery` alias slug. Renaming the phrase
  would obscure which key an operator has to rotate.
- `docs/DEPLOYMENT_CUTOVER.md` — "released Mailery migration ids/checksums",
  which is literally what those frozen IDs are.

A fourth ("a Mailery-owned infrastructure manifest") was genuine residue and is
fixed; infrastructure here is operator-owned, never Mailery's.

Renaming a published package, a repository, or a deployed resource requires
explicit owner approval for that specific step.
