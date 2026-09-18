---
"@hasna/contracts": patch
---

Allow credential-safe API key issuance through a Secrets gateway prefix such as
`https://api.hasna.com/secrets`, preserving the prefix and normalizing an optional
`/v1` suffix. Validate the authority with the shared SDK rules before minting or
writing credentials, and continue to reject conflicting canonical and legacy
configuration.
