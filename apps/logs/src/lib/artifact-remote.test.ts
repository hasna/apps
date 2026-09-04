import { describe, expect, it } from "bun:test";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { ArtifactRemote, type S3ClientLike } from "./artifact-remote.ts";

class RecordingS3 implements S3ClientLike {
  sent: PutObjectCommand[] = [];
  fail = false;

  async send(command: PutObjectCommand): Promise<unknown> {
    if (this.fail) throw new Error("simulated s3 outage");
    this.sent.push(command);
    return {};
  }
}

const BYTES = new TextEncoder().encode("console.log('built');\n");
const DIGEST = createHash("sha256").update(BYTES).digest("hex");

describe("ArtifactRemote", () => {
  it("records a content-addressed object and returns its key when a bucket is configured", async () => {
    const s3 = new RecordingS3();
    const remote = new ArtifactRemote({
      bucket: "logs-artifacts-test",
      prefix: "artifacts",
      client: s3,
      logger: () => {},
    });

    const key = await remote.uploadBytes("run_1", DIGEST, BYTES);

    expect(remote.enabled).toBe(true);
    expect(key).toBe(`artifacts/run_1/${DIGEST}`);
    expect(s3.sent).toHaveLength(1);
    expect(s3.sent[0]?.input).toMatchObject({
      Bucket: "logs-artifacts-test",
      Key: `artifacts/run_1/${DIGEST}`,
      Body: BYTES,
      ContentType: "application/octet-stream",
    });
  });

  it("supports a custom prefix and content type", async () => {
    const s3 = new RecordingS3();
    const remote = new ArtifactRemote({
      bucket: "logs-artifacts-test",
      prefix: "prod/artifacts",
      client: s3,
      logger: () => {},
    });

    const key = await remote.uploadBytes("run_1", DIGEST, BYTES, "application/json");

    expect(key).toBe(`prod/artifacts/run_1/${DIGEST}`);
    expect(s3.sent[0]?.input.ContentType).toBe("application/json");
  });

  it("falls back to local-only recording when no bucket is configured", async () => {
    const s3 = new RecordingS3();
    const remote = new ArtifactRemote({ client: s3, logger: () => {} });

    expect(remote.enabled).toBe(false);
    const key = await remote.uploadBytes("run_1", DIGEST, BYTES);
    expect(key).toBeNull();
    expect(s3.sent).toHaveLength(0);
  });

  it("refuses digests that are not lowercase hex sha-256", async () => {
    const s3 = new RecordingS3();
    const remote = new ArtifactRemote({
      bucket: "logs-artifacts-test",
      client: s3,
      logger: () => {},
    });

    for (const bad of ["not-a-digest", DIGEST.toUpperCase(), ""]) {
      expect(await remote.uploadBytes("run_1", bad, BYTES)).toBeNull();
    }
    expect(s3.sent).toHaveLength(0);
  });

  it("soft-fails: an upload error returns null and logs instead of throwing", async () => {
    const s3 = new RecordingS3();
    s3.fail = true;
    const logged: string[] = [];
    const remote = new ArtifactRemote({
      bucket: "logs-artifacts-test",
      client: s3,
      logger: (message) => logged.push(message),
    });

    await expect(remote.uploadBytes("run_1", DIGEST, BYTES)).resolves.toBeNull();
    expect(logged.join(" ")).toContain("upload failed");
    expect(logged.join(" ")).toContain(`run_1/${DIGEST}`);
  });
});