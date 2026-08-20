---
"@hasna/secrets": patch
---

fix(secrets): package_registry_token requires a value-shaped npm_ suffix, not a bare prefix

The detector matched `npm_` followed by 12+ of `[A-Za-z0-9_]`, so npm's documented
env var NAMES (`npm_lifecycle_event`, `npm_package_name`, ...) tripped
`secrets scan staged` at rc=1 and blocked commits on files that only reference
the names (bug 2693dbc4). The pattern now requires the value shape — `npm_` plus
20+ alphanumeric characters with no underscore — which is the fleet's established
value/name discriminator, applied consistently to the scanner detector and the
history-scan git-grep pattern. Regression tests cover both directions: env var
names pass, a value-shaped npm_ token still trips.
