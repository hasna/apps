import { existsSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "node:buffer";

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  ok: boolean;
}

function resolveCommandPath(command: string): string | null {
  if (command.includes("/") && existsSync(command)) return command;
  const path = process.env["PATH"] ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function commandExists(command: string): boolean {
  return resolveCommandPath(command) !== null;
}

async function streamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return await new Response(stream).text();
}

async function streamBytes(stream: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function runCommand(command: string, args: string[] = [], input?: string | Uint8Array): Promise<CommandResult> {
  const executable = resolveCommandPath(command);
  if (!executable) {
    return { command, args, exitCode: 127, stdout: "", stderr: `${command} not found`, ok: false };
  }
  const proc = Bun.spawn([executable, ...args], {
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined && proc.stdin) {
    proc.stdin.write(input);
    proc.stdin.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    streamText(proc.stdout),
    streamText(proc.stderr),
  ]);
  return { command, args, exitCode, stdout, stderr, ok: exitCode === 0 };
}

export async function runCommandBytes(command: string, args: string[] = []): Promise<{ result: CommandResult; bytes: Uint8Array }> {
  const executable = resolveCommandPath(command);
  if (!executable) {
    return {
      result: { command, args, exitCode: 127, stdout: "", stderr: `${command} not found`, ok: false },
      bytes: new Uint8Array(),
    };
  }
  const proc = Bun.spawn([executable, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, bytes, stderr] = await Promise.all([
    proc.exited,
    streamBytes(proc.stdout),
    streamText(proc.stderr),
  ]);
  return {
    result: { command, args, exitCode, stdout: "", stderr, ok: exitCode === 0 },
    bytes,
  };
}

export async function copyTextToClipboard(text: string): Promise<{ ok: boolean; command?: string; error?: string }> {
  if (process.platform === "darwin" && commandExists("pbcopy")) {
    const result = await runCommand("pbcopy", [], text);
    return result.ok ? { ok: true, command: "pbcopy" } : { ok: false, command: "pbcopy", error: result.stderr };
  }
  if (commandExists("wl-copy")) {
    const result = await runCommand("wl-copy", [], text);
    return result.ok ? { ok: true, command: "wl-copy" } : { ok: false, command: "wl-copy", error: result.stderr };
  }
  if (commandExists("xclip")) {
    const result = await runCommand("xclip", ["-selection", "clipboard"], text);
    return result.ok ? { ok: true, command: "xclip" } : { ok: false, command: "xclip", error: result.stderr };
  }
  return { ok: false, error: "No clipboard copy tool found (pbcopy, wl-copy, or xclip)." };
}

export async function openLocalTarget(target: string): Promise<{ ok: boolean; command?: string; error?: string }> {
  const candidates = process.platform === "darwin"
    ? [["open", target]]
    : [["xdg-open", target], ["gio", "open", target]];
  for (const [command, ...args] of candidates) {
    if (!commandExists(command)) continue;
    const result = await runCommand(command, args);
    return result.ok ? { ok: true, command } : { ok: false, command, error: result.stderr };
  }
  return { ok: false, error: "No opener found (open, xdg-open, or gio)." };
}

export function bytesToBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
