# Proposed amendment — fleet skill-authoring rule (consumer frontmatter)

This document carries the **exact proposed text** to amend the fleet
skill-authoring rule. It ships with the skill.json metadata contract PR
(hasna.skill.v1) so the code and the rule land together. The coordinator
applies it via the owning instruction surface later; no generated rule home is
edited by this PR.

## Current rule (as rendered)

> Consumer skill frontmatter must be exactly `name` + `description`, no extra
> keys.

## Proposed rule (replaces the current text)

> Consumer skill frontmatter is minimal: `name` + `description` only, plus
> `user_invocable: true` where a Claude consumer renderer needs the skill in
> its slash menu. No other frontmatter keys.
>
> Portable metadata lives in `skill.json` (`standard: hasna.skill.v1`):
> `kind`, `version`, `source`, `category`, `tags`, `displayName`, the runtime
> contract, and provenance (`source_commit`, `content_hash`, `changelog`).
> The manifest is the source of truth; a consumer may read frontmatter for
> discovery, never for authority.
>
> A content change requires a version bump. The canonical `content_hash`
> (over the normalized bundle, see `docs/skill-standard.md`) is required on
> every manifest and is verified by `skills validate`; same semver with
> different content is rejected.

## Why the amendment is needed

The current rule was written when `SKILL.md` frontmatter was the only
machine-readable surface. `skill.json` (hasna.skill.v1) now carries the full
contract, and duplicated keys in frontmatter drift from the manifest — two
authors updating one surface and not the other is the exact divergence this
amendment removes. `kind` is the case that made the split necessary: an
instruction skill's `kind` must be readable by the CLI from `skill.json`, and
keeping it also in frontmatter gives two authorities.

`user_invocable` is the one deliberate consumer-only exception: it controls
Claude's slash menu and is stripped by the agent-sync renderer for every other
consumer (Codewith, Codex, OpenCode, Cursor). It is a consumer preference, not
portable metadata, so it stays in frontmatter.

## Migration note

`skills new` / `skills scaffold` and `skills port` / `skills add` now emit
minimal frontmatter and a complete `skill.json` automatically. Existing skills
can be migrated with `skills port` (fills missing contract fields and
recomputes the hash) followed by a manual frontmatter trim; the bundled corpus
is migrated separately on its own schedule.
