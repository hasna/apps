---
"@hasna/knowledge": patch
---

`./serve`'s published declarations no longer import values or types from
`@hasna/contracts/auth` (hasna/apps#1782, adversarial credential-seam audit).
`ServeDeps` spelled `ApiKeyStore` (a class VALUE) and `ApiKeyVerifier` from
the contracts distribution, which breaks every strict `nodenext` consumer
(`TS2835` inside contracts' own `.d.ts`) with `skipLibCheck: false`. Both are
now structural local spellings in the declaration-only leaf
`src/contracts-types.ts` — including the client-seam
`CredentialTier`/`KeychainTierOptions`, the storage-client surface
(`HasnaStorageClient` and its transport), and the project-panel contract —
asserted mutually assignable with the real contracts declarations by
`src/contracts-types.test.ts` in every direction each type crosses; the serve
keeps importing the runtime `verifyApiKey`/`ApiKeyStore` VALUES from
`@hasna/contracts`, which remains a dependency. Verified by a packed-package
strict consumer compile (`moduleResolution: nodenext`, `skipLibCheck: false`)
across every export subpath. The conformance assertions are compile-time only,
so `bun run typecheck:conformance` (`tsconfig.conformance.json`) is now part of
`bun run build` — a drifted spelling fails the same build step that emits the
declarations, which is what makes the guarantee real rather than aspirational.
