import { describe, expect, test } from "bun:test";
import { buildObjectKey, type BuildObjectKeyInput } from "./object-key.js";

describe("buildObjectKey", () => {
  test("builds every label for a provider sandbox", () => {
    expect(
      buildObjectKey({
        machineId: "station-01",
        sandbox: { provider: "e2b", allocationId: "alloc-42" },
        source: "codewith",
        agent: "worker-one",
        sessionId: "session-123",
        sha256: "abc123",
        ext: "jsonl",
      })
    ).toBe(
      "machine=station-01/sandbox=e2b:alloc-42/runtime=codewith/agent=worker-one/session=session-123/artifact=abc123.jsonl"
    );
  });

  test("uses host and unresolved defaults", () => {
    expect(
      buildObjectKey({
        machineId: "station-02",
        source: "claude",
        sessionId: "session-456",
        sha256: "def456",
        ext: ".json",
      })
    ).toBe(
      "machine=station-02/sandbox=host/runtime=claude/agent=unresolved/session=session-456/artifact=def456.json"
    );
  });

  test("is deterministic for identical input", () => {
    const input: BuildObjectKeyInput = {
      machineId: "machine-a",
      sandbox: { provider: "provider", allocationId: "allocation" },
      source: "codex",
      agent: "reviewer",
      sessionId: "session-a",
      sha256: "feedface",
      ext: "txt",
    };

    expect(buildObjectKey(input)).toBe(buildObjectKey(input));
  });

  test("normalizes blank agent values to unresolved", () => {
    expect(
      buildObjectKey({
        machineId: "station-03",
        source: "codex",
        agent: "   ",
        sessionId: "session-789",
        sha256: "abc",
        ext: "jsonl",
      })
    ).toBe(
      "machine=station-03/sandbox=host/runtime=codex/agent=unresolved/session=session-789/artifact=abc.jsonl"
    );

    expect(
      buildObjectKey({
        machineId: "station-03",
        source: "codex",
        agent: "",
        sessionId: "session-789",
        sha256: "abc",
        ext: "jsonl",
      })
    ).toBe(
      "machine=station-03/sandbox=host/runtime=codex/agent=unresolved/session=session-789/artifact=abc.jsonl"
    );
  });
});
