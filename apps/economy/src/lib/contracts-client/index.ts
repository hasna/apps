// Vendored @hasna/contracts HTTP storage client for the hosted API.
// The env-contract resolver lives in ./transport.ts; the mode module this copy
// was previously vendored from has been removed. Kept as a self-contained
// client so an installed economy never needs the contracts client subpath.
export * from "./transport.js";
export * from "./storage.js";
