import { describe, expect, test } from "bun:test";
import { TODOS_CLI_HELP_COMMAND_PATHS } from "./metadata-command-paths.js";
import {
  getTodosCliCommandCapabilityMatrix,
  initializeTodosCliAuthority,
  type TodosCliAuthorityDependencies,
} from "./remote-entrypoint.js";

const REMOTE_ENV = {
  HASNA_TODOS_STORAGE_MODE: "remote",
  HASNA_TODOS_API_URL: "https://authority.invalid",
  HASNA_TODOS_API_KEY: "fixture-only",
};

const DORMANT_REMOTE_DEPENDENCIES: TodosCliAuthorityDependencies = {
  getCloudClient: () => ({ baseUrl: "https://authority.invalid/v1" }),
};

describe("dormant current-main remote CLI contract", () => {
  test("the capability matrix covers every generated top-level command and alias", () => {
    const advertisedNames = new Set<string>(["help"]);
    for (const commandPath of TODOS_CLI_HELP_COMMAND_PATHS) {
      advertisedNames.add(commandPath.split(" ")[0]!);
    }

    const matrix = getTodosCliCommandCapabilityMatrix();
    expect([...matrix.keys()].sort()).toEqual([...advertisedNames].sort());
    expect([...matrix.values()].every((owner) =>
      owner === "diagnostic" || owner === "remote-http" || owner === "local-only"
    )).toBe(true);
  });

  test("retains current-main parsing behind an explicit test-only dependency seam", () => {
    expect(initializeTodosCliAuthority(
      ["--json", "status"],
      REMOTE_ENV,
      DORMANT_REMOTE_DEPENDENCIES,
    )).toEqual({
      route: "remote-http",
      v1_base_url: "https://authority.invalid/v1",
    });

    for (const args of [
      ["storage", "artifacts", "upload", "--run-id", "status"],
      ["config", "--set", "danger=true"],
      ["projects", "--add", "/workspace/example", "--dry-run"],
      ["list", "--recurring"],
      ["plans", "--write-artifacts"],
    ]) {
      expect(() => initializeTodosCliAuthority(
        args,
        REMOTE_ENV,
        DORMANT_REMOTE_DEPENDENCIES,
      )).toThrow("REMOTE_COMMAND_UNSUPPORTED");
    }
  });

  test("the production dependency remains behind the Stage-A hosted floor", () => {
    expect(() => initializeTodosCliAuthority(["--json", "status"], REMOTE_ENV))
      .toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
  });
});
