import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FEEDBACK_EVENT_TYPES,
  buildFeedbackCreatedEvent,
  buildFeedbackTriagedEvent,
  emitFeedbackEvent,
} from "./events.js";
import type { FeedbackEventEnvelope } from "./events.js";
import { LocalFeedbackStore } from "./storage.js";

function tempStore(sink: FeedbackEventEnvelope[] | null): LocalFeedbackStore {
  return new LocalFeedbackStore({
    filePath: join(mkdtempSync(join(tmpdir(), "feedback-events-")), "feedback.jsonl"),
    eventSink: sink === null ? null : async (event) => void sink.push(event),
  });
}

describe("feedback event builders", () => {
  it("builds a feedback.created envelope mirroring FeedbackCreatedData", async () => {
    const store = tempStore(null);
    const item = await store.createFeedback({ appId: "open-todos", message: "Sync is broken", severity: "high" });
    const event = buildFeedbackCreatedEvent(item);
    expect(event.type).toBe(FEEDBACK_EVENT_TYPES.feedbackCreated);
    expect(event.source).toBe("hasna.feedback");
    expect(event.subject).toBe(item.id);
    expect(event.data.feedbackId).toBe(item.id);
    expect(event.data.appId).toBe("open-todos");
    expect(event.data.summary).toBe("Sync is broken");
    expect(event.data.severity).toBe("high");
    expect(event.metadata.contractSchema).toBe("hasna.feedback.v1");
    expect(event.dedupeKey).toBe(`feedback.created:${item.id}`);
  });

  it("builds a feedback.triaged envelope with disposition and changelogRef", async () => {
    const store = tempStore(null);
    const item = await store.createFeedback({ appId: "open-todos", message: "Add dark mode" });
    const shipped = await store.markFeedbackShipped(item.id, "open-todos@1.2.3");
    const event = buildFeedbackTriagedEvent(shipped!, "shipped");
    expect(event.type).toBe(FEEDBACK_EVENT_TYPES.feedbackTriaged);
    expect(event.data.disposition).toBe("shipped");
    expect(event.data.changelogRef).toBe("open-todos@1.2.3");
  });
});

describe("event emission on store paths", () => {
  it("emits feedback.created on create", async () => {
    const events: FeedbackEventEnvelope[] = [];
    const store = tempStore(events);
    const item = await store.createFeedback({ appId: "open-todos", message: "hello" });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("feedback.created");
    expect(events[0]!.data.feedbackId).toBe(item.id);
  });

  it("emits feedback.triaged when status moves to triaged/closed but not new", async () => {
    const events: FeedbackEventEnvelope[] = [];
    const store = tempStore(events);
    const item = await store.createFeedback({ appId: "open-todos", message: "hello" });
    events.length = 0;

    await store.updateFeedbackStatus(item.id, "triaged");
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("feedback.triaged");
    expect((events[0]!.data as { disposition: string }).disposition).toBe("triaged");

    await store.updateFeedbackStatus(item.id, "new");
    expect(events).toHaveLength(1);

    await store.updateFeedbackStatus(item.id, "closed");
    expect(events).toHaveLength(2);
    expect((events[1]!.data as { disposition: string }).disposition).toBe("closed");
  });

  it("feedback shipped marks linkage and emits the notification event", async () => {
    const events: FeedbackEventEnvelope[] = [];
    const store = tempStore(events);
    const item = await store.createFeedback({ appId: "open-todos", message: "please ship" });
    events.length = 0;

    const shipped = await store.markFeedbackShipped(item.id, "https://example.com/changelog#1.2.3");
    expect(shipped!.status).toBe("shipped");
    expect(shipped!.changelogRef).toBe("https://example.com/changelog#1.2.3");
    expect(shipped!.shippedAt).toBeTruthy();

    expect(events).toHaveLength(1);
    const data = events[0]!.data as { disposition: string; changelogRef?: string };
    expect(events[0]!.type).toBe("feedback.triaged");
    expect(data.disposition).toBe("shipped");
    expect(data.changelogRef).toBe("https://example.com/changelog#1.2.3");

    // Persisted linkage round-trips through the store.
    const reloaded = await store.getFeedback(item.id);
    expect(reloaded!.changelogRef).toBe("https://example.com/changelog#1.2.3");
    expect(reloaded!.status).toBe("shipped");
  });

  it("returns null when shipping unknown feedback and requires a changelog ref", async () => {
    const events: FeedbackEventEnvelope[] = [];
    const store = tempStore(events);
    expect(await store.markFeedbackShipped("missing", "ref")).toBeNull();
    expect(events).toHaveLength(0);
    const item = await store.createFeedback({ appId: "open-todos", message: "x" });
    await expect(store.markFeedbackShipped(item.id, "  ")).rejects.toThrow(/changelogRef/);
  });

  it("event sink failures never break the create path", async () => {
    const store = new LocalFeedbackStore({
      filePath: join(mkdtempSync(join(tmpdir(), "feedback-events-")), "feedback.jsonl"),
      eventSink: async () => {
        throw new Error("sink down");
      },
    });
    const item = await store.createFeedback({ appId: "open-todos", message: "still works" });
    expect(item.id).toBeTruthy();
  });

  it("emitFeedbackEvent swallows sink errors", async () => {
    const store = tempStore(null);
    const item = await store.createFeedback({ appId: "open-todos", message: "x" });
    await expect(
      emitFeedbackEvent(buildFeedbackCreatedEvent(item), async () => {
        throw new Error("boom");
      }),
    ).resolves.toBeUndefined();
  });
});
