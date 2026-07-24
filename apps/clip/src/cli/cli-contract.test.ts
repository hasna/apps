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

  it("emits additive evidence and resource contracts when requested", async () => {
    const home = mkdtempSync(join(tmpdir(), "clip-cli-contracts-"));
    try {
      const env = { ...process.env, HASNA_CLIP_HOME: home, CLIP_BASE_URL: "http://127.0.0.1:3741" };
      const share = Bun.spawn(["bun", "run", "src/cli/index.ts", "share", "text", "hello", "--contract"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const shareOut = await new Response(share.stdout).text();
      expect(await share.exited).toBe(0);
      const evidence = JSON.parse(shareOut) as { schema: string; kind: string; resourceRefs: Array<{ kind: string; uri?: string }> };
      expect(evidence.schema).toBe("hasna.evidence_ref.v1");
      expect(evidence.kind).toBe("url");
      expect(evidence.resourceRefs).toHaveLength(1);
      expect(evidence.resourceRefs[0]?.kind).toBe("url");

      const list = Bun.spawn(["bun", "run", "src/cli/index.ts", "list", "--contract", "resources"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const listOut = await new Response(list.stdout).text();
      expect(await list.exited).toBe(0);
      const resources = JSON.parse(listOut) as Array<{ schema: string; kind: string; uri?: string }>;
      expect(resources).toHaveLength(1);
      expect(resources[0]?.schema).toBe("hasna.resource_ref.v1");
      expect(resources[0]?.kind).toBe("url");
      expect(resources[0]?.uri).toStartWith("http://127.0.0.1:3741/s/");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps show output unchanged unless a contract flag is present", async () => {
    const home = mkdtempSync(join(tmpdir(), "clip-cli-show-"));
    try {
      const env = { ...process.env, HASNA_CLIP_HOME: home, CLIP_BASE_URL: "http://127.0.0.1:3741" };
      const share = Bun.spawn(["bun", "run", "src/cli/index.ts", "--json", "share", "text", "show me"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const shareOut = await new Response(share.stdout).text();
      expect(await share.exited).toBe(0);
      const record = JSON.parse(shareOut) as { slug: string; text: string };

      const show = Bun.spawn(["bun", "run", "src/cli/index.ts", "show", record.slug], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const showOut = await new Response(show.stdout).text();
      expect(await show.exited).toBe(0);
      expect(showOut).toStartWith("{\n");
      expect((JSON.parse(showOut) as { slug: string; text: string }).text).toBe("show me");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not expose local file paths through contract output", async () => {
    const home = mkdtempSync(join(tmpdir(), "clip-cli-file-contract-"));
    try {
      const file = join(home, "private-source.txt");
      writeFileSync(file, "private bytes");
      const env = { ...process.env, HASNA_CLIP_HOME: home, CLIP_BASE_URL: "http://127.0.0.1:3741" };
      const share = Bun.spawn(["bun", "run", "src/cli/index.ts", "share", "file", file, "--contract", "all"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const shareOut = await new Response(share.stdout).text();
      expect(await share.exited).toBe(0);
      expect(shareOut).not.toContain(file);
      expect(shareOut).not.toContain("artifactPath");
      expect(shareOut).toContain("hasna.evidence_ref.v1");
      expect(shareOut).toContain("hasna.resource_ref.v1");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("previews prune by default and only deletes expired artifacts with --apply", async () => {
    const home = mkdtempSync(join(tmpdir(), "clip-cli-prune-"));
    try {
      const env = { ...process.env, HASNA_CLIP_HOME: home, CLIP_BASE_URL: "http://127.0.0.1:3741" };
      const expiredSource = join(home, "expired.txt");
      const activeSource = join(home, "active.txt");
      writeFileSync(expiredSource, "expired");
      writeFileSync(activeSource, "active");

      const expiredShare = Bun.spawn([
        "bun",
        "run",
        "src/cli/index.ts",
        "--json",
        "share",
        "file",
        expiredSource,
        "--expires-at",
        "2000-01-01T00:00:00.000Z",
      ], { env, stdout: "pipe", stderr: "pipe" });
      const expiredOut = await new Response(expiredShare.stdout).text();
      expect(await expiredShare.exited).toBe(0);
      const expiredRecord = JSON.parse(expiredOut) as { id: string; artifactPath: string };

      const activeShare = Bun.spawn([
        "bun",
        "run",
        "src/cli/index.ts",
        "--json",
        "share",
        "file",
        activeSource,
        "--ttl",
        "1w",
      ], { env, stdout: "pipe", stderr: "pipe" });
      const activeOut = await new Response(activeShare.stdout).text();
      expect(await activeShare.exited).toBe(0);
      const activeRecord = JSON.parse(activeOut) as { id: string; artifactPath: string; expiresAt: string };
      expect(new Date(activeRecord.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const orphanPath = join(home, "artifacts", `${crypto.randomUUID()}.bin`);
      const unrelatedPath = join(home, "artifacts", "notes.txt");
      writeFileSync(orphanPath, "orphan");
      writeFileSync(unrelatedPath, "not a generated clip artifact");

      const preview = Bun.spawn(["bun", "run", "src/cli/index.ts", "--json", "prune"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const previewOut = await new Response(preview.stdout).text();
      expect(await preview.exited).toBe(0);
      const previewResult = JSON.parse(previewOut) as { dryRun: boolean; expiredShares: Array<{ id: string }>; artifacts: Array<{ path: string }> };
      expect(previewResult.dryRun).toBe(true);
      expect(previewResult.expiredShares.map((share) => share.id)).toContain(expiredRecord.id);
      expect(previewResult.artifacts.map((artifact) => artifact.path)).toEqual(expect.arrayContaining([expiredRecord.artifactPath, orphanPath]));
      expect(existsSync(expiredRecord.artifactPath)).toBe(true);
      expect(existsSync(orphanPath)).toBe(true);
      expect(existsSync(unrelatedPath)).toBe(true);

      const apply = Bun.spawn(["bun", "run", "src/cli/index.ts", "--json", "prune", "--apply"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const applyOut = await new Response(apply.stdout).text();
      expect(await apply.exited).toBe(0);
      const applyResult = JSON.parse(applyOut) as { dryRun: boolean; prunedShares: number; removedArtifacts: number };
      expect(applyResult).toMatchObject({ dryRun: false, prunedShares: 1, removedArtifacts: 2 });
      expect(existsSync(expiredRecord.artifactPath)).toBe(false);
      expect(existsSync(orphanPath)).toBe(false);
      expect(existsSync(unrelatedPath)).toBe(true);
      expect(existsSync(activeRecord.artifactPath)).toBe(true);

      const list = Bun.spawn(["bun", "run", "src/cli/index.ts", "--json", "list"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const listOut = await new Response(list.stdout).text();
      expect(await list.exited).toBe(0);
      expect((JSON.parse(listOut) as Array<{ id: string }>).map((record) => record.id)).toEqual([activeRecord.id]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
