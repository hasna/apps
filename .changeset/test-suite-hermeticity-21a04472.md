---
"@hasna/attachments": patch
"@hasna/economy": patch
"@hasna/hooks": patch
"@hasna/markdown": patch
"@hasna/shield": patch
"@hasna/testers": patch
---

Hermeticize six test suites (21a04472): economy ingest/sync tests stash the ambient Accounts API key, testers CLI/MCP tests stash the ambient Testers API env, attachments stash ambient API/todos keys and split the server harness out of the test file, shield routes CRUD modules through a db-access seam, hooks disable ambient core.hooksPath for fixture commits, markdown skips the per-package lockfile this monorepo layout does not have, and testers pins @hasna/browser to the published 0.5.29.
