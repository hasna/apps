// @hasna/personalnotes root export — the headless Personal Notes core.
//
// Re-exports the in-process domain layer plus the surface entry points so embedders
// can drive notes directly, mount the HTTP router, or resolve client mode. The primary
// integration surface remains the HTTP API (import "@hasna/personalnotes/server").

export * from '../tools/notes-lib.mjs';
export { createRouter } from './server/router.mjs';
export { buildOpenApiDocument } from './server/openapi.mjs';
export { resolveMode, isRemoteMode, DEPLOYMENT_MODES } from './lib/mode.mjs';
export { createNotesBackend } from './lib/notes-backend.mjs';
