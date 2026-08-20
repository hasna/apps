# @hasna/consolidations

## 0.1.2

### Patch Changes

- c5d7ba1: First release of the absorbed monorepo app: the registry refuses to republish
  0.1.0 (published then unpublished on 2026-08-15, version claim burned), so this
  ships 0.1.1 — the contract-kit 0.10.6 remediation from PR #379 plus the version
  correction.
- dc1ccce: fix(serve): answer `--version`/`-V` and `--help`/`-h` before binding a socket
  
  The serve bin used to ignore argv and go straight to `Bun.serve`, so
  `consolidations-serve --help` hung with no output. It now prints usage or the
  version and exits 0 without binding (recordings pattern), with regression tests
  covering all four flags.
