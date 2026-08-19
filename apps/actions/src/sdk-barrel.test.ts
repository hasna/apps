import { describe, expect, test } from "bun:test";
import * as sdk from "./sdk/index.js";

/**
 * Every documented export of `@hasna/actions/sdk` must exist, and a symbol that was
 * deliberately never exported must be undefined, so a dropped re-export is caught.
 */
describe("SDK barrel exports", () => {
  test("every documented export is present", () => {
    const functions: Array<[string, unknown]> = [
      ["ActionsClient", sdk.ActionsClient],
      ["assertManifest", sdk.assertManifest],
      ["createEventAuditSink", sdk.createEventAuditSink],
      ["defineAction", sdk.defineAction],
      ["hasRequiredApprovals", sdk.hasRequiredApprovals],
      ["requiredApprovalCount", sdk.requiredApprovalCount],
      ["JsonActionsStore", sdk.JsonActionsStore],
      ["SQLiteActionsStore", sdk.SQLiteActionsStore],
      ["getActionsDataDir", sdk.getActionsDataDir],
      ["getActionsStatus", sdk.getActionsStatus],
      ["createLocalShellAction", sdk.createLocalShellAction],
      ["localShellBinding", sdk.localShellBinding],
      ["ShellActionError", sdk.ShellActionError],
      ["createTypeScriptAction", sdk.createTypeScriptAction],
    ];
    for (const [name, value] of functions) {
      expect(value, name).toBeDefined();
    }
    expect(typeof sdk.ActionsClient).toBe("function");
    expect(typeof sdk.createLocalShellAction).toBe("function");
    expect(typeof sdk.ShellActionError).toBe("function");
  });

  test("a deliberately non-exported symbol is undefined", () => {
    const unknown = (sdk as unknown as Record<string, unknown>);
    expect(unknown["definitelyNotExported"]).toBeUndefined();
    expect(unknown["internalExecutorMap"]).toBeUndefined();
  });
});
