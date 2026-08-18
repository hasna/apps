import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerAutomationsStore } from "../server/store.js";
import { runAutomationsDaemonCli } from "./index.js";

const hasUnfencedComplete: "completeAction" extends keyof ServerAutomationsStore ? true : false = false;
const hasUnfencedFail: "failAction" extends keyof ServerAutomationsStore ? true : false = false;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("automations daemon server store", () => {
  test("server mutations expose only fence-carrying completion and failure", () => {
    expect(hasUnfencedComplete).toBe(false);
    expect(hasUnfencedFail).toBe(false);
  });

  test("status awaits the selected async server store and closes it", async () => {
    const calls: string[] = [];
    const output = spyOn(console, "log").mockImplementation(() => undefined);
    const store = {
      async status() {
        calls.push("status");
        return { service: "automations", backend: "test" };
      },
      async close() {
        await Bun.sleep(1);
        calls.push("close");
      },
    } as unknown as ServerAutomationsStore;

    try {
      const exitCode = await runAutomationsDaemonCli(["--json", "status"], {
        openStore: async () => {
          calls.push("open");
          return store;
        },
      });

      expect(exitCode).toBe(0);
      expect(calls).toEqual(["open", "status", "close"]);
      expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
        service: "automations",
        backend: "test",
      });
    } finally {
      output.mockRestore();
    }
  });

  test("run once awaits the selected async server store heartbeat and close", async () => {
    const calls: string[] = [];
    const output = spyOn(console, "log").mockImplementation(() => undefined);
    const directory = mkdtempSync(join(tmpdir(), "automations-daemon-"));
    temporaryDirectories.push(directory);
    const store = {
      async heartbeatDaemon() {
        await Bun.sleep(1);
        calls.push("heartbeat");
        return {
          id: "lease-test",
          pid: process.pid,
          heartbeat_at: "2026-08-11T00:00:00.000Z",
        };
      },
      async close() {
        await Bun.sleep(1);
        calls.push("close");
      },
    } as unknown as ServerAutomationsStore;

    try {
      const exitCode = await runAutomationsDaemonCli(
        ["--dir", directory, "--json", "run", "--once"],
        {
          openStore: async () => {
            calls.push("open");
            return store;
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(calls).toEqual(["open", "heartbeat", "close"]);
      expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
        ok: true,
        leaseId: "lease-test",
        once: true,
      });
    } finally {
      output.mockRestore();
    }
  });
});
