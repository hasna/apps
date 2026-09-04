---
"@hasna/calendar": patch
---

Add `calendar status` (`--json` supported): prints CLI version, store transport, and org/calendar counts, degrading to an unconfigured report when `HASNA_CALENDAR_API_URL` is not set (hasna/apps#1602).
