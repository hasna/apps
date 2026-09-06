---
"@hasna/events": patch
---

Return a failing exit code for failed channel test deliveries in both the standalone and embedded Commander CLIs, preserving success/skipped exit codes and delivery output. Honor the existing explicit private-webhook administrator allowlist in default embedded CLI clients as well as the standalone CLI; SDK defaults and custom client policies remain unchanged.
