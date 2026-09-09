---
"@hasna/skills": patch
---

Fix AWS SigV4 query encoding and bytewise ordering so S3 requests support Unicode filenames and reserved punctuation. Preserve repeated query parameters and empty values when signing.
