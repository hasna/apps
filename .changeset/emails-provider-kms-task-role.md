---
"@hasna/emails": patch
---

Use ECS task-role container credentials for managed provider KMS operations when
the container credential endpoint is present, even if the task also carries
general AWS environment credentials for mail. Keep the standard credential
chain for deployments outside ECS.
