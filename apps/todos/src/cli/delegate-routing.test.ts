import { describe, expect, test } from "bun:test";
import { getTodosCliCommandCapabilityMatrix, isTodosCliCommandVisibleForRoute } from "./stage-a.js";

/**
 * THE CONSTRAINT THAT IS INVISIBLE FROM `--help`, and the single most important
 * one in this change.
 *
 * Stage A defaults EVERY canonical command to `local-only` and promotes only
 * the members of `REMOTE_COMMANDS` to `remote-http`. This fleet runs the cloud
 * `/v1` route, where a `local-only` verb is refused outright with
 * REMOTE_COMMAND_UNSUPPORTED and the local SQLite fallback is disabled.
 *
 * `dispatch` is the worked example and it is already dead here: it is a
 * registered canonical command, it is absent from REMOTE_COMMANDS, and running
 * it on this fleet returns
 *
 *   REMOTE_COMMAND_UNSUPPORTED: `dispatch` is a local-only command and the
 *   Todos /v1 authority does not serve it; local SQLite fallback is disabled.
 *
 * A `delegate` registered in only ONE of the two arrays would ship exactly that
 * way — refused on the very fleet whose abandoned-dispatch problem it exists to
 * fix — and nothing in `todos --help`, in the command's own tests, or in a
 * local-route run would reveal it. Hence a test against the matrix itself.
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

  test("CONTROL: dispatch is registered but local-only, which is the failure mode being avoided", () => {
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
