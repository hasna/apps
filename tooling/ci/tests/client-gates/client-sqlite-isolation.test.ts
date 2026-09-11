/**
 * client-sqlite-isolation — client gate, fleet-alignment wave.
 *
 * Ruling (d): a hosted member's CLIENT bundles (`<name>` CLI and `<name>-mcp`)
 * must not contain a SQLite driver. `bun:sqlite` or `better-sqlite3` inside
 * a client bundle is the capability to open a local store; whether or not a
 * code path reaches it today, the next refactor can, and the station rule
 * (no local fleet SQLite anywhere) has no way to see it. The acceptance
 * check from the plan is exactly `grep -c 'bun:sqlite' dist/cli/*.js dist/mcp/*.js == 0`.
 *
 * Server bins (`-serve`, `-migrate`, `-worker`, `-daemon`) are out of scope
 * here: a server takes a DSN and its store is PostgreSQL by ruling; SQLite in
 * a server bundle is a different rule (server_backend_configuration).
 *
 * Reads BUILT bins; an unbuilt bin is skipped with a `not-built` line unless
 * HASNA_CLIENT_GATES_REQUIRE_BUILT=1 (the client-gates CI job), where it is
 * a violation — a gate that could not read the artifact has cleared nothing.
 *
 * MODE: report-only at landing (GATE_MODES). Owners: W6 (todos, mementos,
 * projects, hooks, loops) and each hosted member's alignment PR.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { APPS_DIR } from "../standard/census";
import { assertGate } from "../standard/gate-mode";
import { hostedMembersIn } from "../standard/hosted";
import { bundleText, requireBuilt, resolveBin } from "./bins";

export const GATE = "client-sqlite-isolation";
export const SQLITE_DRIVERS: Array<{ name: string; re: RegExp }> = [
  { name: "bun:sqlite", re: /["'`]bun:sqlite["'`]/ },
  { name: "better-sqlite3", re: /["'`]better-sqlite3["'`]/ },
  { name: "node:sqlite", re: /["'`]node:sqlite["'`]/ },
];

export interface IsolationResult {
  member: string;
  bin: string;
  status: "clean" | "violation" | "not-built" | "undeclared";
  detail: string;
}

export function scanMember(memberDir: string, member: string): IsolationResult[] {
  const out: IsolationResult[] = [];
  for (const bin of [member, `${member}-mcp`]) {
    const resolved = resolveBin(memberDir, bin);
    if (!resolved) {
      out.push({ member, bin, status: "undeclared", detail: "package.json declares no such bin (four-surface gate owns this)" });
      continue;
    }
    if (!resolved.exists) {
      out.push({ member, bin, status: "not-built", detail: `${resolved.declared} is not built in this checkout` });
      continue;
    }
    const { files, text } = bundleText(resolved.absolute);
    const found = SQLITE_DRIVERS.filter((d) => d.re.test(text)).map((d) => d.name);
    if (found.length > 0) {
      out.push({ member, bin, status: "violation", detail: `${resolved.declared} bundles ${found.join(", ")} (${files.length} file(s) read)` });
    } else {
      out.push({ member, bin, status: "clean", detail: `${resolved.declared}: no SQLite driver (${files.length} file(s) read)` });
    }
  }
  return out;
}

export function isolationResults(appsDir: string = APPS_DIR): IsolationResult[] {
  const out: IsolationResult[] = [];
  for (const member of hostedMembersIn(appsDir)) out.push(...scanMember(path.join(appsDir, member), member));
  return out;
}

describe("client gate: SQLite isolation of hosted client bundles (ruling d)", () => {
  test("no hosted member's <name> or <name>-mcp bundle contains bun:sqlite / better-sqlite3", () => {
    const results = isolationResults();
    const violations = results.filter((r) => r.status === "violation").map((r) => `${r.member}: ${r.bin}: ${r.detail}`);
    const notBuilt = results.filter((r) => r.status === "not-built");
    const clean = results.filter((r) => r.status === "clean");
    console.info(`[${GATE}] census: ${clean.length} clean, ${violations.length} violation(s), ${notBuilt.length} not built, ${results.filter((r) => r.status === "undeclared").length} undeclared across ${new Set(results.map((r) => r.member)).size} hosted member(s)`);
    for (const r of notBuilt) console.info(`[${GATE}] not-built: ${r.member}: ${r.bin}: ${r.detail}`);
    const all = requireBuilt() ? [...violations, ...notBuilt.map((r) => `${r.member}: ${r.bin}: not built — the client-gates job must build every hosted member before this test`)] : violations;
    assertGate(GATE, all, "keep bun:sqlite/better-sqlite3 out of the CLI and MCP bundles (server-only code belongs behind the -serve bin)");
  }, 120_000);

  test("self-test: fires on a bundle importing bun:sqlite (directly and through a shim), stays silent on a clean bundle, reports an unbuilt bin", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "client-sqlite-isolation-self-test-"));
    try {
      const mk = (member: string, bins: Record<string, string>, files: Record<string, string>) => {
        const dir = path.join(root, member);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: `@hasna/${member}`, bin: bins }));
        for (const [rel, text] of Object.entries(files)) {
          fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
          fs.writeFileSync(path.join(dir, rel), text);
        }
        return dir;
      };
      const bad = mk("bad", { bad: "dist/cli/index.js", "bad-mcp": "bin/mcp.js" }, {
        "dist/cli/index.js": 'import { Database } from "bun:sqlite";\nnew Database("x.db");\n',
        "bin/mcp.js": '#!/usr/bin/env bun\nawait import("../dist/mcp/index.js");\n',
        "dist/mcp/index.js": 'const sqlite = require("better-sqlite3");\n',
      });
      const good = mk("good", { good: "dist/cli/index.js", "good-mcp": "dist/mcp/index.js" }, {
        "dist/cli/index.js": 'import { resolveClientTransport } from "@hasna/contracts/client";\n// bun:sqlite is mentioned in this comment without quotes and does not count\n',
        "dist/mcp/index.js": 'export const tools = [];\n',
      });
      const unbuilt = mk("unbuilt", { unbuilt: "dist/cli/index.js", "unbuilt-mcp": "dist/mcp/index.js" }, {});

      const badR = scanMember(bad, "bad");
      expect(badR.map((r) => r.status)).toEqual(["violation", "violation"]);
      expect(badR[1]!.detail).toContain("better-sqlite3");
      expect(scanMember(good, "good").map((r) => r.status)).toEqual(["clean", "clean"]);
      expect(scanMember(unbuilt, "unbuilt").map((r) => r.status)).toEqual(["not-built", "not-built"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
