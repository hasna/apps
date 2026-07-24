// @hasna/personalnotes — OSS core root export.
//
// NOTE: this workstream (dual storage) introduces the storage layer only. The
// full root surface (CLI/MCP/HTTP API/SDK bins and exports) is added by the
// repo-rename / scaffold workstream (OSS-1) and reconciled at merge. Until then
// the root re-exports the dual-storage layer so `@hasna/personalnotes` resolves.

export * from "./lib/storage/index.js";
