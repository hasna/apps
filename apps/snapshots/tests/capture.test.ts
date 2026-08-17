import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureAll } from "../src/capture/index.js";
import { commandExists, runCommand } from "../src/util.js";

describe("captureAll", () => {
  test("honors an explicitly empty source selection", async () => {
    const result = await captureAll({ include: [], now: "2026-06-19T00:00:00.000Z" });

    expect(result).toEqual({ resources: [], diagnostics: [], sourceStatuses: [] });
  });

  test("always captures the local machine resource", async () => {
    const result = await captureAll({ include: ["machine"], now: "2026-06-19T00:00:00.000Z" });

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].kind).toBe("machine");
    expect(result.resources[0].attributes.hostname).toBeTruthy();
    expect(result.sourceStatuses?.[0]).toMatchObject({ source: "machine", ok: true, resourceCount: 1 });
  });

  test("uses the caller cwd and configured machine id without changing the observed time", async () => {
    const previousMachineId = process.env.HASNA_MACHINE_ID;
    process.env.HASNA_MACHINE_ID = "machine-fixture";
    try {
      const result = await captureAll({
        include: ["machine"],
        cwd: "/tmp/snapshots-capture-cwd",
        now: "2026-06-19T01:02:03.000Z"
      });
      const machine = result.resources[0];

      expect(machine?.id).toBe("machine:machine-fixture");
      expect(machine?.observedAt).toBe("2026-06-19T01:02:03.000Z");
      expect(machine?.attributes.cwd).toBe("/tmp/snapshots-capture-cwd");
      expect(machine?.attributes.hasna_machine_id).toBe("machine-fixture");
    } finally {
      if (previousMachineId === undefined) delete process.env.HASNA_MACHINE_ID;
      else process.env.HASNA_MACHINE_ID = previousMachineId;
    }
  });

  test("turns missing optional integrations into diagnostics", async () => {
    const result = await captureAll({ include: ["browser"], now: "2026-06-19T00:00:00.000Z" });

    expect(result.resources.every((resource) => resource.kind === "browser-state" || resource.kind === "diagnostic")).toBe(true);
  });

  test("reports a deterministic browser miss as a healthy informational diagnostic", async () => {
    const previousBrowserDir = process.env.HASNA_BROWSER_DIR;
    process.env.HASNA_BROWSER_DIR = join(mkdtempSync(join(tmpdir(), "snapshots-browser-missing-")), "absent");
    try {
      const result = await captureAll({ include: ["browser"], now: "2026-06-19T00:00:00.000Z" });
      const diagnostic = result.resources[0];

      expect(result.diagnostics).toEqual([
        expect.objectContaining({ source: "browser", level: "info", message: "No local browser state directory found." })
      ]);
      expect(diagnostic).toMatchObject({ kind: "diagnostic", source: "browser", observedAt: "2026-06-19T00:00:00.000Z" });
      expect(diagnostic?.attributes.level).toBe("info");
      expect(result.sourceStatuses).toEqual([
        expect.objectContaining({ source: "browser", ok: true, resourceCount: 0, diagnosticCount: 1 })
      ]);
    } finally {
      if (previousBrowserDir === undefined) delete process.env.HASNA_BROWSER_DIR;
      else process.env.HASNA_BROWSER_DIR = previousBrowserDir;
    }
  });

  test("captures a bounded current process inventory", async () => {
    const result = await captureAll({ include: ["processes"], now: "2026-06-19T00:00:00.000Z" });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.resources.every((resource) => resource.kind === "process")).toBe(true);
    expect(result.resources.every((resource) => resource.observedAt === "2026-06-19T00:00:00.000Z")).toBe(true);
    expect(result.sourceStatuses).toEqual([
      expect.objectContaining({ source: "processes", ok: true, diagnosticCount: 0 })
    ]);
  });

  test("captures restartable metadata for tmux panes", async () => {
    if (!commandExists("tmux")) return;
    const socket = `snapshots-capture-${Date.now()}`;
    process.env.HASNA_SNAPSHOTS_TMUX_SOCKET = socket;
    try {
      const command = "env HASNA_SNAPSHOTS_RESTARTABLE=1 HASNA_SNAPSHOTS_PROCESS_ID=capture-pane sleep 60";
      const created = runCommand("tmux", ["-L", socket, "new-session", "-d", "-s", "capture-pane", command], 5_000);
      if (!created.ok) return;
      const result = await captureAll({ include: ["tmux"], now: "2026-06-19T00:00:00.000Z" });
      const pane = result.resources.find((resource) => resource.kind === "tmux-pane" && resource.name.startsWith("capture-pane:"));

      expect(pane?.attributes.restartable).toBe(true);
    } finally {
      runCommand("tmux", ["-L", socket, "kill-server"], 5_000);
      delete process.env.HASNA_SNAPSHOTS_TMUX_SOCKET;
    }
  });

  test("can skip tmux pane tails for faster daemon captures", async () => {
    if (!commandExists("tmux")) return;
    const socket = `snapshots-capture-fast-${Date.now()}`;
    process.env.HASNA_SNAPSHOTS_TMUX_SOCKET = socket;
    try {
      const created = runCommand("tmux", ["-L", socket, "new-session", "-d", "-s", "capture-fast", "sleep 60"], 5_000);
      if (!created.ok) return;
      const result = await captureAll({ include: ["tmux"], now: "2026-06-19T00:00:00.000Z", tmuxPaneTailLines: 0 });
      const pane = result.resources.find((resource) => resource.kind === "tmux-pane" && resource.name.startsWith("capture-fast:"));

      expect(pane?.attributes.content_tail_skipped).toBe(true);
      expect(pane?.attributes.content_tail).toBe("");
    } finally {
      runCommand("tmux", ["-L", socket, "kill-server"], 5_000);
      delete process.env.HASNA_SNAPSHOTS_TMUX_SOCKET;
    }
  });
});
