/**
 * The artifact kit (audio upload at recording creation) — fake-S3 tests in the
 * same in-memory-bucket style as the skills kit tests (hasna/apps#1639), plus
 * the LocalStore wiring: upload-on-create when a bucket is configured,
 * unchanged behaviour when it is not, and fail-soft on storage errors.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AudioArtifactStorage,
  DEFAULT_S3_PREFIX,
  contentTypeForExtension,
  resolveAudioArtifactStorage,
  uploadAudioAtCreation,
  type S3ClientLike,
} from "../lib/audio-artifact-storage.js";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { getRecording } from "../db/recordings.js";
import {
  getStore,
  __resetStore,
  __setLocalArtifactStorage,
  __resetLocalArtifactStorage,
} from "../store.js";

/** An S3 client that keeps objects in a Map, so a test can assert on the exact keys. */
class FakeS3 implements S3ClientLike {
  objects = new Map<string, Uint8Array>();
  sent: unknown[][] = [];

  async send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand): Promise<{ Body?: unknown }> {
    this.sent.push([command.constructor.name, command.input]);
    const key = command.input.Key!;
    if (command instanceof PutObjectCommand) {
      const body = command.input.Body as Uint8Array | string;
      this.objects.set(key, typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const found = this.objects.get(key);
      if (!found) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      return { Body: found };
    }
    this.objects.delete(key);
    return {};
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}

class FailingS3 implements S3ClientLike {
  async send(): Promise<{ Body?: unknown }> {
    throw new Error("simulated storage outage");
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const AUDIO_BYTES = new Uint8Array([0x4d, 0x34, 0x41, 0x20, 0x00, 0x02, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef]);
const AUDIO_SHA256 = sha256Hex(AUDIO_BYTES);

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "recordings-artifact-"));
}

describe("AudioArtifactStorage kit", () => {
  test("upload places a content-addressed object and returns the exact ref", async () => {
    const s3 = new FakeS3();
    const storage = new AudioArtifactStorage({ bucket: "recordings-media", client: s3 });
    const dir = makeTempDir();
    const audioPath = join(dir, "part2b.m4a");
    writeFileSync(audioPath, AUDIO_BYTES);

    const ref = await storage.uploadAudio("rec_123", audioPath);

    expect(ref).not.toBeNull();
    expect(ref!.objectKey).toBe(`${DEFAULT_S3_PREFIX}/rec_123/${AUDIO_SHA256}.m4a`);
    expect(ref!.sha256).toBe(AUDIO_SHA256);
    expect(ref!.bytes).toBe(AUDIO_BYTES.byteLength);
    expect(s3.keys()).toEqual([ref!.objectKey]);
    expect(sha256Hex(s3.objects.get(ref!.objectKey)!)).toBe(AUDIO_SHA256);

    // Content type follows the extension.
    const put = s3.sent.find(([name]) => name === "PutObjectCommand")!;
    expect((put[1] as { ContentType: string }).ContentType).toBe("audio/mp4");

    rmSync(dir, { recursive: true, force: true });
  });

  test("custom prefix is honoured and key segments are bounded", async () => {
    const s3 = new FakeS3();
    const storage = new AudioArtifactStorage({ bucket: "b", prefix: "media/audio", client: s3 });
    const dir = makeTempDir();
    const audioPath = join(dir, "clip.wav");
    writeFileSync(audioPath, AUDIO_BYTES);

    const ref = await storage.uploadAudio("rec_9", audioPath);

    expect(ref!.objectKey).toBe(`media/audio/rec_9/${AUDIO_SHA256}.wav`);
    const put = s3.sent.find(([name]) => name === "PutObjectCommand")!;
    expect((put[1] as { ContentType: string }).ContentType).toBe("audio/wav");

    rmSync(dir, { recursive: true, force: true });
  });

  test("no bucket means local-only: usesS3 false, upload is a no-op, nothing is sent", async () => {
    const s3 = new FakeS3();
    const storage = new AudioArtifactStorage({ client: s3 });
    const dir = makeTempDir();
    const audioPath = join(dir, "clip.wav");
    writeFileSync(audioPath, AUDIO_BYTES);

    expect(storage.usesS3).toBe(false);
    expect(await storage.uploadAudio("rec_1", audioPath)).toBeNull();
    expect(await storage.readAudio("recordings/rec_1/whatever.wav")).toBeNull();
    expect(s3.sent).toEqual([]);

    rmSync(dir, { recursive: true, force: true });
  });

  test("an unreadable or missing audio file yields null, not an error", async () => {
    const s3 = new FakeS3();
    const storage = new AudioArtifactStorage({ bucket: "recordings-media", client: s3 });
    expect(await storage.uploadAudio("rec_1", join(makeTempDir(), "nope.wav"))).toBeNull();
    expect(s3.sent).toEqual([]);
  });

  test("a storage failure propagates from the kit (the caller decides how softly)", async () => {
    const storage = new AudioArtifactStorage({ bucket: "recordings-media", client: new FailingS3() });
    const dir = makeTempDir();
    const audioPath = join(dir, "clip.wav");
    writeFileSync(audioPath, AUDIO_BYTES);

    await expect(storage.uploadAudio("rec_1", audioPath)).rejects.toThrow("simulated storage outage");
    rmSync(dir, { recursive: true, force: true });
  });

  test("objectKeyFor refuses anything that is not a lowercase hex sha-256", () => {
    const storage = new AudioArtifactStorage({ bucket: "b" });
    expect(() => storage.objectKeyFor("rec_1", "not-a-digest", "wav")).toThrow("sha-256");
    expect(() => storage.objectKeyFor("rec_1", "A".repeat(64), "wav")).toThrow("sha-256");
    expect(storage.objectKeyFor("rec_1", "a".repeat(64), "wav")).toBe(`recordings/rec_1/${"a".repeat(64)}.wav`);
    // Extension is bounded: anything non-alphanumeric is stripped, empty falls back to bin.
    expect(storage.objectKeyFor("rec_1", "a".repeat(64), "wav/../../evil")).toBe(
      `recordings/rec_1/${"a".repeat(64)}.wav`
    );
    expect(storage.objectKeyFor("rec_1", "a".repeat(64), "")).toBe(`recordings/rec_1/${"a".repeat(64)}.bin`);
  });

  test("readAudio round-trips the uploaded bytes and returns null for unknown keys", async () => {
    const s3 = new FakeS3();
    const storage = new AudioArtifactStorage({ bucket: "recordings-media", client: s3 });
    const dir = makeTempDir();
    const audioPath = join(dir, "clip.m4a");
    writeFileSync(audioPath, AUDIO_BYTES);

    const ref = await storage.uploadAudio("rec_7", audioPath);
    const read = await storage.readAudio(ref!.objectKey);
    expect(read).not.toBeNull();
    expect(sha256Hex(read!)).toBe(AUDIO_SHA256);
    expect(await storage.readAudio(`recordings/rec_7/${"0".repeat(64)}.m4a`)).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  test("contentTypeForExtension maps the known audio formats and falls back safely", () => {
    expect(contentTypeForExtension("m4a")).toBe("audio/mp4");
    expect(contentTypeForExtension("WAV")).toBe("audio/wav");
    expect(contentTypeForExtension("webm")).toBe("audio/webm");
    expect(contentTypeForExtension("weird")).toBe("application/octet-stream");
  });

  test("resolveAudioArtifactStorage reads the bucket env pair and defaults the prefix", async () => {
    expect(resolveAudioArtifactStorage({ HASNA_RECORDINGS_S3_BUCKET: "media-bucket" }).usesS3).toBe(true);
    expect(resolveAudioArtifactStorage({ RECORDINGS_S3_BUCKET: "media-bucket" }).usesS3).toBe(true);
    expect(resolveAudioArtifactStorage({ HASNA_RECORDINGS_S3_BUCKET: "" }).usesS3).toBe(false);
    expect(resolveAudioArtifactStorage({}).usesS3).toBe(false);

    const s3 = new FakeS3();
    const storage = resolveAudioArtifactStorage(
      { HASNA_RECORDINGS_S3_BUCKET: "media-bucket", HASNA_RECORDINGS_S3_PREFIX: "custom/prefix" },
      s3,
    );
    expect(storage.usesS3).toBe(true);
    const dir = makeTempDir();
    const audioPath = join(dir, "clip.wav");
    writeFileSync(audioPath, AUDIO_BYTES);
    const ref = await storage.uploadAudio("rec_4", audioPath);
    expect(ref!.objectKey).toBe(`custom/prefix/rec_4/${AUDIO_SHA256}.wav`);
    rmSync(dir, { recursive: true, force: true });
  });

  test("uploadAudioAtCreation fails softly: a storage error never rejects", async () => {
    const storage = new AudioArtifactStorage({ bucket: "recordings-media", client: new FailingS3() });
    const dir = makeTempDir();
    const audioPath = join(dir, "clip.wav");
    writeFileSync(audioPath, AUDIO_BYTES);

    // Resolves null instead of throwing; the recording row survives.
    expect(await uploadAudioAtCreation("rec_1", audioPath, storage)).toBeNull();
    // No audio path / no bucket: trivially null.
    expect(await uploadAudioAtCreation("rec_2", undefined, storage)).toBeNull();
    expect(await uploadAudioAtCreation("rec_3", audioPath, new AudioArtifactStorage({}))).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("LocalStore upload-at-creation wiring", () => {
  let tempDir: string;
  let originalDbPath: string | undefined;
  let originalAudioDir: string | undefined;
  let originalClientStore: string | undefined;

  beforeEach(() => {
    resetDatabase();
    __resetStore();
    __resetLocalArtifactStorage();
    tempDir = makeTempDir();
    originalDbPath = process.env.HASNA_RECORDINGS_DB_PATH;
    originalAudioDir = process.env.RECORDINGS_AUDIO_DIR;
    originalClientStore = process.env.HASNA_RECORDINGS_CLIENT_STORE;
    process.env.HASNA_RECORDINGS_DB_PATH = join(tempDir, "test.db");
    process.env.RECORDINGS_AUDIO_DIR = join(tempDir, "audio");
    // The suite is hermetic by contract: the ambient hosted-store configuration
    // must not route these in-process calls to the hosted API, and the client
    // never falls back to the on-box store when no hosted env is configured —
    // local mode is declared EXPLICITLY via the store override. Restored in
    // afterEach.
    delete process.env.HASNA_RECORDINGS_API_URL;
    delete process.env.HASNA_RECORDINGS_API_KEY;
    process.env.HASNA_RECORDINGS_CLIENT_STORE = "sqlite";
  });

  afterEach(() => {
    closeDatabase();
    resetDatabase();
    __resetStore();
    __resetLocalArtifactStorage();
    if (originalDbPath === undefined) delete process.env.HASNA_RECORDINGS_DB_PATH;
    else process.env.HASNA_RECORDINGS_DB_PATH = originalDbPath;
    if (originalAudioDir === undefined) delete process.env.RECORDINGS_AUDIO_DIR;
    else process.env.RECORDINGS_AUDIO_DIR = originalAudioDir;
    if (originalClientStore === undefined) delete process.env.HASNA_RECORDINGS_CLIENT_STORE;
    else process.env.HASNA_RECORDINGS_CLIENT_STORE = originalClientStore;
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  test("with a bucket configured, the audio is uploaded at creation and the row is linked", async () => {
    const s3 = new FakeS3();
    __setLocalArtifactStorage(new AudioArtifactStorage({ bucket: "recordings-media", client: s3 }));
    const audioPath = join(tempDir, "part2b.m4a");
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(audioPath, AUDIO_BYTES);

    const recording = await getStore().createRecording({
      audio_path: audioPath,
      raw_text: "hello",
    });

    expect(recording.audio_object_key).toBe(`${DEFAULT_S3_PREFIX}/${recording.id}/${AUDIO_SHA256}.m4a`);
    expect(recording.audio_sha256).toBe(AUDIO_SHA256);
    expect(recording.audio_bytes).toBe(AUDIO_BYTES.byteLength);
    expect(s3.keys()).toEqual([recording.audio_object_key]);
    expect(sha256Hex(s3.objects.get(recording.audio_object_key!)!)).toBe(AUDIO_SHA256);

    // The linkage is durable: the row read back from the database carries it.
    const persisted = getRecording(recording.id);
    expect(persisted!.audio_object_key).toBe(recording.audio_object_key);
    expect(persisted!.audio_sha256).toBe(AUDIO_SHA256);
  });

  test("without a bucket the historical behaviour is untouched (no upload, no keys)", async () => {
    __setLocalArtifactStorage(new AudioArtifactStorage({}));
    const audioPath = join(tempDir, "clip.wav");
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(audioPath, AUDIO_BYTES);

    const recording = await getStore().createRecording({
      audio_path: audioPath,
      raw_text: "hello",
    });

    expect(recording.audio_path).toBe(audioPath);
    expect(recording.audio_object_key).toBeNull();
    expect(recording.audio_sha256).toBeNull();
    expect(recording.audio_bytes).toBeNull();
  });

  test("a storage outage fails softly: the recording is still created, local-only", async () => {
    __setLocalArtifactStorage(new AudioArtifactStorage({ bucket: "recordings-media", client: new FailingS3() }));
    const audioPath = join(tempDir, "clip.wav");
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(audioPath, AUDIO_BYTES);

    const recording = await getStore().createRecording({
      audio_path: audioPath,
      raw_text: "still saved",
    });

    expect(recording.id).toBeTruthy();
    expect(recording.raw_text).toBe("still saved");
    expect(recording.audio_path).toBe(audioPath);
    expect(recording.audio_object_key).toBeNull();
    expect(recording.audio_sha256).toBeNull();
    expect(recording.audio_bytes).toBeNull();
  });

  test("a recording without audio is created untouched even with a bucket configured", async () => {
    const s3 = new FakeS3();
    __setLocalArtifactStorage(new AudioArtifactStorage({ bucket: "recordings-media", client: s3 }));

    const recording = await getStore().createRecording({ raw_text: "text-only" });

    expect(recording.audio_path).toBeNull();
    expect(recording.audio_object_key).toBeNull();
    expect(s3.sent).toEqual([]);
  });
});