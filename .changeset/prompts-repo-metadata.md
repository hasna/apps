---
"@hasna/prompts": patch
---

Fix package.json `repository`/`homepage`/`bugs` metadata: the published fields named `github.com/hasna/prompts`, a repository that never existed. Repointed to the real source, the `hasna/apps` monorepo — `repository` now carries `url: git+https://github.com/hasna/apps.git` with `directory: apps/prompts`, and `homepage`/`bugs` resolve to the `hasna/apps` repo pages for that member path.
