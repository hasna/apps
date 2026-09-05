---
"@hasna/dispatch": patch
---

Drop the `@hasna/machines` dependency. That package was deleted from npm
(hasna/apps#1515), so an empty-cache `bun add @hasna/dispatch` could not resolve
it and `dispatch` self-heal pointed operators at a package that no longer
exists. The machine route/command types the runner needs
(`MachineRouteSource`, `MachineCommandPlan`, `MachineCommandResolver`) are now
declared in-package, the dead `import("@hasna/machines/consumer")` and the five
`--external @hasna/machines` build flags are gone, and the resolver is an
optional injection point with an SSH fallback that shell-quotes both the host id
and the command. Callers that pass no resolver are unaffected.

Fixes the dispatch half of hasna/apps#1603; the change landed in #1756 without a
changeset, so this is its first scheduled release.
