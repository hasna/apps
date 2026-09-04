import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { closeDatabase } from "../db/database.js";
import { resetStore } from "../lib/store/index.js";
import { MediaStorage, type S3ClientLike } from "../lib/media-storage.js";
import { createCall, getCallByTwilioSid } from "../db/calls.js";
import { parseFormBody, handleStatusWebhook, flushBackgroundMediaCopies } from "./webhooks.js";

class InMemoryS3 implements S3ClientLike {
  readonly objects = new Map<string, Buffer>();

  async send(command: PutObjectCommand): Promise<unknown> {
    const key = command.input.Key as string;
    const body = command.input.Body;
    this.objects.set(key, Buffer.from(body instanceof Uint8Array ? body : String(body)));
    return {};
  }
}

const originalEnv = new Map(
  ["HASNA_TELEPHONY_API_URL", "HASNA_TELEPHONY_API_KEY", "TELEPHONY_API_URL", "TELEPHONY_API_KEY", "HASNA_TELEPHONY_DB_PATH", "HASNA_TELEPHONY_LOCAL", "TELEPHONY_LOCAL"].map(
    (name) => [name, process.env[name]] as const,
  ),
);

let tempRoot: string | undefined;
let originalFetch: typeof fetch;

function restoreEnv(): void {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

beforeEach(() => {
  for (const name of originalEnv.keys()) delete process.env[name];
  // handleStatusWebhook dispatches call.status events through the store-backed
  // dispatchWebhook, whose resolver fails closed without the API env — select
  // local mode EXPLICITLY (HASNA_TELEPHONY_LOCAL=1), like the other
  // store-backed telephony tests, so the on-box SQLite store serves the temp DB.
  process.env.HASNA_TELEPHONY_LOCAL = "1";
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
  resetStore();
  closeDatabase();
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("parseFormBody", () => {
  it("decodes application/x-www-form-urlencoded webhook payloads", () => {
    expect(parseFormBody("MessageSid=SM123&Body=hello+world%21&From=%2B15551234567")).toEqual({
      MessageSid: "SM123",
      Body: "hello world!",
      From: "+15551234567",
    });
  });

  it("preserves equals signs inside field values", () => {
    expect(parseFormBody("Body=token=a=b=c&MessageSid=SM123")).toEqual({
      Body: "token=a=b=c",
      MessageSid: "SM123",
    });
  });

  it("decodes plus signs in field names as spaces", () => {
    expect(parseFormBody("Friendly+Name=Main+line")).toEqual({
      "Friendly Name": "Main line",
    });
  });
});

describe("handleStatusWebhook media copy", () => {
  it("copies the recording at call completion and stores object_key + sha256 on the call row", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "telephony-status-webhook-test-"));
    process.env.HASNA_TELEPHONY_DB_PATH = join(tempRoot, "telephony.db");
    resetStore();

    const call = createCall({
      direction: "inbound",
      from_number: "+15551234567",
      to_number: "+15559876543",
      twilio_sid: "CAstatuscall1",
    });

    const s3 = new InMemoryS3();
    const bytes = new TextEncoder().encode("call-recording-bytes");
    const digest = createHash("sha256").update(bytes).digest("hex");
    globalThis.fetch = async () =>
      new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg" } });

    await handleStatusWebhook(
      "CallSid=CAstatuscall1&CallStatus=in-progress&RecordingSid=RE42&RecordingStatus=completed&RecordingUrl=https%3A%2F%2Fapi.twilio.com%2Frecordings%2FRE42%2Frecording.mp3",
      new MediaStorage({ bucket: "test-media-bucket", client: s3 }),
    );

    // The media copy runs in the background after the webhook response (the
    // row update is awaited; the copy is not) — resolve it before asserting
    // the copy metadata landed on the row.
    await flushBackgroundMediaCopies();

    const stored = getCallByTwilioSid("CAstatuscall1");
    expect(stored?.recording_url).toBe("https://api.twilio.com/recordings/RE42/recording.mp3");
    expect(stored?.object_key).toBe(`telephony/media/CAstatuscall1/${digest}.mp3`);
    expect(stored?.sha256).toBe(digest);
    expect(s3.objects.has(`telephony/media/CAstatuscall1/${digest}.mp3`)).toBe(true);
    expect(call.id).toBe(stored?.id);
  });

  it("ignores intermediate recording status callbacks (partial media must not be copied)", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "telephony-status-webhook-test-"));
    process.env.HASNA_TELEPHONY_DB_PATH = join(tempRoot, "telephony.db");
    resetStore();

    const call = createCall({
      direction: "inbound",
      from_number: "+15551234567",
      to_number: "+15559876543",
      twilio_sid: "CAstatuscall2",
    });

    const s3 = new InMemoryS3();
    const bytes = new TextEncoder().encode("partial-recording-bytes");
    globalThis.fetch = async () =>
      new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg" } });

    // Twilio <Record> status callbacks fire intermediate events
    // (recording-started / recording-in-progress / recording-paused) that
    // carry RecordingUrl while the recording is still being written.
    for (const recordingStatus of ["in-progress", "paused"]) {
      await handleStatusWebhook(
        `CallSid=CAstatuscall2&CallStatus=in-progress&RecordingSid=RE44&RecordingStatus=${recordingStatus}&RecordingUrl=https%3A%2F%2Fapi.twilio.com%2Frecordings%2FRE44%2Frecording.mp3`,
        new MediaStorage({ bucket: "test-media-bucket", client: s3 }),
      );
    }

    const stored = getCallByTwilioSid("CAstatuscall2");
    expect(stored?.object_key).toBeNull();
    expect(stored?.sha256).toBeNull();
    expect(stored?.recording_url).toBeNull();
    expect(s3.objects.size).toBe(0);
    expect(call.id).toBe(stored?.id);
  });

  it("leaves the call row untouched when the recording copy fails (soft-fail)", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "telephony-status-webhook-test-"));
    process.env.HASNA_TELEPHONY_DB_PATH = join(tempRoot, "telephony.db");
    resetStore();

    createCall({
      direction: "inbound",
      from_number: "+15551234567",
      to_number: "+15559876543",
      twilio_sid: "CAstatuscall3",
    });

    const s3 = new InMemoryS3();
    globalThis.fetch = async () => new Response("gone", { status: 503 });

    await handleStatusWebhook(
      "CallSid=CAstatuscall3&CallStatus=in-progress&RecordingSid=RE45&RecordingStatus=completed&RecordingUrl=https%3A%2F%2Fapi.twilio.com%2Frecordings%2FRE45%2Frecording.mp3",
      new MediaStorage({ bucket: "test-media-bucket", client: s3 }),
    );

    // Same as above: the failed copy settles in the background; await it so
    // the test never outlives a tracked copy.
    await flushBackgroundMediaCopies();

    const stored = getCallByTwilioSid("CAstatuscall3");
    expect(stored?.object_key).toBeNull();
    expect(stored?.sha256).toBeNull();
    expect(s3.objects.size).toBe(0);
  });
});
