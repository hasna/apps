# Changelog

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
