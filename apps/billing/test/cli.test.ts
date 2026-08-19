// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19).
//
// Priority 4 — CLI behavior through the real commander program (no TTY
// required): openapi generate writes the document to a temporary path and
// prints the {ok:true,wrote} envelope; openapi check returns {ok:false} and
// exit code 1 for a stale document and {ok:true} for a current one; malformed
// --input produces a ValidationError; an unknown operation returns the
// {ok:false,error} envelope; and the dashboard's data source (cliNamespaces)
// covers every registry op.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
let originalExitCode: number;

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
  originalExitCode = process.exitCode;
});
afterEach(() => {
  restoreStdout();
  process.exitCode = originalExitCode;
  closeDatabase();
});

function cliArgs(command: string[]): string[] {
  return ["node", "billing", ...command];
}

async function runCli(program: Command, command: string[]): Promise<void> {
  await program.parseAsync(cliArgs(command));
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

  it("flags a stale document with {ok:false} and exit code 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-cli-"));
    const stalePath = join(dir, "stale.json");
    // A byte-different document (extra whitespace) is stale.
    writeFileSync(stalePath, `${openApiJson()}\n`);
    const program = buildProgram();
    await runCli(program, ["openapi", "check", "--path", stalePath]);
    expect(JSON.parse(captured.join(""))).toEqual({ ok: false, error: "openapi.json is stale; run `billing openapi generate`." });
    expect(process.exitCode).toBe(1);
  });

  it("accepts a current document with {ok:true} and leaves the exit code untouched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-cli-"));
    const currentPath = join(dir, "current.json");
    writeFileSync(currentPath, openApiJson());
    const program = buildProgram();
    process.exitCode = 0;
    await runCli(program, ["openapi", "check", "--path", currentPath]);
    expect(JSON.parse(captured.join(""))).toEqual({ ok: true, path: currentPath });
    expect(process.exitCode).toBe(0);
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
