---
"@hasna/secrets": patch
---

Keep the published TYPE surface installable, and hold the local vault lane to
the whole ruling (follow-up to #1778, hasna/apps#1720).

`bun build --target bun` inlines `@hasna/contracts`, so the shipped bundles
import node builtins only — but `tsc --emitDeclarationOnly` inlines nothing.
Deleting the vendored `src/store/contracts-client/` copy moved
`import ... from "@hasna/contracts/client"` onto `dist/sdk.d.ts`, the `.` and
`./sdk` type entry, while `@hasna/contracts` is a devDependency a consumer never
installs: `npm pack` + `tsc` in a clean consumer project returned 7 x TS2307
"Cannot find module '@hasna/contracts/client'". The runtime was unaffected.

The contracts client types that cross the published boundary are now spelled in
`src/store/client-types.ts` — declarations only, no logic, no resolver, no
second credential chain — and `src/store/client-types.test.ts` asserts each one
is mutually assignable with the real `@hasna/contracts` declaration, so a shape
that drifts fails the build. `@hasna/contracts` stays a build-time dependency:
promoting it would put 20 MB and an unsatisfiable
`contracts -> peer @hasna/secrets` cycle into every consumer's tree to ship
types alone.

`tests/published-types-self-contained.test.ts` is the gate that was missing: it
walks the declaration graph from every `exports[*].types` entry and fails when a
reachable `.d.ts` imports anything but a node builtin or a declared runtime
dependency.

The local-vault lane now yields to a configured AUTHORITY as well as to a
resolved credential. `HASNA_SECRETS_LOCAL_VAULT=1` selected the on-box vault
whenever no key resolved, even with `HASNA_SECRETS_API_URL` set, the Keychain
`api-url` item present, or an authority in
`~/.hasna/secrets/config/credentials` — so a station whose Keychain lookup
missed (locked keychain, wrong `HASNA_STATION`) read a different vault instead
of failing. The ruling is "no url AND no key"; a half-applied hosted run now
fails closed with the opt-in exactly as it does without it, and the error no
longer advises an opt-in that does not apply.
