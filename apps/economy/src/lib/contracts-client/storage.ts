// The @hasna/contracts storage client seam, used from the package rather than
// vendored. Previous versions of this file carried a byte-faithful vendored
// copy of the 0.5.0-era storage client. Re-exporting the shared package keeps
// credential resolution on the maintained code path.
//
// NAMED re-exports only, never `export *`: the bundler emits a broken
// `__reExport(exports, storage)` referencing an unbound identifier for
// `export * from` an external ESM subpath, which crashes every built bin
// (`ReferenceError: storage is not defined` at startup).
export { resolveStorageClient } from "@hasna/contracts/client/storage";
export type { HasnaStorageClient } from "@hasna/contracts/client/storage";
