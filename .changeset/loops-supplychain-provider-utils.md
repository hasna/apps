---
"@hasna/loops": patch
---

Dependency bump for GHSA-866g-f22w-33x8: `ai` 6.0.204 -> 6.0.277, which pins `@ai-sdk/provider-utils` 4.0.50 (the advisory covers `>=4.0.0-beta.10 <4.0.33`).

The advisory reached the shipped package surface through the exact `ai` 6.0.204 dependency. Both the root and standalone Loops lockfiles are regenerated with Bun 1.3.14. No runtime source, authority, credential, `/v1`, or local-opt-in behavior changes.
