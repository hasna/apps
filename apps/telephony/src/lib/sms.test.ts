import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { closeDatabase } from "../db/database.js";
import { getMessage } from "../db/messages.js";
import { resetStore } from "./store/index.js";
import { MediaStorage, type S3ClientLike } from "./media-storage.js";
import { handleInboundSms } from "./sms.js";

/**
 * In-memory bucket standing in for the AWS client (the artifact-kit injection
 * seam: MediaStorage accepts an S3ClientLike so tests never touch AWS).
 */
class InMemoryS3 implements S3ClientLike {
  readonly objects = new Map<string, Buffer>();

  async send(command: PutObjectCommand): Promise<unknown> {
    const key = command.input.Key as string;
    const body = command.input.Body;
    this.objects.set(key, Buffer.from(body instanceof Uint8Array ? body : String(body)));
    return {};
  }
}

function inboundSmsFixture(): { bytes: Uint8Array; digest: string } {
  const bytes = new TextEncoder().encode("inbound-mms-bytes");
  return { bytes, digest: createHash("sha256").update(bytes).digest("hex") };
}

describe("handleInboundSms media copy", () => {
  it("creates the message row first, then copies inbound MMS media and attaches object_key + sha256", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "telephony-sms-media-test-"));
    process.env.HASNA_TELEPHONY_DB_PATH = join(tempRoot, "telephony.db");
    process.env.HASNA_DATA_HOME = join(tempRoot, "data");
    // handleInboundSms persists through the store, whose resolver fails
    // closed without the API env — select local mode EXPLICITLY
    // (HASNA_TELEPHONY_LOCAL=1), like the other store-backed telephony tests.
    process.env.HASNA_TELEPHONY_LOCAL = "1";
    const s3 = new InMemoryS3();
    const { bytes, digest } = inboundSmsFixture();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } });
    try {
      const msg = await handleInboundSms(
        {
          MessageSid: "SMmedia1",
          From: "+15551234567",
          To: "+15559876543",
          Body: "look at this",
          NumMedia: "1",
          MediaUrl0: "https://api.twilio.com/media/SMmedia1.jpg",
        },
        undefined,
        undefined,
        new MediaStorage({ bucket: "test-media-bucket", client: s3 }),
      );

      // Keyed under the provider sid, mirroring the row's twilio_sid.
      expect(msg.object_key).toBe(`telephony/media/SMmedia1/${digest}.jpg`);
      expect(msg.sha256).toBe(digest);
      expect(msg.twilio_sid).toBe("SMmedia1");
      expect(s3.objects.has(`telephony/media/SMmedia1/${digest}.jpg`)).toBe(true);

      // The row really carries the copy metadata (not just the returned object).
      const stored = getMessage(msg.id);
      expect(stored?.object_key).toBe(`telephony/media/SMmedia1/${digest}.jpg`);
      expect(stored?.sha256).toBe(digest);
      expect(stored?.media_url).toBe("https://api.twilio.com/media/SMmedia1.jpg");
    } finally {
      globalThis.fetch = originalFetch;
      resetStore();
      closeDatabase();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("soft-fails: a failed copy still keeps the message row with object_key null", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "telephony-sms-media-test-"));
    process.env.HASNA_TELEPHONY_DB_PATH = join(tempRoot, "telephony.db");
    process.env.HASNA_DATA_HOME = join(tempRoot, "data");
    process.env.HASNA_TELEPHONY_LOCAL = "1";
    const s3 = new InMemoryS3();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("gone", { status: 503 });
    try {
      const msg = await handleInboundSms(
        {
          MessageSid: "SMmedia2",
          From: "+15551234567",
          To: "+15559876543",
          Body: "media will fail",
          NumMedia: "1",
          MediaUrl0: "https://api.twilio.com/media/SMmedia2.jpg",
        },
        undefined,
        undefined,
        new MediaStorage({ bucket: "test-media-bucket", client: s3 }),
      );

      expect(msg.object_key).toBeNull();
      expect(msg.sha256).toBeNull();
      expect(s3.objects.size).toBe(0);

      // The row still exists (create happens before the copy) and keeps the
      // provider URL as the fallback — a failed copy never drops the message.
      const stored = getMessage(msg.id);
      expect(stored?.object_key).toBeNull();
      expect(stored?.media_url).toBe("https://api.twilio.com/media/SMmedia2.jpg");
    } finally {
      globalThis.fetch = originalFetch;
      resetStore();
      closeDatabase();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
