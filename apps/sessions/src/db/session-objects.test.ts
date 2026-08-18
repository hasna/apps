import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "./database.js";
import { saveParsedSession } from "./sessions.js";
import {
  enqueueSessionObject,
  getSessionObject,
  listRetryableSessionObjects,
  markSessionObjectFailed,
  markSessionObjectUploaded,
} from "./session-objects.js";

const SESSION_ID = "session-object-state-fixture";

describe("session_objects state", () => {
  beforeEach(() => {
    process.env.SESSIONS_DB_PATH = ":memory:";
    resetDatabase();
    saveParsedSession({
      session: {
        id: SESSION_ID,
        source: "codewith",
        source_id: SESSION_ID,
        machine: "station-fixture",
      },
      messages: [],
      toolCalls: [],
    });
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.SESSIONS_DB_PATH;
  });

  test("moves a pending row to uploaded only for the expected digest", () => {
    const pending = enqueueSessionObject({
      session_id: SESSION_ID,
      object_kind: "normalized_content",
      object_key: "fixture/pending.json",
      source_digest: "digest-one",
      size: 42,
    });
    expect(pending.status).toBe("pending");
    expect(markSessionObjectUploaded(SESSION_ID, "normalized_content", "wrong")).toBe(false);
    expect(markSessionObjectUploaded(SESSION_ID, "normalized_content", "digest-one")).toBe(true);
    expect(getSessionObject(SESSION_ID, "normalized_content")).toMatchObject({
      status: "uploaded",
      last_error: null,
    });
    expect(
      markSessionObjectFailed(
        SESSION_ID,
        "normalized_content",
        "digest-one",
        "late failure from another worker",
      ),
    ).toBe(false);
    expect(getSessionObject(SESSION_ID, "normalized_content")?.status).toBe("uploaded");
    expect(listRetryableSessionObjects()).toEqual([]);
  });

  test("moves pending to failed and keeps failed rows retryable", () => {
    enqueueSessionObject({
      session_id: SESSION_ID,
      object_kind: "normalized_content",
      object_key: "fixture/failure.json",
      source_digest: "digest-two",
      size: 24,
    });
    expect(
      markSessionObjectFailed(
        SESSION_ID,
        "normalized_content",
        "digest-two",
        "fixture upload failure",
      ),
    ).toBe(true);
    expect(getSessionObject(SESSION_ID, "normalized_content")).toMatchObject({
      status: "failed",
      last_error: "fixture upload failure",
    });
    expect(listRetryableSessionObjects()).toHaveLength(1);
  });

  test("re-enqueueing changed content resets failed state to pending", () => {
    enqueueSessionObject({
      session_id: SESSION_ID,
      object_kind: "normalized_content",
      object_key: "fixture/old.json",
      source_digest: "old-digest",
      size: 10,
    });
    markSessionObjectFailed(
      SESSION_ID,
      "normalized_content",
      "old-digest",
      "fixture failure",
    );

    const retried = enqueueSessionObject({
      session_id: SESSION_ID,
      object_kind: "normalized_content",
      object_key: "fixture/new.json",
      source_digest: "new-digest",
      size: 20,
    });
    expect(retried).toMatchObject({
      object_key: "fixture/new.json",
      source_digest: "new-digest",
      size: 20,
      status: "pending",
      last_error: null,
    });
  });
});
