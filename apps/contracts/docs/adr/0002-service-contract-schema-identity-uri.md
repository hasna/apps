# 2. The `$id` of the service contract JSON Schema is an opaque identity URI

- **Status:** proposed — the contract-version consequence is an owner decision
- **Date:** 2026-09-10
- **Applies to:** `hasna.service_contract.v1` (`src/hasna.contract.schema.json`,
  `SERVICE_CONTRACT_JSON_SCHEMA` in `src/service-contract.ts`)

## Context

The `@hasna/contracts` package was moved into this monorepo (`hasna/apps`,
`apps/contracts`). The standalone `github.com/hasna/contracts` repository no
longer exists — `gh api repos/hasna/contracts` returns **404**.

BUG-0065 repointed the npm metadata that still named the dead repository
(`repository`, `homepage`, `bugs` in `package.json`), the storage-kit README
template and its vendored mirrors, the automations manifest `$schema`, one doc
link and four example fixtures (PR hasna/apps#2127).

That sweep deliberately stopped short of one class of occurrence, because it is
a schema-**identity** change rather than a metadata repoint. This ADR records
that remainder and the decision taken for `contractVersion` v1.

### What the remaining occurrences are

| occurrence | kind |
| --- | --- |
| `src/hasna.contract.schema.json` `$id` | the schema's identity URI |
| `src/service-contract.ts` `$id` (same string, in the exported constant) | the schema's identity URI |
| `dist/hasna.contract.schema.json`, `dist/index.js`, `dist/conformance.js`, `dist/service-contract.js`, `dist/service-contract.d.ts`, `dist/cli/index.js` | committed build output derived from the two above |
| `src/todos/provenance.ts` (`TODOS_SOURCE_FREEZE`) and the five `generated/todos/v1/*.json` bundles that embed it | frozen historical provenance: a repository name **plus a commit sha** recording where a source was frozen |

The first three rows are the same value reaching the published tarball: the
package ships `dist/hasna.contract.schema.json`, so the URI is inside the
published artifact.

The last row is not a stale live link. `sourceFreeze.contracts` and
`sourceFreeze.e00115` name `hasna/contracts` **at a specific 40-character sha**
as the historical base those frozen bundles were generated from. Rewriting them
would falsify the provenance they exist to record, and would also break the
byte-reproducibility gate. They are intentionally **not** touched.

### What `$id` is, and what it is not

`$id` is a JSON Schema **identity** keyword. It gives the schema document a
canonical URI so `$ref`s resolve against a stable base, and so a validator can
cache and de-duplicate the document. It is not a fetch instruction: a JSON
Schema consumer is not required to dereference it, and the tooling that consumes
this schema does not fetch it. The conformance kit validates manifests with the
Zod schema at runtime and with the shipped JSON Schema for editor tooling — in
both cases from local bytes.

The current value is a `github.com` URL, so it *reads* like a repository link
even though it is not used as one. That mismatch is what made the dead-repo
finding look like a live broken link.

## Options considered

**(a) Keep the value; declare it opaque.** Leave `$id` byte-for-byte as it is
for `contractVersion` v1 and record, inside the schema itself, that it is an
opaque identifier rather than a repository link.

**(b) Change the value.** Point `$id` at the schema's new home under
`hasna/apps` and decide whether that is a breaking contract change requiring a
version bump.

## Decision

Adopt **(a)** for `contractVersion` v1.

Reasons:

1. **Changing it buys no working link.** Any replacement is also a
   `github.com` path that does not resolve as a schema document; neither the old
   nor the new URI is dereferenceable. The change would trade one non-fetchable
   URL for another.
2. **Changing it costs real identity.** `$id` is part of a published contract
   document's identity. Consumers that key on it — validator caches, `$ref`
   bases, recorded document ids — would break for a benefit that does not
   exist. Doing that silently inside a bug-fix branch is exactly the risk the
   BUG-0065 split was protecting against.
3. **The naming is the actual defect.** The URI is not wrong as an identifier;
   it was misread as a link. Documenting the identity semantics fixes the
   misreading at the artifact level, where the record travels with the
   published package.

The decision is recorded in the schema itself as a root-level `$comment`, in
both copies (`src/hasna.contract.schema.json` and the exported
`SERVICE_CONTRACT_JSON_SCHEMA`), which a conformance test keeps equal.

Nothing in this ADR changes the schema's validation behaviour: `$comment` is an
annotation keyword, ignored by validators.

## Consequences

- The dead-repo string still appears in the published `$id` and in the committed
  `dist/` output derived from it. That is now a **documented, intentional**
  identity value rather than an unnoticed stale link.
- `dist/` is regenerated from source by the package build; per repository law
  it is never hand-edited.
- The `generated/todos/v1` bundles keep their frozen provenance unchanged.

## Owner decision required

Adopting (b) later — or bumping `hasna.service_contract.v1` to a v2 whose `$id`
names the schema's home in `hasna/apps` — is a contract-identity change to an
already-published document. It is **owner-gated** and is not taken here.

Republishing `@hasna/contracts` with the BUG-0065 metadata repoint is likewise
owner-gated.
