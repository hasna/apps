import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { S3Client, type S3ClientDependencies } from "../db/cloud/s3-client.js";
import { getSessionObject } from "../db/session-objects.js";
import { saveParsedSession } from "../db/sessions.js";
import {
  enqueueStoredSessionObjectIfConfigured,
  serializeStoredSessionContent,
} from "./session-content-object.js";
import { syncRetryableSessionObjects } from "./session-object-sync.js";

interface StoredObject {
  body: Buffer;
  contentType?: string;
}

class FakeObjectStore {
  readonly objects = new Map<string, StoredObject>();
  failUpload = false;
  headSizeOffset = 0;

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PutObjectCommand) {
      if (this.failUpload) throw new Error("fixture upload rejected");
      const { Key, Body, ContentType } = command.input;
      if (!Key || Body === undefined) throw new Error("missing fixture put input");
      this.objects.set(Key, {
        body: Buffer.from(Body as Uint8Array),
        contentType: ContentType,
      });
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      const object = this.objects.get(command.input.Key ?? "");
      if (!object) throw new Error("fixture object not found");
      return {
        ContentLength: object.body.byteLength + this.headSizeOffset,
        ContentType: object.contentType,
      };
    }
    throw new Error(`unexpected fixture command: ${String(command)}`);
  }
}

function fakeS3Client(store: FakeObjectStore): S3Client {
  const dependencies: S3ClientDependencies = {
    createClient: () => store,
    createUpload: ({ params }) => ({
      async done() {
        if (store.failUpload) throw new Error("fixture upload rejected");
        store.objects.set(params.Key, {
          body: Buffer.from(params.Body),
          contentType: params.ContentType,
        });
      },
    }),
  };
  return new S3Client(
    { bucket: "fixture-sessions", region: "fixture-region-1" },
    dependencies,
  );
}

const SESSION_ID = "session-object-sync-fixture";

describe("session object enqueue and sync", () => {
  beforeEach(() => {
    process.env.SESSIONS_DB_PATH = ":memory:";
    resetDatabase();
    saveParsedSession({
      session: {
        id: SESSION_ID,
        source: "codewith",
        source_id: SESSION_ID,
        machine: "station-fixture",
        title: "Fixture session",
      },
      messages: [
        {
          id: "fixture-message",
          session_id: SESSION_ID,
          role: "user",
          content: "fixture content",
        },
      ],
      toolCalls: [],
    });
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.SESSIONS_DB_PATH;
  });

  test("does not enqueue in local-only mode", () => {
    expect(enqueueStoredSessionObjectIfConfigured(SESSION_ID, {})).toBeNull();
    expect(getSessionObject(SESSION_ID, "normalized_content")).toBeNull();
  });

  test("enqueues a deterministic key with host and unresolved defaults", () => {
    const queued = enqueueStoredSessionObjectIfConfigured(SESSION_ID, {
      HASNA_SESSIONS_S3_BUCKET: "fixture-sessions",
      HASNA_SESSIONS_S3_REGION: "fixture-region-1",
      HASNA_SESSIONS_S3_PREFIX: "normalized",
    });
    const serialized = serializeStoredSessionContent(SESSION_ID);
    expect(queued).toMatchObject({
      source_digest: serialized.sourceDigest,
      size: serialized.size,
      status: "pending",
    });
    expect(queued?.object_key).toBe(
      `normalized/machine=station-fixture/sandbox=host/runtime=codewith/agent=unresolved/session=${SESSION_ID}/artifact=${serialized.sourceDigest}.json`,
    );
  });

  test("uploads, heads, and marks uploaded only after acknowledgement", async () => {
    const store = new FakeObjectStore();
    const queued = enqueueStoredSessionObjectIfConfigured(SESSION_ID, {
      HASNA_SESSIONS_S3_BUCKET: "fixture-sessions",
      HASNA_SESSIONS_S3_REGION: "fixture-region-1",
    });
    const result = await syncRetryableSessionObjects({
      objectStore: fakeS3Client(store),
      sessionId: SESSION_ID,
    });
    expect(result).toEqual({ attempted: 1, uploaded: 1, failed: 0, errors: [] });
    expect(getSessionObject(SESSION_ID, "normalized_content")).toMatchObject({
      status: "uploaded",
      last_error: null,
    });
    expect(store.objects.get(queued!.object_key)?.contentType).toBe("application/json");
  });

  test("marks a failed upload and retries it successfully", async () => {
    const store = new FakeObjectStore();
    const objectStore = fakeS3Client(store);
    enqueueStoredSessionObjectIfConfigured(SESSION_ID, {
      HASNA_SESSIONS_S3_BUCKET: "fixture-sessions",
      HASNA_SESSIONS_S3_REGION: "fixture-region-1",
    });
    store.failUpload = true;
    const failed = await syncRetryableSessionObjects({ objectStore, sessionId: SESSION_ID });
    expect(failed).toMatchObject({ attempted: 1, uploaded: 0, failed: 1 });
    expect(getSessionObject(SESSION_ID, "normalized_content")).toMatchObject({
      status: "failed",
      last_error: "fixture upload rejected",
    });

    store.failUpload = false;
    const retried = await syncRetryableSessionObjects({ objectStore, sessionId: SESSION_ID });
    expect(retried).toEqual({ attempted: 1, uploaded: 1, failed: 0, errors: [] });
    expect(getSessionObject(SESSION_ID, "normalized_content")?.status).toBe("uploaded");
  });

  test("treats a mismatched HEAD size as a failed acknowledgement", async () => {
    const store = new FakeObjectStore();
    store.headSizeOffset = 1;
    enqueueStoredSessionObjectIfConfigured(SESSION_ID, {
      HASNA_SESSIONS_S3_BUCKET: "fixture-sessions",
      HASNA_SESSIONS_S3_REGION: "fixture-region-1",
    });
    const result = await syncRetryableSessionObjects({
      objectStore: fakeS3Client(store),
      sessionId: SESSION_ID,
    });
    expect(result).toMatchObject({ attempted: 1, uploaded: 0, failed: 1 });
    expect(getSessionObject(SESSION_ID, "normalized_content")).toMatchObject({
      status: "failed",
    });
    expect(getSessionObject(SESSION_ID, "normalized_content")?.last_error).toContain(
      "acknowledgement size mismatch",
    );
  });
});
