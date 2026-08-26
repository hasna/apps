# Standard-adherence suite

`bun test tooling/ci/tests/standard` — asserts the repo's member packages
conform to the hasna/apps standards. Complements the repo's own gates
(`bun run check`: names/secrets/manifests/publish-guard); it does not modify
`.github/workflows`.

## Checks

| check | file | standard | severity |
|---|---|---|---|
| 1. contracts conformance | `contracts.test.ts` | `hasna.contract.json` exists and passes `contracts repo-conformance` at the member's effective kit version (pinned `@hasna/contracts` dep → manifest `kitVersion` → `latest`); `kitVersion` matches the pinned dep where present | HARD, recorded exceptions |
| 2. publishConfig | `publish-config.test.ts` | `publishConfig.access === "public"`; nothing `private:true` | HARD, recorded exceptions |
| 3. four surfaces | `surfaces.test.ts` | `<name>` CLI bin (HARD), `<name>-mcp`, `<name>-serve`, `./sdk` (WARN, P5-census exceptions) | HARD + WARN |
| 4. license | `license.test.ts` | `license === "Apache-2.0"` | HARD, recorded exceptions |
| 5. dist hygiene | `dist-hygiene.test.ts` | no `files` entry pulls in `node_modules` (negated exclusions fine) | HARD |
| 6. intra-wave unpublished pins | `published-pins.test.ts` | no publishable member exact-pins an intra-wave dep (`@hasna/*` member of this tree) to a version not on the npm registry (wave tooling must publish the bumped dep before/within the same wave, or hold pins at the last published version) | HARD, registry-backed |
| 7. quarantine window admissions | `quarantine-pins.test.ts` | no finding-scope member's declared `dependencies` admit a version published inside the fleet 7-day `minimumReleaseAge` window (fresh resolution and pack-audit installs fail the 604800s guard; pin to the last version published before the window). Non-scope members' admissions are reported as a census, never asserted | HARD (scope), registry-backed |

## The census exception records are a REPORTING lane (f05fe292, 2026-08-15)

The hand-refresh loop is gone. New (unrecorded) violations — contracts
conformance failures, four-surface WARN gaps — **auto-file a reconcile task**
keyed on a stable fingerprint title via `todos task upsert --fingerprint`
(files in todos project `5e44770b-694c-46a3-864f-20a2b9ec1de2`, the
release/versioning lane project; override with `HASNA_TODOS_PROJECT`), are
reported with their task ids, and **the suite passes while reporting them**.
Created tasks are assigned to `agent-ea` via `todos task upsert --assign
agent-ea --assign-seat` (the lane's documented identity; override with
`HASNA_TODOS_AGENT`), so attribution does not depend on an ambient
`TODOS_AGENT_ID`.
Idempotent by fingerprint: a re-run files nothing new. If the `todos` CLI is
unavailable the violation is reported as `NOT FILED` and the suite still
passes.

**The two-sided registry contract is unchanged and load-bearing**: a recorded
exception whose member now PASSES (stale entry) still fails the suite until
the entry is deleted — a check that cannot fail is not a check. The
contracts-manifest, kitVersion and no-cannot-run checks remain hard gates
(recorded exceptions allowed, stale records still fail).

Every check is two-sided (prove-it-can-fail): a seeded violation fires and a
conforming member stays silent. The exception registries in `census.ts` are
data measured 2026-08-14; each entry carries the reason and the remediation
task. **When a violation is fixed, DELETE its exception entry** — a stale
entry fails the suite until removed, so the registry cannot rot.

## Remediation tasks

Filed 2026-08-14 in todos project `5e44770b-694c-46a3-864f-20a2b9ec1de2`
(`TODOS_AGENT_ID=agent-ea`):

- `slides` (`62ec9dbc`) — missing the HARD `<name>`
  CLI bin (per-member tasks; bins are never invented in-suite). The `router`
  bin (`452b7a32`) landed with #216; its exception entry was deleted.
- 22 contracts-conformance failures (accounts `f6869bad`, automations `99f670fe`, calendar
  `a967c9bd`, catalog `e4d8cd62`, docs `6818348f`, draw `5698b7d3`, emails
  `e0ef3e32`, gateway `9dc0ee28`, instructions `c15cca18`, knowledge
  `a8c97621`, logs `d166125e`, mementos `5695459d`,
  prompts `eb3f331d`, sheets `d766ac9c`, signatures `7001d8d7`, slides
  `ccc2e931`, tables `daaa2841`) plus `shield`
  (`2aceeb94`, added by the integrator lane for import #74), `hooks`
  (`03d497e8`, added by the integrator lane when #102's manifest landed),
  `files` (`b0845699`, added by the iterate-to-green fixer when #90's
  manifest landed), `todos` (`0ad82b16`, added by the iterate-to-green
  fixer when #105's manifest landed) and `monitor` (`d2c6d20f`, added by
  the iterate-to-green fixer when #97's manifest landed) — per-member
  tasks. `machines` (`6ab8775b`) was REMOVED 2026-08-15: #124 bumped
  `@hasna/contracts` to 0.10.6 and its manifest now validates clean.
- 25 members without `hasna.contract.json` (24 at the original census plus
  `connectors` and `terminal`, added by the integrator lane for imports
  #80/#88, minus `hooks`, whose manifest landed in #102) — one aggregate
  task (`41208cbe`) enumerating them.
- Members missing `-mcp` / `-serve` bins (including `terminal`, added by
  the integrator lane for import #88) — one aggregate task (`35e136f2`)
  enumerating them.
- `apps/computers` flaky test timeout — BUG task `1a8b922c`.
- The `./sdk` WARNs are owned by the standing P5 lane
  (`c7ce8b75-3d4e-4376-854c-875cd20c605b`).
- `apps/actions` missing publishConfig — fixed in this landing change;
  task `14a7ddcb-5068-41dd-a9eb-4278ceca22d9` closed.

## Landing

Branch `test/standard-adherence`, merged by the integrator lane (no PR from
this branch). Member fixes are limited to trivial manifest corrections
(missing `publishConfig` when clearly intended); versions are never bumped
and nothing is published from this branch.
