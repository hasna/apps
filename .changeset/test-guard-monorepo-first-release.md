---
"@hasna/test-guard": patch
---

First release from the hasna/apps monorepo. The SC-00062 bun-test concurrency guard (sentinel, bun-wrapper, battery) previously lived only machine-local at `~/.hasna/test-guard` and could not ship as a PR. This package home imports the scripts byte-faithfully with one deliberate deviation: the sentinel no longer sources the retired `$HOME/.hasna/cloud/hasna-cloud-env.sh` runtime config (forbidden by the no-cloud guard for public packages), and the hermetic smoke is wired as the package test with a regression asserting the retired config is never sourced. `0.0.1` is the first release under the monorepo.
