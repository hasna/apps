---
"@hasna/projects": minor
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

**Breaking type change for consumers of the re-exported zod schemas.** Five of
the seven `ProjectResource*Schema` exports from the package root are published
as `z.ZodType<Output>` (the two enums keep their exact `z.ZodEnum<[...]>`
spelling). The runtime values are unchanged — they are still the very
`@hasna/contracts` schema objects, pinned by identity, and `.parse()` /
`.safeParse()` / composition still work — but the published TYPE no longer
carries the concrete zod members. Consumer code that reads them stops
compiling after this release:

- `ProjectResourceLinkLabelsSchema`: `.shape`, `.extend()`, `.pick()`,
  `.partial()`, `.keyof()`
- `ProjectResourceLinkLocatorSchema`: `.options`, `.discriminator`
- `ProjectResourceLinkSchema`: `.innerType()`, `.sourceType`
- `ProjectResourceLinkInputSchema`, `ProjectResourceLinkCollectionV1Schema`:
  `.innerType()`

Import the schemas from `@hasna/contracts/schemas` directly if you need those
members. Input and output types are unchanged and asserted equal to the
contracts schemas in `src/types/client-types.test.ts`. The narrowing is the
price of a self-contained declaration graph: spelling the object/effect
schemas member-faithfully would mean hand-re-declaring the eight-branch unions
and their discriminated locators.