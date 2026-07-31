import { describe, expect, test } from "bun:test";

import {
  getTodosCliCommandCapabilityMatrix,
  initializeTodosCliAuthority,
} from "./stage-a.js";

const REMOTE_ENV = {
  HASNA_TODOS_STORAGE_MODE: "remote",
  HASNA_TODOS_API_URL: "https://authority.invalid",
  HASNA_TODOS_API_KEY: "fixture-remote-key",
};

function initFailure(args: string[]): string {
  try {
    initializeTodosCliAuthority(args, REMOTE_ENV);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected ${JSON.stringify(args)} to be rejected, but it was accepted`);
}

/**
 * Regression for the reported defect: `todos complete <id>` failed with
 * `REMOTE_COMMAND_UNSUPPORTED: ... is not supported by the Todos /v1 CLI;
 * local SQLite fallback is disabled`.
 *
 * Both clauses of that message are false for a verb that does not exist. The
 * verb is unsupported everywhere, not on this transport, and no SQLite
 * fallback would accept it either. Agents therefore debugged their connection,
 * their storage mode, and their credentials rather than their command.
 *
 * Three distinct conditions previously produced one identical string:
 *   1. the verb is not in the registry at all    (`complete`, `register`)
 *   2. the verb exists but is local-only         (`sprint`)
 *   3. the verb is remote-capable, the flag is not (`list --recurring`)
 *
 * Only (2) is what the message asserted.
 */
describe("stage-a rejection messages distinguish why an invocation was refused", () => {
  test("`complete` and `register` are accepted as aliases of the real verbs", () => {
    // The fleet's MCP surface names these operations `complete_task` and
    // `register_agent`, and the rules corpus instructs agents to use them, so
    // the CLI accepts the same words rather than rejecting its own vocabulary.
    expect(() => initializeTodosCliAuthority(["complete", "abcd1234"], REMOTE_ENV)).not.toThrow();
    expect(() => initializeTodosCliAuthority(["register", "fixture-agent"], REMOTE_ENV)).not.toThrow();

    const matrix = getTodosCliCommandCapabilityMatrix();
    expect(matrix.get("complete")).toBe("remote-http");
    expect(matrix.get("register")).toBe("remote-http");
    // Control: the canonical verbs they alias are routed the same way.
    expect(matrix.get("done")).toBe("remote-http");
    expect(matrix.get("init")).toBe("remote-http");
  });

  test("an owner-less verb is not asserted to be nonexistent", () => {
    // `channels` is contributed at runtime by the optional
    // `@hasna/events/commander` package, so Stage A cannot see it in the
    // static registry. It must NOT be told it is not a todos command -- that
    // would be a worse falsehood than the message this fix removes. The claim
    // is scoped to the route instead.
    const message = initFailure(["channels"]);
    expect(message).toContain("UNKNOWN_COMMAND");
    expect(message).not.toContain("is not a todos command");
    expect(message).toContain("/v1 route");
    expect(message).toContain("optional packages");
  });

  test("an unknown verb is reported as unknown, not as a transport limitation", () => {
    const message = initFailure(["zzzznotacommand", "abcd1234"]);

    expect(message).toContain("UNKNOWN_COMMAND");
    expect(message).toContain("zzzznotacommand");
    // The two false clauses must not appear: nothing about this verb is
    // specific to /v1, and enabling a SQLite fallback would not accept it.
    expect(message).not.toContain("REMOTE_COMMAND_UNSUPPORTED");
    expect(message).not.toContain("local SQLite fallback");
    // The remedy has to be in the text itself.
    expect(message).toContain("todos --help");
  });

  test("a near-miss unknown verb names the closest real verb", () => {
    expect(initFailure(["dnoe", "abcd1234"])).toContain("done");
    expect(initFailure(["lsit"])).toContain("list");
  });

  test("a local-only verb says it is local-only and names the remedy", () => {
    const message = initFailure(["sprint"]);

    expect(message).toContain("REMOTE_COMMAND_UNSUPPORTED");
    expect(message).toContain("sprint");
    expect(message).toContain("local-only");
    // Control: it must not be misfiled as an unknown verb.
    expect(message).not.toContain("UNKNOWN_COMMAND");
  });

  test("an unsupported option on a supported verb blames the option, not the verb", () => {
    const message = initFailure(["list", "--recurring"]);

    expect(message).toContain("REMOTE_COMMAND_UNSUPPORTED");
    expect(message).toContain("--recurring");
    // `list` itself works remotely; saying the command is unsupported sends
    // the reader to debug the wrong thing.
    expect(message).not.toContain("UNKNOWN_COMMAND");
  });

  test("a suggestion is always a verb the caller can actually run here", () => {
    // Reviewer finding (P2): pointing a typo at a local-only verb buys the
    // caller a second, different refusal instead of a way out.
    const matrix = getTodosCliCommandCapabilityMatrix();
    const localOnly = new Set(
      [...matrix.entries()].filter(([, owner]) => owner === "local-only").map(([command]) => command),
    );
    // Positive control: `sprint` IS local-only, so this probe can fail.
    expect(localOnly.has("sprint")).toBe(true);

    const message = initFailure(["sprin"]);
    const suggested = message.match(/Did you mean: ([^?]+)\?/)?.[1]?.split(", ") ?? [];
    for (const suggestion of suggested) expect(localOnly.has(suggestion)).toBe(false);
  });

  test("a bulk invocation with no action says to ADD one, not to remove one", () => {
    // Reviewer finding (P3): "re-run without it" does not parse when nothing
    // was given.
    const message = initFailure(["bulk"]);
    expect(message).toContain("missing action");
    expect(message).toContain("pass one of");
    expect(message).not.toContain("re-run without it");
  });

  test("every registered verb the remote gate refuses is refused as local-only, never as unknown", () => {
    // Guards the classifier against drift: a verb that is in the canonical
    // registry must never be reported as if it did not exist.
    const matrix = getTodosCliCommandCapabilityMatrix();
    const localOnly = [...matrix.entries()]
      .filter(([, owner]) => owner === "local-only")
      .map(([command]) => command);

    // Positive control: the set is non-empty, so the loop below can fail.
    expect(localOnly.length).toBeGreaterThan(0);

    for (const command of localOnly) {
      const message = initFailure([command]);
      expect(message).not.toContain("UNKNOWN_COMMAND");
    }
  });
});
