---
"@hasna/emails": patch
---

Request the supported SQS queue visibility attribute and fail readiness when a stalled ingest worker has unknown queue state. Keep oldest-message age unknown without a real CloudWatch measurement; deployment alarms must monitor queue age separately.
