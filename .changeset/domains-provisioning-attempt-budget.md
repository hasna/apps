---
"@hasna/domains": patch
---

Reset the bounded provisioning attempt counter on successful state transitions and add a configurable high default for consecutive provider polls, preventing normal registrar, DNS propagation, and certificate waits from exhausting the entire job budget.
