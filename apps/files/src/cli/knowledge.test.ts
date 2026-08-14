import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");
let testDir: string | undefined;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("knowledge CLI", () => {
  test("exports manifests, resolves refs, and polls outbox events as JSON", () => {
    testDir = mkdtempSync(join(tmpdir(), "files-knowledge-cli-"));
    const sourceRoot = join(testDir, "source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "notes.md"), "# Notes\nhello knowledge\n");
    const env = {
      ...process.env,
      HASNA_FILES_DATA_DIR: testDir,
      HASNA_FILES_DB_PATH: join(testDir, "files.db"),
    };

    expect(Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "add", sourceRoot, "--name", "docs"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    }).exitCode).toBe(0);
    expect(Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "index"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    }).exitCode).toBe(0);

    const sourcesProc = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const sources = JSON.parse(new TextDecoder().decode(sourcesProc.stdout)) as Array<{ id: string; name: string }>;
    const source = sources.find((entry) => entry.name === "docs")!;

    const listProc = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const files = JSON.parse(new TextDecoder().decode(listProc.stdout)) as Array<{ id: string; name: string }>;
    const file = files.find((entry) => entry.name === "notes.md")!;

    const manifestProc = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "knowledge", "manifest", "--source", source.id, "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(manifestProc.exitCode).toBe(0);
    const manifest = JSON.parse(new TextDecoder().decode(manifestProc.stdout)) as {
      items: Array<{ kind: string; file_id: string; source_revision_hash: string }>;
      delta_cursor: string;
    };
    expect(manifest.items[0]).toMatchObject({
      kind: "file",
      file_id: file.id,
    });
    expect(manifest.items[0]!.source_revision_hash).toMatch(/^sha256:/);
    expect(manifest.delta_cursor).toBeDefined();

    const resolveProc = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "knowledge", "resolve", `open-files://file/${file.id}`, "--mode", "metadata", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(resolveProc.exitCode).toBe(0);
    const resolved = JSON.parse(new TextDecoder().decode(resolveProc.stdout)) as {
      status: string;
      file_id: string;
      permissions: { mode: string; write: boolean };
    };
    expect(resolved.status).toBe("ready");
    expect(resolved.file_id).toBe(file.id);
    expect(resolved.permissions).toEqual(expect.objectContaining({ mode: "read_only", write: false }));

    const doctorProc = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "knowledge", "doctor", `open-files://file/${file.id}`, "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(doctorProc.exitCode).toBe(0);
    const doctor = JSON.parse(new TextDecoder().decode(doctorProc.stdout)) as {
      checked_count: number;
      checks: Array<{ status: string; recommendation: string; issue_codes: string[] }>;
    };
    expect(doctor.checked_count).toBe(1);
    expect(doctor.checks[0]).toMatchObject({
      status: "ready",
      recommendation: "none",
      issue_codes: [],
    });

    const outboxProc = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "knowledge", "outbox", "poll", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(outboxProc.exitCode).toBe(0);
    const outbox = JSON.parse(new TextDecoder().decode(outboxProc.stdout)) as {
      events: Array<{ cursor: number; event_type: string; file_id?: string }>;
      next_cursor: number;
    };
    expect(outbox.events.some((event) => event.event_type === "indexed" && event.file_id === file.id)).toBe(true);

    const ackProc = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "knowledge", "outbox", "ack", "knowledge-cli-test", String(outbox.next_cursor), "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(ackProc.exitCode).toBe(0);
    const checkpoint = JSON.parse(new TextDecoder().decode(ackProc.stdout)) as { consumer_id: string; cursor: number };
    expect(checkpoint).toMatchObject({ consumer_id: "knowledge-cli-test", cursor: outbox.next_cursor });
  });
});
