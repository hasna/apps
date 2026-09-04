---
"@hasna/skills": patch
---

The hosted service image now carries the bundled skill corpus (`skills/`), so the boot seed can publish the bundled skills as `slug@<package version>`; the first 0.2.0 boot logged "0 seeded, 86 skipped" because the runtime stage copied only bin/, dist/ and migrations/.
