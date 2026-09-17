---
"@hasna/attachments": patch
---

Stop SDK requests when credential refresh fails or the configured authority changes. A long-lived client no longer reuses its initial key after removal or sends a new authority's key to the original URL.
