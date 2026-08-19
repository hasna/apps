# Member bootstrap scaffold

Generates a conforming new member under `apps/<name>` from a template, so a
new member never re-derives the four-surface shape by hand (measured before
this scaffold: every import re-derived it, and 15/82 members still lack the
mcp bin, 27/82 the serve bin, 53/82 the `./sdk` export).

## What a generated member gets

- **Four surfaces** (repo law 4): `<name>` CLI bin, `<name>-mcp` bin,
  `<name>-serve` bin, and an `./sdk` export — all built with `bun build`
  (zero runtime dependencies, so the generated member cannot drag the
  lockfile or a supply-chain pin).
- **hasna.contract.json** at contracts kit 0.11.1, schema
  `hasna.service_contract.v1`, with `api` / `sdk` / `mcp` / `cli`
  serviceSurfaces, both storage engines (sqlite + postgresql with a fail-closed
  `scripts/pg-test-gate.mjs` — the kit refuses a storage waiver for a
  service-capable member), a self-host artifact (docker-compose.yml +
  Dockerfile), and `metadata.release.artifactScan` wired into prepack.
  `contracts repo-conformance` passes on the generated member (measured:
  all 15 checks at kit 0.11.1).
- **Self-contained `tsconfig.json`** mirroring the repo-root
  `tsconfig.base.json` options — the Dockerfile build copies only
  `package.json` + `tsconfig.json` + `src` into the image, where the repo-root
  base does not exist, so a generated member cannot depend on it. Matches the
  fleet member shape: imported members keep their standalone configs.
- **Changeset wiring** — the generator writes
  `.changeset/<name>-bootstrap.md` with a `minor` bump, satisfying the
  versioning suite's version-without-changeset gate.
- **Gates wiring** — `contract:check` (`contracts repo-conformance .`),
  `verify` (`typecheck && test && build && contract:check`), plus the
  standard `build` / `typecheck` / `test` scripts the root gates and turbo
  consume. The census gates pick the member up automatically: `check-names`
  and `check-manifests` enumerate `apps/*` by directory.

## Usage

```bash
bun tooling/member-scaffold/generate-member.ts <kebab-name> ["description"]
```

The generator refuses a non-kebab-case name and refuses to overwrite an
existing `apps/<name>` (idempotency). Then:

```bash
bun install                          # add @hasna/contracts devDep + refresh bun.lock
bun run check:names                  # census gate sees the new member
cd apps/<name> && bun run verify     # typecheck + test + build + contract:check
```

Land the generated member PR-first like any other change, with the changeset
the generator created.

## Template layout

```
template/
├── package.json         # @hasna/<name>, four surfaces, publishConfig public
├── tsconfig.json        # extends ../../tsconfig.base.json
├── hasna.contract.json  # service contract v1, kit 0.11.1
├── openapi.json         # the doc the sdk surface's generatedFrom references
├── LICENSE              # Apache-2.0
├── README.md
└── src/                 # index (sdk), sdk, cli, mcp (stdio), serve, cli.test
```

Placeholders substituted by the generator: `__MEMBER__` (kebab name),
`__MEMBER_UPPER__` (env-prefix segment), `__MEMBER_DESC__` (description).
