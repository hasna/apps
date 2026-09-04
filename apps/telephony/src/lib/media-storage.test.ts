import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { MediaStorage, type S3ClientLike } from "./media-storage.js";

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

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fakeProvider(bytes: Uint8Array, contentType = "audio/mpeg", status = 200): typeof fetch {
  return async () => new Response(bytes, { status, headers: { "content-type": contentType } });
}

describe("MediaStorage.copyProviderMedia", () => {
  it("is inert (no fetch, no upload) when no bucket is configured", async () => {
    const s3 = new InMemoryS3();
    let fetched = false;
    const storage = new MediaStorage({ client: s3 });
    const result = await storage.copyProviderMedia({
      mediaId: "call-1",
      sourceUrl: "https://api.twilio.com/recording.mp3",
      fetchImpl: async () => {
        fetched = true;
        return new Response("x");
      },
    });

    expect(storage.usesS3).toBe(false);
    expect(result).toBeNull();
    expect(fetched).toBe(false);
    expect(s3.objects.size).toBe(0);
  });

  it("copies provider media under media/<id>/<sha256>.<ext> with the digest proof", async () => {
    const s3 = new InMemoryS3();
    const bytes = new TextEncoder().encode("recording-bytes");
    const digest = sha256Hex(bytes);

    const storage = new MediaStorage({ bucket: "test-media-bucket", client: s3 });
    const result = await storage.copyProviderMedia({
      mediaId: "CA1234567890",
      sourceUrl: "https://api.twilio.com/recordings/RE000/recording.mp3",
      fetchImpl: fakeProvider(bytes, "audio/mpeg"),
    });

    expect(result).toEqual({
      objectKey: `telephony/media/CA1234567890/${digest}.mp3`,
      sha256: digest,
      size: bytes.length,
    });
    expect(s3.objects.has(`telephony/media/CA1234567890/${digest}.mp3`)).toBe(true);
    expect(Buffer.from(s3.objects.get(`telephony/media/CA1234567890/${digest}.mp3`)!)).toEqual(Buffer.from(bytes));
  });

  it("uses the configured prefix and bucket when set", async () => {
    const s3 = new InMemoryS3();
    const bytes = new TextEncoder().encode("wav-bytes");
    const digest = sha256Hex(bytes);

    const storage = new MediaStorage({ bucket: "custom-bucket", prefix: "my/prefix", client: s3 });
    const result = await storage.copyProviderMedia({
      mediaId: "CA1",
      sourceUrl: "https://api.twilio.com/recording",
      fetchImpl: fakeProvider(bytes, "audio/wav"),
    });

    expect(result?.objectKey).toBe(`my/prefix/media/CA1/${digest}.wav`);
  });

  it("falls back to the URL extension for generic content types", async () => {
    const s3 = new InMemoryS3();
    const bytes = new TextEncoder().encode("ogg-bytes");
    const digest = sha256Hex(bytes);

    const storage = new MediaStorage({ bucket: "custom-bucket", client: s3 });
    const result = await storage.copyProviderMedia({
      mediaId: "CA1",
      sourceUrl: "https://api.twilio.com/recordings/RE1/recording.ogg",
      fetchImpl: fakeProvider(bytes, "application/octet-stream"),
    });

    expect(result?.objectKey).toBe(`telephony/media/CA1/${digest}.ogg`);
  });

  it("soft-fails (null + no upload) when the provider responds non-2xx", async () => {
    const s3 = new InMemoryS3();
    const storage = new MediaStorage({ bucket: "custom-bucket", client: s3 });
    const result = await storage.copyProviderMedia({
      mediaId: "CA1",
      sourceUrl: "https://api.twilio.com/missing.mp3",
      fetchImpl: fakeProvider(new Uint8Array(0), "audio/mpeg", 404),
    });

    expect(result).toBeNull();
    expect(s3.objects.size).toBe(0);
  });

  it("soft-fails (null + no upload) when the provider fetch throws", async () => {
    const s3 = new InMemoryS3();
    const storage = new MediaStorage({ bucket: "custom-bucket", client: s3 });
    const result = await storage.copyProviderMedia({
      mediaId: "CA1",
      sourceUrl: "https://api.twilio.com/down.mp3",
      fetchImpl: async () => {
        throw new Error("provider unreachable");
      },
    });

    expect(result).toBeNull();
    expect(s3.objects.size).toBe(0);
  });

  it("soft-fails (null) when the S3 upload throws", async () => {
    const s3 = new InMemoryS3();
    s3.failUploads = true;
    const storage = new MediaStorage({ bucket: "custom-bucket", client: s3 });
    const result = await storage.copyProviderMedia({
      mediaId: "CA1",
      sourceUrl: "https://api.twilio.com/recording.mp3",
      fetchImpl: fakeProvider(new TextEncoder().encode("bytes"), "audio/mpeg"),
    });

    expect(result).toBeNull();
  });

  it("sanitizes a hostile media id so it cannot escape the prefix", async () => {
    const s3 = new InMemoryS3();
    const bytes = new TextEncoder().encode("bytes");
    const digest = sha256Hex(bytes);

    const storage = new MediaStorage({ bucket: "custom-bucket", client: s3 });
    const result = await storage.copyProviderMedia({
      mediaId: "../../../etc/passwd",
      sourceUrl: "https://api.twilio.com/recording.mp3",
      fetchImpl: fakeProvider(bytes, "audio/mpeg"),
    });

    expect(result?.objectKey).toBe(`telephony/media/etc/passwd/${digest}.mp3`);
    expect(result!.objectKey.includes("..")).toBe(false);
    expect(result!.objectKey.startsWith("telephony/media/")).toBe(true);
  });
});

describe("MediaStorage.mediaKeyFor", () => {
  it("refuses nothing but normalizes extensions to lowercase alphanumerics", () => {
    const storage = new MediaStorage({ bucket: "b" });
    expect(storage.mediaKeyFor("CA1", "a".repeat(64), "mP3")).toBe(`telephony/media/CA1/${"a".repeat(64)}.mp3`);
    expect(storage.mediaKeyFor("CA1", "a".repeat(64), "../../secret")).toBe(`telephony/media/CA1/${"a".repeat(64)}.secret`);
  });
});