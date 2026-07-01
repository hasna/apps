import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ChangelogProjectInfo {
  appId?: string;
  repositoryUrl?: string;
}

interface PackageJson {
  name?: string;
  repository?: string | { url?: string };
}

function appIdFromPackageName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const withoutScope = name.includes("/") ? name.split("/").at(-1) : name;
  return withoutScope?.replace(/^open-/, "") || undefined;
}

export function normalizeRepositoryUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^git@github\.com:/, "https://github.com/");
}

export async function readProjectInfo(cwd = process.cwd()): Promise<ChangelogProjectInfo> {
  try {
    const raw = await readFile(join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as PackageJson;
    const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    return {
      appId: appIdFromPackageName(pkg.name),
      repositoryUrl: normalizeRepositoryUrl(repository),
    };
  } catch {
    return {};
  }
}

