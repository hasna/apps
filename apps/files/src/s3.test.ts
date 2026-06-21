import { describe, expect, test } from "bun:test";
import { createS3ObjectStore, isMissingS3ObjectError, s3BodyToBuffer } from "./s3.js";
import type { S3Client } from "@aws-sdk/client-s3";

class FakeS3Client {
  readonly commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  readonly objects = new Map<
    string,
    { body: Buffer; contentType?: string; lastModified: Date }
  >();

  async send(command: { input: Record<string, unknown>; constructor: { name: string } }) {
    this.commands.push({
      name: command.constructor.name,
      input: command.input,
    });
    const key = String(command.input.Key ?? "");

    if (command.constructor.name === "PutObjectCommand") {
      this.objects.set(key, {
        body: Buffer.from(command.input.Body as Uint8Array),
        contentType:
          typeof command.input.ContentType === "string"
            ? command.input.ContentType
            : undefined,
        lastModified: new Date("2026-01-02T03:04:05.000Z"),
      });
      return {};
    }

    if (command.constructor.name === "GetObjectCommand") {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      return {
        Body: {
          transformToByteArray: async () => Uint8Array.from(object.body),
        },
        ContentLength: object.body.byteLength,
        ContentType: object.contentType,
        LastModified: object.lastModified,
      };
    }

    if (command.constructor.name === "HeadObjectCommand") {
      const object = this.objects.get(key);
      if (!object) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      return {
        ContentLength: object.body.byteLength,
        ContentType: object.contentType,
        LastModified: object.lastModified,
      };
    }

    if (command.constructor.name === "DeleteObjectCommand") {
      this.objects.delete(key);
      return {};
    }

    if (command.constructor.name === "ListObjectsV2Command") {
      const prefix = String(command.input.Prefix ?? "");
      return {
        Contents: Array.from(this.objects.entries())
          .filter(([objectKey]) => objectKey.startsWith(prefix))
          .map(([objectKey, object]) => ({
            Key: objectKey,
            Size: object.body.byteLength,
            LastModified: object.lastModified,
          })),
        IsTruncated: false,
      };
    }

    throw new Error(`Unexpected command ${command.constructor.name}`);
  }
}

describe("SDK-safe S3 object store", () => {
  test("wraps core object operations without app-owned storage policy", async () => {
    const client = new FakeS3Client();
    const store = createS3ObjectStore({ client: client as unknown as S3Client });

    await store.putObject({
      bucket: "bucket",
      key: "orgs/org-1/files/report.txt",
      body: Buffer.from("hello"),
      contentType: "text/plain",
    });

    expect(await store.objectExists({ bucket: "bucket", key: "orgs/org-1/files/report.txt" })).toBe(true);
    await expect(
      store.getObjectBodyBuffer({ bucket: "bucket", key: "orgs/org-1/files/report.txt" }),
    ).resolves.toEqual(Buffer.from("hello"));
    await expect(store.listObjects({ bucket: "bucket", prefix: "orgs/org-1/" })).resolves.toEqual([
      {
        key: "orgs/org-1/files/report.txt",
        size: 5,
        lastModified: new Date("2026-01-02T03:04:05.000Z"),
      },
    ]);

    await store.deleteObject({ bucket: "bucket", key: "orgs/org-1/files/report.txt" });
    expect(await store.objectExists({ bucket: "bucket", key: "orgs/org-1/files/report.txt" })).toBe(false);
  });

  test("presigns download and upload commands through an injected signer", async () => {
    const client = new FakeS3Client();
    const store = createS3ObjectStore({
      client: client as unknown as S3Client,
      signer: async (_client, command, options) =>
        `signed:${command.constructor.name}:${command.input.Key}:${options.expiresIn}:${Array.from(options.signableHeaders ?? []).join(",")}`,
    });

    await expect(
      store.getSignedDownloadUrl({
        bucket: "bucket",
        key: "orgs/org-1/files/report.txt",
        expiresInSeconds: 120,
      }),
    ).resolves.toBe("signed:GetObjectCommand:orgs/org-1/files/report.txt:120:");

    await expect(
      store.getSignedUploadUrl({
        bucket: "bucket",
        key: "orgs/org-1/files/report.txt",
        contentType: "text/plain",
        contentLength: 5,
        expiresInSeconds: 60,
        signableHeaders: new Set(["content-type", "content-length"]),
      }),
    ).resolves.toBe(
      "signed:PutObjectCommand:orgs/org-1/files/report.txt:60:content-type,content-length",
    );
  });

  test("normalizes AWS body variants and missing-object errors", async () => {
    await expect(s3BodyToBuffer("hello")).resolves.toEqual(Buffer.from("hello"));
    await expect(
      s3BodyToBuffer({
        transformToByteArray: async () => Uint8Array.from(Buffer.from("bytes")),
      }),
    ).resolves.toEqual(Buffer.from("bytes"));

    expect(isMissingS3ObjectError({ name: "NoSuchKey" })).toBe(true);
    expect(isMissingS3ObjectError({ $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(isMissingS3ObjectError({ name: "AccessDenied" })).toBe(false);
  });
});
