---
"@hasna/repos": patch
---

fix(repos): exact owner/name lookup resolves the live canonical checkout (todos d8ed2fc2). `repos repo <owner>/<name> --json` — the exact-target form the worktree law mandates — was rejected rc=1 with a fuzzy "Repo not found" suggestion even when the canonical checkout of that exact remote was indexed with a live path, because getRepo() fell through to the all-rows-missing pre-migration resolver. Qualified identities now route through the exact-remote resolution (the same contract as `--remote`): mirror-only remotes still refuse, a live checkout beats a hollow sibling, live multi-checkout ambiguity stays loud (now caught on the CLI, HTTP API and MCP surfaces), and the all-dead pre-migration deterministic pick (todos 0251863c) is preserved.
