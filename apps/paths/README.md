# @hasna/paths

Package-owned path resolver for Hasna apps. One small shared helper that
resolves where an app's config, data, state, and cache live, honoring
environment overrides and platform defaults — so the fleet can move its homes
without per-package hardcoding.

## Resolved layout

| kind    | env override        | Linux / other (XDG)          | macOS                        |
|---------|---------------------|------------------------------|------------------------------|
| config  | `HASNA_CONFIG_HOME` | `~/.config/hasna/<app>`      | `~/Library/Application Support/Hasna/<app>` |
| data    | `HASNA_DATA_HOME`   | `~/.local/share/hasna/<app>` | `~/Library/Application Support/Hasna/<app>` |
| state   | `HASNA_STATE_HOME`  | `~/.local/state/hasna/<app>` | `~/Library/Logs/Hasna/<app>` |
| cache   | `HASNA_CACHE_HOME`  | `~/.cache/hasna/<app>`       | `~/Library/Caches/Hasna/<app>` |

**Internal apps** (`internal: true`) resolve one level deeper:
`hasna/internal/<app>` beneath the same four roots. This retires the legacy
`~/.hasna` internal home prefix as a concept — an internal app keeps the
same layout, nested under `internal/`.

**Env override semantics mirror XDG:** `HASNA_<KIND>_HOME` names the
hasna-level base root and the app slug is appended, e.g.
`HASNA_CONFIG_HOME=/srv/cfg` -> `/srv/cfg/<app>`. An env var that is set but
empty is treated as unset and falls back to the default. Overrides win on
every platform, macOS included.

On macOS, config and data share `Application Support`, `state` maps to
`Library/Logs`, and `cache` maps to `Library/Caches` — the Apple convention.

## Usage (SDK)

```ts
import { dataDir, dirs, resolvePath } from "@hasna/paths";
// or, via the ./sdk subpath:
import { dataDir as sdkDataDir } from "@hasna/paths/sdk";

dataDir({ app: "todos" });                      // ~/.local/share/hasna/todos (linux)
dataDir({ app: "mailery", internal: true });    // ~/.local/share/hasna/internal/mailery
dataDir({ app: "todos", env: { HASNA_DATA_HOME: "/mnt/data" } });
const all = dirs({ app: "todos" });             // { config, data, state, cache }
resolvePath("config", { app: "todos" });
```

All helpers are pure and injectable (`home`, `platform`, `env`), so the
resolver is deterministic in tests.

## Usage (CLI)

```sh
paths --app todos                 # print all four homes
paths --app todos --kind data     # print one home
paths --app mailery --internal    # internal-app layout
paths --base --kind config        # print the hasna base root (no app)
paths --app todos --json          # machine-readable
```

## Why this exists

Phase 3 of the XDG home migration (hotfixes plan `0f49f56a`): every
`@hasna/<name>` package switches its reads/writes to this resolver, then a
machine can point anywhere via `HASNA_*_HOME` without code changes, and the
fleet migrates its stores behind the same abstraction.
