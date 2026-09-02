# @hasna/paths

Package-owned path resolver for Hasna apps. One small shared helper that
resolves where an app's config, data, state, and cache live, honoring
environment overrides and platform defaults — so the fleet can move its homes
without per-package hardcoding.

## Resolved layout

| kind    | Hasna override      | Standard XDG root | Linux / other default | macOS default |
|---------|---------------------|-------------------|-----------------------|---------------|
| config  | `HASNA_CONFIG_HOME` | `XDG_CONFIG_HOME` | `~/.config/hasna/<app>` | `~/Library/Application Support/Hasna/<app>` |
| data    | `HASNA_DATA_HOME`   | `XDG_DATA_HOME` | `~/.local/share/hasna/<app>` | `~/Library/Application Support/Hasna/<app>` |
| state   | `HASNA_STATE_HOME`  | `XDG_STATE_HOME` | `~/.local/state/hasna/<app>` | `~/Library/Logs/Hasna/<app>` |
| cache   | `HASNA_CACHE_HOME`  | `XDG_CACHE_HOME` | `~/.cache/hasna/<app>` | `~/Library/Caches/Hasna/<app>` |

**Internal apps** (`internal: true`) resolve one level deeper:
`hasna/internal/<app>` beneath the same four roots. This retires the legacy
`~/.hasna` internal home prefix as a concept — an internal app keeps the
same layout, nested under `internal/`.

Resolution is per kind, in this order on every platform (including macOS):

1. A nonempty `HASNA_<KIND>_HOME` replaces the **Hasna-level** root:
   `HASNA_CONFIG_HOME=/srv/cfg` produces `/srv/cfg/<app>`. It must be an
   absolute path with no surrounding whitespace or control characters.
   Invalid explicit Hasna roots throw a `TypeError` naming only the variable,
   never its value. An empty string remains equivalent to unset.
2. A valid `XDG_<KIND>_HOME` replaces the **parent** root:
   `XDG_CONFIG_HOME=/srv/cfg` produces `/srv/cfg/hasna/<app>`.
   Unset, empty, relative, or NUL-containing XDG values are ignored. Absolute
   XDG values are not trimmed; spaces are part of the path.
3. Otherwise the platform default in the table applies.

The standard variables, absolute-path rule, and Linux defaults follow the
[XDG Base Directory Specification 0.8](https://specifications.freedesktop.org/basedir/latest/).
Hasna's higher-precedence root and stricter explicit-override validation are
package policy, not additional XDG requirements. `XDG_CONFIG_DIRS`,
`XDG_DATA_DIRS`, and `XDG_RUNTIME_DIR` are outside this four-home resolver.

On macOS, the existing package defaults remain unchanged: config and data
share `Application Support`, `state` maps to `Library/Logs`, and `cache` maps
to `Library/Caches`. A valid explicit XDG root opts that kind into the XDG
layout; missing or ignored XDG roots do not move macOS homes. The `platform`
test option selects defaults; path syntax still uses the host's `node:path`.

## Usage (SDK)

```ts
import { dataDir, dirs, resolvePath } from "@hasna/paths";
// or, via the ./sdk subpath:
import { dataDir as sdkDataDir } from "@hasna/paths/sdk";

dataDir({ app: "todos" });                      // ~/.local/share/hasna/todos (linux)
dataDir({ app: "mailery", internal: true });    // ~/.local/share/hasna/internal/mailery
dataDir({ app: "todos", env: { HASNA_DATA_HOME: "/mnt/data" } });
dataDir({ app: "todos", env: { XDG_DATA_HOME: "/mnt/data" } }); // /mnt/data/hasna/todos
const all = dirs({ app: "todos" });             // { config, data, state, cache }
resolvePath("config", { app: "todos" });
```

All helpers are pure and injectable (`home`, `platform`, `env`), so the
resolver is deterministic in tests.

This library only returns paths. It creates no directories, moves no data,
and owns no service or authoritative application-data store.

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

## Release artifact gate

Build first, then run `bun run scan:artifact`. The gate uses
`npm pack . --json --ignore-scripts --workspaces=false --dry-run=false --pack-destination <temporary-directory>`
and requires exactly one local regular `.tgz` before invoking the pinned
Contracts scanner. JSON, filename, missing-file, pack, and scanner failures
stop the gate; symlinks are rejected and its temporary directory is removed.
`--ignore-scripts` prevents the `prepack` hook from recursively invoking itself.
`--dry-run=false` ensures a real archive even when an outer npm dry-run invokes
the hook and passes its configuration to child processes.
These flags follow the [npm pack documentation](https://docs.npmjs.com/cli/v11/commands/npm-pack/).
The existing package version and Contracts pin are not changed by this fix;
release versioning remains with the separate version wave.
