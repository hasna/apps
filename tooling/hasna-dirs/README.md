# hasna-dirs — ~/.hasna namespace guard

`~/.hasna` is the fleet apps' on-station data root. Top-level directories under
it are **reserved for registered fleet app names** — the OSS apps in
`hasna/apps/apps/*`, the internal apps from `internal-apps.registry.json`, and
the products repo. Nothing else may create a directory there.

## Why

- App dirs are addressed by name all over the fleet (paths, env, knowledge,
  backups). A stray `~/.hasna/<misc>` dir silently squats on the namespace.
- The guard makes the rule enforced, not aspirational, and gives us a place to
  document pre-convention legacy dirs until they are renamed or retired.

## Usage

    hasna-dirs check          # scan; exit 1 on any VIOLATION
    hasna-dirs guard          # check + append violations to ~/Library/Logs/hasna-dirs.log
    hasna-dirs create <app>   # mkdir but ONLY for a registered app name
    hasna-dirs whitelist      # print the whitelist

A LaunchAgent (`com.hasna.dirs.guard.plist`) runs `guard` every 10 minutes and
at login.

## Whitelist

`apps.list` — union of:

- `hasna/apps/apps/*` directory names (OSS apps)
- `@hasna/*` and `@hasna-internal/*` package names from
  `internal-apps.internal-apps.registry.json`
- `hasna-products` package names

Regenerate with `hasna-dirs refresh` on a station that has the repos, review
the diff, commit. Existing pre-convention dirs are listed as `KNOWN_LEGACY` in
`bin/hasna-dirs` and are reported (not flagged) until triaged.

## Install

    ln -s ~/Workspace/50-repositories/hasna/apps/tooling/hasna-dirs/bin/hasna-dirs ~/.local/bin/hasna-dirs
    cp tooling/hasna-dirs/com.hasna.dirs.guard.plist ~/Library/LaunchAgents/
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hasna.dirs.guard.plist

## Rule for agents and scripts

Never `mkdir ~/.hasna/<name>` by hand. If the name is a registered app, use
`hasna-dirs create <app>`; if it is not, the directory does not belong under
`~/.hasna` (put ops tooling in the repo, per-station state under
`~/.local/state`-style locations).