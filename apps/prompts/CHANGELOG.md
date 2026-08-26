# @hasna/prompts

## 0.3.37

### Patch Changes

- 5273f12: Fix package.json `repository`/`homepage`/`bugs` metadata: the published fields named `github.com/hasna/prompts`, a repository that never existed. Repointed to the real source, the `hasna/apps` monorepo — `repository` now carries `url: git+https://github.com/hasna/apps.git` with `directory: apps/prompts`, and `homepage`/`bugs` resolve to the `hasna/apps` repo pages for that member path.

## 0.3.36

### Patch Changes

- Updated dependencies [85a5e06]
  - @hasna/contracts@0.14.1

## 0.3.35

### Patch Changes

- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0

## 0.3.34

### Patch Changes

- 2ea3b9a: fix: packed tarballs no longer carry account-id-shaped 12-digit runs (publish-guard pattern aws-account-id, row 27d2a7a2). The carries were bundled dependency constants — zod's nil-UUID regex (v4/core/regexes.js), pg-types' binary-parser date offset, and the workspace @hasna/contracts bundle — plus one own-source nil-UUID literal in testers. Fixes: externalize zod/pg/@hasna/contracts in the member builds (each remains a declared runtime dependency, so runtime behavior is unchanged), build testers' nil UUID at runtime, and add a per-member publish-guard regression that packs the tarball and scans it with the guard's pattern set (red before, green after).
- Updated dependencies [554a5b9]
  - @hasna/contracts@0.13.4

## 0.3.33

### Patch Changes

- 6699f5c: Dispatch engine (emit + codewith read-only) with run receipts. Adds `prompts dispatch <id>` (--runtime emit|codewith, --target, --var/--vars-json, --cwd, --wait), `prompts dispatch get <run-id>` (metadata-only default; --include-output for bounded redacted captures), `prompts dispatch cancel <run-id>`, and `prompts targets list` (read-only discovery, safe profile names + availability only). Codewith runs are strictly read-only, pass the rendered prompt on stdin (never a shell string), run under an allowlisted environment, reserve the provider account via the conversations lock store (`codewith/provider-account/<provider>/<fingerprint>`, released on terminal state), and record dispatch_runs receipts binding prompt id/version, render hash, target, and output pointers. Dispatch renders strictly by default; missing variables fail with `STRICT_RENDER_MISSING_VARS` before a run is accepted. One accepted run increments prompt usage exactly once. MCP tools added: `prompts_targets`, `prompts_dispatch`, `prompts_dispatch_get`.
- 9c943e1: Add cross-app integration resolvers to the render engine: `{{todo:...}}`, `{{channel:...}}`, `{{knowledge:...}}`, `{{memento:...}}`, and `{{file:...}}` refs resolve through each owning package's SDK (todos/conversations/knowledge/mementos/files) with fixed, versioned, redacted projections, named fail-closed error codes, a permissive `--allow-unresolved-integrations` preview, render receipts, and a new `prompts_resolve` MCP tool. The owning packages remain optional runtime peers; when one is not installed the ref fails closed with the app's UNAVAILABLE code.
- 753b302: Typed variables, strict render, labels, and template dependencies. Backward-compatible template parser adds `\{{...}}` literal escaping, typed values (string/number/boolean/object/array), dot paths (`{{request.owner.name}}`), and `{{>partial-slug}}` partials; objects/arrays render as canonical JSON. `prompts render` gains `--strict` (named MISSING_VARIABLE failure), `--preview` (visible `[UNRESOLVED ...]` markers), and `--vars-json` (typed values). Stored variable metadata is persisted in a new `prompt_variables` table with real required state (inline defaults are optional), typed defaults, descriptions, validation, and render format; inspect/validate/lint read from it. New `prompt_labels` table with normalized exact keys/values and repeatable `--label key=value` filters on list/search. Template dependencies: one parent per prompt via `--extends` (no multiple inheritance), partials resolved from the store, pinned dependency versions, depth/cycle/byte-budget bounds, and `render_receipts` recording resolved source IDs/versions. The schedules render path routes through the canonical engine and `schedule due --dry-run` no longer mutates run state. MCP parity: `prompts_render` strict/typed options plus label and dependency tools; SDK exposes labels, dependencies, and render receipts.
- Updated dependencies [b630c48]
  - @hasna/events@0.1.16
