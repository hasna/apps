import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGhosttyTranscript } from "./transcript.js";

describe("Ghostty terminal transcript preparation", () => {
  test("creates an operator manifest while keeping the public summary command-free", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "occtrl-transcript-"));
    const transcript = await createGhosttyTranscript({
      id: "tr-test",
      now: new Date("2026-06-18T00:00:00.000Z"),
      dataDir,
      tabs: [{ rows: 1, cols: 2 }],
      commands: ["echo secret", "pwd"],
      dir: "/workspace/project",
    });

    expect(transcript).toBeDefined();
    expect(transcript!.summary.commandCount).toBe(2);
    expect(JSON.stringify(transcript!.summary)).not.toContain("echo secret");
    expect(transcript!.summary.manifestPath).toBe(join(dataDir, "terminal-transcripts", "tr-test", "manifest.json"));
    expect(transcript!.plan.panes[0]).toEqual(expect.objectContaining({
      paneIndex: 0,
      logPath: expect.stringContaining("pane-0.log"),
      statusPath: expect.stringContaining("pane-0.status"),
    }));

    const manifest = JSON.parse(await readFile(transcript!.manifestPath, "utf8"));
    expect(manifest.schema_version).toBe("open-computer.terminal-transcript.v1");
    expect(manifest.command_count).toBe(2);
    expect(manifest.panes[0].command).toBe("echo secret");
    expect(manifest.panes[0].commandHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("skips transcript creation when no pane has a command", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "occtrl-transcript-empty-"));
    const transcript = await createGhosttyTranscript({
      id: "tr-empty",
      dataDir,
      tabs: [{ rows: 1, cols: 1 }],
      commands: [undefined],
    });

    expect(transcript).toBeUndefined();
  });

  test("captures dir-only pane setup as a transcript entry", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "occtrl-transcript-dir-"));
    const transcript = await createGhosttyTranscript({
      id: "tr-dir",
      dataDir,
      tabs: [{ rows: 1, cols: 1 }],
      commands: [undefined],
      dir: "/workspace/project",
    });

    expect(transcript).toBeDefined();
    expect(transcript!.summary.commandCount).toBe(1);
    const manifest = JSON.parse(await readFile(transcript!.manifestPath, "utf8"));
    expect(manifest.panes[0].command).toBe("cd '/workspace/project'");
  });
});
