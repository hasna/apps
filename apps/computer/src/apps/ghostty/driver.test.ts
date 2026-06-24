import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openGhostty } from "./driver.js";
import { clearEmergencyStop, requestEmergencyStop } from "../../agent/control.js";

describe("Ghostty driver transcript boundary", () => {
  test("emergency stop blocks app-driver terminal execution before AppleScript runs", async () => {
    let executed = false;
    requestEmergencyStop("global stop");
    try {
      const result = await openGhostty(
        {
          grid: { rows: 1, cols: 1 },
          run: ["echo secret"],
          dir: process.cwd(),
          terminalApproval: {
            approved: true,
            workspaceRoots: [process.cwd()],
            audit: false,
          },
        },
        {
          environment: { platform: "darwin", hasAppBundle: true, hasBinary: false },
          runScript: async () => {
            executed = true;
            return { ok: true, stderr: "" };
          },
        },
      );

      expect(result.ok).toBe(false);
      expect(result.message).toContain("global stop");
      expect(executed).toBe(false);
    } finally {
      clearEmergencyStop();
    }
  });

  test("emergency stop aborts app-driver AppleScript execution in flight", async () => {
    const result = await openGhostty(
      {
        grid: { rows: 1, cols: 1 },
        run: ["echo secret"],
        dir: process.cwd(),
        terminalApproval: {
          approved: true,
          workspaceRoots: [process.cwd()],
          audit: false,
        },
      },
      {
        environment: { platform: "darwin", hasAppBundle: true, hasBinary: false },
        runScript: async (_script, context) => {
          setTimeout(() => requestEmergencyStop("global stop"), 0);
          await new Promise<void>((resolve) => {
            if (context?.signal?.aborted) return resolve();
            context?.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return { ok: false, stderr: String(context?.signal?.reason ?? "missing abort") };
        },
      },
    );

    clearEmergencyStop();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("global stop");
  });

  test("approved run specs create transcript artifacts and inject capture wrapper", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "occtrl-ghostty-driver-"));
    let executedScript = "";

    const result = await openGhostty(
      {
        grid: { rows: 1, cols: 1 },
        run: ["echo secret"],
        dir: "/workspace/project",
        terminalApproval: {
          approved: true,
          workspaceRoots: ["/workspace"],
          audit: false,
        },
      },
      {
        environment: { platform: "darwin", hasAppBundle: true, hasBinary: false },
        transcriptDataDir: dataDir,
        transcriptId: "driver-tr",
        now: new Date("2026-06-18T00:00:00.000Z"),
        runScript: async (script) => {
          executedScript = script;
          return { ok: true, stderr: "" };
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(result.transcript).toBeDefined();
    expect(JSON.stringify(result.transcript)).not.toContain("echo secret");
    expect(executedScript).toContain("tee -a");
    expect(executedScript).toContain("[occtrl:driver-tr:pane-0:");

    const manifest = JSON.parse(await readFile(result.transcript!.manifestPath, "utf8"));
    expect(manifest.panes[0].command).toBe("echo secret");
    expect(manifest.panes[0].logPath).toContain("pane-0.log");
  });

  test("direct driver calls cannot execute run specs without terminal approval context", async () => {
    let executed = false;
    const result = await openGhostty(
      {
        grid: { rows: 1, cols: 1 },
        run: ["echo secret"],
        dir: process.cwd(),
      },
      {
        environment: { platform: "darwin", hasAppBundle: true, hasBinary: false },
        runScript: async () => {
          executed = true;
          return { ok: true, stderr: "" };
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("requires confirmation");
    expect(executed).toBe(false);
  });
});
