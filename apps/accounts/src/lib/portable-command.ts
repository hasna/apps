import { existsSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";
import { AccountsError } from "../types.js";

function environmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

function resolveExecutable(bin: string, env: NodeJS.ProcessEnv): string {
  if (process.platform !== "win32" || isAbsolute(bin) || /[\\/]/.test(bin)) return bin;
  const extensions = extname(bin)
    ? [""]
    : (environmentValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  for (const entry of (environmentValue(env, "PATH") ?? "").split(delimiter)) {
    const directory = entry.replace(/^"(.*)"$/, "$1");
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${bin}${extension.toLowerCase()}`);
      if (existsSync(candidate)) return candidate;
      const upperCandidate = join(directory, `${bin}${extension.toUpperCase()}`);
      if (existsSync(upperCandidate)) return upperCandidate;
    }
  }
  return bin;
}

const WINDOWS_CMD_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

function escapeWindowsCommand(value: string): string {
  return value.replace(WINDOWS_CMD_META_CHARACTERS, "^$1");
}

function escapeWindowsBatchArgument(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new AccountsError("Windows batch arguments cannot contain line breaks.");
  }
  let escaped = value
    .replace(/(?=(\\+?)?)\1"/g, "$1$1\\\"")
    .replace(/(?=(\\+?)?)\1$/, "$1$1");
  escaped = `"${escaped}"`.replace(WINDOWS_CMD_META_CHARACTERS, "^$1");
  // A batch shim parses its command line after cmd.exe has already parsed it.
  return escaped.replace(WINDOWS_CMD_META_CHARACTERS, "^$1");
}

export interface WindowsBatchCommand {
  command: string;
  args: ["/d", "/s", "/c", string];
  windowsVerbatimArguments: true;
}

export function prepareWindowsBatchCommand(
  executable: string,
  args: string[],
  commandInterpreter: string,
): WindowsBatchCommand {
  const command = [
    escapeWindowsCommand(executable),
    ...args.map(escapeWindowsBatchArgument),
  ].join(" ");
  return {
    command: commandInterpreter,
    args: ["/d", "/s", "/c", `"${command}"`],
    windowsVerbatimArguments: true,
  };
}

export interface PortableCommand {
  command: string;
  args: string[];
  windowsVerbatimArguments?: true;
}

/**
 * Resolve a command exactly as Windows will and route batch shims through
 * cmd.exe without enabling a general shell. npm and Bun package bins commonly
 * install as `.cmd`; CreateProcess cannot execute those files directly.
 */
export function preparePortableCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): PortableCommand {
  const executable = resolveExecutable(command, env);
  if (process.platform !== "win32" || !/\.(?:bat|cmd)$/i.test(executable)) {
    return { command: executable, args };
  }
  return prepareWindowsBatchCommand(
    executable,
    args,
    environmentValue(env, "COMSPEC") || "cmd.exe",
  );
}
