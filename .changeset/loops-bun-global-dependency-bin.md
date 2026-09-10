---
"@hasna/loops": patch
---

Search the Bun global install's dependency bin directory when resolving executables.

`bun add -g <pkg>` links only the directly-installed package's `bin` entries into `$BUN_INSTALL/bin`. Every transitive dependency's bins are materialized at `$BUN_INSTALL/install/global/node_modules/.bin`, a directory bun never puts on PATH — so a companion CLI installed as a dependency (the `accounts` CLI on this fleet) is "not found" and the remote account preflight exits `127` on a machine where it is installed and healthy.

`commonExecutableDirs()` now includes `<BUN_INSTALL>/install/global/node_modules/.bin` (and `<HOME>/.bun/install/global/node_modules/.bin` when `BUN_INSTALL` is unset), and the remote bootstrap PATH the executor emits searches `${BUN_INSTALL:-$HOME/.bun}/install/global/node_modules/.bin`. Measured on bun 1.3.14; npm 11 links the same way (top-level package only), so this is not fixable from a package manifest.
