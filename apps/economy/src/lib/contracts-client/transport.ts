// The @hasna/contracts client seam, used from the package rather than vendored.
// Previous versions of this file carried a byte-faithful vendored copy of the
// 0.5.0-era transport (plus the mode helper in ./mode.ts). A fork does not
// receive credential-resolution fixes, so the source now re-exports the shared
// package. Consumers import { HasnaHttpError } and friends from here.
//
// NAMED re-exports only, never `export *`: the bundler emits a broken
// `__ReExport(exports, client)` referencing an unbound identifier for
// `export * from` an external ESM subpath, which crashes every built bin
// (`ReferenceError: client is not defined` at startup).
export { HasnaHttpError } from "@hasna/contracts/client";
