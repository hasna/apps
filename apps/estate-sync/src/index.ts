/**
 * @hasna/estate-sync — shared cloud-sync engine for the apps estate store bucket.
 *
 * Parameterized by (estate bucket, app prefix): skills, loops, and deliverables
 * each hold a prefix tenant under the same shared bucket. Push writes a digest
 * bundle plus a signed index pointer; pull resolves the signed index, fetches by
 * digest, verifies sha256, and hydrates atomically.
 */
export {
  EstateS3Store,
  buildObjectUrl,
  sha256Hex,
  type AwsCredentials,
  type EstateS3StoreOptions,
  type FetchLike,
  type PutObjectInput,
  type StoredObject,
} from "./store.js";
export {
  canonicalIndexString,
  signIndex,
  verifyIndexSignature,
  INDEX_SIGNATURE_VERSION,
} from "./sign.js";
export { atomicWrite } from "./atomic.js";
export {
  EstateSyncClientImpl,
  EstateSyncError,
  createEstateSync,
  isSha256Hex,
  normalizeName,
  DIGEST_HEX_LENGTH,
  INDEX_SCHEMA_VERSION,
  type EstateIndexEntry,
  type EstateSyncClient,
  type EstateSyncOptions,
  type PullArtifactOptions,
  type PullArtifactResult,
  type PushArtifactInput,
  type PushArtifactResult,
} from "./sync.js";
