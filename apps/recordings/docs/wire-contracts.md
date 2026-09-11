# Hosted recording wire contracts

The additive `@hasna/recordings/contracts/hosted-v1` and `@hasna/recordings/contracts/stream-v1` exports describe hosted recording metadata and PCM streaming. They perform no I/O, choose no endpoint, read no credentials and implement no provider or storage backend. Existing `./sdk`, CLI, MCP, serve, projects and native provider interfaces keep their existing behavior. The hosted camelCase API is distinct from the legacy SDK's snake_case API. Qualified timestamps require seconds; numeric offsets require a colon and valid hour/minute ranges.

```ts
import { recordingInputParser } from "@hasna/recordings/contracts/hosted-v1";
import { streamEventParser } from "@hasna/recordings/contracts/stream-v1";

const request = recordingInputParser.parse(input);
const event = streamEventParser.safeParse(decodedEvent);
if (!event.success) handleInvalidContract(event.error.code);
```

Every parser exposes an explicit `ContractParser<T>` interface with plain DTOs. `parse` throws a fixed `ContractValidationError`; `safeParse` returns `{success: true, data}` or `{success: false, error: {code: "invalid_contract"}}`. Neither error retains rejected data, schema-library internals or a cause. Consumers using different validation libraries can use these interfaces without exchanging Zod types.

Inputs reject unknown fields. Recording input has a UUID, title, transcript and duration in milliseconds; caller input cannot supply trusted provenance. Titles are trimmed. Paste input uses UTC timestamps ending in `Z`; output timestamps may have offsets. A paste receipt's `client_reported` evidence does not mean the server observed the target. Pagination requires `before` and `beforeId` together, or neither; either cursor component alone is invalid. Responses preserve extra JSON fields, including nested fields, while still checking known fields.

Hosted wire version `1.0` is independent of package and local-control versions. Metadata may be entirely absent for legacy v1. Once advertised, version and capabilities must both be present: major `1`, bounded minor, unique valid capability names, and all four required capabilities. Future compatible minors and additional capabilities are accepted. No incompatible advertisement downgrades to legacy mode. Bootstrap and version response parsers enforce these rules too. This intentionally tightens the previous hosted SDK's permissive metadata parsing to match service/native negotiation; it does not modify the legacy public SDK.

Streaming controls are strict. `parseStreamControlJSON` also enforces the existing 20,000-byte UTF-8 control-message ceiling. `pcmFrameParser` accepts only nonempty even-length PCM16 frames, from 2 through 24,000 bytes, without copying or converting them. The format is 24 kHz mono signed little-endian PCM16. Stream event parsers validate known event types, bounds, final capture identity and complete advertised metadata. New fields are allowed; unknown event types are rejected. Legacy final events may omit segments/provenance/recordingId, and legacy ready events may omit metadata/window fields.

These are value contracts, not a session state machine. The consumer must bind events to its current capture, require ready before sending, enforce sequence ordering, cumulative/buffer/deadline limits, require input finish before final delivery, validate renewal expiry against its clock, and require ready metadata when bootstrap advertised it. `acceptsAudioAcknowledgement` is a pure check against the consumer's sent and acknowledged byte counts; it does not update those counts. The consumer owns consent, authorization, cancellation and error display. Error-event messages are untrusted data and must not be logged as validation diagnostics.

Fictional positive and negative interoperability vectors are exported as `@hasna/recordings/contracts/fixtures/v1`. They freeze current input/output differences explicitly. Contract additions do not repoint or replace any legacy API. A subsequent reviewed package release and consumer adoption are required; introducing these modules does not publish them or change a deployed service.
