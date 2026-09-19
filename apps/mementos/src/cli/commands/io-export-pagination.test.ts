// Export defaults to a byte-bounded receipt. Every advertised continuation must
// be directly executable, while --all is the explicit exhaustive legacy array.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  startMemoriesPageStubProcess,
  waitForMemoriesPageStub,
  apiModeTestEnv,
  type MemoriesPageStubProcess,
} from "../../test-support/memories-page-stub.js";

const ROWS = 1500;
const CLI_PATH = new URL("../index.tsx", import.meta.url).pathname;
let stub: MemoriesPageStubProcess;

beforeAll(async () => {
  stub = startMemoriesPageStubProcess(ROWS);
  await waitForMemoriesPageStub(stub.baseUrl);
});

afterAll(() => {
  stub.stop();
});

async function runExport(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const outFile = join(tmpdir(), `mementos-export-${Date.now()}-${Math.random()}.txt`);
  const errFile = join(tmpdir(), `mementos-export-err-${Date.now()}-${Math.random()}.txt`);
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "export", ...args], {
    env: apiModeTestEnv(stub.baseUrl),
    stdout: Bun.file(outFile),
    stderr: Bun.file(errFile),
  });
  const exitCode = await proc.exited;
  const stdout = existsSync(outFile) ? (await Bun.file(outFile).text()).trim() : "";
  const stderr = existsSync(errFile) ? (await Bun.file(errFile).text()).trim() : "";
  for (const file of [outFile, errFile]) if (existsSync(file)) unlinkSync(file);
  return { stdout, stderr, exitCode };
}

interface ExportReceipt {
  memories: Array<{ id: string }>;
  _meta: {
    count: number;
    offset: number;
    has_more: boolean;
    next_cursor: number | null;
    complete: boolean;
    truncated: boolean;
    truncation_reason: string | null;
    next_arguments: { cursor: number; limit: number; max_bytes: number; scope?: string } | null;
  };
}

describe("mementos export pagination in api mode", () => {
  test("advertised continuation is directly executable and non-overlapping", async () => {
    const firstResult = await runExport("--scope", "shared");
    expect(firstResult.exitCode).toBe(0);
    expect(firstResult.stderr).not.toContain("error:");
    const first = JSON.parse(firstResult.stdout) as ExportReceipt;
    expect(first.memories).toHaveLength(100);
    expect(first._meta).toMatchObject({ count: 100, offset: 0, has_more: true, next_cursor: 100, complete: false });
    expect(Object.keys(first._meta.next_arguments!).sort()).toEqual(["cursor", "limit", "max_bytes", "scope"]);
    expect(first._meta.next_arguments!.scope).toBe("shared");

    const next = first._meta.next_arguments!;
    const secondResult = await runExport(
      "--cursor", String(next.cursor),
      "--limit", String(next.limit),
      "--max-bytes", String(next.max_bytes),
      "--scope", next.scope!,
    );
    expect(secondResult.exitCode).toBe(0);
    const second = JSON.parse(secondResult.stdout) as ExportReceipt;
    expect(second._meta.offset).toBe(next.cursor);
    const firstIds = new Set(first.memories.map((memory) => memory.id));
    expect(second.memories.some((memory) => firstIds.has(memory.id))).toBe(false);
  });

  test("terminal paginated receipt is not marked truncated and has no reason", async () => {
    const result = await runExport("--cursor", "1490", "--limit", "20");
    expect(result.exitCode).toBe(0);
    const terminal = JSON.parse(result.stdout) as ExportReceipt;
    expect(terminal.memories).toHaveLength(10);
    expect(terminal._meta).toMatchObject({
      offset: 1490,
      has_more: false,
      next_cursor: null,
      truncated: false,
      truncation_reason: null,
      next_arguments: null,
    });
  });

  test("--all is the explicit exhaustive legacy bare array", async () => {
    const result = await runExport("--all");
    expect(result.exitCode).toBe(0);
    const all = JSON.parse(result.stdout) as Array<{ id: string }>;
    expect(Array.isArray(all)).toBe(true);
    expect(all).toHaveLength(ROWS);
  });
});
