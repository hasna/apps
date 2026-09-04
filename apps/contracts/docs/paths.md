# Paths — the single resolver (ruling hasna/apps#1668)

`@hasna/contracts/paths` is the **only** paths resolver in the fleet. Every app
resolves its local data/config/state/cache roots through it; nothing else may
reimplement or embed the placement logic, and nothing else may hard-code the
legacy literals (`.hasna/<app>` / `Application Support` in `apps/<app>/src`).

## Placement

| platform | config | data | state | cache |
|---|---|---|---|---|
| macOS (`darwin`) | `~/.hasna/<app>/` | `~/.hasna/<app>/` | `~/.hasna/<app>/` | `~/.hasna/<app>/` |
| other (Linux, …) | `~/.config/hasna/<app>/` | `~/.local/share/hasna/<app>/` | `~/.local/state/hasna/<app>/` | `~/.cache/hasna/<app>/` |

The macOS root matches the station convention, the home-directory taxonomy and
what is on disk today; Linux keeps XDG. `internal: true` nests under
`internal/<app>` (kept for `@hasna/paths` parity).

## Overrides

Kind overrides win unconditionally over the platform layout, app segment kept
(`$HASNA_DATA_HOME/<app>`):

- `HASNA_CONFIG_HOME` / `HASNA_DATA_HOME` / `HASNA_STATE_HOME` / `HASNA_CACHE_HOME`.

An empty-string override is treated as unset; a whitespace-only value is a
set override (parity with the deleted `@hasna/paths`).

Per-app exact-app overrides (`HASNA_<APP>_HOME`, `MONITOR_CONFIG_DIR`, …) are
app-level policy layered on top by each app's thin wrapper; the resolver itself
only knows the kind overrides and the app slug.

## API

```ts
type PathKind = "config" | "data" | "state" | "cache";
interface PathsResolverOptions {
  app: string;            // lowercase kebab-case slug, validated
  internal?: boolean;     // nest under internal/<app>
  platform?: string;      // default process.platform
  home?: string;          // default effectiveHome(env)
  env?: Record<string, string | undefined>; // default process.env
}
effectiveHome(env?)       // $HOME → $USERPROFILE → os.homedir(), hard error if none
kindEnv(kind)             // e.g. "HASNA_DATA_HOME"
baseDir(kind, options)    // override, else platform layout (no app segment)
resolveDir(kind, options) // baseDir + [internal/]app
dataDir(options) stateDir(options) configDir(options) cacheDir(options)
```

## Conformance

`tooling/ci/tests/standard/paths-conformance.test.ts` fails on:

1. embedded resolver markers or `HASNA_<KIND>_HOME` code reads outside
   `apps/contracts/src/paths.ts`;
2. `.hasna/<app>` / `Application Support` literals in `apps/<app>/src` outside
   the resolver (recorded allowlist: project-relative `.hasna/…` conventions —
   knowledge workspace, instructions fragments, repos worktree rule text,
   `#1590` projects-workspace fixtures — and Apple TCC system database paths).

## Hosted mode

Hosted mode must not create local data directories at all (hasna/apps#1613);
the resolver only matters for local placement and caches.