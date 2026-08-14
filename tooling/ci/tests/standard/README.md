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

Every check is two-sided (prove-it-can-fail): a seeded violation fires and a
conforming member stays silent. The exception registries in `census.ts` are
data measured 2026-08-14; each entry carries the reason and the remediation
task. **When a violation is fixed, DELETE its exception entry** — a stale
entry fails the suite until removed, so the registry cannot rot.

## Remediation tasks

Filed 2026-08-14 in todos project `5e44770b-694c-46a3-864f-20a2b9ec1de2`
(`TODOS_AGENT_ID=agent-ea`):

- `router` (`452b7a32`), `slides` (`62ec9dbc`) — missing the HARD `<name>`
  CLI bin (per-member tasks; bins are never invented in-suite).
- 18 contracts-conformance failures (automations `99f670fe`, calendar
  `a967c9bd`, catalog `e4d8cd62`, docs `6818348f`, draw `5698b7d3`, emails
  `e0ef3e32`, gateway `9dc0ee28`, instructions `c15cca18`, knowledge
  `a8c97621`, logs `d166125e`, machines `6ab8775b`, mementos `5695459d`,
  prompts `eb3f331d`, sheets `d766ac9c`, signatures `7001d8d7`, slides
  `ccc2e931`, tables `daaa2841`, telephony `26ad6a16`) — per-member tasks.
- 23 members without `hasna.contract.json` — one aggregate task
  (`41208cbe`) enumerating them.
- Members missing `-mcp` / `-serve` bins — one aggregate task
  (`35e136f2`) enumerating them.
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
