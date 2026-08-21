---
"@hasna/logs": patch
---

Release-gate remediation (adversarial review of the 0.4.7 candidate): remove the retired `HASNA_LOGS_STORAGE_MODE` env from the Dockerfile (server backend selection is `HASNA_LOGS_DATABASE_URL` only); adopt the store's reported cursor on an empty baseline `watch --events` poll so events ingested after the first poll are emitted instead of repeating the baseline; page the hosted event stream when a service filter is applied so matches beyond the first window are not truncated and `has_more` is computed over the filtered stream (with a safety bound that never reports a silent false — regression tests for both watch defects); regenerate the standalone `bun.lock` against the current manifest (frozen Docker install); regenerate the vendored storage kit to 0.12.0 and align the `@hasna/contracts` pin to `^0.12.0` so the repo conformance gate passes.
