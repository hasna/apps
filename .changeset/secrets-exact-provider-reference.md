---
"@hasna/secrets": minor
---

Add `secrets exec --secret-ref` for exact AWS Secrets Manager references, including JSON fields and explicit versions. Validate the configured profile, actual caller account, region and returned identity before injecting a string into a trusted child, with value-safe failure messages.
