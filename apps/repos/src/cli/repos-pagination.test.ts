import { describe, expect, test } from "bun:test";

describe("repos command pagination flags", () => {
  test("supports --offset with --json output", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "repos", "--json", "--limit", "1", "--offset", "0"],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HASNA_REPOS_AUTO_BOOTSTRAP: "0",
        HASNA_REPOS_DB_PATH: ":memory:",
      },
    });

    expect(result.exitCode).toBe(0);

    const output = new TextDecoder().decode(result.stdout);
    const parsed = JSON.parse(output) as unknown;
    expect(parsed).toMatchObject({ repos: [], count: 0, total: 0, limit: 1, cursor: 0, has_more: false, compact: true });
  });
});
