---
"@hasna/loops": patch
---

fix(executor): propagate the active account profile's config-dir var (CLAUDE_CONFIG_DIR and sibling tool vars) into spawned agent and claude command targets when the runner's own env lacks it, so headless runs no longer silently fall back to the default account profile (row e84f3956)
