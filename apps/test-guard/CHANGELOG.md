# @hasna/test-guard

## 0.0.3

### Patch Changes

- 74fa2b0: fix: sentinel auto-rearm — when the bun curl installer clobbers the wrapper (marker missing / integrity mismatch), the sentinel now restores the wrapper from the package source (atomic .new + mv) and re-pins bun-real to the fleet-pinned 1.3.14 build (sha 37141662ebed915a, verified against the release SHASUMS256.txt and the pinned binary sha) instead of only alerting; it exits 0 only after the static chain and the functional canary pass, and fails closed into the alert path when the rearm cannot be verified. The download is arch-derived (the recorded sha is the aarch64 build the station01 installer installs) and cached in the guard dir's pinned/ store; pin constants are config-overridable. battery section 17 + hermetic smoke regress the rearm on a temp-dir copy of the bin layout; the marker-preserving-tamper, unscoped-wrapper and wrapper-missing fixtures were made rearm-aware (heal vs fail-closed) and hermetic so the battery never mutates the live install. Row 7112181b.

## 0.0.2

### Patch Changes

- 4cd9ab4: Add --version and --help flags to sentinel.sh (task a6fc52c7). The flags short-circuit before any check, so a flag can never be mistaken for the positional bun-path argument again (this exact misparse posted two false [ALERT]s to #incidents on 2026-08-20). test/smoke.sh regresses both flags and asserts --version matches package.json.
- 8cb1eab: First release from the hasna/apps monorepo. The SC-00062 bun-test concurrency guard (sentinel, bun-wrapper, battery) previously lived only machine-local at `~/.hasna/test-guard` and could not ship as a PR. This package home imports the scripts byte-faithfully with one deliberate deviation: the sentinel no longer sources the retired `$HOME/.hasna/cloud/hasna-cloud-env.sh` runtime config (forbidden by the no-cloud guard for public packages), and the hermetic smoke is wired as the package test with a regression asserting the retired config is never sourced. `0.0.1` is the first release under the monorepo.
