import React from "react";
import { Box, Text } from "ink";
import { execSync } from "child_process";
import { homedir } from "os";
import { type Permissions } from "./history.js";

function getCwd(): string {
  const cwd = process.cwd();
  const home = homedir();
  return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
}

function getGitBranch(): string | null {
  try {
    return execSync("git branch --show-current 2>/dev/null", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim() || null;
  } catch {
    return null;
  }
}

function getGitDirty(): boolean {
  try {
    const out = execSync("git status --porcelain 2>/dev/null", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function activePerms(perms: Permissions): string[] {
  const labels: Array<[keyof Permissions, string]> = [
    ["destructive", "del"],
    ["network", "net"],
    ["sudo", "sudo"],
    ["install", "pkg"],
    ["write_outside_cwd", "write"],
  ];
  return labels.filter(([k]) => perms[k]).map(([, l]) => l);
}

interface Props {
  permissions: Permissions;
}

export default function StatusBar({ permissions }: Props) {
  const cwd = getCwd();
  const branch = getGitBranch();
  const dirty = branch ? getGitDirty() : false;
  const perms = activePerms(permissions);

  return (
    <Box gap={2} paddingLeft={2} marginTop={1}>
      <Text dimColor>{cwd}</Text>
      {branch && (
        <Text dimColor>
          {branch}
          {dirty ? " ●" : ""}
        </Text>
      )}
      {perms.length > 0 && (
        <Text dimColor>{perms.join(" · ")}</Text>
      )}
    </Box>
  );
}
