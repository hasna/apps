---
"@hasna/repos": minor
---

Place worktrees at `~/.hasna/repos/worktrees/<org>/<repo>/<worktree>` — the org-aware canonical layout ruled by the owner on 2026-09-10 — instead of the flat `worktrees/<repo>/<worktree>`, which could not tell `hasna/apps` from a same-named repository in another org. `repos worktree add` computes the org from the registry row (the `org` column the scanner fills from the remote's owner, falling back to the owner of the sanitized `remote_url`; a row with neither is refused with `REPO_ORG_UNRESOLVABLE`), and the SDK's `computeWorktreePath` now takes `(org, repo, worktree)`.

User-facing behaviour changes:

- `repos worktree list` reports a worktree still sitting at the pre-ruling flat path as `legacy-flat-layout` (not a blocking error) together with `suggested_path`, the org-nested path it would have today; a three-segment path whose registered parent computes to a different path is `layout-mismatch`, anything deeper is `nested-layout`, and every entry now carries `org`. Nothing is moved automatically — migrate a flat worktree by landing its work, `repos worktree remove <repo>/<worktree>`, then `repos worktree add` again.
- `repos worktree remove` (and the sync verbs `push`/`pull`/`sync`/`versions`) accept the fully qualified `<org>/<repo>/<worktree>` reference; a `<repo>/<worktree>` pair is resolved at its canonical path first and then at the legacy flat path. `repos worktree list <org>/<repo>` filters by org as well as by bare name.
- `repos worktree adopt --all` sweeps both the org-nested and the legacy flat depth and reports each candidate's `layout` and `canonical_path`.
- `repos worktree add <org>/<repo>` is unambiguous when several usable checkouts share one remote: the row at the canonical clone path `<clones-root>/<org>/<repo>` wins; otherwise the single row whose registry `org`/`name` equal the reference; otherwise `AMBIGUOUS_REPO` as before (`hasna-products/mailery` previously failed because an older `platform-mailery` clone shares the remote).
