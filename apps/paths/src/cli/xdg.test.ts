import { expect, test } from "bun:test";
import { join } from "node:path";

function cli(args: string[], overrides: Record<string, string> = {}) {
  const env = { ...process.env };
  for (const prefix of ["HASNA", "XDG"]) {
    for (const kind of ["CONFIG", "DATA", "STATE", "CACHE"]) delete env[`${prefix}_${kind}_HOME`];
  }
  const result = Bun.spawnSync([process.execPath, "src/cli/index.ts", ...args], {
    cwd: join(import.meta.dir, "../.."), env: { ...env, ...overrides }, stdout: "pipe", stderr: "pipe",
  });
  return { status: result.exitCode, stdout: new TextDecoder().decode(result.stdout), stderr: new TextDecoder().decode(result.stderr) };
}

test("CLI honors XDG for JSON, internal, base, and one-kind output", () => {
  const env = { XDG_DATA_HOME: "/xdg-root" };
  expect(cli(["--app", "todos", "--kind", "data"], env).stdout).toBe("/xdg-root/hasna/todos\n");
  expect(cli(["--app", "todos", "--internal", "--kind", "data"], env).stdout).toBe("/xdg-root/hasna/internal/todos\n");
  expect(JSON.parse(cli(["--base", "--kind", "data", "--json"], env).stdout)).toEqual({ kind: "data", base: "/xdg-root/hasna" });
  expect(JSON.parse(cli(["--app", "todos", "--json"], env).stdout).data).toBe("/xdg-root/hasna/todos");
  expect(cli(["--app", "todos", "--kind", "data"], { ...env, HASNA_DATA_HOME: "/hasna-root" }).stdout).toBe("/hasna-root/todos\n");
});

test("CLI rejects an invalid explicit root without leaking it or writing partial output", () => {
  for (const args of [["--app", "todos", "--json"], ["--base", "--kind", "data"]]) {
    const result = cli(args, { HASNA_DATA_HOME: "private-relative-root", XDG_DATA_HOME: "/valid-root" });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("HASNA_DATA_HOME must be an absolute path");
    expect(result.stderr).not.toContain("private-relative-root");
  }
});

test("help/version remain execution-free with invalid roots", () => {
  for (const arg of ["--help", "--version"]) {
    const result = cli([arg], { HASNA_DATA_HOME: "private-relative-root" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  }
});
