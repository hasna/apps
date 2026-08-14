// HTTP storage client for the Hasna Service Contract v1 — imported from
// `@hasna/contracts/client/storage`, never defined here.
//
// This is the piece that makes the hosted-API client real. It sits on top of
// the shared transport and implements the generic resource CRUD vocabulary
// every Hasna serve app exposes under `/v1`:
//
//   list   -> GET    /v1/<resource>            -> { items, total, ... }
//   get    -> GET    /v1/<resource>/<id>       -> <entity> | null (404 => null)
//   create -> POST   /v1/<resource>            -> <entity>   (auto Idempotency-Key)
//   update -> PATCH  /v1/<resource>/<id>       -> <entity>   (PUT via method opt)
//   delete -> DELETE /v1/<resource>/<id>       -> void       (204/404 => ok)
//
// An app's storage resolver selects this client when the API env pair
// (HASNA_<APP>_API_URL + HASNA_<APP>_API_KEY) is present, and falls through
// to the local store otherwise.
//
// Guarantees carried up from the shared seam: JSON in/out, per-request timeout,
// retries with exponential backoff + jitter for transient failures, and
// idempotency (create() attaches an `Idempotency-Key` so a retried POST cannot
// duplicate). Non-2xx responses surface as `HasnaHttpError` (status + body).
//
// SAFETY: never logs, returns, or embeds the API key. The key lives only inside
// the transport it wraps.

export {
  createHasnaStorageClient,
  resolveStorageClient,
} from "@hasna/contracts/client/storage";
export type {
  HasnaStorageClient,
  ResolveStorageClientResult,
  StorageCreateOptions,
  StorageDeleteOptions,
  StorageGetOptions,
  StorageListOptions,
  StorageListResult,
  StorageUpdateOptions,
} from "@hasna/contracts/client/storage";
