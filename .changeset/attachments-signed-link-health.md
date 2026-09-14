---
"@hasna/attachments": patch
---

Check signed S3 download links with a bounded ranged GET so health-check does not mark working links dead after a rejected HEAD request. Handle empty objects under the same deadline, cancel response bodies, and abort the transport after the check. Retain HEAD for ordinary constrained share links and report failed checks without inventing an HTTP 404 status.
