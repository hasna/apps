import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { MAX_ATTACHMENT_BYTES } from "../lib/attachments.js";
import { isolatedStoreChildEnv } from "../lib/store/isolated-test-env.js";

const TEST_ROOT = join(tmpdir(), `conversations-cli-send-attachments-${Date.now()}`);
const TEST_DB = join(TEST_ROOT, "conversations.db");
const ATTACHMENTS_DIR = join(TEST_ROOT, "attachments");
const SOURCE_DIR = join(TEST_ROOT, "source");
const CLI = ["bun", "run", "./src/cli/index.tsx"];

mkdirSync(SOURCE_DIR, { recursive: true });

function runCli(args: string[], agent: string) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: isolatedStoreChildEnv(TEST_DB, {
      CONVERSATIONS_AGENT_ID: agent,
      CONVERSATIONS_ATTACHMENTS_DIR: ATTACHMENTS_DIR,
      FORCE_COLOR: "0",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function seedChannel(channel: string): void {
  const created = runCli(["channel", "create", channel, "--from", "alice"], "alice");
  expect(created.exitCode, created.stderr).toBe(0);
  const joined = runCli(["channel", "join", channel, "--from", "bob"], "bob");
  expect(joined.exitCode, joined.stderr).toBe(0);
}

function seedRoot(channel: string): { id: number; uuid: string } {
  seedChannel(channel);
  const root = runCli([
    "send",
    "--channel",
    channel,
    "--from",
    "alice",
    "--json",
    "root message",
  ], "alice");
  expect(root.exitCode, root.stderr).toBe(0);
  return JSON.parse(root.stdout) as { id: number; uuid: string };
}

function messagesIn(channel: string): Array<Record<string, unknown>> {
  const result = runCli(["channel", "read", channel, "--from", "alice", "--json"], "alice");
  expect(result.exitCode, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Array<Record<string, unknown>>;
}

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "app_user:synthetic-password", "@db.example.invalid/app"].join("");
}

describe("send attachment and reply compatibility (e2e)", () => {
  afterAll(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test("--attach sends multiple files atomically and --reply-to preserves the exact parent", () => {
    const channel = "send-attach-reply";
    const root = seedRoot(channel);
    const textFile = join(SOURCE_DIR, "evidence.txt");
    const pdfFile = join(SOURCE_DIR, "handoff.pdf");
    writeFileSync(textFile, "synthetic attachment evidence\n");
    writeFileSync(pdfFile, "synthetic PDF placeholder\n");

    const sent = runCli([
      "send",
      "--channel",
      channel,
      "--from",
      "bob",
      "--priority",
      "high",
      "--attach",
      textFile,
      pdfFile,
      "--reply-to",
      String(root.id),
      "--json",
      "attached reply",
    ], "bob");

    expect(sent.exitCode, sent.stderr).toBe(0);
    const message = JSON.parse(sent.stdout) as {
      id: number;
      reply_to: number | null;
      priority: string;
      attachments: Array<{ name: string; path: string; size: number; mime_type: string }>;
    };
    expect(message.reply_to).toBe(root.id);
    expect(message.priority).toBe("high");
    expect(message.attachments.map((attachment) => ({
      name: attachment.name,
      size: attachment.size,
      mime_type: attachment.mime_type,
    }))).toEqual([
      {
        name: "evidence.txt",
        size: Buffer.byteLength("synthetic attachment evidence\n"),
        mime_type: "text/plain",
      },
      {
        name: "handoff.pdf",
        size: Buffer.byteLength("synthetic PDF placeholder\n"),
        mime_type: "application/pdf",
      },
    ]);
    expect(readFileSync(message.attachments[0].path, "utf8")).toBe("synthetic attachment evidence\n");
    expect(readFileSync(message.attachments[1].path, "utf8")).toBe("synthetic PDF placeholder\n");

    const shown = runCli(["show", String(message.id), "--json"], "alice");
    expect(shown.exitCode, shown.stderr).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      id: message.id,
      reply_to: root.id,
      attachments: message.attachments,
    });
  });

  test("--attachment is a migration-safe alias", () => {
    const channel = "send-attachment-alias";
    seedChannel(channel);
    const file = join(SOURCE_DIR, "alias.json");
    writeFileSync(file, "{\"synthetic\":true}\n");

    const sent = runCli([
      "send",
      "--channel",
      channel,
      "--from",
      "alice",
      "--attachment",
      file,
      "--json",
      "alias attachment",
    ], "alice");

    expect(sent.exitCode, sent.stderr).toBe(0);
    expect(JSON.parse(sent.stdout).attachments).toMatchObject([
      { name: "alias.json", mime_type: "application/json" },
    ]);
  });

  test("a missing attachment rejects the whole multi-file send before any message is stored", () => {
    const channel = "send-attachment-atomic";
    seedChannel(channel);
    const present = join(SOURCE_DIR, "present.txt");
    const missing = join(SOURCE_DIR, "missing.txt");
    writeFileSync(present, "synthetic present file\n");
    const before = messagesIn(channel);

    const sent = runCli([
      "send",
      "--channel",
      channel,
      "--from",
      "alice",
      "--attach",
      present,
      missing,
      "--json",
      "must not persist",
    ], "alice");

    expect(sent.exitCode).toBe(1);
    expect(`${sent.stdout}${sent.stderr}`).toContain("Attachment source not found");
    expect(messagesIn(channel)).toEqual(before);
  });

  test("unreadable, oversized, and unsupported attachments fail before a message is stored", () => {
    const channel = "send-attachment-validation";
    seedChannel(channel);
    const unreadable = join(SOURCE_DIR, "unreadable.txt");
    const oversized = join(SOURCE_DIR, "oversized.txt");
    const unsupported = join(SOURCE_DIR, "payload.exe");
    writeFileSync(unreadable, "synthetic unreadable file\n");
    writeFileSync(oversized, "synthetic oversized prefix\n");
    truncateSync(oversized, MAX_ATTACHMENT_BYTES + 1);
    writeFileSync(unsupported, "synthetic unsupported file\n");
    const before = messagesIn(channel);

    chmodSync(unreadable, 0);
    try {
      const unreadableResult = runCli([
        "send", "--channel", channel, "--from", "alice",
        "--attach", unreadable, "--json", "must not persist unreadable",
      ], "alice");
      expect(unreadableResult.exitCode).toBe(1);
      expect(`${unreadableResult.stdout}${unreadableResult.stderr}`).toContain("EACCES");
    } finally {
      chmodSync(unreadable, 0o600);
    }

    const oversizedResult = runCli([
      "send", "--channel", channel, "--from", "alice",
      "--attach", oversized, "--json", "must not persist oversized",
    ], "alice");
    expect(oversizedResult.exitCode).toBe(1);
    expect(`${oversizedResult.stdout}${oversizedResult.stderr}`).toContain("exceeds maximum size");

    const unsupportedResult = runCli([
      "send", "--channel", channel, "--from", "alice",
      "--attach", unsupported, "--json", "must not persist unsupported",
    ], "alice");
    expect(unsupportedResult.exitCode).toBe(1);
    expect(`${unsupportedResult.stdout}${unsupportedResult.stderr}`).toContain("Unsupported attachment type");

    expect(messagesIn(channel)).toEqual(before);
  });

  test("archive and compressed attachment extensions fail closed before a local message is stored", () => {
    const channel = "send-attachment-opaque";
    seedChannel(channel);
    const compressedFinding = gzipSync(Buffer.from(`attachment ${syntheticDatabaseUrl()}`));
    const before = messagesIn(channel);

    for (const extension of ["bundle", "zip", "gz", "tgz", "tar"]) {
      const source = join(SOURCE_DIR, `opaque.${extension}`);
      writeFileSync(source, compressedFinding);
      const sent = runCli([
        "send",
        "--channel",
        channel,
        "--from",
        "alice",
        "--attach",
        source,
        "--json",
        `must not persist ${extension}`,
      ], "alice");

      expect(sent.exitCode).toBe(1);
      expect(`${sent.stdout}${sent.stderr}`).toContain(
        "Archive and compressed attachment types are not supported securely",
      );
      expect(messagesIn(channel)).toEqual(before);
    }
  });
});
