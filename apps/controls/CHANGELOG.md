# @hasna/controls

## 0.1.2

### Patch Changes

- d7d615b: Align hasna.contract.json kitVersion to the declared contracts kit 0.13.1 (the pinned @hasna/contracts version). Todos d175d558.

## 0.1.1

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
