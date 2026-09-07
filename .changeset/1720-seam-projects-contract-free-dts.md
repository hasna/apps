---
"@hasna/projects": patch
---

Published declarations no longer import anything from `@hasna/contracts`
(hasna/apps#1782, adversarial credential-seam audit). A strict `nodenext`
consumer with `skipLibCheck: false` failed with `TS2835` inside contracts'
own distribution the moment a `dist/*.d.ts` named a contracts type — the
crossing types (the `ProjectResource*` link shapes, the client-seam
`KeychainTierOptions`/`CredentialChainOptions`/`ResolvedCredential`, and the
serve's `ApiKeyStatus`/`AuthAuditHook`) are now spelled structurally in
`src/types/client-types.ts`, a declaration-only leaf asserted mutually
assignable with the real contracts declarations by
`src/types/client-types.test.ts` in every direction each type crosses. The
root's zod schema re-exports keep the very same contract objects as values,
re-typed through the local spellings (`src/types/project-resource-schemas.ts`,
identity-pinned by the conformance test). The `./sdk` bundle additionally
builds `--external @hasna/contracts`, so the runtime keeps resolving the
dependency instead of inlining a second copy. Verified by a packed-package
strict consumer compile (`moduleResolution: nodenext`, `skipLibCheck: false`)
across every export subpath.