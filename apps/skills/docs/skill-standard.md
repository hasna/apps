# Portable Skill Standard

Portable skills live in one folder each:

```text
~/.hasna/skills/<skill-name>/
├── SKILL.md
├── skill.json
├── AGENTS.md
├── package.json
├── tsconfig.json
└── src/
    └── index.ts
```

`skills new <name>` creates this layout. `skills scaffold <name>` is an alias.
`skills port <path>` and `skills add <path>` copy an existing skill folder into
this layout and add missing standard files.

## The manifest split

Two metadata surfaces exist, with one rule: **portable metadata lives in
`skill.json`; consumer frontmatter stays minimal.**

- `skill.json` is the machine-readable manifest and the **source of truth**
  for everything the fleet needs to know about a skill: identity, version,
  runtime contract, provenance. It is the `hasna.skill.v1` contract defined
  in `schemas/skill.schema.json` (published at
  `https://hasna.dev/schemas/skill.v1.json`).
- `SKILL.md` is the agent-facing document. Its frontmatter carries only
  `name` and `description` (plus `user_invocable: true` where a Claude
  consumer renderer needs it). Everything else — `kind`, `version`,
  `source`, `category`, `tags`, `displayName` — lives in `skill.json`.
  See `docs/authoring-rule-amendment.md` for the proposed fleet rule text.

```yaml
---
name: my-skill
description: What this skill does and when to use it.
---
```

## Skill Kinds

A skill declares its artifact class with the `kind` field in `skill.json`
(`kind` may also appear in `SKILL.md` frontmatter for compatibility with
existing Codewith conventions):

- `kind: executable` (default when omitted) — a runnable skill folder with
  `package.json`, a non-empty `bin`, and `src/index.ts`. `skills run` executes it.
- `kind: instruction` — a `SKILL.md`-primary prose skill for coding agents.
  `package.json`, `bin`, and `src/` are all optional. Instruction skills may still
  bundle optional helper scripts (a `bin`/`src` is permitted, not forbidden), but
  they are consumed by agents via `SKILL.md`, not executed. `skills run` on an
  instruction skill returns a clear "not runnable — instruction skill" error
  instead of executing a stub.

Missing `kind` defaults to `executable` so the bundled corpus is unaffected.
Migrated operational (prose) skills should set `kind: instruction` explicitly.

## Naming

Skill names are lowercase slugs: letters, numbers, dots, underscores, and
hyphens. The folder name, `SKILL.md` frontmatter `name`, `skill.json` `name`,
and `package.json` `name` must match.

## The `hasna.skill.v1` manifest

Every portable skill needs a `skill.json` manifest conforming to
`hasna.skill.v1` (schema: `schemas/skill.schema.json`). The templates always
emit a complete valid manifest; `skills validate` rejects one that is
incomplete, invalid, or whose `content_hash` does not match the bundle.

### Required fields

| field | type | meaning |
|---|---|---|
| `standard` | string | `"hasna.skill.v1"` |
| `name` | string | Lowercase slug; matches the folder name |
| `description` | string | What this skill does and when to use it |
| `version` | string | Semver (e.g. `0.1.0`). Any content change requires a version bump |
| `runtime` | object | The runtime contract below |
| `provenance` | object | Source and integrity fields; `content_hash` is required |

### Optional fields (legacy-compatible)

| field | type | meaning |
|---|---|---|
| `$schema` | string | `https://hasna.dev/schemas/skill.v1.json` |
| `displayName` | string | Human-facing name |
| `category` | string | Marketplace / registry category |
| `tags` | string[] | Searchable tags |
| `kind` | `"executable" \| "instruction"` | Artifact class |
| `inputs` | object[] | Declared inputs (`name`, `type`, optional `required`, `description`) |
| `commands` | object[] | Runnable commands (`name`, `entry`/`command`, optional `args`, `description`) |

### The runtime contract

| field | type | default | meaning |
|---|---|---|---|
| `runtime` | `"bun" \| "node" \| "python3"` | *(required)* | Execution runtime. `bun` is the Hasna default |
| `version` | string | — | Optional runtime version constraint (e.g. `"22"`, `">=3.12"`) |
| `entrypoint` | string | `commands[0].entry` | Relative path to the runnable entrypoint |
| `timeout` | integer | `900` | Max execution seconds, **capped at 900** |
| `needs_network` | boolean | `false` | Whether execution requires network egress |
| `env` | string[] | `[]` | **Secret REFERENCE names only, never values** — uppercase identifiers such as `OPENAI_API_KEY` |
| `sandbox` | `"readonly-fs" \| "workspace-write" \| "full"` | `"readonly-fs"` | Filesystem access granted to execution |
| `system_deps` | string[] | `[]` | Allowlisted system binaries (see schema for the list) |
| `artifacts` | string[] | `[]` | Glob patterns of artifacts the skill may produce (e.g. `"out/**"`) |

### The provenance fields

| field | type | meaning |
|---|---|---|
| `source_commit` | string | Git SHA of the source revision, or `"unknown"` for locally scaffolded skills |
| `content_hash` | string | **Self-referencing** canonical SHA-256 of the normalized bundle (see below). Required on every manifest |
| `changelog` | string | Pointer to changelog / release notes (relative path or URL) |

### Example

```json
{
  "$schema": "https://hasna.dev/schemas/skill.v1.json",
  "standard": "hasna.skill.v1",
  "name": "my-skill",
  "description": "What this skill does and when to use it.",
  "version": "0.1.0",
  "displayName": "My Skill",
  "category": "Development Tools",
  "tags": ["custom"],
  "inputs": [
    {
      "name": "args",
      "type": "string[]",
      "required": false,
      "description": "Arguments passed after `skills run my-skill`."
    }
  ],
  "commands": [
    {
      "name": "my-skill",
      "entry": "src/index.ts",
      "description": "Run my-skill.",
      "args": ["...args"]
    }
  ],
  "runtime": {
    "runtime": "bun",
    "entrypoint": "src/index.ts",
    "timeout": 900,
    "needs_network": false,
    "env": [],
    "sandbox": "readonly-fs",
    "system_deps": [],
    "artifacts": []
  },
  "provenance": {
    "source_commit": "unknown",
    "content_hash": "<64 lowercase hex chars>",
    "changelog": "CHANGELOG.md"
  }
}
```

If `skill.json` is absent, the CLI can infer a portable manifest from
`SKILL.md` frontmatter plus `package.json` `bin`, but scaffolded and ported
skills always keep a complete `skill.json` checked in. A manifest present
without a valid `content_hash` is rejected by `skills validate`.

## Canonical content hashing

`content_hash` is a **self-referencing** SHA-256 over the normalized skill
bundle:

1. **Coverage** — every file at the skill root (`SKILL.md`, `skill.json`,
   `AGENTS.md`, `package.json`, `tsconfig.json`) plus every file under
   `src/`, `scripts/`, `assets/`, and `references/`, recursively.
2. **Exclusions** — `node_modules`, `.git`, `dist`, `build`, `.turbo`,
   dot-entries, and symlinks never enter the hash.
3. **Normalization** — line endings are normalized to LF; for `skill.json`
   the manifest is **blank-canonicalized**: parsed, its own `content_hash`
   field (top-level or under `provenance`) removed, and re-serialized with
   sorted keys. Key order, CRLF, and the hash's own presence therefore never
   change the digest.
4. **Determinism** — files are hashed in sorted relative-path order (posix
   separators), each entry length-prefixed, so the digest is identical on
   every platform for the same logical content.
5. **Verification** — `skills validate` recomputes the hash and rejects any
   manifest whose declared `content_hash` does not match, with the computed
   value in the error message.

### Versioning rule

**A content change requires a version bump; the same version with different
content is rejected.** Enforcement is structural: any content change alters
the canonical bundle, so the declared `content_hash` no longer matches and
`skills validate` fails (`contract.content_hash_mismatch`). Re-hashing
without a version bump is still a rejection signal for the registry/server
later, which pins by version + hash — same semver + different hash is
unpublishable.

## Agent Handoff

`AGENTS.md` is required for portable skills created or ported by the CLI. It
tells a coding agent where to put logic, how to update the manifest, how to test
the skill, and how to verify it with:

```bash
skills validate my-skill
skills run my-skill --help
```

## Runtime

The first command in `skill.json.commands` is the default for:

```bash
skills run my-skill [args...]
```

For Bun/TypeScript skills, point `entry` at `src/index.ts`. The CLI runs the
entry from the skill folder, passes through arguments, and records run metadata
under the caller project’s `.skills/runs` and `.skills/exports` directories.

## Validation

```bash
skills validate my-skill --json
```

Validation checks:

- folder and name safety;
- `SKILL.md` frontmatter compatibility (including a valid `kind`);
- the `hasna.skill.v1` contract: `standard`, `name`, `description`, `version`
  (semver), the runtime contract (runtime, timeout cap, sandbox, env reference
  names, system-deps allowlist), and provenance;
- the canonical `content_hash`: present, well-formed, and matching the bundle
  (`contract.content_hash_mismatch` on drift);
- `skill.json` standard, version, inputs, and commands (relaxed for
  `kind: instruction`, which needs neither `commands`, `inputs`, nor `AGENTS.md`);
- `AGENTS.md` presence (executable skills only);
- `package.json` and command entrypoint safety (`package.json`/`bin`/`src` are
  optional for `kind: instruction`);
- no reserved files such as `.env` or symlinks.

An invalid manifest exits non-zero with the exact field errors.

## Porting Existing Skills

```bash
skills port ./old-skill
skills add ./old-skill --name new-name
```

Porting copies the folder into `~/.hasna/skills/<name>/`, skips generated and
dependency directories such as `node_modules`, `dist`, and `.git`, then adds or
normalizes `skill.json`, `AGENTS.md`, `package.json`, `tsconfig.json`, and an
entrypoint when they are missing. Missing contract fields (runtime defaults,
provenance) are filled and the `content_hash` is recomputed over the ported
bundle; unknown keys in an existing `skill.json` are preserved.
