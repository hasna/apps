---
"@hasna/conversations": patch
---

Prevent duplicate TUI sends while an API response is pending and preserve drafts typed during that request. Restore unchanged safe drafts only for explicit retries after failure, keep sensitive-content errors redacted, retry initial history independently, and handle exact-detail/read-acknowledgement failures in the chat view.
