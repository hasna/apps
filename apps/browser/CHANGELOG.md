# Changelog

## 0.5.37

### Patch Changes

- 6c1bc9d: Switch @hasna/browser local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/browser` default (with the `BROWSER_DATA_DIR` exact-app override) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.2.1` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
- Updated dependencies [7d846c2]
  - @hasna/skills@0.1.71
  - @hasna/conversations@0.7.13
  - @hasna/paths@0.2.1
  - @hasna/sessions@0.12.22
  - @hasna/todos@0.15.51

## 0.5.36

### Patch Changes

- Switch @hasna/browser local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/browser` default (with the `BROWSER_DATA_DIR` exact-app override) stays the effective data home until the store is actually migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)

## 0.5.35

### Patch Changes

- Updated dependencies [23916b3]
  - @hasna/connectors@1.4.4
  - @hasna/conversations@0.7.8
  - @hasna/sessions@0.12.21
  - @hasna/todos@0.15.50

## 0.5.34

### Patch Changes

- Updated dependencies [1126270]
- Updated dependencies [8554afc]
- Updated dependencies [68167f7]
- Updated dependencies [947fa83]
  - @hasna/conversations@0.7.7
  - @hasna/skills@0.1.64
  - @hasna/secrets@0.3.10
  - @hasna/sessions@0.12.19
  - @hasna/todos@0.15.47

## 0.5.33

### Patch Changes

- Updated dependencies [8b70821]
  - @hasna/skills@0.1.66

## 0.5.32

### Patch Changes

- Updated dependencies [4af006f]
- Updated dependencies [5e23b61]
- Updated dependencies [9fd8163]
  - @hasna/secrets@0.3.7
  - @hasna/skills@0.1.65
  - @hasna/todos@0.15.48

## 0.5.31

### Patch Changes

- Updated dependencies [ae4567b]
  - @hasna/secrets@0.3.6

## 0.5.30

### Patch Changes

- Updated dependencies [85ec5ff]
  - @hasna/conversations@0.7.6

## 0.5.29

### Patch Changes

- Updated dependencies [50473b8]
  - @hasna/secrets@0.3.5

## 0.5.28

### Patch Changes

- Updated dependencies [4794bda]
  - @hasna/todos@0.15.46

## 0.5.27

### Patch Changes

- Updated dependencies [b8f1f5d]
  - @hasna/todos@0.15.45

## 0.5.26

### Patch Changes

- Updated dependencies [73f839e]
  - @hasna/todos@0.15.44

## 0.5.25

### Patch Changes

- Updated dependencies [5ff8f02]
  - @hasna/conversations@0.7.5

## 0.5.24

### Patch Changes

- Updated dependencies [5275dde]
- Updated dependencies [1c859c2]
  - @hasna/mementos@0.14.86
  - @hasna/todos@0.15.43

## 0.5.23

### Patch Changes

- 2ea3b9a: fix: packed tarballs no longer carry account-id-shaped 12-digit runs (publish-guard pattern aws-account-id, row 27d2a7a2). The carries were bundled dependency constants — zod's nil-UUID regex (v4/core/regexes.js), pg-types' binary-parser date offset, and the workspace @hasna/contracts bundle — plus one own-source nil-UUID literal in testers. Fixes: externalize zod/pg/@hasna/contracts in the member builds (each remains a declared runtime dependency, so runtime behavior is unchanged), build testers' nil UUID at runtime, and add a per-member publish-guard regression that packs the tarball and scans it with the guard's pattern set (red before, green after).
- @hasna/conversations@0.7.4
  - @hasna/sessions@0.12.19
  - @hasna/todos@0.15.42

## 0.5.22

### Patch Changes

- f1b21aa: fix: prepack typecheck resolves the optional @hasna/conversations SDK as a runtime-only module (non-literal dynamic import), so build:types no longer fails TS2307 against the unbuilt workspace member in a fresh checkout. Todos 0cbbd621.

## 0.5.21

### Patch Changes

- Updated dependencies [e6134c1]
  - @hasna/todos@0.15.41

## 0.5.20

### Patch Changes

- Updated dependencies [d7d615b]
- Updated dependencies [d7d615b]
- Updated dependencies [d7d615b]
  - @hasna/conversations@0.7.3
  - @hasna/secrets@0.3.4
  - @hasna/sessions@0.12.17
  - @hasna/todos@0.15.40

## 0.5.19

### Patch Changes

- Updated dependencies [edf3cea]
  - @hasna/sessions@0.12.16
  - @hasna/conversations@0.7.2
  - @hasna/todos@0.15.39

## 0.5.18

### Patch Changes

- Updated dependencies [b2638b2]
  - @hasna/secrets@0.3.3
  - @hasna/conversations@0.7.1
  - @hasna/todos@0.15.38

## 0.5.17

### Patch Changes

- d88b39a: Fix Bun.WebView opt-in fallback leaving the CLI process alive after the window closes (#10).
- a2164ba: Expose `./sdk` import surface for library use (4-surface standard) (#83).
- ef45d73: Security hardening wave-2: close tmux MCP injection, bind styles, timing-safe compares, static containment (#201).
- 3ae7cc5: Display name updated to "Hasna Browser" (open- prefix retired) (#345).
- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- Updated dependencies [ba9af33]
- Updated dependencies [bbc5a25]
- Updated dependencies [e405538]
- Updated dependencies [0d4f749]
- Updated dependencies [ca7acc8]
- Updated dependencies [4e5b690]
- Updated dependencies [28fedae]
- Updated dependencies [0d7a2d6]
  - @hasna/conversations@0.7.0
  - @hasna/connectors@1.4.2
  - @hasna/secrets@0.3.2
  - @hasna/sessions@0.12.15
  - @hasna/todos@0.15.37

## 0.5.16

- fix(kernel): distinguish transient vault read failures from missing key so a temporary secrets-backend read error no longer masquerades as a missing credential (#8).
- fix(storage): harden browser local storage persistence (#7).

Release bump to publish the merged PR-drain fixes (#7, #8) to npm.
