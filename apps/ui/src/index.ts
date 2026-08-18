// @hasna/ui — library entry.
//
// Re-exports the offline content-mirror surface. package.json already declares
// `"module": "src/index.ts"` and ships `src/` in the published tarball; this
// file is the entry that declaration promises.

export {
  CONTENT_DIR_ENV,
  resolveContentDir,
  uidotshUriToRelativePath,
  uriToContentFile,
  contentSetupMessage,
  MissingContentMirrorError,
  hasContentMirror,
  assertContentMirror,
} from "./content.ts";

export { uriToFile, fetchOne, fetchMany, fetchResource } from "./fetch.ts";
