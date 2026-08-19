---
"@hasna/test-guard": patch
---

First release from the hasna/apps monorepo. The SC-00062 bun-test concurrency guard (sentinel, bun-wrapper, battery) previously lived only machine-local at `~/.hasna/test-guard` and could not ship as a PR. This package home imports the scripts byte-faithfully (sha256-identical ports, no sentinel logic changed) and wires the hermetic smoke as the package test. `0.0.1` is the first release under the monorepo.
