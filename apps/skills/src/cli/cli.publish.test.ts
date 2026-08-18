import { describe, expect, test } from "bun:test";
import { runCli } from "./cli.test-utils";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("skills push (CLI)", () => {
  test("help names the canonical corpus root instead of a hardcoded installed path", async () => {
    const { stdout, exitCode } = await runCli(["push", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("local corpus");
    expect(stdout).toContain("canonical");
    expect(stdout).toContain("owner-layout migration");
  });
});
