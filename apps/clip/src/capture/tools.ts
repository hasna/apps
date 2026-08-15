import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const WINDOWS_POWERSHELL_COMMANDS = ["powershell.exe", "powershell", "pwsh.exe", "pwsh"] as const;

function isWindowsPlatform(): boolean {
  return process.platform === "win32";
}

function pathEnv(): string {
  return process.env["PATH"] ?? process.env["Path"] ?? process.env["path"] ?? "";
}

function pathEntries(): string[] {
  return pathEnv().split(isWindowsPlatform() ? ";" : ":");
}

function pathext(): string[] {
  const raw = process.env["PATHEXT"] ?? process.env["PathExt"] ?? process.env["pathext"] ?? ".COM;.EXE;.BAT;.CMD;.PS1";
  const extensions = raw.split(";").map((extension) => extension.trim()).filter(Boolean);
  return [...new Set(["", ...extensions, ...extensions.map((extension) => extension.toLowerCase())])];
}

function hasCommandExtension(command: string): boolean {
  return /\.[^/\\]+$/.test(command);
}

function commandCandidates(command: string): string[] {
  if (!isWindowsPlatform() || hasCommandExtension(command)) return [command];
  return pathext().map((extension) => `${command}${extension}`);
}

function isPathLike(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function resolveCommandPath(command: string): string | null {
  if (isPathLike(command)) {
    for (const candidate of commandCandidates(command)) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
  for (const dir of pathEntries()) {
    if (!dir) continue;
    for (const executable of commandCandidates(command)) {
      const candidate = join(dir, executable);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function commandExists(command: string): boolean {
  return resolveCommandPath(command) !== null;
}

export function findWindowsPowerShellCommand(): string | null {
  if (!isWindowsPlatform()) return null;
  for (const command of WINDOWS_POWERSHELL_COMMANDS) {
    if (commandExists(command)) return command;
  }
  return null;
}

function windowsPowerShellFileArgs(scriptPath: string, args: string[] = []): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Sta",
    "-File",
    scriptPath,
    ...args,
  ];
}

export async function runWindowsPowerShellScript(
  command: string,
  script: string,
  args: string[] = [],
  input?: string | Uint8Array,
): Promise<CommandResult> {
  const dir = mkdtempSync(join(tmpdir(), "clip-powershell-"));
  const scriptPath = join(dir, "script.ps1");
  writeFileSync(scriptPath, script, "utf8");
  try {
    return await runCommand(command, windowsPowerShellFileArgs(scriptPath, args), input);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  if (process.platform === "win32") {
    const command = findWindowsPowerShellCommand();
    if (command) {
      const script = `
$ErrorActionPreference = 'Stop'
$Text = [Console]::In.ReadToEnd()
if (Get-Command Set-Clipboard -ErrorAction SilentlyContinue) {
  Set-Clipboard -Value $Text
} else {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.Clipboard]::SetText($Text)
}
`;
      const result = await runWindowsPowerShellScript(command, script, [], text);
      return result.ok ? { ok: true, command } : { ok: false, command, error: result.stderr.trim() || result.stdout.trim() };
    }
  }
  if (commandExists("wl-copy")) {
    const result = await runCommand("wl-copy", [], text);
    return result.ok ? { ok: true, command: "wl-copy" } : { ok: false, command: "wl-copy", error: result.stderr };
  }
  if (commandExists("xclip")) {
    const result = await runCommand("xclip", ["-selection", "clipboard"], text);
    return result.ok ? { ok: true, command: "xclip" } : { ok: false, command: "xclip", error: result.stderr };
  }
  return { ok: false, error: "No clipboard copy tool found (pbcopy, PowerShell, wl-copy, or xclip)." };
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
