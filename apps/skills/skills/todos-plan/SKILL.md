---
name: todos-plan
description: "Create, edit, verify, execute, route, or synchronize Todos plans while preserving provider roles, authenticated authority, full stable IDs, and durable task evidence."
---

# Todos Plan

Use the Todos CLI as the source of truth. Markdown plan files are durable
human-readable artifacts; they do not replace task or plan rows. Never edit a
Todos database, hosted row, generated registry, or cached task store directly.

## Required Operation-Authority Gate

Apply this gate before every non-help Todos read or write.

1. Feature-detect the installed surface with metadata-only help:

   ```bash
   todos --help
   todos <command> --help
   ```

   A command or flag absent from installed help is unsupported. Help presence
   is necessary but not sufficient: the selected authenticated authority must
   also support the exact invocation. On `REMOTE_COMMAND_UNSUPPORTED` or an
   equivalent capability error, stop instead of substituting another CLI,
   bootstrapping a localhost service, extracting internal source, or silently
   changing the data path.
2. Record a non-secret provider-role table from package-owned configuration and
   authenticated readback:

   | Role | Required proof |
   |---|---|
   | Product story | `user-hosted` or `Hasna SaaS`. Hasna-operated AWS dogfood is customer-zero of the user-hosted story. |
   | Client data path | A local SQLite file or the server HTTP API. A client never opens PostgreSQL directly. |
   | Server operator | The party operating the authenticated Todos server. |
   | Authenticated authority | Exact API origin, tenant, and principal returned by the installed client. |
   | Server backend | `sqlite` or `postgresql`, selected by server database configuration. This is storage, not authorization. |
   | Plan-artifact writer | The package-owned atomic writer and receipt lookup used for Markdown artifacts. |

   These are independent facts. Hasna SaaS is a product story, not a backend.
   The server backend does not authorize a task operation. Do not derive
   authority from a location word, provider name, hostname guess, or retired
   placement enum.
3. Before production task data access, run the installed authenticated health
   check:

   ```bash
   todos health --json
   ```

   Require a successful authenticated HTTP authority with the intended tenant
   and no silent fallback. A local SQLite result is valid only for an explicitly
   selected on-box user-hosted workflow. Ambiguous authority, failed auth,
   unavailable routing, unsupported commands, or an unexpected backend fails
   closed. Never fall back from an authenticated production authority to a
   local file after an error.
4. Resolve the project through the authenticated authority, capture its full
   UUID, and prove scoped status:

   ```bash
   todos --json projects --show <project-ref>
   todos status --project <full-project-uuid> --json
   ```

   Require the returned project identity, tenant, and authority to match the
   intended operation. Never continue from a short ID, stale slug, pathname
   guess, or cross-project result.
5. Before an object-specific operation, prove the exact full stable UUID with
   the corresponding singleton read:

   ```bash
   todos inspect <full-task-uuid>
   todos plans --show <full-plan-uuid>
   todos --json lists --show <full-task-list-uuid>
   todos template-preview <full-template-uuid>
   ```

   Use the full UUID returned by the authority for every later read or
   mutation. If exact identity cannot be proven, stop.

Never print credentials or raw authentication material.

## Production Collection and Completeness Gate

Prefer exact full-ID singleton reads. If a production list, search, history, or
export is required to resolve or verify an object, use only a package-owned
producer and reviewed collector that enforce caller- or policy-selected
positive aggregate caps for calls, items, serialized bytes, and wall time
before materialization. The collector must own every producer call under the
remaining budgets, validate complete responses incrementally without uncapped
buffering, stop at the first excess, and discard the entire result on failure.

Drain every page within those aggregate caps. Reject repeated cursors, invalid
or partial JSON, trailing unvalidated data, producer failure, timeout, any cap
hit, scope drift, or a missing or ambiguous terminal signal. A larger cap,
consumer-side truncation, shell pipeline, generic timeout wrapper, or absence
from an incomplete result cannot prove completeness. Only an explicit terminal
marker such as `has_more=false` or equivalent exhaustion metadata can.

## Fresh Production Mutation Gate

Immediately before every production mutation:

1. Re-read the exact full-UUID target and every exact parent object from the
   same authenticated authority.
2. Preserve the authority-issued revision, version, ETag, or equivalent
   compare-and-swap token for the object being changed. Revalidate project,
   plan, task-list, task, lock, dependency, and approval scope as applicable.
3. Submit the mutation conditionally against that fresh token. Each mutation,
   including a comment, verification record, update, approval, completion,
   deletion, lock change, or dependency change, needs its own fresh pre-read
   and token. Never reuse a token or treat one successful write as authority
   for a later write.
4. Re-read every exact affected UUID from the same authority and verify the
   intended transition while preserving unrelated fields.

A read followed by an unconditional write is not a drift gate. If installed
help and the active authority do not expose a version token and conditional
mutation control for the exact operation, that production mutation is
non-runnable.

For every production create or append operation, additionally require:

- every exact stable parent UUID advertised by the data model;
- separate caller-stable operation and step identities plus the
  authority-documented deterministic C3 key bound to exact immutable
  semantics, parents, payload, and preconditions; and
- reconciliation through the same authority by the returned full UUID or an
  exact idempotency-key lookup.

After a timeout or ambiguous response, reconcile before any retry. One matching
accepted object may be accepted only after its exact step-bound receipt and
full readback. Zero accepted effects is not success. A single retry is
permitted only under C8. Any accepted step enters C9 forward repair or
receipt-scoped compensation instead of retry. Never issue a blind replacement
create.

## Named C1-C9 Production Mutation Envelope

Every production create, update, completion, approval, assignment, dependency
or lock change, delete, comment, verification/evidence record, export, plan
artifact write, or other state mutation must close one immutable envelope whose
fields are explicitly named `C1` through `C9`. Existing outcome authorization
is enough; do not insert a duplicate approval. If the authenticated authority
or package-owned plan-artifact writer cannot prove a clause, that path is
non-runnable.

- **C1 Authority, provider roles, full targets, and immediate preimage.**
  Record the product story, provider-role table, authenticated authority and
  tenant, server backend, full project UUID, and every full plan, task-list,
  task, template, export, and artifact target. Immediately before submission,
  perform bounded complete same-authority reads of every existing target and
  parent, preserving required full fields and revisions/ETags. For create,
  require exact bounded terminal authority-issued absence; for an artifact,
  capture exact absence or the full byte preimage and SHA-256.
- **C2 Authority-enforced exact-prestate precondition.** Require
  create-if-absent for row creates/appends and a fresh exact full-target-UUID
  CAS/`If-Match` for every existing-row mutation. Bind each precondition to the
  full UUID and complete C1 state or authority-issued revision. Artifact
  creation must be atomic no-overwrite; replacement must be an atomic expected
  full-preimage mutation bound to the prior SHA-256 and bytes. Client-side
  checks, editor saves, shell redirection, and read-then-unconditional-write do
  not qualify.
- **C3 Stable distinct step identities and deterministic keys.** Create one
  caller-stable operation identity and a distinct caller-stable step identity
  for every ordered manifest entry, including a singleton. Supply the
  authority-documented deterministic key for each step, bound to operation ID,
  step ID, ordinal, immutable semantics, all full targets, canonical payload
  or artifact digest, and exact C1/C2 state. Never invent a key algorithm or
  reuse identities or keys for a resubmission.
- **C4 Immutable step-bound receipts.** Require exactly one immutable receipt
  from the authority or package-owned artifact writer for every ordered step.
  It must bind operation ID, distinct step ID, ordinal, deterministic key,
  authority/tenant, full targets, consumed pre-state, canonical payload digest,
  disposition, accepted effect if any, resulting revision or artifact
  SHA-256/byte length, and exact receipt identity. Multi-step work also needs an
  immutable coordinator receipt binding the ordered step receipts and terminal
  aggregate state.
- **C5 Exact terminal lookup with hard caps.** Look up the exact receipt,
  operation, or deterministic key through the same authority under positive
  finite authority-enforced aggregate caps for calls, items, serialized bytes,
  and wall time. The artifact writer must provide an equivalent exact terminal
  receipt lookup. Client-only limits, manual cursor chasing, shell timeouts, or
  an uncapped filesystem scan do not qualify.
- **C6 Fail closed.** Do not claim success or execute a dependent step if any
  cap is missing, zero, unlimited, client-only, or hit; output is partial,
  incomplete, nonterminal, invalid, or scope-drifted; or lookup returns zero or
  multiple matches. A terminal zero-effect result is nonacceptance, not
  success, and may enter only C8.
- **C7 Exactly-one result, full readback, and duplicate proof.** Require
  exactly one matching immutable step receipt and exactly one accepted effect
  for every accepted ordered step, plus the matching coordinator receipt for
  multi-step work. Perform bounded complete readback of every affected UUID
  from the same authority and exact full-byte readback of every artifact by
  path and SHA-256. Verify requested and preserved fields, revisions,
  identities, ordinals, parent scope, and that each deterministic key maps to
  the same receipt, target, payload/preimage digest, exact pre-state, and
  precondition.
- **C8 Restricted fresh-identity retry.** Allow at most one mutation retry,
  only after exact C5 lookup proves exactly one immutable terminal
  nonacceptance receipt for every submitted step and zero accepted effects for
  the operation. Immediately before resubmission, repeat the full C1 read,
  capture fresh C2 state, freeze a new ordered manifest, and create a new
  operation ID, new distinct step IDs, and new deterministic keys. Ambiguous,
  accepted, zero-match, nonterminal, incomplete, or multiply matched outcomes
  forbid retry.
- **C9 Ordered immutable manifest, compensation, and repair.** Before the
  first write, freeze an ordered immutable manifest, including a one-step
  manifest for a singleton. Every entry contains its ordinal, operation ID,
  distinct step ID, dependencies, full targets and parents, exact C1 state, C2
  preconditions, deterministic key, intended receipt identity, and
  authority-documented forward-repair or receipt-scoped compensation route.
  Once a step is submitted, do not rewrite or blind-rerun the manifest.
  Compensation is permitted only for an exactly identified accepted receipt;
  every compensating write is a new operation with its own C1-C9 envelope.

Task and plan titles, descriptions, comments, verification commands and
summaries, completion notes, export contents, plan Markdown, and any other
private payload must not appear in argv, shell history, diagnostics,
environment variables, or ad hoc temporary files. Submit bytes only through a
package-owned protected input channel identified by a non-secret opaque
descriptor. The descriptor may appear in argv only when it neither reveals nor
encodes the private value. If the installed package exposes only direct
positional or flag values for a private field, that production mutation is
non-runnable.

## Inputs

Resolve these at runtime; none has a built-in default:

- `<full-project-uuid>`: authoritative project UUID.
- `<full-plan-uuid>`: authoritative plan UUID when the plan exists.
- `<full-task-uuid>`: authoritative task UUID for the current work item.
- `<plan-slug>`: caller- or policy-selected stable lowercase slug.
- `<agent-name>`: inherited agent identity when task state is updated.

Commands containing angle-bracket placeholders are illustrative. Replace every
placeholder with an authority-proven value before execution.

## Authoring Workflow

1. Apply the Required Operation-Authority Gate.
2. Inspect the exact current task and, when present, the exact plan:

   ```bash
   todos inspect <full-task-uuid>
   todos plans --show <full-plan-uuid>
   ```

3. Create or update the relative Markdown artifact through the package-owned
   protected artifact writer:

   ```text
   .hasna/todos/plans/<full-project-uuid>/<plan-slug>.md
   ```

   Pass Markdown bytes by opaque descriptor, not argv or shell redirection.
   For create, require atomic no-overwrite and a receipt with path, byte length,
   SHA-256, operation ID, step ID, and deterministic key. For update, supply the
   exact expected preimage bytes and SHA-256, require atomic replacement, and
   retain the immutable before/after receipt. Immediately perform exact
   full-byte readback and hash verification. If the package-owned writer lacks
   these controls, do not write the artifact.
4. Use Todos CLI commands for authoritative state. Private values below are
   represented only by package-owned opaque descriptors:

   ```bash
   todos add <opaque-task-create-descriptor> --project <full-project-uuid> --plan <full-plan-uuid> <C1-C9-controls>
   todos update <full-task-uuid> <opaque-update-descriptor> <C1-C9-controls>
   todos comment <full-task-uuid> <opaque-comment-descriptor> <C1-C9-controls>
   todos record-verification <full-task-uuid> <opaque-evidence-descriptor> --agent <agent-name> <C1-C9-controls>
   ```

   The descriptors and `<C1-C9-controls>` are capability requirements, not
   literal flags. Resolve only package-documented forms from current help and
   the authenticated authority contract. Run a production form only when every
   required control exists.
5. Read back every created or changed object using its returned full UUID.
6. Record verification as work proceeds. Complete only the task whose
   acceptance criteria are satisfied:

   ```bash
   todos --agent <agent-name> done <full-task-uuid> <opaque-completion-descriptor> <C1-C9-controls>
   ```

   Task completion requires a new exact task read and fresh token after the
   final preceding mutation.

## Plan Artifact Requirements

The relative Markdown artifact must include:

- full Todos project, plan, and task UUIDs where applicable;
- scope and out-of-scope boundaries;
- acceptance criteria and dependencies;
- rollout or recovery notes when relevant;
- verification commands and evidence references; and
- residual risks.

Draft-only artifacts must say that no authoritative plan row exists. Do not
invent placeholder UUIDs or allow workers to execute against a draft identity.

## Worker Routing

Task-triggered workers receive:

- full task, plan, and project UUIDs;
- repository root plus repo-relative allowed and out-of-scope paths;
- Todos CLI source-of-truth instruction;
- validation and evidence requirements; and
- adversarial verification requirement.

Use isolated work scopes. Do not route new repo-mutating work through prompt
paste. Native Codewith goals and loops are Codewith mechanisms; OpenLoops
workflows and runs are separate and must be named and recorded as OpenLoops
only when that system is actually used.

## Destructive Plan Operations

Plan completion or deletion requires exact scope already authorized by the
caller and the Fresh Production Mutation Gate:

```bash
todos plans --show <full-plan-uuid>
todos plans --complete <full-plan-uuid> <C1-C9-controls>
todos plans --delete <full-plan-uuid> <C1-C9-controls>
```

These forms are syntax references only. If the client cannot submit the exact
operation conditionally against the freshly read plan version, do not run it
in production. Re-read the exact plan after completion. After deletion require
an authoritative exact-ID tombstone or not-found result distinguishable from
auth, routing, transport, and incomplete collection failure.

Do not add a duplicate approval gate when the caller already authorized the
exact outcome. If the exact plan identity or destructive scope is new, stop.

## Done Criteria

- The Required Operation-Authority Gate passed.
- The provider-role table, authenticated authority, and server backend were
  recorded as independent facts.
- Every required collection was producer-bounded and explicitly terminal
  without hitting an aggregate cap.
- All commands and flags exist in installed help and on the active authority.
- The plan artifact is relative and linked to authority-proven full UUIDs.
- Every production mutation has a complete immutable named C1-C9 envelope.
- Every artifact create/update used atomic no-overwrite or exact-preimage
  semantics, immutable receipts, and full byte/hash readback.
- Every existing-object mutation used a fresh same-authority CAS token and was
  read back from the same authority.
- Every create or append used exact parent UUIDs, separate operation/step
  identities, the authority-documented deterministic C3 key, and bounded
  terminal reconciliation before success was claimed.
- Verification, changed files, and residual risks are recorded.
- Adversarial verification is reconciled before completion.

## Related

- [[todos-plans]] — plan, template, and task-list CLI operations.
- [[todos-progress]] — comments, locking, dependencies, and history.
- [[todos-filter]] — bounded task listing, filtering, and export views.
