# Release Compatibility

`todos release-compat check` builds a local release readiness report for the OSS
package. It is designed for agents to run before publishing, updating a global
install, or preparing rollback notes.

```bash
todos release-compat check --json
todos release-compat check --format markdown
```

The check covers:

- package identity: `@hasna/todos`, public publish access, and `hasna/apps`
  repository metadata
- binary stability for `todos`, `todos-mcp`, and `todos-serve`
- package export stability for the root package, SDK, MCP manifest, registry,
  contracts, and storage adapter
- in-memory migration simulations from empty and recent local schema levels
- Bun global install, smoke test, and rollback commands
- changelog readiness through `todos release-notes`, `generate_release_notes`,
  and the `release_notes` JSON contract

MCP clients use `check_release_compatibility`. The JSON payload is the stable
`release_compatibility_report` contract and does not require network access.

## Public package gate modes

`bun run verify:release` is an explicitly non-authoritative review. It rebuilds
and packs twice, checks the public boundary, provenance, entrypoints, isolated
install smoke, and byte-for-byte reproducibility, but always reports
`authoritative: false`.

The authoritative path is `npm publish`, whose `prepublishOnly` lifecycle runs
the gate in publish mode. Publish mode requires
`HASNA_TODOS_EXPECTED_COMMIT` to equal `HEAD`, rejects every skip flag, and
requires `npm_lifecycle_event=prepublishOnly`. The expected commit cannot be
passed as a command-line argument. The package has no `prepack`, `prepare`, or
other final-pack mutation scripts, so npm's final publish pack is generated
from the same deterministic build state verified by the gate.

The Actions entrypoint is the repository-root
`.github/workflows/release-todos.yml`. A push of an annotated
`npm/todos/v<version>` tag on protected-main history invokes `npm publish`
from `apps/todos`. The workflow sets `HASNA_TODOS_EXPECTED_COMMIT` to
GitHub's event SHA and supplies the fixed reviewer variables and signed receipt
from the `npm-release` environment. See `npm-release-agent-review.md` for
the independent review and receipt procedure.

The npm trusted publisher for `@hasna/todos` must bind `hasna/apps`,
`release-todos.yml`, and `npm-release`, with direct publishing enabled.
A manual workflow run executes review-mode checks without publishing and does
not validate the npm OIDC binding or authoritative receipt gate.

Without the export, `prepublishOnly` fails the gate with
`release-expected-commit` and nothing is published; with a value that is not
`HEAD`, it fails with `release-expected-commit-match`. Both negative controls
are covered in `src/lib/public-release-gate.test.ts`.

Both modes use Bun 1.3.14, `npm pack --ignore-scripts`, a committer-time-derived
`SOURCE_DATE_EPOCH`, explicit tracked blob/mode/symlink verification against
`HEAD`, and a strict packed-binary allowlist. Review mode is suitable for CI;
only publish mode can produce an authoritative PASS.
