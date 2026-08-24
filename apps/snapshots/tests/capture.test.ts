import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureAll, isRestartableCommand } from "../src/capture/index.js";
import { claudeProjectSlug } from "../src/capture/resume.js";
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

describe("isRestartableCommand", () => {
  test("detects opencode2 resume invocations", () => {
    expect(isRestartableCommand("opencode2 --continue")).toBe(true);
    expect(isRestartableCommand("opencode2 -c")).toBe(true);
    expect(isRestartableCommand("opencode2 --session ses_fcd9fb83ffferR1QLpM2U6euUN")).toBe(true);
    expect(isRestartableCommand("opencode2 -s ses_fcd9fb83ffferR1QLpM2U6euUN")).toBe(true);
    expect(isRestartableCommand("opencode2 --continue --prompt \"fix the tests\"")).toBe(true);
  });

  test("does not mark plain opencode2 invocations restartable", () => {
    expect(isRestartableCommand("opencode2 run \"fix the tests\"")).toBe(false);
    expect(isRestartableCommand("opencode2 --help")).toBe(false);
    expect(isRestartableCommand("opencode2 --version")).toBe(false);
  });

  test("keeps classic agent resume detection", () => {
    expect(isRestartableCommand("claude --resume")).toBe(true);
    expect(isRestartableCommand("codex --resume")).toBe(true);
    expect(isRestartableCommand("codewith --resume")).toBe(true);
    expect(isRestartableCommand("claude")).toBe(false);
  });

  test("keeps the explicit restartable marker", () => {
    expect(isRestartableCommand("env HASNA_SNAPSHOTS_RESTARTABLE=1 sleep 60")).toBe(true);
  });
});

describe("tmux pane resume identity", () => {
  test("enriches pane records with opencode2 and claude session identity", async () => {
    if (!commandExists("tmux")) return;
    const socket = `snapshots-resume-${Date.now()}`;
    const root = mkdtempSync(join(tmpdir(), "snapshots-resume-tmux-"));
    const cwd = join(root, "pane-cwd");
    mkdirSync(cwd, { recursive: true });

    const opencodeDb = join(root, "opencode.db");
    const db = new Database(opencodeDb, { create: true });
    db.exec(`
      CREATE TABLE session_v2 (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        directory TEXT NOT NULL,
        version TEXT NOT NULL,
        title TEXT,
        agent TEXT,
        model TEXT,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      );
    `);
    db.query(
      `INSERT INTO session_v2 (id, project_id, slug, directory, version, title, agent, model, time_created, time_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("ses_fixture", "p1", "s1", cwd, "v", "fixture session", "build", "{\"id\":\"deepseek-v4-flash\"}", 1_787_000_000_000, 1_787_556_333_337);
    db.close();

    const claudeDir = join(root, "claude-projects");
    const slugDir = join(claudeDir, claudeProjectSlug(cwd));
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(
      join(slugDir, "session.jsonl"),
      `${JSON.stringify({ type: "user", cwd, sessionId: "claude-fixture", timestamp: "2026-08-24T00:00:00.000Z" })}\n`
    );

    process.env.HASNA_SNAPSHOTS_TMUX_SOCKET = socket;
    process.env.HASNA_SNAPSHOTS_OPENCODE_DB = opencodeDb;
    process.env.HASNA_SNAPSHOTS_CLAUDE_PROJECTS_DIR = claudeDir;
    try {
      const created = runCommand("tmux", ["-L", socket, "new-session", "-d", "-s", "resume-pane", "-c", cwd, "sleep 60"], 5_000);
      if (!created.ok) return;
      const result = await captureAll({ include: ["tmux"], now: "2026-06-19T00:00:00.000Z" });
      const pane = result.resources.find((resource) => resource.kind === "tmux-pane" && resource.name.startsWith("resume-pane:"));

      expect(pane?.attributes.resume_identity).toMatchObject({
        opencode2: expect.objectContaining({
          session_id: "ses_fixture",
          directory: cwd,
          title: "fixture session",
          model_id: "deepseek-v4-flash",
          time_updated_ms: 1_787_556_333_337
        }),
        claude: expect.objectContaining({
          session_id: "claude-fixture",
          cwd,
          file: "session.jsonl"
        })
      });
    } finally {
      runCommand("tmux", ["-L", socket, "kill-server"], 5_000);
      delete process.env.HASNA_SNAPSHOTS_TMUX_SOCKET;
      delete process.env.HASNA_SNAPSHOTS_OPENCODE_DB;
      delete process.env.HASNA_SNAPSHOTS_CLAUDE_PROJECTS_DIR;
    }
  });

  test("reports absent resume identity sources as info diagnostics without failing capture", async () => {
    if (!commandExists("tmux")) return;
    const socket = `snapshots-resume-missing-${Date.now()}`;
    const root = mkdtempSync(join(tmpdir(), "snapshots-resume-missing-"));
    process.env.HASNA_SNAPSHOTS_TMUX_SOCKET = socket;
    process.env.HASNA_SNAPSHOTS_OPENCODE_DB = join(root, "absent.db");
    process.env.HASNA_SNAPSHOTS_CLAUDE_PROJECTS_DIR = join(root, "absent-claude");
    try {
      const created = runCommand("tmux", ["-L", socket, "new-session", "-d", "-s", "resume-missing", "sleep 60"], 5_000);
      if (!created.ok) return;
      const result = await captureAll({ include: ["tmux"], now: "2026-06-19T00:00:00.000Z" });
      const pane = result.resources.find((resource) => resource.kind === "tmux-pane" && resource.name.startsWith("resume-missing:"));

      expect(pane?.attributes.resume_identity).toEqual({ opencode2: null, claude: null });
      expect(result.diagnostics.some((d) => d.source === "resume-identity" && d.level === "info" && d.message.includes("opencode2"))).toBe(true);
      expect(result.diagnostics.some((d) => d.source === "resume-identity" && d.level === "info" && d.message.includes("Claude"))).toBe(true);
      expect(result.diagnostics.filter((d) => d.source === "resume-identity")).toHaveLength(2);
    } finally {
      runCommand("tmux", ["-L", socket, "kill-server"], 5_000);
      delete process.env.HASNA_SNAPSHOTS_TMUX_SOCKET;
      delete process.env.HASNA_SNAPSHOTS_OPENCODE_DB;
      delete process.env.HASNA_SNAPSHOTS_CLAUDE_PROJECTS_DIR;
    }
  });
});
