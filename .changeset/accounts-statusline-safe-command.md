---
"@hasna/accounts": patch
---

Successor of the terminated statusline-provisioner candidate (hasna/apps#272, 3x NO_GO): a fresh Claude profile whose machine's shared settings omit `statusLine` now receives the installed statusline binary at birth — but ONLY when the PATH-resolved path contains no shell metacharacters. The prior candidate persisted `"<binary>" render`; double quotes do not neutralize `$()`, backticks, or embedded quotes, so a hostile PATH entry became a command executed at status refresh. The resolved path is now validated against a strict charset and rejected (never persisted) otherwise, with scanning continuing to a later safe PATH entry. The default is birth-only (LocalStore and ApiStore `addProfile`); launch/switch/health passes stay source-driven and never sweep existing profiles.
