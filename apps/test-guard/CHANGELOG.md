# @hasna/test-guard

## 0.0.2

### Patch Changes

- 4cd9ab4: Add --version and --help flags to sentinel.sh (task a6fc52c7). The flags short-circuit before any check, so a flag can never be mistaken for the positional bun-path argument again (this exact misparse posted two false [ALERT]s to #incidents on 2026-08-20). test/smoke.sh regresses both flags and asserts --version matches package.json.
- 8cb1eab: First release from the hasna/apps monorepo. The SC-00062 bun-test concurrency guard (sentinel, bun-wrapper, battery) previously lived only machine-local at `~/.hasna/test-guard` and could not ship as a PR. This package home imports the scripts byte-faithfully with one deliberate deviation: the sentinel no longer sources the retired `$HOME/.hasna/cloud/hasna-cloud-env.sh` runtime config (forbidden by the no-cloud guard for public packages), and the hermetic smoke is wired as the package test with a regression asserting the retired config is never sourced. `0.0.1` is the first release under the monorepo.
