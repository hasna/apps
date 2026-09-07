import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedStoreChildEnv } from "../lib/store/isolated-test-env.js";

const TEST_ROOT = join(
  tmpdir(),
  `conversations-cli-attachments-get-${process.pid}-${Date.now()}`,
);
const TEST_DB = join(TEST_ROOT, "conversations.db");
const ATTACHMENTS_DIR = join(TEST_ROOT, "attachments");
const SOURCE_DIR = join(TEST_ROOT, "source");
const OUTPUT_DIR = join(TEST_ROOT, "output");
const CLI = ["bun", "run", "./src/cli/index.tsx"];

mkdirSync(SOURCE_DIR, { recursive: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

type CliResult = {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
};

function runCli(args: string[]): CliResult {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: isolatedStoreChildEnv(TEST_DB, {
      CONVERSATIONS_AGENT_ID: "attachment-reader",
      CONVERSATIONS_ATTACHMENTS_DIR: ATTACHMENTS_DIR,
      FORCE_COLOR: "0",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: Buffer.from(result.stdout),
    stderr: Buffer.from(result.stderr),
  };
}

function outputText(result: CliResult): string {
  return `${result.stdout.toString("utf8")}${result.stderr.toString("utf8")}`;
}

function seedAttachment(
  token: string,
  name: string,
  content: Buffer,
): { messageId: number; storedPath: string } {
  const channel = `attachment-get-${token}`;
  const created = runCli(["channel", "create", channel, "--from", "attachment-reader"]);
  expect(created.exitCode, outputText(created)).toBe(0);

  const source = join(SOURCE_DIR, `${token}-${name}`);
  writeFileSync(source, content);
  const sent = runCli([
    "send",
    "--channel",
    channel,
    "--from",
    "attachment-reader",
    "--attach",
    source,
    "--json",
    `binary attachment fixture ${token}`,
  ]);
  expect(sent.exitCode, outputText(sent)).toBe(0);

  const message = JSON.parse(sent.stdout.toString("utf8")) as {
    id: number;
    attachments: Array<{ name: string; path: string }>;
  };
  expect(message.attachments).toHaveLength(1);
  expect(message.attachments[0].name).toBe(`${token}-${name}`);
  return {
    messageId: message.id,
    storedPath: message.attachments[0].path,
  };
}

describe("attachments get (e2e)", () => {
  afterAll(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  test("round-trips arbitrary bytes to a new output file and raw stdout", () => {
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0x0a, 0x0d, 0x7f, 0x80, 0xc8, 0xff]);
    const fixture = seedAttachment("roundtrip", "payload.png", bytes);
    const output = join(OUTPUT_DIR, "roundtrip.png");

    const fileResult = runCli([
      "attachments",
      "get",
      String(fixture.messageId),
      "roundtrip-payload.png",
      "--output",
      output,
    ]);
    expect(fileResult.exitCode, outputText(fileResult)).toBe(0);
    expect(readFileSync(output)).toEqual(bytes);
    expect(statSync(output).mode & 0o777).toBe(0o600);

    const stdoutResult = runCli([
      "attachments",
      "get",
      String(fixture.messageId),
      "roundtrip-payload.png",
      "--stdout",
    ]);
    expect(stdoutResult.exitCode, stdoutResult.stderr.toString("utf8")).toBe(0);
    expect(stdoutResult.stdout).toEqual(bytes);
    // Local mode announces itself once on stderr (hasna/apps#1720); the binary
    // bytes must still land on stdout untouched.
    expect(stdoutResult.stderr.toString("utf8")).toContain("LOCAL mode");
  });

  test("refuses to overwrite an existing output file", () => {
    const bytes = Buffer.from("attachment overwrite control\n");
    const fixture = seedAttachment("overwrite", "evidence.txt", bytes);
    const output = join(OUTPUT_DIR, "existing.txt");
    const sentinel = Buffer.from("keep existing bytes\n");
    writeFileSync(output, sentinel);

    const result = runCli([
      "attachments",
      "get",
      String(fixture.messageId),
      "overwrite-evidence.txt",
      "--output",
      output,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(outputText(result)).toContain("Output file already exists");
    expect(outputText(result)).toContain("Choose a new --output path");
    expect(readFileSync(output)).toEqual(sentinel);
  });

  test("a valid zero-byte stdout download still emits an explicit receipt", () => {
    const fixture = seedAttachment("empty", "empty.txt", Buffer.alloc(0));
    const result = runCli([
      "attachments",
      "get",
      String(fixture.messageId),
      "empty-empty.txt",
      "--stdout",
    ]);

    expect(result.exitCode, outputText(result)).toBe(0);
    expect(result.stdout).toHaveLength(0);
    expect(result.stderr.toString("utf8")).toContain("0 bytes written to stdout");
  });

  test("distinguishes a missing message and leaves no partial file", () => {
    const output = join(OUTPUT_DIR, "missing-message.txt");
    const result = runCli([
      "attachments",
      "get",
      "999999999",
      "missing.txt",
      "--output",
      output,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(outputText(result)).toContain("Message #999999999 not found");
    expect(outputText(result)).toContain("conversations show 999999999 --json");
    expect(existsSync(output)).toBe(false);
  });

  test("distinguishes a missing attachment name and leaves no partial file", () => {
    const fixture = seedAttachment(
      "missing-name",
      "present.txt",
      Buffer.from("present attachment\n"),
    );
    const output = join(OUTPUT_DIR, "missing-name.txt");
    const result = runCli([
      "attachments",
      "get",
      String(fixture.messageId),
      "absent.txt",
      "--output",
      output,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(outputText(result)).toContain(
      `Attachment "absent.txt" not found on message #${fixture.messageId}`,
    );
    expect(outputText(result)).toContain(
      `conversations show ${fixture.messageId} --json`,
    );
    expect(existsSync(output)).toBe(false);
  });

  test("distinguishes attachment read permission denial and leaves no partial file", () => {
    const fixture = seedAttachment(
      "permission",
      "private.txt",
      Buffer.from("permission fixture\n"),
    );
    const output = join(OUTPUT_DIR, "permission.txt");

    chmodSync(fixture.storedPath, 0);
    try {
      const result = runCli([
        "attachments",
        "get",
        String(fixture.messageId),
        "permission-private.txt",
        "--output",
        output,
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(outputText(result)).toContain(
        `Permission denied while reading attachment "permission-private.txt" from message #${fixture.messageId}`,
      );
      expect(outputText(result)).toContain("Check read permissions");
      expect(existsSync(output)).toBe(false);
    } finally {
      chmodSync(fixture.storedPath, 0o600);
    }
  });
});
