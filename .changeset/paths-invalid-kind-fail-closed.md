---
"@hasna/paths": patch
---

Fail closed on an unknown path kind. `baseDir` previously returned `undefined` and `resolvePath` threw a cryptic `The "paths[0]" property must be of type string` from `node:path` when a JS caller or runtime misconfiguration passed a value outside `config | data | state | cache`. Both now throw a clear `TypeError` naming the invalid kind. The `PathKind` union still protects TypeScript callers; this closes the silent-undefined failure class at the resolver boundary. No resolved path changes (XDG home migration, hotfixes plan 0f49f56a, tasks P3.1/P3.2).
