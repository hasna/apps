---
"@hasna/emails": patch
---

Preserve Resend SDK rejection status and bounded error diagnostics so definitive provider rejections remain safe to retry. Missing status, transport failures, provider server errors and success responses without a usable message receipt remain uncertain and require reconciliation.
