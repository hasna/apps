import { describe, expect, test } from "bun:test";
import { CONTRACTS_KIT_VERSION, scannerCommand } from "./scan-artifact";

describe("instructions packed artifact scanner", () => {
  test("pins the exact contracts kit and scans an archive, never the source tree", () => {
    expect(CONTRACTS_KIT_VERSION).toBe("1.0.2");
    expect(scannerCommand("/tmp/instructions.tgz")).toEqual([
      "bunx",
      "@hasna/contracts@1.0.2",
      "artifact-scan",
      "/tmp/instructions.tgz",
    ]);
  });

  test("positive control: a source-directory argument is not constructed", () => {
    const command = scannerCommand("/tmp/candidate.tgz");
    expect(command.at(-1)).toEndWith(".tgz");
    expect(command).not.toContain("src");
  });
});
