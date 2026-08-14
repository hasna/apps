/**
 * Four-surface standard — standard-adherence suite, check 3.
 *
 * Repo law 4: every publishable member ships a `<name>` CLI bin (HARD),
 * an `<name>-mcp` bin, an `<name>-serve` bin and an `./sdk` export (the
 * last three WARN, recorded exceptions per the P5 census). Missing bins
 * are NEVER invented by this suite — they are recorded and filed as
 * remediation tasks.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  APPS_DIR,
  membersIn,
  classificationTable,
  CLI_EXCEPTIONS,
  MCP_EXCEPTIONS,
  SERVE_EXCEPTIONS,
  SDK_EXCEPTIONS,
} from "./census";

const cliSet = () => new Set(CLI_EXCEPTIONS.map((e) => e.member));
const mcpSet = () => new Set(MCP_EXCEPTIONS.map((e) => e.member));
const serveSet = () => new Set(SERVE_EXCEPTIONS.map((e) => e.member));
const sdkSet = () => new Set(SDK_EXCEPTIONS.map((e) => e.member));

export interface SurfaceViolation {
  member: string;
  surface: "cli" | "mcp" | "serve" | "sdk";
  kind: "missing" | "stale-exception";
}

export function surfaceViolations(appsDir: string = APPS_DIR): SurfaceViolation[] {
  const out: SurfaceViolation[] = [];
  for (const m of membersIn(appsDir)) {
    if (!m.publishable) continue;
    if (!m.hasCli && !cliSet().has(m.name)) out.push({ member: m.name, surface: "cli", kind: "missing" });
    if (!m.hasMcp && !mcpSet().has(m.name)) out.push({ member: m.name, surface: "mcp", kind: "missing" });
    if (!m.hasServe && !serveSet().has(m.name)) out.push({ member: m.name, surface: "serve", kind: "missing" });
    if (!m.hasSdk && !sdkSet().has(m.name)) out.push({ member: m.name, surface: "sdk", kind: "missing" });
  }
  // The registries must not rot: a recorded exception whose member now ships
  // the surface is stale.
  for (const m of membersIn(appsDir)) {
    if (m.hasCli && cliSet().has(m.name)) out.push({ member: m.name, surface: "cli", kind: "stale-exception" });
    if (m.hasMcp && mcpSet().has(m.name)) out.push({ member: m.name, surface: "mcp", kind: "stale-exception" });
    if (m.hasServe && serveSet().has(m.name)) out.push({ member: m.name, surface: "serve", kind: "stale-exception" });
    if (m.hasSdk && sdkSet().has(m.name)) out.push({ member: m.name, surface: "sdk", kind: "stale-exception" });
  }
  return out;
}

describe("standard-adherence: four-surface standard", () => {
  test("the <name> CLI bin is HARD — every publishable member except recorded exceptions", () => {
    const v = surfaceViolations().filter((x) => x.surface === "cli");
    expect(v.map((x) => `${x.member}: ${x.kind === "stale-exception" ? "now conforms but a CLI exception entry remains" : "missing cli bin"}`)).toEqual([]);
  });

  test("<name>-mcp / <name>-serve / ./sdk are WARN — recorded exceptions allowed", () => {
    const v = surfaceViolations().filter((x) => x.surface !== "cli");
    expect(v.map((x) => `${x.member}: ${x.kind === "stale-exception" ? `now ships ${x.surface} but an exception entry remains` : `missing ${x.surface}`}`)).toEqual([]);
  });

  test("self-test: the check fires on a member missing its CLI bin and stays silent on a conforming member", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "standard-surfaces-self-test-"));
    try {
      const apps = path.join(root, "apps");
      fs.mkdirSync(path.join(apps, "conforming"), { recursive: true });
      fs.mkdirSync(path.join(apps, "broken"), { recursive: true });
      const conforming = {
        name: "@hasna/conforming",
        bin: { conforming: "cli.js", "conforming-mcp": "mcp.js", "conforming-serve": "serve.js" },
        exports: { ".": "index.js", "./sdk": "sdk.js" },
      };
      const broken = {
        name: "@hasna/broken",
        bin: { "not-the-cli": "x.js" },
      };
      fs.writeFileSync(path.join(apps, "conforming", "package.json"), JSON.stringify(conforming, null, 2));
      fs.writeFileSync(path.join(apps, "broken", "package.json"), JSON.stringify(broken, null, 2));
      const v = surfaceViolations(apps);
      expect(v.filter((x) => x.member === "conforming")).toEqual([]);
      const brokenHits = v.filter((x) => x.member === "broken");
      expect(brokenHits.some((x) => x.surface === "cli")).toBe(true);
      expect(brokenHits.some((x) => x.surface === "mcp")).toBe(true);
      expect(brokenHits.some((x) => x.surface === "serve")).toBe(true);
      expect(brokenHits.some((x) => x.surface === "sdk")).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("report: emit the per-member classification table", () => {
    const table = classificationTable();
    const lines = table.split("\n").filter((l) => l.startsWith("|"));
    console.log(`\n[standard] per-member classification (${lines.length} members):\n${table}`);
    expect(lines.length).toBeGreaterThan(0);
  });
});
