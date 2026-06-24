import { existsSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export const MAC_HELPER_NAMES = ["scroll", "accessibility", "record"] as const;
export type MacHelperName = typeof MAC_HELPER_NAMES[number];

export type MacHelperInspection = {
  name: MacHelperName;
  found: boolean;
  executable: boolean;
  path: string | null;
  candidates: string[];
  reason: string | null;
};

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const MAX_UPWARD_SEARCH_DEPTH = 6;

export function resolveMacHelper(name: MacHelperName): string {
  const inspected = inspectMacHelper(name);
  if (inspected.found && inspected.path) return inspected.path;
  throw new Error(`${name} helper not found. Expected an executable helper binary in the package helpers directory.`);
}

export function inspectMacHelpers(names: readonly MacHelperName[] = MAC_HELPER_NAMES): MacHelperInspection[] {
  return names.map((name) => inspectMacHelper(name));
}

export function inspectMacHelper(name: MacHelperName): MacHelperInspection {
  const candidates = macHelperCandidates(name);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const executable = isExecutableFile(candidate);
    return {
      name,
      found: true,
      executable,
      path: candidate,
      candidates,
      reason: executable ? null : "helper exists but is not executable",
    };
  }
  return {
    name,
    found: false,
    executable: false,
    path: null,
    candidates,
    reason: "helper was not found in source, bundled package, or user helper directories",
  };
}

function macHelperCandidates(name: MacHelperName): string[] {
  const candidates: string[] = [];
  let current = MODULE_DIR;
  for (let depth = 0; depth <= MAX_UPWARD_SEARCH_DEPTH; depth += 1) {
    candidates.push(join(current, "helpers", name));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const home = process.env.HOME;
  if (home) candidates.push(join(home, ".hasna", "computer", "helpers", name));
  return [...new Set(candidates)];
}

function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    if (process.platform === "win32") return true;
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
