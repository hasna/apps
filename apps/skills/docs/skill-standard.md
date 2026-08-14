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

## Skill Kinds

A skill declares its artifact class with the `kind` frontmatter field:

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

Minimum `SKILL.md` frontmatter for an instruction skill:

```yaml
---
name: project
description: Open or resume an existing Hasna repo project using the projects CLI.
kind: instruction
version: 0.1.0
source: private
---
```

## Naming

Skill names are lowercase slugs: letters, numbers, dots, underscores, and
hyphens. The folder name, `SKILL.md` frontmatter `name`, `skill.json` `name`,
and `package.json` `name` should match.

## Manifest

Every portable skill needs a manifest. `skill.json` is the machine-readable
manifest. `SKILL.md` frontmatter stays compatible with existing Codewith
`SKILL.md` conventions and can be used by agents for skill discovery.

Minimum `SKILL.md` frontmatter:

```yaml
---
name: my-skill
description: What this skill does and when to use it.
version: 0.1.0
source: custom
category: Development Tools
tags:
  - custom
---
```

Minimum `skill.json`:

```json
{
  "$schema": "https://hasna.dev/schemas/skill.v1.json",
  "standard": "hasna.skill.v1",
  "name": "my-skill",
  "description": "What this skill does and when to use it.",
  "version": "0.1.0",
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
  ]
}
```

If `skill.json` is absent, the CLI can infer a portable manifest from
`SKILL.md` frontmatter plus `package.json` `bin`, but scaffolded and ported
skills should keep `skill.json` checked in.

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
- `skill.json` standard, version, inputs, and commands (relaxed for
  `kind: instruction`, which needs neither `commands`, `inputs`, nor `AGENTS.md`);
- `AGENTS.md` presence (executable skills only);
- `package.json` and command entrypoint safety (`package.json`/`bin`/`src` are
  optional for `kind: instruction`);
- no reserved files such as `.env` or symlinks.

## Porting Existing Skills

```bash
skills port ./old-skill
skills add ./old-skill --name new-name
```

Porting copies the folder into `~/.hasna/skills/<name>/`, skips generated and
dependency directories such as `node_modules`, `dist`, and `.git`, then adds or
normalizes `skill.json`, `AGENTS.md`, `package.json`, `tsconfig.json`, and an
entrypoint when they are missing.

## Machine Layout

The skills app folder (`~/.hasna/skills/`, relocatable with
`$HASNA_SKILLS_DIR`) hosts the owner layout:

```text
~/.hasna/skills/
├── skills/     canonical corpus cache — the sync source
├── logs/       run/sync logs (created lazily)
├── outputs/    run outputs (created lazily)
├── custom/     experiments, retained as-is
├── config.json
└── skills.db
```

`skills/` replaces the older `installed/` corpus home, and legacy flat skill
dirs that predate `installed/` migrate into it. Both moves are opt-in and
idempotent:

```bash
skills storage migrate            # installed/ + legacy dirs -> skills/, creates logs/ + outputs/
skills storage migrate --dry-run  # show what would move, write nothing
```

Migration refuses to run against a non-empty `skills/` that carries no
migration record (`skills/.layout-migration.json`), and never touches
`custom/`. After a successful migration `skills sync` reads the corpus from
the new cache automatically.

### Unmarked-home adoption

Agent homes are full of skill directories the CLI never wrote (the ad-hoc
sed/scp/rsync era). Those carry no `.hasna-skills.json` marker and sync leaves
them alone by design. Adoption is the migration mode for that population:

```bash
skills sync --adopt             # dry-run: hash unmarked home skills vs the corpus
skills sync --adopt --apply     # write markers for exact matches; ledger the rest
```

Each unmarked home skill's `SKILL.md` is hashed (line endings normalized,
`user_invocable` stripped) and compared against the canonical corpus cache:

- exact match -> a marker is written and the dir is adopted;
- content differs -> recorded in `~/.hasna/skills/conflicts.json` (home, skill,
  hash, canonical hash, mtime) and skipped — an unmarked dir is never
  overwritten;
- no canonical entry -> reported as unknown and skipped.

Every written marker is listed in a rollback record under
`~/.hasna/skills/rollback/`. Nothing is ever deleted by adoption.

### Home drift census

```bash
skills sync --check             # exits non-zero while drift exists
```

Compares each existing agent home against the canonical corpus and lists
`missing-from-home`, `stray-in-home` (marked dir, no canonical entry), and
`diverged` (marked dir whose hash differs). Unmarked dirs are adoption
candidates, not drift. `skills diff <name>` and `skills outdated` use the same
home-vs-canonical comparison; the pinned-skill version comparison remains as a
subset. `skills sync --prune [--apply]` removes only marked-and-stray dirs,
recording each removal in the rollback store before it happens.
