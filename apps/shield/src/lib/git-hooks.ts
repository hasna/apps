import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";

type RunnerOptions = {
  cwd?: string;
  encoding?: BufferEncoding;
};

type CommandRunner = (command: string, args: string[], options?: RunnerOptions) => string;

export interface InstallPrePushHookOptions {
  force?: boolean;
}

export interface InstallPrePushHookResult {
  hookPath: string;
  installed: boolean;
  skipped: boolean;
  reason?: string;
}

const HOOK_MARKER = "# managed-by-open-security";

function defaultRunner(command: string, args: string[], options?: RunnerOptions): string {
  return execFileSync(command, args, {
    cwd: options?.cwd,
    encoding: options?.encoding ?? "utf-8",
  }) as string;
}

function getHookContents(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
${HOOK_MARKER}

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

run_security() {
  if command -v security >/dev/null 2>&1; then
    security secrets . --format terminal --fail-on high --no-git-history
    return $?
  fi

  if [ -x "./node_modules/.bin/security" ]; then
    ./node_modules/.bin/security secrets . --format terminal --fail-on high --no-git-history
    return $?
  fi

  if [ -f "./dist/cli/index.js" ] && command -v bun >/dev/null 2>&1; then
    bun run ./dist/cli/index.js secrets . --format terminal --fail-on high --no-git-history
    return $?
  fi

  if [ -f "./src/cli/index.tsx" ] && command -v bun >/dev/null 2>&1; then
    bun run ./src/cli/index.tsx secrets . --format terminal --fail-on high --no-git-history
    return $?
  fi

  echo "open-security pre-push hook: security CLI not found" >&2
  exit 1
}

run_security
`;
}

export function installPrePushHook(
  repoPath: string,
  options: InstallPrePushHookOptions = {},
  runner: CommandRunner = defaultRunner,
): InstallPrePushHookResult {
  const gitDir = runner("git", ["rev-parse", "--git-dir"], {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  const hooksDir = resolve(repoPath, gitDir, "hooks");
  const hookPath = resolve(hooksDir, "pre-push");

  mkdirSync(hooksDir, { recursive: true });

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf-8");
    if (existing.includes(HOOK_MARKER)) {
      writeFileSync(hookPath, getHookContents(), "utf-8");
      chmodSync(hookPath, 0o755);
      return { hookPath, installed: true, skipped: false };
    }

    if (!options.force) {
      return {
        hookPath,
        installed: false,
        skipped: true,
        reason: "Existing pre-push hook found. Re-run with --force-hook to overwrite it.",
      };
    }
  }

  writeFileSync(hookPath, getHookContents(), "utf-8");
  chmodSync(hookPath, 0o755);
  return { hookPath, installed: true, skipped: false };
}
