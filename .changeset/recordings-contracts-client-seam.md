---
"@hasna/recordings": patch
---

Migrate the HTTP storage client to the @hasna/contracts client seam: resolveStorageClient is now imported from @hasna/contracts/client/storage instead of the vendored copy, and the app's own resolver (resolveStoreClient) keeps the partial-pair fail-closed contract on top of the seam's call-time credential chain.
