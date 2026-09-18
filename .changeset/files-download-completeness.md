---
"@hasna/files": patch
---

Reject truncated or size-mismatched hosted downloads before committing the output. The content service now reports the expected object size on full reads, and the streaming client cancels failed reads and reports its actual byte count.
