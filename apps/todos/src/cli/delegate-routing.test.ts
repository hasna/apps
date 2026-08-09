import { describe, expect, test } from "bun:test";
import { getTodosCliCommandCapabilityMatrix, isTodosCliCommandVisibleForRoute } from "./stage-a.js";

/**
 * THE CONSTRAINT THAT IS INVISIBLE FROM `--help`, and the single most important
 * one in this change.
 *
 * Stage A defaults EVERY canonical command to `local-only` and promotes only
 * the members of `REMOTE_COMMANDS` to `remote-http`. Under hosted
 * configuration a `local-only` verb remains fail-closed unless an invocation
 * is explicitly admitted as workstation-only.
 *
 * `dispatch` is the worked example: it is registered, absent from
 * REMOTE_COMMANDS, and therefore refused on the hosted route. A `delegate`
 * registered in only ONE of the two arrays would ship unusable on the shared
 * fleet authority. Nothing in the command's local tests would reveal that
 * authority error, hence a test against the matrix itself.
 */

describe("delegate is routable on the remote /v1 authority, not just registered", () => {
  const matrix = getTodosCliCommandCapabilityMatrix();

  test("delegate is a KNOWN command — absent from the registry it would be UNKNOWN_COMMAND", () => {
    expect(matrix.has("delegate")).toBe(true);
  });

  test("delegate is owned by remote-http, so the /v1 route serves it", () => {
    expect(matrix.get("delegate")).toBe("remote-http");
  });

  test("delegate stays visible in a remote route's help and completions", () => {
    expect(isTodosCliCommandVisibleForRoute("delegate", "remote-http")).toBe(true);
    expect(isTodosCliCommandVisibleForRoute("delegate", "local")).toBe(true);
  });

  test("CONTROL: dispatch is registered but local-only, which is the authority mismatch being avoided", () => {
    // If this ever flips, either someone made `dispatch` remote-capable — a
    // change operating rule 12 forbids, since it types into a tmux pane — or
    // this test is reading a matrix that no longer means what it says.
    expect(matrix.has("dispatch")).toBe(true);
    expect(matrix.get("dispatch")).toBe("local-only");
    expect(isTodosCliCommandVisibleForRoute("dispatch", "remote-http")).toBe(false);
  });

  test("CONTROL: a name that was never registered is absent, so `has` is not answering true to everything", () => {
    expect(matrix.has("delegate-nonexistent-control")).toBe(false);
  });

  test("CONTROL: an established remote verb reads the same way delegate does", () => {
    expect(matrix.get("assign")).toBe("remote-http");
  });
});

describe("the existing dispatch family is untouched", () => {
  const matrix = getTodosCliCommandCapabilityMatrix();

  test("dispatch and its sibling dispatches both remain registered", () => {
    // `delegate` is an ADDITION. Renaming or unregistering `dispatch` would
    // reach a scheduler, a history verb and two SQLite tables, and is expressly
    // out of scope.
    expect(matrix.has("dispatch")).toBe(true);
    expect(matrix.has("dispatches")).toBe(true);
    expect(matrix.get("dispatches")).toBe("local-only");
  });
});
