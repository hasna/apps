// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19).
//
// Priority 4 — CLI behavior through the real commander program (no TTY
// required): openapi generate writes the document to a temporary path and
// prints the {ok:true,wrote} envelope; openapi check returns {ok:false} and
// exit code 1 for a stale document and {ok:true} for a current one; malformed
// --input produces a ValidationError; an unknown operation returns the
// {ok:false,error} envelope; and the dashboard's data source (cliNamespaces)
// covers every registry op.
//
// The openapi check exit codes (1 stale / 0 current) are asserted through a
// spawned CLI process: mutating process.exitCode inside the suite's own
// process makes bun test's runner exit non-zero even when every test passes
// (measured at head 1c61c64d: 164 pass / 1 skip / 0 fail, rc=1), so the exit
// contract is asserted on the child process instead.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProgram } from "../src/cli/index.jsx";
import { cliNamespaces } from "../src/cli/namespaces.js";
import { cliInvoke, parseInputJson } from "../src/cli/dispatch.js";
import { openApiJson } from "../src/api/index.js";
import { ALL_OPS } from "../src/services/registry.js";
import { freshDb, systemContext } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import type { Command } from "commander";

let captured: string[];
let originalWrite: (chunk: unknown) => boolean;

function captureStdout(): void {
  captured = [];
  originalWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    captured.push(String(chunk));
    return true;
  };
}

function restoreStdout(): void {
  (process.stdout as unknown as { write: (chunk: unknown) => boolean }).write = originalWrite;
}

beforeEach(() => {
  captureStdout();
});
afterEach(() => {
  restoreStdout();
  closeDatabase();
});

function cliArgs(command: string[]): string[] {
  return ["node", "billing", ...command];
}

async function runCli(program: Command, command: string[]): Promise<void> {
  await program.parseAsync(cliArgs(command));
}

/** The real CLI entry, run as its own process; the exit code is the assertion subject. */
function runCliProcess(command: string[]): { stdout: string; exitCode: number } {
  const cliEntry = fileURLToPath(new URL("../src/cli/index.tsx", import.meta.url));
  const result = spawnSync(process.execPath, [cliEntry, ...command], { encoding: "utf8" });
  if (result.error) throw result.error;
  return { stdout: result.stdout, exitCode: result.status ?? -1 };
}

describe("openapi generate/check with temporary paths", () => {
  it("generates the document to a temp path and prints the ok envelope", async () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-cli-"));
    const outPath = join(dir, "generated.json");
    const program = buildProgram();
    await runCli(program, ["openapi", "generate", "--out", outPath]);
    expect(readFileSync(outPath, "utf8")).toBe(openApiJson());
    const printed = JSON.parse(captured.join(""));
    expect(printed).toEqual({ ok: true, wrote: outPath });
  });

  it("flags a stale document with {ok:false} and exit code 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-cli-"));
    const stalePath = join(dir, "stale.json");
    // A byte-different document (extra whitespace) is stale.
    writeFileSync(stalePath, `${openApiJson()}\n`);
    const { stdout, exitCode } = runCliProcess(["openapi", "check", "--path", stalePath]);
    expect(JSON.parse(stdout)).toEqual({ ok: false, error: "openapi.json is stale; run `billing openapi generate`." });
    expect(exitCode).toBe(1);
  });

  it("accepts a current document with {ok:true} and exit code 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-cli-"));
    const currentPath = join(dir, "current.json");
    writeFileSync(currentPath, openApiJson());
    const { stdout, exitCode } = runCliProcess(["openapi", "check", "--path", currentPath]);
    expect(JSON.parse(stdout)).toEqual({ ok: true, path: currentPath });
    expect(exitCode).toBe(0);
  });
});

describe("CLI input and unknown-operation envelopes", () => {
  it("throws a ValidationError for malformed --input JSON", async () => {
    const program = buildProgram();
    await expect(program.parseAsync(cliArgs(["customers", "get-customer", "--input", "{not json"]))).rejects.toThrow(
      "--input must be valid JSON.",
    );
  });

  it("parseInputJson accepts valid JSON and defaults to {}", () => {
    expect(parseInputJson('{"id":"x"}')).toEqual({ id: "x" });
    expect(parseInputJson(undefined)).toEqual({});
    expect(() => parseInputJson("nope")).toThrow(/valid JSON/);
  });

  it("returns an {ok:false,error} envelope for an unknown operation", async () => {
    const db = freshDb();
    const ctx = systemContext(db);
    const result = await cliInvoke("no_such_operation", {}, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Unknown operation: no_such_operation",
    });
    expect(Object.keys(result.error!)).toEqual(["code", "message", "suggestion"]);
  });

  it("wraps a domain error in the same envelope (code preserved)", async () => {
    const db = freshDb();
    const ctx = systemContext(db);
    const result = await cliInvoke("get_customer", { id: "missing" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("CUSTOMER_NOT_FOUND");
  });
});

describe("dashboard data source", () => {
  it("cliNamespaces covers every registry op (the Ink dashboard renders from it)", () => {
    const namespaces = cliNamespaces();
    const covered = new Set(namespaces.flatMap((ns) => ns.ops.map((op) => op.op)));
    for (const op of ALL_OPS) {
      expect(covered.has(op.op), `dashboard namespace missing ${op.op}`).toBe(true);
    }
    // Namespace names are snake_case resource names (the CLI maps them to
    // kebab-case command groups at build time).
    for (const ns of namespaces) {
      expect(ns.resource).toMatch(/^[a-z0-9_]+$/);
      expect(ns.ops.length).toBeGreaterThan(0);
    }
  });
});
