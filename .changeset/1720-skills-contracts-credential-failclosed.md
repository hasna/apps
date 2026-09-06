---
"@hasna/skills": patch
---

Fail closed when no credential and no API URL resolve; the on-machine run is
opt-in only (owner directive 2026-09-04, hasna/apps#1720; class-patch order
2026-09-06). skills 0.4.0 adopted the shared `@hasna/contracts` resolver but
kept the wrong local-mode semantics: an install with neither a credential nor a
URL silently served the bundled corpus ("local mode" as the absence of
configuration). The class patch closes that.

- **Local mode only by explicit opt-in.** `HASNA_SKILLS_LOCAL=1` (alias
  `SKILLS_LOCAL=1`) selects the on-machine run when the environment configures
  no authority; it is answered before the resolver runs, so opting in never
  reads the Keychain or the credentials file. A configured environment always
  outranks it. The opted-in run prints `skills: local mode …` on stderr once.
- **Fail closed.** Hosted with no credential now exits non-zero — a URL
  configured with no key was already a loud failure; nothing configured without
  the opt-in is one now too: `MISSING_API_CREDENTIAL`, no SQLite opened, no
  `*-local-fallback` event, one line naming the opt-in.
- **Published declarations stay self-contained (#1782).**
  `@hasna/contracts` is a build-time devDependency (`bun build --target bun`
  inlines it); the crossing client types are spelled locally in
  `src/lib/client-types.ts`, with mutual-assignability tests, so the published
  `.d.ts` files import no `@hasna/contracts`.
- `@hasna/contracts` stays pinned to exact `1.0.2`.

The fix depends on nothing being deleted: a stale `~/.hasna/skills/config/credentials`
holding only newlines parses as "no disk credential" (no throw) and lands on the
same fail-closed refusal; station01/02 write the real credential file and are
served hosted as before.