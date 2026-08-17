import { describe, expect, test } from "bun:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3ClientConfig as AwsS3ClientConfig,
} from "@aws-sdk/client-s3";
import { S3Client, type S3ClientDependencies } from "./s3-client.js";

interface StoredObject {
  body: Buffer;
  contentType?: string;
}

class FakeObjectStore {
  readonly objects = new Map<string, StoredObject>();

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PutObjectCommand) {
      const { Key, Body, ContentType } = command.input;
      if (!Key || Body === undefined) throw new Error("missing put input");
      this.objects.set(Key, {
        body: Buffer.from(Body as Uint8Array),
        contentType: ContentType,
      });
      return {};
    }

    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(command.input.Key ?? "");
      if (!object) throw new Error("not found");
      return {
        Body: {
          async transformToByteArray() {
            return new Uint8Array(object.body);
          },
        },
      };
    }

    if (command instanceof HeadObjectCommand) {
      const object = this.objects.get(command.input.Key ?? "");
      if (!object) throw new Error("not found");
      return {
        ContentLength: object.body.byteLength,
        ContentType: object.contentType,
      };
    }

    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(command.input.Key ?? "");
      return {};
    }

    throw new Error(`unexpected command: ${String(command)}`);
  }
}

function testDependencies(store: FakeObjectStore): S3ClientDependencies {
  return {
    createClient: () => store,
    createUpload: ({ params }) => ({
      async done() {
        store.objects.set(params.Key, {
          body: Buffer.from(params.Body),
          contentType: params.ContentType,
        });
      },
    }),
    presign: async (_client, command, expiresIn) => {
      const operation = command instanceof GetObjectCommand ? "get" : "put";
      const key = command.input.Key ?? "";
      const contentType = command instanceof PutObjectCommand
        ? `&contentType=${command.input.ContentType ?? ""}`
        : "";
      return `https://signed.invalid/${operation}/${key}?expiresIn=${expiresIn}${contentType}`;
    },
  };
}

describe("S3Client", () => {
  test("uploads, downloads, heads, and deletes an object", async () => {
    const store = new FakeObjectStore();
    const client = new S3Client(
      { bucket: "sessions", region: "eu-central-1" },
      testDependencies(store)
    );
    const body = Buffer.from("session transcript");

    await client.upload("small.jsonl", body, "application/x-ndjson");
    expect(await client.download("small.jsonl")).toEqual(body);
    expect(await client.head("small.jsonl")).toEqual({
      contentLength: body.byteLength,
      contentType: "application/x-ndjson",
    });

    await client.delete("small.jsonl");
    expect(store.objects.has("small.jsonl")).toBe(false);
    await expect(client.download("small.jsonl")).rejects.toThrow("not found");
  });

  test("uses a managed upload for large bodies", async () => {
    const store = new FakeObjectStore();
    const client = new S3Client(
      { bucket: "sessions", region: "eu-central-1" },
      testDependencies(store)
    );
    const body = Buffer.alloc(5 * 1024 * 1024 + 1, 7);

    await client.upload("large.bin", body, "application/octet-stream");

    expect(await client.download("large.bin")).toEqual(body);
  });

  test("presigns downloads and uploads", async () => {
    const store = new FakeObjectStore();
    const client = new S3Client(
      { bucket: "sessions", region: "eu-central-1" },
      testDependencies(store)
    );

    await expect(client.presign("read.json", 60)).resolves.toBe(
      "https://signed.invalid/get/read.json?expiresIn=60"
    );
    await expect(client.presignPut("write.json", "application/json", 120)).resolves.toBe(
      "https://signed.invalid/put/write.json?expiresIn=120&contentType=application/json"
    );
  });

  test("constructs a client without explicit credentials", () => {
    const store = new FakeObjectStore();
    let capturedConfig: AwsS3ClientConfig | undefined;

    new S3Client(
      {
        bucket: "sessions",
        region: "eu-central-1",
        endpoint: "http://object-store.invalid",
      },
      {
        createClient(config) {
          capturedConfig = config;
          return store;
        },
      }
    );

    expect(capturedConfig).toEqual({
      region: "eu-central-1",
      endpoint: "http://object-store.invalid",
      forcePathStyle: true,
    });
    expect(capturedConfig && "credentials" in capturedConfig).toBe(false);
  });
});
