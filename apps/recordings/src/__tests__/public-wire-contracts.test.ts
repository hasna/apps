import { expect, test } from "bun:test";
import * as hosted from "../contracts/hosted-v1.js";
import * as stream from "../contracts/stream-v1.js";
import vectors from "../../contracts/v1/fixtures.json";

const parsers: Record<string, stream.ContractParser<unknown>> = {
  recordingInputParser: hosted.recordingInputParser, recordingResponseParser: hosted.recordingResponseParser,
  pasteInputParser: hosted.pasteInputParser, pasteReceiptParser: hosted.pasteReceiptParser,
  pageOptionsParser: hosted.pageOptionsParser, accountResponseParser: hosted.accountResponseParser,
  versionResponseParser: hosted.versionResponseParser, bootstrapInputParser: hosted.bootstrapInputParser,
  renameInputParser: hosted.renameInputParser, pendingDeletionParser: hosted.pendingDeletionParser,
  streamControlParser: stream.streamControlParser, streamEventParser: stream.streamEventParser,
  recordingIDParser: stream.recordingIDParser,
  healthResponseParser: hosted.healthResponseParser, readyResponseParser: hosted.readyResponseParser,
  providersResponseParser: hosted.providersResponseParser,
};
for (const fixture of vectors.cases) {
  test(`public wire fixture: ${fixture.parser}: ${fixture.name}`, () => {
    const parser = parsers[fixture.parser];
    expect(parser).toBeDefined();
    const result = parser!.safeParse(fixture.value);
    expect(result.success).toBe(fixture.valid);
    if (fixture.valid) expect(parser!.parse(fixture.value)).toEqual(result.success ? result.data : undefined);
    else {
      expect(result).toEqual({ success: false, error: { code: "invalid_contract" } });
      expect(() => parser!.parse(fixture.value)).toThrow(stream.ContractValidationError);
    }
  });
}

test("PCM frames enforce exact byte bounds without copying or converting", () => {
  for (const bytes of [2, 4_800, 24_000]) {
    const frame = new Uint8Array(bytes);
    expect(stream.pcmFrameParser.parse(frame)).toBe(frame);
  }
  for (const bytes of [0, 1, 3, 24_001, 24_002]) expect(stream.pcmFrameParser.safeParse(new Uint8Array(bytes)).success).toBe(false);
  expect(stream.pcmFrameParser.safeParse([0, 0]).success).toBe(false);
});

test("serialized controls have a UTF-8 byte ceiling independent of token character limits", () => {
  const small: stream.StreamControl = { type: "session.authorize", accessToken: "a".repeat(15_900) };
  expect(stream.parseStreamControlJSON(JSON.stringify(small))).toEqual(small);
  const unicode = { type: "session.authorize", accessToken: "é".repeat(11_000) };
  expect(stream.streamControlParser.safeParse(unicode).success).toBe(true);
  expect(() => stream.parseStreamControlJSON(JSON.stringify(unicode))).toThrow(stream.ContractValidationError);
  for (const value of ["{", "null", "[]", JSON.stringify({ type: "session.authorize", accessToken: "a".repeat(16_001) })]) {
    expect(() => stream.parseStreamControlJSON(value)).toThrow(stream.ContractValidationError);
  }
});

test("acknowledgments never approve unsent, skipped or repeated PCM", () => {
  const event: stream.AudioAccepted = { type: "audio.accepted", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bytes: 4_800, totalBytes: 9_600 };
  expect(stream.acceptsAudioAcknowledgement(event, 9_600, 4_800)).toBe(true);
  expect(stream.acceptsAudioAcknowledgement(event, 4_800, 4_800)).toBe(false);
  expect(stream.acceptsAudioAcknowledgement(event, 9_600, 0)).toBe(false);
  expect(stream.acceptsAudioAcknowledgement(event, 9_600, 9_600)).toBe(false);
  expect(stream.acceptsAudioAcknowledgement(event, Infinity, 4_800)).toBe(false);
  expect(stream.acceptsAudioAcknowledgement(event, 9_600, -1)).toBe(false);
});

test("runtime bounds cover metadata, transcript, sequence and collections", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const metadata = { wireVersion: "1.0", capabilities: [...stream.REQUIRED_CAPABILITIES] };
  expect(stream.wireMetadataParser.safeParse({ ...metadata, capabilities: [...metadata.capabilities, ...Array.from({ length: 29 }, (_, i) => `extra-${i}`)] }).success).toBe(false);
  expect(stream.wireMetadataParser.safeParse({ ...metadata, wireVersion: "1.10000" }).success).toBe(false);
  expect(stream.streamEventParser.safeParse({ type: "partial", sessionId: id, segment: { id: "one", text: "a".repeat(256_001) } }).success).toBe(false);
  expect(stream.streamEventParser.safeParse({ type: "partial", sessionId: id, segment: { id: "a".repeat(257), text: "Fictional" } }).success).toBe(false);
  expect(stream.streamEventParser.safeParse({ type: "partial", sessionId: id, segment: { id: "one", text: "Fictional", startSecond: 2, endSecond: 1 } }).success).toBe(false);
  expect(stream.streamEventParser.safeParse({ type: "partial", sessionId: id, sequence: Number.MAX_SAFE_INTEGER + 1, segment: { id: "one", text: "Fictional" } }).success).toBe(false);
  expect(stream.streamEventParser.safeParse({ type: "final", sessionId: id, transcript: { sessionId: id, text: "Fictional", segments: Array.from({ length: 4_097 }, () => ({ id: "one", text: "Fictional" })) } }).success).toBe(false);
  expect(stream.streamEventParser.safeParse({ type: "final", sessionId: id, transcript: { sessionId: id, text: "Fictional", segments: [{ id: "one", text: "a".repeat(128_001) }, { id: "two", text: "a".repeat(128_001) }] } }).success).toBe(false);
  const recording = { id, title: "Fictional", transcript: "", durationMs: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  expect(hosted.recordingListParser.safeParse({ recordings: Array(101).fill(recording) }).success).toBe(false);
  expect(hosted.recordingInputParser.safeParse({ id, title: "Fictional", transcript: "", durationMs: NaN }).success).toBe(false);
});

test("forward-compatible fields retain JSON values and never admit executable or non-finite data", () => {
  const response: hosted.HostedVersionResponse = { name: "recordings", version: "fictional", apiVersion: "v1", extra: { array: [null, true, 1, "future"] } };
  expect(hosted.versionResponseParser.parse(response)).toEqual(response);
  for (const extra of [() => "fictional", Infinity, { number: NaN }]) expect(hosted.versionResponseParser.safeParse({ ...response, extra }).success).toBe(false);
});

test("validation failures do not retain secrets, rejected values or original errors", () => {
  const privateValue = "fictional-private-placeholder";
  const value = { type: "session.authorize", accessToken: privateValue, unexpected: privateValue };
  const result = stream.streamControlParser.safeParse(value);
  expect(JSON.stringify(result)).not.toContain(privateValue);
  try { stream.streamControlParser.parse(value); throw Error("parser accepted invalid input"); }
  catch (error) {
    expect(error).toBeInstanceOf(stream.ContractValidationError);
    expect(String(error)).not.toContain(privateValue);
    expect(Object.keys(error as object).sort()).toEqual(["code", "name"]);
    expect((error as Error).cause).toBeUndefined();
  }
  const hostile = { get type(): never { throw Error(privateValue); } };
  expect(stream.streamControlParser.safeParse(hostile)).toEqual({ success: false, error: { code: "invalid_contract" } });
});

test("parser consumers use structural interfaces rather than schema-library types", () => {
  const acceptParser = <T>(value: { parse(input: unknown): T; safeParse(input: unknown): stream.ContractResult<T> }) => value;
  const parser: stream.ContractParser<hosted.HostedPageOptions> = acceptParser(hosted.pageOptionsParser);
  expect(parser.parse({ limit: 10 })).toEqual({ limit: 10 });
});
