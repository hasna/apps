// agent-authored (no SOL consult available)

import { describe, expect, test, mock } from "bun:test";
import { gatherFromAssistants } from "./assistants.js";

// Per-test SDK fixture state, read at call time by the mocked module.
const sdkState: { sessions: unknown[]; throwOnList?: boolean } = { sessions: [] };

describe("gatherFromAssistants", () => {
  test("returns an empty result when the SDK package is not installed", async () => {
    mock.module("@hasna/assistants", () => {
      throw new Error("module not found");
    });
    const result = await gatherFromAssistants();
    expect(result.source).toBe("assistants");
    expect(result.examples).toEqual([]);
    expect(result.count).toBe(0);
  });

  test("builds multi-turn examples from listSessions", async () => {
    mock.module("@hasna/assistants", () => ({
      listSessions: async () => {
        if (sdkState.throwOnList) throw new Error("boom");
        return sdkState.sessions;
      },
    }));
    sdkState.throwOnList = false;
    sdkState.sessions = [
      {
        messages: [
          { role: "system", content: "ignored" },
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi there" },
        ],
      },
      {
        messages: [{ role: "user", content: "only one turn" }],
      },
      {
        messages: [
          { role: "user", content: "q1" },
          { role: "assistant", content: "a1" },
          { role: "user", content: "q2" },
          { role: "assistant", content: "a2" },
        ],
      },
    ];

    const result = await gatherFromAssistants({ limit: 100 });
    // Session 2 has fewer than 2 user/assistant turns and is skipped
    expect(result.count).toBe(2);

    const first = result.examples[0]!;
    expect(first.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(first.messages[0]?.content).toContain("personal AI assistant");
    expect(first.messages[1]?.content).toBe("hello");
    expect(first.messages[2]?.content).toBe("hi there");

    // Non user/assistant roles are filtered out before slicing to 6 turns
    const third = result.examples[1]!;
    expect(third.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user", "assistant"]);
  });

  test("caps sessions at floor(limit / 2) and examples at limit", async () => {
    sdkState.sessions = Array.from({ length: 10 }, (_, i) => ({
      messages: [
        { role: "user", content: `q${i}` },
        { role: "assistant", content: `a${i}` },
      ],
    }));

    const result = await gatherFromAssistants({ limit: 4 });
    // floor(4 / 2) = 2 sessions → 2 examples
    expect(result.count).toBe(2);
    expect(result.examples[0]?.messages[1]?.content).toBe("q0");
    expect(result.examples[1]?.messages[1]?.content).toBe("q1");
  });

  test("non-string content is stringified", async () => {
    sdkState.sessions = [
      {
        messages: [
          { role: "user", content: { note: "obj" } },
          { role: "assistant", content: 42 },
        ],
      },
    ];

    const result = await gatherFromAssistants();
    expect(result.count).toBe(1);
    expect(result.examples[0]?.messages[1]?.content).toBe("[object Object]");
    expect(result.examples[0]?.messages[2]?.content).toBe("42");
  });

  test("a throwing listSessions degrades to an empty result", async () => {
    sdkState.throwOnList = true;
    const result = await gatherFromAssistants();
    expect(result.source).toBe("assistants");
    expect(result.count).toBe(0);
  });
});
