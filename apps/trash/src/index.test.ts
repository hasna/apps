/**
 * The package's public surface — the four-surface law means the exports are
 * part of the contract, so they are asserted rather than assumed:
 *
 *   `.`        the library (`import { TrashStore } from "@hasna/trash"`)
 *   `./sdk`    the facade
 *   CLI/MCP/serve bins are exercised in their own suites.
 */

import { describe, expect, test } from "bun:test";
import * as library from "./index.js";
import * as sdk from "./sdk.js";

describe("@hasna/trash public surface", () => {
  test("the root export carries the store and its dependencies", () => {
    expect(typeof library.TrashStore).toBe("function");
    expect(typeof library.resolveTrashRoots).toBe("function");
    expect(typeof library.planRetention).toBe("function");
    expect(typeof library.resolveTrashMode).toBe("function");
    expect(typeof library.inspectSource).toBe("function");
    expect(typeof library.createEntry).toBe("function");
    expect(typeof library.listRefusals).toBe("function");
    expect(typeof library.withFileLock).toBe("function");
    expect(library.ENTRY_SCHEMA).toBe("hasna.trash.entry.v1");
  });

  test("the ./sdk export builds a store and re-exports the planner", () => {
    expect(typeof sdk.createTrash).toBe("function");
    expect(typeof sdk.resolveConfig).toBe("function");
    expect(typeof sdk.planRetention).toBe("function");
    expect(typeof sdk.isExcludedPath).toBe("function");
    expect(sdk.TrashStore).toBe(library.TrashStore);
  });

  test("the ./sdk export carries the guard's decision layer", () => {
    // The consumer is a Bash hook holding a command STRING; it needs the
    // decision and the rewritten command, not the store handle.
    expect(typeof sdk.planGuardCommand).toBe("function");
    expect(typeof sdk.scanDeleteVerbs).toBe("function");
    expect(typeof sdk.guardPlanDocument).toBe("function");
    expect(typeof sdk.quoteForShell).toBe("function");
    expect(sdk.REWRITE_VERBS).toEqual(["rm", "rmdir"]);
    expect(sdk.EXIT_REFUSED).toBe(2);

    const decision = sdk.planGuardCommand("rm -rf /", { spool: "/s", trashBin: "trash", home: "/home/u", cwd: "/work" });
    expect(decision.kind).toBe("deny");
  });

  test("no scaffold placeholder survives", () => {
    expect((library as Record<string, unknown>).hello).toBeUndefined();
  });
});
