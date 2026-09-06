/**
 * @hasna/recordings SDK — typed `/v1` cloud client.
 *
 * Generated from the serve OpenAPI document (src/server/openapi.ts). Regenerate
 * with `bun run generate:sdk`.
 *
 *   import { createRecordingsV1Client } from "@hasna/recordings/sdk";
 *   const client = createRecordingsV1Client();          // resolves through the fleet chain
 *   const { recordings } = await client.listRecordings({ limit: 20 });
 *
 * The credential is resolved fresh on every request through the ONE resolver in
 * `@hasna/contracts` (Keychain, `~/.hasna/recordings/config/credentials`, then
 * `HASNA_RECORDINGS_API_KEY`), so a rotation heals a client held open for
 * hours. An explicit `baseUrl` pins the authority — with no `apiKey` beside it
 * the client sends NO credential at all and the ambient chain is never
 * consulted (#1794). The unhosted local serve (http://localhost:8874) is
 * reachable only under the explicit `HASNA_RECORDINGS_LOCAL=1` opt-in and says
 * so on stderr.
 */
export {
  createRecordingsV1Client,
  resolveRecordingsSdkTransport,
  RECORDINGS_LOCAL_SERVE_URL,
  __resetRecordingsSdkLocalNotice,
} from "./resolve.js";
export type {
  ResolveRecordingsSdkTransportOptions,
  RecordingsSdkTransport,
} from "./resolve.js";

export {
  RecordingsV1Client,
  ApiError as RecordingsV1ApiError,
} from "./v1.generated.js";
export type {
  RecordingsV1ClientOptions,
  Recording as RecordingsV1Recording,
  Agent as RecordingsV1Agent,
  Project as RecordingsV1Project,
  CreateRecordingInput as RecordingsV1CreateRecordingInput,
  RegisterAgentInput as RecordingsV1RegisterAgentInput,
  RegisterProjectInput as RecordingsV1RegisterProjectInput,
} from "./v1.generated.js";