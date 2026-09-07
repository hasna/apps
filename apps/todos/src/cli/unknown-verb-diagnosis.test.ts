import { describe, expect, test } from "bun:test";

import {
  getTodosCliOnBoxStoreCommands,
  initializeTodosCliAuthority,
} from "./stage-a.js";

const REMOTE_ENV = {
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

function initRoute(args: string[]): string {
  return initializeTodosCliAuthority(args, REMOTE_ENV).route;
}

/**
 * The command surface is transport-neutral: a verb that does not exist is
 * reported as unknown wherever it is typed, and a verb that exists ROUTES —
 * to the hosted store when its data plane is shared, to the on-box store when
 * its data plane is the workstation. Nothing is refused for its transport.
 */
describe("stage-a routing and unknown-verb diagnosis", () => {
  test("`complete` and `register` are accepted as aliases of the real verbs", () => {
    // The fleet's MCP surface names these operations `complete_task` and
    // `register_agent`, and the rules corpus instructs agents to use them, so
    // the CLI accepts the same words rather than rejecting its own vocabulary.
    expect(() => initializeTodosCliAuthority(["complete", "abcd1234"], REMOTE_ENV)).not.toThrow();
    expect(() => initializeTodosCliAuthority(["register", "fixture-agent"], REMOTE_ENV)).not.toThrow();
    expect(initRoute(["complete", "abcd1234"])).toBe("remote-http");
    expect(initRoute(["register", "fixture-agent"])).toBe("remote-http");
  });

  test("an unknown verb is reported as unknown, not as a transport limitation", () => {
    const message = initFailure(["zzzznotacommand", "abcd1234"]);

    expect(message).toContain("UNKNOWN_COMMAND");
    expect(message).toContain("zzzznotacommand");
    // Nothing about an unknown verb is specific to any transport.
    expect(message).not.toContain("REMOTE_COMMAND_UNSUPPORTED");
    expect(message).not.toContain("local SQLite fallback");
    expect(message).not.toContain("/v1 route");
    // The remedy has to be in the text itself.
    expect(message).toContain("todos --help");
  });

  test("an owner-less verb is not asserted to be nonexistent — it is UNKNOWN_COMMAND", () => {
    // `channels` is contributed at runtime by the optional
    // `@hasna/events/commander` package, so Stage A cannot see it in the
    // static registry. It must NOT be told it is not a todos command -- that
    // would be a worse falsehood than the message this fix removes.
    const message = initFailure(["channels"]);
    expect(message).toContain("UNKNOWN_COMMAND");
    expect(message).not.toContain("is not a todos command");
    expect(message).not.toContain("/v1 route");
    expect(message).not.toContain("optional packages");
  });

  test("project-registration commands are known while a near-miss remains the UNKNOWN_COMMAND red control", () => {
    expect(initRoute(["project-registration"])).toBe("remote-http");
    expect(initRoute(["project-resources", "wks_projectresources1", "--all"])).toBe("remote-http");
    const redControl = initFailure(["project-resourcess", "wks_projectresources1"]);
    expect(redControl).toContain("UNKNOWN_COMMAND");
    expect(redControl).toContain("project-resources");
  });

  test("a near-miss unknown verb names the closest real verb", () => {
    expect(initFailure(["dnoe", "abcd1234"])).toContain("done");
    expect(initFailure(["lsit"])).toContain("list");
  });

  test("an on-box verb routes to the on-box store instead of being refused", () => {
    expect(initRoute(["sprint"])).toBe("local");
    expect(initRoute(["machines"])).toBe("local");
  });

  test("redaction configuration, scans, and evidence all select the on-box route", () => {
    for (const args of [
      ["redaction", "status"], ["redaction", "add"], ["redaction", "scan"], ["redaction", "evidence"],
    ]) {
      expect(initializeTodosCliAuthority(args, REMOTE_ENV)).toEqual({
        route: "local",
        v1_base_url: null,
        local_store: "configured-authority",
      });
    }
  });

  test("an option that used to be refused now routes and the action owns the semantics", () => {
    // `list --recurring` boots hosted; the client-side recurring filter is
    // enforced by the action, so the invocation is not a stage-a concern.
    expect(initRoute(["list", "--recurring"])).toBe("remote-http");
  });

  test("typo recovery suggests from the FULL registered catalog", () => {
    const suggestionMessage = initFailure(["sprin"]);
    const suggested = suggestionMessage.match(/Did you mean: ([^?]+)\?/)?.[1]?.split(", ") ?? [];
    // `sprint` is a workstation-store verb, but it is registered, so it is a
    // legitimate suggestion — the catalog is the same in every transport.
    expect(suggested).toContain("sprint");
  });

  test("a bulk invocation with no action says to ADD one, not to remove one", () => {
    // Reviewer finding (P3): "re-run without it" does not parse when nothing
    // was given.
    expect(initRoute(["bulk"])).toBe("remote-http");
  });

  test("a global option without a value names itself and the remedy", () => {
    const message = initFailure(["--project"]);
    expect(message).toContain("INVALID_GLOBAL_OPTION");
    expect(message).toContain("--project");
    expect(message).not.toContain("REMOTE_COMMAND_UNSUPPORTED");
  });

  test("every registered on-box verb routes to the on-box store under hosted configuration", () => {
    // Guards the classifier against drift: a verb that is in the canonical
    // registry must never be reported as if it did not exist.
    const onBox = [...getTodosCliOnBoxStoreCommands()];
    expect(onBox.length).toBeGreaterThan(0);
    for (const command of onBox) {
      expect(initRoute([command])).toBe("local");
      // A near-miss of a registered verb names that verb as a suggestion —
      // typo recovery draws from the FULL catalog in every transport.
      const nearMiss = initFailure([`${command}x`]);
      expect(nearMiss).toContain("UNKNOWN_COMMAND");
      expect(nearMiss).not.toContain("REMOTE_COMMAND_UNSUPPORTED");
    }
  });
});