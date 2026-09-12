---
"@hasna/emails": patch
---

Keep ordinary mailbox reads and health checks available during expensive message searches by admitting one search per API process. Busy searches receive HTTP 429 with retry guidance, and search queries have a transaction-local database time limit.
