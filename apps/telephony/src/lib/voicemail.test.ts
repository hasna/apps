import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { closeDatabase } from "../db/database.js";
import { resetStore } from "./store/index.js";
import { MediaStorage, type S3ClientLike } from "./media-storage.js";
import { handleVoicemailRecording } from "./voicemail.js";
import { getVoicemail } from "../db/voicemails.js";
import { createCall } from "../db/calls.js";

/**
 * In-memory bucket standing in for the AWS client (the artifact-kit injection
 * seam: MediaStorage accepts an S3ClientLike so tests never touch AWS).
 */
class InMemoryS3 implements S3ClientLike {
  readonly objects = new Map<string, Buffer>();
  failUploads = false;

  async send(command: PutObjectCommand): Promise<unknown> {
    if (this.failUploads) throw new Error("synthetic S3 upload failure");
    const key = command.input.Key as string;
    const body = command.input.Body;
    this.objects.set(key, Buffer.from(body instanceof Uint8Array ? body : String(body)));
    return {};
  }
}

function recordingFixture(): { bytes: Uint8Array; digest: string } {
  const bytes = new TextEncoder().encode("voicemail-recording-bytes");
  return { bytes, digest: createHash("sha256").update(bytes).digest("hex") };
}

describe("handleVoicemailRecording media copy", () => {
  it("copies the provider recording into the bucket and stores object_key + sha256 on the row", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "telephony-voicemail-media-test-"));
    process.env.HASNA_TELEPHONY_DB_PATH = join(tempRoot, "telephony.db");
    process.env.HASNA_DATA_HOME = join(tempRoot, "data");
    // handleVoicemailRecording persists through the store, whose resolver
    // fails closed without the API env — select local mode EXPLICITLY
    // (HASNA_TELEPHONY_LOCAL=1), like the other store-backed telephony tests.
    process.env.HASNA_TELEPHONY_LOCAL = "1";
    const s3 = new InMemoryS3();
    const { bytes, digest } = recordingFixture();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg" } });
    const call = createCall({
      direction: "inbound",
      from_number: "+15551234567",
      to_number: "+15559876543",
    });
    try {
      const voicemail = await handleVoicemailRecording({
        call_id: call.id,
        from_number: "+15551234567",
        to_number: "+15559876543",
        recording_url: "https://api.twilio.com/recordings/RE999/recording.mp3",
        duration: 42,
        mediaStorage: new MediaStorage({ bucket: "test-media-bucket", client: s3 }),
      });

      expect(voicemail.object_key).toBe(`telephony/media/${call.id}/${digest}.mp3`);
      expect(voicemail.sha256).toBe(digest);
      expect(s3.objects.has(`telephony/media/${call.id}/${digest}.mp3`)).toBe(true);

      // The row really carries the copy metadata (not just the returned object).
      const stored = getVoicemail(voicemail.id);
      expect(stored?.object_key).toBe(`telephony/media/${call.id}/${digest}.mp3`);
      expect(stored?.sha256).toBe(digest);
      expect(stored?.recording_url).toBe("https://api.twilio.com/recordings/RE999/recording.mp3");
    } finally {
      globalThis.fetch = originalFetch;
      resetStore();
      closeDatabase();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("soft-fails: a failed upload still creates the row with object_key null", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "telephony-voicemail-media-test-"));
    process.env.HASNA_TELEPHONY_DB_PATH = join(tempRoot, "telephony.db");
    process.env.HASNA_DATA_HOME = join(tempRoot, "data");
    // handleVoicemailRecording persists through the store, whose resolver
    // fails closed without the API env — select local mode EXPLICITLY
    // (HASNA_TELEPHONY_LOCAL=1), like the other store-backed telephony tests.
    process.env.HASNA_TELEPHONY_LOCAL = "1";
    const s3 = new InMemoryS3();
    s3.failUploads = true;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(new TextEncoder().encode("bytes"), { status: 200, headers: { "content-type": "audio/mpeg" } });
    const call = createCall({
      direction: "inbound",
      from_number: "+15551234567",
      to_number: "+15559876543",
    });
    try {
      const voicemail = await handleVoicemailRecording({
        call_id: call.id,
        from_number: "+15551234567",
        to_number: "+15559876543",
        recording_url: "https://api.twilio.com/recordings/RE888/recording.mp3",
        mediaStorage: new MediaStorage({ bucket: "test-media-bucket", client: s3 }),
      });

      expect(voicemail.object_key).toBeNull();
      expect(voicemail.sha256).toBeNull();
      const stored = getVoicemail(voicemail.id);
      expect(stored?.object_key).toBeNull();
      expect(stored?.recording_url).toBe("https://api.twilio.com/recordings/RE888/recording.mp3");
    } finally {
      globalThis.fetch = originalFetch;
      resetStore();
      closeDatabase();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates the row without copy fields when no bucket is configured", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "telephony-voicemail-media-test-"));
    process.env.HASNA_TELEPHONY_DB_PATH = join(tempRoot, "telephony.db");
    process.env.HASNA_DATA_HOME = join(tempRoot, "data");
    // handleVoicemailRecording persists through the store, whose resolver
    // fails closed without the API env — select local mode EXPLICITLY
    // (HASNA_TELEPHONY_LOCAL=1), like the other store-backed telephony tests.
    process.env.HASNA_TELEPHONY_LOCAL = "1";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(new TextEncoder().encode("bytes"), { status: 200, headers: { "content-type": "audio/mpeg" } });
    try {
      const voicemail = await handleVoicemailRecording({
        from_number: "+15551234567",
        to_number: "+15559876543",
        recording_url: "https://api.twilio.com/recordings/RE777/recording.mp3",
      });

      expect(voicemail.object_key).toBeNull();
      expect(voicemail.sha256).toBeNull();
      expect(getVoicemail(voicemail.id)?.recording_url).toBe(
        "https://api.twilio.com/recordings/RE777/recording.mp3",
      );
    } finally {
      globalThis.fetch = originalFetch;
      resetStore();
      closeDatabase();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});