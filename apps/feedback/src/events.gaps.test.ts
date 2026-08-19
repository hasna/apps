// Sol-guided coverage — Priority 5: event builders and the default sink.
//
// summarize behavior (first line, 140-char truncation with ellipsis) is pinned
// through the created-event payload; the default sink is proven by emitting
// through a temporary HASNA_EVENTS_DIR and reading the stored events file.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFeedbackCreatedEvent,
  buildFeedbackTriagedEvent,
  createDefaultFeedbackEventSink,
} from "./events.js";
import type { FeedbackItem } from "./types.js";

function item(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "fb-events-1",
    appId: "app-a",
    message: "first line\nsecond line",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    status: "new",
    source: "sdk",
    kind: "bug",
    tags: ["export"],
    ...overrides,
  };
}

describe("feedback event builders — summarize and triagedBy", () => {
  test("the created-event summary takes the first line only", () => {
    const event = buildFeedbackCreatedEvent(item());
    const data = event.data as { summary: string; feedbackId: string };
    expect(data.summary).toBe("first line");
    expect(data.feedbackId).toBe("fb-events-1");
  });

  test("a first line longer than 140 characters truncates to 140 with an ellipsis", () => {
    const long = "x".repeat(200);
    const event = buildFeedbackCreatedEvent(item({ message: long }));
    const summary = (event.data as { summary: string }).summary;
    expect(summary).toHaveLength(140);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.slice(0, -1)).toBe("x".repeat(139));

    const boundary = "y".repeat(140);
    const atBoundary = buildFeedbackCreatedEvent(item({ message: boundary }));
    expect((atBoundary.data as { summary: string }).summary).toBe(boundary);
  });

  test("the triaged event carries triagedBy when given and omits it otherwise", () => {
    const withBy = buildFeedbackTriagedEvent(item({ status: "shipped", changelogRef: "CH-7" }), "shipped", { triagedBy: "agent-fable" });
    expect((withBy.data as { triagedBy?: string; changelogRef?: string }).triagedBy).toBe("agent-fable");
    expect((withBy.data as { changelogRef?: string }).changelogRef).toBe("CH-7");

    const withoutBy = buildFeedbackTriagedEvent(item(), "triaged");
    expect((withoutBy.data as { triagedBy?: string }).triagedBy).toBeUndefined();
    expect((withoutBy.data as { disposition: string }).disposition).toBe("triaged");
  });
});

describe("default feedback event sink", () => {
  test("emits through a temporary HASNA_EVENTS_DIR and persists the envelope", async () => {
    const eventsDir = mkdtempSync(join(tmpdir(), "feedback-events-sink-"));
    const sink = createDefaultFeedbackEventSink(eventsDir);
    await sink(buildFeedbackCreatedEvent(item()));

    const stored = await readFile(join(eventsDir, "events.json"), "utf8");
    expect(stored).toContain("fb-events-1");
    expect(stored).toContain("feedback.created");
    const parsed = JSON.parse(stored) as Array<{ type: string; data: { feedbackId: string } }>;
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0]!.type).toBe("feedback.created");
    expect(parsed[0]!.data.feedbackId).toBe("fb-events-1");
  });
});
