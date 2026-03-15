import React from "react";
import { Box, Text } from "ink";
import { execSync } from "child_process";
import { homedir } from "os";
import { type Permissions } from "./history.js";

function formatCwd(cwd: string): string {
  const home = homedir();
  return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
}

function getGitBranch(cwd: string): string | null {
  try {
    return execSync("git branch --show-current 2>/dev/null", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim() || null;
  } catch { return null; }
}

function getGitDirty(cwd: string): boolean {
  try {
    return execSync("git status --porcelain 2>/dev/null", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim().length > 0;
  } catch { return false; }
}

function activePerms(perms: Permissions): string[] {
  const labels: Array<[keyof Permissions, string]> = [
    ["destructive", "del"],
    ["network",     "net"],
    ["sudo",        "sudo"],
    ["install",     "pkg"],
    ["write_outside_cwd", "write"],
  ];
  // only show disabled ones — full access is the default so no need to clutter
  const disabled = labels.filter(([k]) => !perms[k]).map(([, l]) => `no-${l}`);
  return disabled;
}

interface Props {
  permissions: Permissions;
  cwd?: string;
}

export default function StatusBar({ permissions, cwd: cwdProp }: Props) {
  const cwd = cwdProp ?? process.cwd();
  const branch = getGitBranch(cwd);
  const dirty = branch ? getGitDirty(cwd) : false;
  const restricted = activePerms(permissions);

  return (
    <Box gap={2} paddingLeft={2} marginTop={1}>
      <Text dimColor>{formatCwd(cwd)}</Text>
      {branch && <Text dimColor>{branch}{dirty ? " ●" : ""}</Text>}
      {restricted.length > 0 && <Text dimColor>{restricted.join(" · ")}</Text>}
    </Box>
  );
}
