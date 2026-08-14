// Client transport seam — imported from `@hasna/contracts/client`, never
// defined here.
//
// The credential-seam conformance gate forbids vendored copies of the
// @hasna/contracts client seam: a fork does not receive credential-resolution
// fixes, so it keeps resolving keys from the process environment however many
// times the shared package is corrected. This app pins @hasna/contracts and
// consumes the seam as a typed library dependency.
//
// CLIENT CONTRACT (env vars). For app `<NAME>`:
//
//   API base URL:
//     HASNA_<NAME>_API_URL = https://<app>.your-deployment.example
//     <NAME>_API_URL                                                  (alias)
//   API key (bearer / x-api-key):
//     HASNA_<NAME>_API_KEY = hasna_<app>_...
//     <NAME>_API_KEY                                                  (alias)
//
// Transport is HTTP IFF an API URL resolves AND a credential resolves for it;
// otherwise the client stays on the local store. A set `HASNA_<NAME>_STORAGE_MODE`
// (or `HASNA_<NAME>_MODE`) is an error, never a hint. A URL without a
// credential is misconfigured and fails closed via `createClientTransport`.
//
// SAFETY: the shared seam never returns, logs, or embeds the API key value.
// Callers receive only presence flags, source names, and tiers.

export {
  appendQuery,
  clientTransportEnvKeys,
  createClientTransport,
  createHasnaHttpTransport,
  HasnaHttpError,
  resolveClientTransport,
  toV1BaseUrl,
} from "@hasna/contracts/client";
export type {
  ClientTransportEnvKeys,
  ClientTransportKind,
  ClientTransportResolution,
  HasnaHttpTransport,
  HasnaHttpTransportOptions,
  HasnaRequestOptions,
  HasnaRetryOptions,
  QueryParams,
  ResolveClientTransportOptions,
} from "@hasna/contracts/client";
