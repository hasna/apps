// Regression test (BUG 2796806b remediation cycle one): `mementos export`
// targets up to 10000 rows and must assemble the full population in api mode
// even though the server caps single responses at 1000 rows. Before the fix
// it called `listMemories({limit: 10000})`, which silently returned exactly
// one capped page under the bounded-page contract.

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

const ROWS = 1500; // > 1000: must be assembled across two capped pages
const CLI_PATH = new URL("../index.tsx", import.meta.url).pathname;
let stub: MemoriesPageStubProcess;

beforeAll(async () => {
  stub = startMemoriesPageStubProcess(ROWS);
  await waitForMemoriesPageStub(stub.baseUrl);
});

afterAll(() => {
  stub.stop();
});

describe("mementos export full population in api mode", () => {
  test("exports the full population from a capped server, not one 1000-row page", async () => {
    const outFile = join(tmpdir(), `mementos-export-pcap-${Date.now()}-${Math.random()}.txt`);
    const errFile = join(tmpdir(), `mementos-export-pcap-err-${Date.now()}-${Math.random()}.txt`);
    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "export", "--format", "json"],
      { env: apiModeTestEnv(stub.baseUrl), stdout: Bun.file(outFile), stderr: Bun.file(errFile) },
    );
    const exitCode = await proc.exited;
    const stdout = existsSync(outFile) ? (await Bun.file(outFile).text()).trim() : "";
    const stderr = existsSync(errFile) ? (await Bun.file(errFile).text()).trim() : "";
    for (const f of [outFile, errFile]) if (existsSync(f)) unlinkSync(f);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("error:");
    const parsed = JSON.parse(stdout) as Array<{ id: string }>;
    expect(parsed.length).toBe(ROWS);
  });
});
