# State layout

`@hasna/contracts` is an execution-free library and currently owns no
persistent user state. Installing or running its validation commands does not
create a home directory.

If the package gains non-authoritative user-level state in the future, it must
use the matching XDG kind (and its standard default):

```text
$XDG_CONFIG_HOME/hasna/contracts   (~/.config/hasna/contracts)
$XDG_STATE_HOME/hasna/contracts    (~/.local/state/hasna/contracts)
$XDG_CACHE_HOME/hasna/contracts    (~/.cache/hasna/contracts)
```

The legacy roots `~/.contracts` and `~/.open-contracts` are not operational read
paths. The package never copies, moves, rewrites, or deletes them. There is no
automatic migration because the current package has no global store or
installer-owned data to migrate. Any files found at those paths must be audited
before manual removal rather than treated as `@hasna/contracts` data.

## Intentional project-local paths

These paths remain relative to the consuming project or target repository. They
must not be redirected into a package-global root.

| Path | Owner and purpose |
| --- | --- |
| `.hasna/project/**` | Project metadata defined by the project-manifest schemas. `@hasna/contracts` validates the layout; `projects` owns reading and writing it. |
| `src/generated/storage-kit/.storage-kit-manifest.json` | Deterministic `vendor-kit` output tracked in the target repository alongside the generated storage kit. |
| `.hasna/loops/runs/**` | OpenLoops run artifacts described by the integration contract. They are owned by OpenLoops, not by `@hasna/contracts`. |

Other dotdir references are declarations or negative fixtures, not Contracts
state. In particular, `.codewith` and other `.hasna/<app>` paths in the secure
local-store policy belong to their named packages, while `.hasna/cloud` appears
in the no-cloud scanner as a forbidden legacy runtime path.

## Credential resolution paths (read, never owned)

`@hasna/contracts` does not own these directories, but its credential resolver
reads only the owner-safe XDG app config (see CONTRACT.md §3a):

```text
$XDG_CONFIG_HOME/hasna/<name>.env    (default ~/.config/hasna/<name>.env)
```

Files must be regular, current-user-owned, and mode 0400 or 0600; unsafe files
fail closed. Legacy `~/.hasna/**` and `*-cloud.env` files are not consulted.
`@hasna/contracts` never writes, copies, moves, or deletes these files.
Explicit legacy migration tooling may preserve/import old data, but ordinary
clients never use it as an authoritative dataset.

The repository ignores `.hasna/` so local project metadata is not accidentally
committed. The generated storage-kit manifest is outside that ignored directory
and is intentionally checked into each target repository.
