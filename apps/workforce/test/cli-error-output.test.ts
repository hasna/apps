import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTestDatabase } from "./helpers/database.js";

const cwd = process.cwd();
const dbPath = join(tmpdir(), `workforce-cli-errors-${crypto.randomUUID()}.db`);
const baseEnv = {
  ...process.env,
  HASNA_WORKFORCE_API_TOKEN: "",
  WORKFORCE_API_TOKEN: "",
};

function runCli(args: string[], env: NodeJS.ProcessEnv = baseEnv): SpawnSyncReturns<string> {
  return spawnSync("bun", ["run", "src/cli/index.tsx", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...env, HASNA_WORKFORCE_DB_PATH: dbPath },
  });
}

describe("CLI error output", () => {
  let plainFailure: SpawnSyncReturns<string>;
  let jsonFailure: SpawnSyncReturns<string>;

  beforeAll(() => {
    plainFailure = runCli(["member", "get", "no-such-id"]);
    jsonFailure = runCli(["--json", "member", "get", "no-such-id"]);
  });

  afterAll(() => cleanupTestDatabase(dbPath));

  it("writes failures to stderr without contaminating stdout", () => {
    expect(plainFailure.stdout).toBe("");
    expect(plainFailure.stderr).toContain("Member not found: no-such-id");
  });

  it("writes a parseable error envelope to stderr in JSON mode", () => {
    expect(jsonFailure.stdout).toBe("");
    expect(JSON.parse(jsonFailure.stderr)).toEqual({
      code: "MEMBER_NOT_FOUND",
      message: "Member not found: no-such-id",
      suggestion: "Use list_members to find the correct member id.",
      error: "Member not found: no-such-id",
    });
  });

  it("writes a readable one-line message in non-JSON mode", () => {
    expect(plainFailure.stderr.trim()).toBe(
      "Member not found: no-such-id Use list_members to find the correct member id.",
    );
  });

  it("keeps a non-zero exit code on failure", () => {
    expect(plainFailure.status).toBe(1);
    expect(jsonFailure.status).toBe(1);
  });

  it("applies stream and formatting rules to top-level failures", () => {
    const env = { ...baseEnv, WORKFORCE_API_TOKEN: "invalid-token" };
    const plain = runCli([], env);
    const json = runCli(["--json"], env);

    expect(plain.stdout).toBe("");
    expect(plain.stderr.trim()).toBe("Invalid API token.");
    expect(json.stdout).toBe("");
    expect(JSON.parse(json.stderr)).toEqual({
      code: "INTERNAL_ERROR",
      message: "Invalid API token.",
      suggestion: "",
      error: "Invalid API token.",
    });
    expect(plain.status).toBe(1);
    expect(json.status).toBe(1);
  });
});
