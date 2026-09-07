---
"@hasna/skills": patch
---

Verify that the Skills command selected on PATH belongs to the same Bun installer's global bin directory before reporting self-update success. Refuse discovery failures, shadowed commands and invalid version results while preserving successful updates and installer failures. Explain that installation may already have completed without automatically retrying it or changing PATH.
