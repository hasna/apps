---
"@hasna/recordings": patch
---

Make the native recorder ready for the next recording immediately after paste delivery is confirmed, removing the extra 600 ms clipboard grace period on that path. Restore the previous clipboard only while the transaction still owns it, and retain the existing grace period when delivery cannot be confirmed.
