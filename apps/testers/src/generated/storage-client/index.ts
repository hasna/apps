// Vendored Hasna client-flip HTTP storage client.
//
// Extracted from `@hasna/contracts` (`src/client/*`) so the testers CLI/MCP can
// route reads AND writes to the app's cloud `/v1` API when the client-flip env
// resolves to cloud (mode=self_hosted/cloud + HASNA_TESTERS_API_URL +
// HASNA_TESTERS_API_KEY), without depending on an unreleased contracts subpath.
//
// See ../../store/index.ts for the testers-specific Store (LocalStore | ApiStore).
export * from "./mode.js";
export * from "./transport.js";
export * from "./storage.js";
