# Agent Workflow Skills (private per-station store)

This directory is kept as the pointer for the Hasna **agent workflow skills** —
instruction-first skills that tell coding agents how to run fleet workflows:
session login, project creation, publishing, guarded merging, and so on.

## The 9 fleet workflow skills moved to the private store (owner ruling 2026-08-15)

`fleet-package-rollout`, `goal-plan-coordination`, `inbox`, `inbox-monitor`,
`merge-pr`, `skill-goal-execute`, `skill-login`, `skill-project-create`, and
`skill-publish` are **for internal fleet use only** and no longer live in this
public repository. They moved to the private per-station store
(`hasna-internal/fleet-resources`), which hydrates each station's skill cache
(`~/.hasna/skills/skills/`). Edit them there, never here.

The public `@hasna/skills` package keeps only the OSS executable corpus under
`skills/`. The sync/registry code paths that serve agent-workflow skills remain
for the machine-local caches, which is where those skills now come from — not
from this repository.

## What may live here again

If a skill is genuinely public (no fleet-only content), it belongs in the OSS
corpus under `skills/` with a registry entry — not in this directory. This
directory is reserved for the private-store pointer and carries no skill
corpus of its own.
