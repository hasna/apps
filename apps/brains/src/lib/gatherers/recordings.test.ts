// agent-authored (no SOL consult available)

import { describe, expect, test, mock } from "bun:test";
import { gatherFromRecordings } from "./recordings.js";

// Per-test SDK fixture state, read at call time by the mocked module.
const sdkState: { recordings: unknown[]; throwOnList?: boolean } = { recordings: [] };

const longTranscript = "word ".repeat(3000).trim(); // 5999 characters

describe("gatherFromRecordings", () => {
  test("returns an empty result when the SDK package is not installed", async () => {
    mock.module("@hasna/recordings", () => {
      throw new Error("module not found");
    });
    const result = await gatherFromRecordings();
    expect(result.source).toBe("recordings");
    expect(result.examples).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("recordings without a transcription produce no examples", async () => {
    mock.module("@hasna/recordings", () => ({
      listRecordings: async () => {
        if (sdkState.throwOnList) throw new Error("boom");
        return sdkState.recordings;
      },
    }));
    sdkState.throwOnList = false;
    sdkState.recordings = [
      { id: "r1", fileName: "no-transcript.mp3" },
      { id: "r2", transcription: null },
    ];

    const result = await gatherFromRecordings();
    expect(result.count).toBe(0);
  });

  test("a transcribed recording yields a summary example and a search example", async () => {
    sdkState.recordings = [
      { id: "r1", fileName: "meeting.mp3", transcription: "alpha beta gamma delta", createdAt: 1750000000000 },
    ];

    const result = await gatherFromRecordings();
    expect(result.count).toBe(2);

    const summary = result.examples[0]!;
    expect(summary.messages[0]?.content).toContain("voice-aware");
    expect(summary.messages[1]?.content).toBe('Summarize the recording "meeting.mp3"');
    expect(summary.messages[2]?.content).toBe("alpha beta gamma delta");

    const search = result.examples[1]!;
    expect(search.messages[1]?.content).toBe('Find recordings mentioning "alpha beta gamma"');
    expect(search.messages[2]?.content).toContain('Found recording: "meeting.mp3"');
  });

  test("transcript is truncated to 2000 characters for the summary example", async () => {
    sdkState.recordings = [
      { id: "r1", name: "long.m4a", transcription: longTranscript },
    ];

    const result = await gatherFromRecordings();
    expect(result.count).toBe(2);
    const summary = result.examples[0]!;
    expect(summary.messages[2]?.content).toHaveLength(2000);
  });

  test("search example uses the first three words of the transcript", async () => {
    sdkState.recordings = [
      { id: "r1", fileName: "f.m4a", transcription: "one two three four five" },
    ];

    const result = await gatherFromRecordings();
    const search = result.examples[1]!;
    expect(search.messages[1]?.content).toBe('Find recordings mentioning "one two three"');
  });

  test("respects the limit on the combined example list", async () => {
    sdkState.recordings = [
      { id: "r1", fileName: "a.m4a", transcription: "one two three" },
      { id: "r2", fileName: "b.m4a", transcription: "four five six" },
    ];

    const result = await gatherFromRecordings({ limit: 2 });
    // 2 recordings → 4 examples before slicing → 2 after
    expect(result.count).toBe(2);
  });

  test("a throwing listRecordings degrades to an empty result", async () => {
    sdkState.throwOnList = true;
    const result = await gatherFromRecordings();
    expect(result.source).toBe("recordings");
    expect(result.count).toBe(0);
  });
});
