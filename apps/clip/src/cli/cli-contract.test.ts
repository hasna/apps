import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function isolatedClipEnv(home: string): NodeJS.ProcessEnv {
  const env = { ...process.env, HASNA_CLIP_HOME: home };
  delete env["HASNA_CLIP_DB_PATH"];
  delete env["CLIP_DB_PATH"];
  delete env["HASNA_CLIP_ARTIFACT_DIR"];
  return env;
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

  it("renders QR output for show and copy-link without replacing JSON contracts", async () => {
    const home = mkdtempSync(join(tmpdir(), "clip-cli-qr-"));
    try {
      const env = { ...process.env, HASNA_CLIP_HOME: home, CLIP_BASE_URL: "http://phone.lan:3741" };
      const share = Bun.spawn(["bun", "run", "src/cli/index.ts", "--json", "share", "text", "hello"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const shareOut = await new Response(share.stdout).text();
      expect(await share.exited).toBe(0);
      const record = JSON.parse(shareOut) as { id: string; slug: string; shareUrl: string };
      const expectedShareUrl = `http://phone.lan:3741/s/${record.slug}`;
      expect(record.shareUrl).toBe(expectedShareUrl);

      const showQr = Bun.spawn(["bun", "run", "src/cli/index.ts", "show", record.slug, "--qr"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const showQrOut = await new Response(showQr.stdout).text();
      expect(await showQr.exited).toBe(0);
      expect(showQrOut).toContain("\u001b[40m");
      expect(showQrOut).toContain("\u001b[47m");
      expect(showQrOut).toContain(expectedShareUrl);

      const copyLinkQr = Bun.spawn(["bun", "run", "src/cli/index.ts", "copy-link", record.id, "--qr"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const copyLinkQrOut = await new Response(copyLinkQr.stdout).text();
      expect(await copyLinkQr.exited).toBe(0);
      expect(copyLinkQrOut).toContain("\u001b[40m");
      expect(copyLinkQrOut).toContain("\u001b[47m");
      expect(copyLinkQrOut).toContain(expectedShareUrl);

      const showJson = Bun.spawn(["bun", "run", "src/cli/index.ts", "--json", "show", record.slug, "--qr"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const showJsonOut = await new Response(showJson.stdout).text();
      expect(await showJson.exited).toBe(0);
      expect((JSON.parse(showJsonOut) as { shareUrl: string }).shareUrl).toBe(expectedShareUrl);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("requires --yes before uninstalling the local store and config", async () => {
    const root = mkdtempSync(join(tmpdir(), "clip-cli-uninstall-"));
    const home = join(root, "home");
    const sentinel = join(root, "outside.txt");
    try {
      writeFileSync(sentinel, "keep");
      const env = isolatedClipEnv(home);

      const share = await runCli(["share", "text", "hello"], env);
      expect(share.exitCode).toBe(0);

      const config = await runCli(["config", "set", "baseUrl", "http://127.0.0.1:3741"], env);
      expect(config.exitCode).toBe(0);
      expect(existsSync(join(home, "clip.db"))).toBe(true);
      expect(existsSync(join(home, "config.json"))).toBe(true);

      const refused = await runCli(["uninstall"], env);
      expect(refused.exitCode).toBe(1);
      expect((JSON.parse(refused.stdout) as { error: string }).error).toContain("--yes");
      expect(existsSync(join(home, "clip.db"))).toBe(true);
      expect(existsSync(join(home, "config.json"))).toBe(true);

      const removed = await runCli(["uninstall", "--yes"], env);
      expect(removed.exitCode).toBe(0);
      expect((JSON.parse(removed.stdout) as { removed: boolean; homeDir: string }).removed).toBe(true);
      expect(existsSync(home)).toBe(false);
      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
