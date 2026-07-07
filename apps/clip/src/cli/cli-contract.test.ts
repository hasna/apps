import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runCli(args: string[], env: Record<string, string | undefined>): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.ts", "--json", ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("CLI JSON contract", () => {
  it("emits parseable JSON for share/list/status", async () => {
    const home = mkdtempSync(join(tmpdir(), "clip-cli-"));
    try {
      const env = { ...process.env, HASNA_CLIP_HOME: home, CLIP_BASE_URL: "http://127.0.0.1:3741" };
      const share = await runCli(["share", "text", "hello"], env);
      expect(share.exitCode).toBe(0);
      const record = JSON.parse(share.stdout) as { id: string; slug: string };
      expect(record.id).toBeTruthy();
      expect(record.slug).toBeTruthy();

      const list = await runCli(["list"], env);
      expect(list.exitCode).toBe(0);
      expect(JSON.parse(list.stdout)).toHaveLength(1);

      const status = await runCli(["status"], env);
      expect(status.exitCode).toBe(0);
      expect((JSON.parse(status.stdout) as { storage: { totalActive: number } }).storage.totalActive).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("captures, lists, and re-shares opt-in clipboard history", async () => {
    const home = mkdtempSync(join(tmpdir(), "clip-cli-history-"));
    const binDir = join(home, "bin");
    try {
      mkdirSync(binDir);
      const wlPaste = join(binDir, "wl-paste");
      writeFileSync(wlPaste, "#!/usr/bin/env bash\nif [ \"$1\" = \"--no-newline\" ]; then printf 'cli history text'; else exit 2; fi\n");
      chmodSync(wlPaste, 0o755);
      const env = {
        ...process.env,
        PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
        HASNA_CLIP_HOME: home,
        CLIP_BASE_URL: "http://127.0.0.1:3741",
      };

      const clipboardShare = await runCli(["clipboard", "--kind", "text"], env);
      expect(clipboardShare.exitCode).toBe(0);

      const emptyHistory = await runCli(["history"], env);
      expect(emptyHistory.exitCode).toBe(0);
      expect(JSON.parse(emptyHistory.stdout)).toHaveLength(0);

      const capture = await runCli(["history", "capture", "--kind", "text", "--title", "CLI history", "--max-items", "2"], env);
      expect(capture.exitCode).toBe(0);
      const entry = JSON.parse(capture.stdout) as { id: string; slug: string; kind: string; text: string };
      expect(entry.id).toBeTruthy();
      expect(entry.kind).toBe("clipboard-text");
      expect(entry.text).toBe("cli history text");

      const history = await runCli(["history", "list"], env);
      expect(history.exitCode).toBe(0);
      expect((JSON.parse(history.stdout) as unknown[])).toHaveLength(1);

      const reshare = await runCli(["history", "share", entry.id, "--title", "Shared from history"], env);
      expect(reshare.exitCode).toBe(0);
      const record = JSON.parse(reshare.stdout) as { kind: string; title: string; text: string; metadata: Record<string, unknown> };
      expect(record.kind).toBe("text");
      expect(record.title).toBe("Shared from history");
      expect(record.text).toBe("cli history text");
      expect(record.metadata.clipboardHistoryId).toBe(entry.id);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
