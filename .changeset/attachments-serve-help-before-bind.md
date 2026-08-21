---
"@hasna/attachments": patch
---

attachments-serve answers --help and --version before creating the DB pool; previously it died with `createCloudPoolFromEnv requires attachments storage mode 'cloud'` before printing either (BUG row 970d7c6f).
