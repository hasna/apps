# Contract Conformance

Open Feedback ships a `hasna.contract.json` describing itself against the
[Hasna Service Contract v1](https://github.com/hasna/contracts). Run the check
with:

```bash
bun run contract-check    # contracts repo-conformance .
```

**It exits 1 today, and that is the accurate result.** This page records what is
genuinely missing, so the failure is legible instead of mysterious.

## Why the manifest still declares no `storage` block

**SQLite now exists** — `SqliteFeedbackStore` in `src/storage.sqlite.ts` is the
local default, at `~/.hasna/feedback/feedback.db`, with an automatic
non-destructive import of any existing `feedback.jsonl`. That is item 1 below,
and it is done. JSONL is now an export format and an opt-in legacy engine
(`HASNA_FEEDBACK_STORE=jsonl`) rather than the storage format.

There is still no PostgreSQL driver here; the `postgres` runtime engine is a
seam that requires the host to inject its own `FeedbackStore` adapter, and
`createFeedbackStore` throws without one.

**The manifest is deliberately unchanged by that work, and the block is still
absent.** A `cli-with-store` manifest must declare `storage`, and the block this
repo would have to write is not yet truthful in either available shape:

- `engines: ["sqlite", "postgres"]` asserts a PostgreSQL backend that does not
  exist (item 2).
- `engines: ["sqlite"]` plus a PostgreSQL waiver is **refused outright** while
  `feedback-serve` ships. Measured at `37718cb0`, one variable apart: with the
  bin present the waiver yields `declared waiver ignored: storage waivers are
  not permitted for a service-capable cli-with-store repo shipping
  feedback-serve`; with the bin removed the same manifest is fully conformant.
  Removing the bin is gated — see the `0.4.0` gate below and todos `87db44e3`.

So `manifest_valid` remains the first reported failure, and correctly so. The
storage block lands with whichever of those two unblocks first, not with this
change. Writing it now would assert a backend that is not there, which is the
one thing this file has consistently refused to do.

Two kit-shape facts for whoever writes that block, measured against
`@hasna/contracts` 0.8.5 rather than read from docs:

- `storage.envPrefix` must be exactly `HASNA_FEEDBACK_`. The code now reads
  `HASNA_FEEDBACK_*` first (falling back to the legacy unprefixed names), so
  this part is already true.
- `cli-with-store` storage also requires `storage.sqlitePath`, conventionally
  `~/.hasna/<name>/<name>.db`; omitting it fails validation. Elements of
  `metadata.conformance.waivedStorageEngines` are **objects**, not strings —
  `{ engine, reason, reviewedBy?, expiresAt? }`.

Note also that the kit does **not** verify a declared backend actually exists: a
probe declaring `storage.mode=sqlite` passed conformance with no implementation
behind it. Conformance passing is therefore not evidence that this work is done.

Two escape hatches exist and both are closed to this repo, by the kit's own
rules rather than by choice:

- **The PostgreSQL storage waiver is refused.** It is available only to a
  CLI-only `cli-with-store` repo. Measured verdict: *"storage waivers are not
  permitted for a service-capable cli-with-store repo shipping feedback-serve"*.
- **Reclassifying as `library` is refused.** Measured verdict: *"library repos
  must not ship a -serve or -mcp bin"*. This package ships both.

## What is actually required to conform

Each item is real implementation work, not a manifest edit.

1. ~~**Move the store onto a contract storage engine.** SQLite as the local
   default, with a migration for existing `feedback.jsonl` data, and
   `exportJsonl` preserved as an export format rather than the storage
   format.~~ **DONE** — `SqliteFeedbackStore` (`src/storage.sqlite.ts`) is the
   default engine; `migrateJsonlIntoSqlite` imports an existing log
   automatically, once, without modifying it; `exportJsonl` is byte-identical
   across both engines and is covered by a parity test. This did **not** change
   the reported gap set, because the manifest block it unblocks is still
   waiting on item 2 or on the `feedback-serve` removal.
2. **Implement PostgreSQL as a second engine**, plus a `storage.pgTestGate`
   naming an env-gated live-PostgreSQL test. This is not optional while
   `feedback-serve` ships: the waiver that would excuse it is unavailable to a
   service-capable repo.
3. **Complete the HTTP service topology**: add `GET /ready` and `GET /version`,
   and reshape `GET /health` to the contract's `{ status, version, mode }`.
   Note that `mode` must report a `sqlite | postgres` backend, so this cannot
   land before step 1 — the API topology and the storage migration are one piece
   of work, not two. Reshaping `/health` is a breaking change to the published
   HTTP surface and needs its own version note.
4. **Publish an OpenAPI document** at `/openapi.json` and generate the
   TypeScript client from it. `FeedbackClient` is hand-written today, so
   `generatedFrom` cannot be declared truthfully until it is generated.
5. **Add a self-host deployment artifact** (`Dockerfile` or `compose.yml`) and
   verify it builds and serves.

Once those land, the API surface can move from `deferred` to `supported` and the
manifest can carry the `storage` block the contract requires.

## What already conforms

The release gate does. `metadata.release.artifactScan.script` names the
`artifact-scan` package script, `prepack` reaches it, and it scans the **packed
tarball** rather than the source tree — see `scripts/scan-artifact.ts`. Scanning
`src/` would report on files that are never published and miss built output that
is, which is a gate that cannot fail for the case it exists to catch.

Because `repo-conformance` returns early when the manifest is invalid, that gate
is not visible in the report today. It was verified by running the check against
a copy of this repo carrying a hypothetical `storage` block; the gate passed, and
the same probe is what caught the declared script name being wrong.

That probe is no longer a one-off — see below.

## The measured gap, and the check that holds it

`bun run contract-check` reports exactly one failure, because `repo-conformance`
stops at `manifest_valid`. **Fixing the manifest does not leave the repo one step
from conformant.** Running the check against a copy carrying the minimal
schema-valid `storage` block shows what the early return hides:

| check | status |
| --- | --- |
| `manifest_valid` | fails today; passes under the probe |
| `surface_matrix` | fail — `missing supported surface declarations or eligible waivers: api` |
| `service_api_topology` | fail — `a supported API surface is required` |
| `surface_bindings` | fail — `generatedFrom is required for a supported service SDK` |
| `self_host_artifact` | fail — no `Dockerfile` / `compose.yml` |
| `storage_capabilities` | fail — `missing storage engines: sqlite, postgres`, plus `envPrefix` and `pgTestGate` |

Everything else passes, including `published_artifact_gate`,
`credential_seam_compliance`, `public_manifest_safety` and `hosting_story`.

Note what ties four of those five together: **they are consequences of shipping
`feedback-serve`.** The PostgreSQL waiver is refused for a service-capable repo,
and the API topology, SDK binding and self-host artifact are all required because
a serve bin is present. They are one decision's worth of work, not five
independent ones, which is why the list above is not a checklist to nibble at.

`bun run contract-gap` pins that set and runs in CI. It fails when a new
violation appears **and** when an existing one is fixed without the baseline
being lowered, so neither drift nor silent progress goes unrecorded. It probes
behind the early return deliberately: a ratchet reading only the reported output
would baseline one failure and pass forever while the other five sat unseen.

## Decision (2026-08-02): the `feedback-serve` bin is being withdrawn

Recorded from a two-sided debate on todos task `9b740e99`. Verdict: **drop the
bin, with an alignment condition.** The reasoning, because the conclusion is
worth less than the argument:

**The bin cannot do what its name declares.** `src/server/cli.ts` builds the
server with only `{ host, port }`; `startFeedbackServer` then falls back to
`createFeedbackStore()` with no options; and `createFeedbackStore` throws in
cloud mode without a host-injected adapter (`src/storage.ts`). So
`FEEDBACK_STORE=postgres feedback-serve` cannot start, ever. A `<name>-serve` bin
is the conventional declaration of a run-me-as-a-service story. Withdrawing it
retracts a false advertisement rather than removing a capability — the identical
server remains as `feedback serve`, as the exported `startFeedbackServer()`, and
as `createFeedbackHandler()`.

**Why the subcommand was demoted in the same change.** The opposing side's
strongest point, conceded by both: `feedback serve` runs the identical code path,
so removing only the bin would make the conformance report go clean while the
same one-command HTTP server still shipped. The kit's condition is
`bins.includes("feedback-serve")` — a *string proxy* for service capability, and
a proxy a subcommand walks straight past. Dropping the bin while leaving the
subcommand advertising an unqualified "HTTP API" would have moved the report
without changing the truth. Its description now states what it actually is: a
local-development server over the JSONL store, with no PostgreSQL support.

**What is deliberately NOT done here.** The bin is deprecated, not removed —
`0.3.0` ships a stub that still works and prints a migration notice to stderr,
and `0.4.0` removes it. Nothing is urgent: CI runs the `contract-gap` ratchet
rather than `contract-check`, so no build, publish or consumer is gated on this.
The gap set above is therefore unchanged by this commit, and correctly so.

### GATE — do not execute the `0.4.0` checklist below on its own

**Removing the `feedback-serve` bin is blocked until at least one of these is
true:**

1. the upstream kit defect (todos `87db44e3`) is resolved, so the waiver test no
   longer keys on a bin name; **or**
2. `feedback serve` is withdrawn in the same change as the bin.

**Why, measured rather than asserted.** A reviewer executed the checklist below
exactly as written against this branch. Dropping the bin from `package.json`,
from `bins` in `hasna.contract.json`, and dropping the `bin` field from the
`feedback-http-api` surface makes **four checks stop failing**:

- `self_host_artifact`
- `service_api_topology`
- `surface_bindings`
- `surface_matrix`

None of those four stops failing because anything got better. They stop because
`bins` is the only thing the kit reads to decide this repo is service-capable —
and the byte-identical HTTP server still ships as `feedback serve`, over the same
`startFeedbackServer`, with the same absence of PostgreSQL support. Four checks
would stop being run against a surface that is still there.

That is precisely the proxy-satisfaction the deprecation decision above was
constructed to avoid, arrived at by following this repo's own instructions. Note
the uncomfortable part rather than burying it: the distinction this repo drew
between a `<name>-serve` bin and a `serve` subcommand is a distinction about the
proxy itself, since `bins` is what the kit inspects. That is thin ground, and it
holds here only because the bin still ships, the gap is genuinely unchanged, and
the defect is filed upstream instead of being quietly exploited. Remove the bin
alone and the ground is gone.

**A future reader who disagrees with this gate should reopen `87db44e3`, not
delete these lines.** Deleting them removes the only record of why the obvious
next step is the wrong one.

**Removal checklist for `0.4.0`** — run only once the gate above is satisfied,
since the manifest also has to move: delete `src/server/cli.ts`; drop
`feedback-serve` from `bin` in `package.json` and from the `build` script; drop
it from `bins` in `hasna.contract.json`; drop the `bin` field from the
`feedback-http-api` surface there; drop the `feedback-serve` probe from
`feedback doctor` (`src/cli/index.ts`); and lower the `contract-gap` baseline in
the same commit, which the ratchet will force.

The ratchet is a genuine tripwire here, not a formality: removing the bin makes
`contract-gap` exit 1 rather than pass quietly, so whoever runs the checklist
will be stopped and sent back to this gate.

**Filed upstream regardless of any of the above:** the kit's ineligibility test
keys on a bin *name*, so any `cli-with-store` repo can hide its server behind a
subcommand and take the PostgreSQL waiver. That defect outlives this repo's
decision and is the finding with the longest reach.
