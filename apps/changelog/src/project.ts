import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeAppId } from "./validation.js";

export interface ChangelogProjectInfo {
  appId?: string;
  repositoryUrl?: string;
}

interface PackageJson {
  name?: string;
  repository?: string | { url?: string };
}

/**
 * Infer the hasna.app.v1 appId from an npm package name. `@hasna/*` package
 * names normalize to the bare app slug (`@hasna/todos` -> `todos`), which is
 * the join key used by the distribution contracts.
 */
function appIdFromPackageName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  try {
    return normalizeAppId(name);
  } catch {
    return undefined;
  }
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
