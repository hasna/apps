// b27cc4a0: the CLI display surface for auth status — `accounts set
// --auth-status`, the `accounts auth-status` probe verb, the list table's AUTH
// column, show's per-machine lines, and the additive --json contract.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "accounts-auth-status-cli-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function run(machineId: string, ...args: string[]) {
  return spawnSync(process.execPath, ["run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      ACCOUNTS_HOME: home,
      HASNA_ACCOUNTS_MACHINE_ID: machineId,
    },
  });
}

test("set --auth-status records per-machine entries; show --json carries authStatus additively", () => {
  expect(run("m1", "add", "p1", "--tool", "codewith").status).toBe(0);
  expect(
    run("m1", "set", "p1", "--tool", "codewith", "--auth-status", "host-a=ok:healthy", "--auth-status", "host-b=no").status,
  ).toBe(0);

  const shown = run("m1", "show", "p1", "--tool", "codewith", "--json");
  expect(shown.status).toBe(0);
  const details = JSON.parse(shown.stdout);
  expect(details.name).toBe("p1"); // existing keys unchanged
  expect(details.active).toBe(false);
  expect(details.authStatus["host-a"]).toEqual({
    authenticated: true,
    checkedAt: expect.any(String),
    detail: "healthy",
  });
  expect(details.authStatus["host-b"]).toEqual({
    authenticated: false,
    checkedAt: expect.any(String),
  });
  expect(details.metadata).toBeUndefined();
});

test("set --auth-status merges per machine and never replaces the map", () => {
  expect(run("m1", "add", "p1", "--tool", "codewith").status).toBe(0);
  expect(run("m1", "set", "p1", "--tool", "codewith", "--auth-status", "host-a=ok").status).toBe(0);
  expect(run("m1", "set", "p1", "--tool", "codewith", "--auth-status", "host-b=no").status).toBe(0);

  const details = JSON.parse(run("m1", "show", "p1", "--tool", "codewith", "--json").stdout);
  expect(details.authStatus["host-a"].authenticated).toBe(true);
  expect(details.authStatus["host-b"].authenticated).toBe(false);
});

test("set rejects a malformed --auth-status value", () => {
  expect(run("m1", "add", "p1", "--tool", "codewith").status).toBe(0);
  const bad = run("m1", "set", "p1", "--tool", "codewith", "--auth-status", "host-a=maybe");
  expect(bad.status).toBe(1);
  expect(bad.stdout + bad.stderr).toMatch(/expected MACHINE=ok\|no/);
});

test("accounts auth-status probes this machine, stores the entry, and prints it", () => {
  expect(run("probe-host", "add", "probe-me", "--tool", "codewith").status).toBe(0);

  const probed = run("probe-host", "auth-status", "probe-me", "--tool", "codewith");
  expect(probed.status).toBe(0);
  expect(probed.stdout).toContain("probe-host");
  expect(probed.stdout).toContain("no");

  const details = JSON.parse(run("probe-host", "show", "probe-me", "--tool", "codewith", "--json").stdout);
  const entry = details.authStatus["probe-host"];
  expect(entry).toBeDefined();
  expect(entry.authenticated).toBe(false);
  expect(typeof entry.checkedAt).toBe("string");
  expect(entry.detail).toBe("not-locally-verifiable");
});

test("list text renders a table with an AUTH column reflecting the stored machine entry", () => {
  expect(run("m1", "add", "p1", "--tool", "codewith").status).toBe(0);
  expect(run("m1", "set", "p1", "--tool", "codewith", "--auth-status", "host-a=ok").status).toBe(0);

  // On host-a the AUTH column (the last, rightmost column) reads yes; on an
  // unrecorded host it reads —.
  const onA = run("host-a", "list");
  expect(onA.status).toBe(0);
  expect(onA.stdout).toContain("AUTH");
  const rowA = onA.stdout.split("\n").find((line) => line.startsWith("p1"));
  expect(rowA).toMatch(/yes$/);

  const onB = run("host-b", "list");
  const rowB = onB.stdout.split("\n").find((line) => line.startsWith("p1"));
  expect(rowB).toMatch(/—$/);
});

test("list --json adds authStatus only when present and keeps existing keys", () => {
  expect(run("m1", "add", "p1", "--tool", "codewith").status).toBe(0);
  expect(run("m1", "set", "p1", "--tool", "codewith", "--auth-status", "host-a=ok").status).toBe(0);
  expect(run("m1", "add", "p2", "--tool", "codewith").status).toBe(0);

  const details = JSON.parse(run("host-a", "list", "--json").stdout);
  const p1 = details.find((p: { name: string }) => p.name === "p1");
  const p2 = details.find((p: { name: string }) => p.name === "p2");
  expect(p1.authStatus["host-a"].authenticated).toBe(true);
  expect(p1.active).toBe(false);
  expect(p2.authStatus).toBeUndefined();
});

test("show text prints the stored per-machine auth status", () => {
  expect(run("m1", "add", "p1", "--tool", "codewith").status).toBe(0);
  expect(run("m1", "set", "p1", "--tool", "codewith", "--auth-status", "host-a=ok:healthy").status).toBe(0);

  const out = run("m1", "show", "p1", "--tool", "codewith");
  expect(out.status).toBe(0);
  expect(out.stdout).toContain("auth status");
  expect(out.stdout).toContain("host-a");
  expect(out.stdout).toContain("healthy");
});
