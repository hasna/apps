# Secrets

**Never print, echo, log, commit, or paste a credential value — in any encoding.**
Config references secret NAMES only; values live in the vault (`secrets` CLI).
This is a PUBLIC repo — a committed credential is public immediately.

Before EVERY `git commit` and `git push`, scan the staged diff:

```bash
secrets scan staged        # commit gate; exit 0 clean / 1 finding / 2 could not scan
```

If `secrets scan staged` is unavailable, the regex fallback is
`git diff --cached --diff-filter=ACM | grep -iE '...'` — prefer the CLI; it is
the documented form on this fleet.

- Test presence without revealing: `[ -n "${VAR:-}" ] && echo set`, or
  `secrets get <key> --check` (length + sha256 only).
- Consume: `secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- <cmd>`
  — and know npm reads NO env var: pair the variable with a temp npmrc
  placeholder (see `.claude/rules/publish.md`).
- Never `env | grep`, `echo $TOKEN`, or `cat` a credential file. The staged
  scan reads diffs only and cannot see transcript leaks.
- If a value IS exposed: post name + scope (never the value) to the `incidents`
  channel and continue; rotation is never escalated to the owner.
