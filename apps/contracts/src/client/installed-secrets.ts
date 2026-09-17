import { closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } from "node:constants";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exports as resolveExports } from "resolve.exports";

const PACKAGE = "@hasna/secrets";
const MAX_PACKAGE_BYTES = 1024 * 1024;

function entryPoint(directory: string): string {
  // Package-manager symlinks (workspaces and pnpm) are normal installations.
  // Resolve the package root first, then require its exported file to stay in it.
  const root = realpathSync(directory);
  const fd = openSync(join(root, "package.json"), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  let pkg: unknown;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_PACKAGE_BYTES) throw new Error("Invalid Secrets package metadata");
    pkg = JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
  if (!pkg || typeof pkg !== "object" || !("name" in pkg) || pkg.name !== PACKAGE) {
    throw new Error("Invalid Secrets package identity");
  }
  // The supported SDK publishes an explicit ESM export. No main/index guesses,
  // require condition, global paths, registry access, or alternate package.
  const target = resolveExports(pkg, ".")?.[0];
  if (typeof target !== "string" || !target.startsWith("./")) throw new Error("Missing Secrets import export");
  const parts = target.slice(2).split("/");
  if (/[\\%?#\0]/.test(target) || parts.some(part => !part || part === "." || part === ".." || part === "node_modules")) {
    throw new Error("Invalid Secrets import export");
  }
  const file = realpathSync(join(root, ...parts));
  const within = relative(root, file);
  if (!within || within === ".." || within.startsWith(`..${sep}`) || !statSync(file).isFile()) {
    throw new Error("Secrets import export escapes its package or is not a file");
  }
  return pathToFileURL(file).href;
}

/** Find only an already-installed SDK, relative to the consuming module. */
export function resolveInstalledSecrets(parentUrl: string): string {
  let directory = dirname(fileURLToPath(parentUrl));
  for (;;) {
    if (basename(directory) !== "node_modules") {
      const candidate = join(directory, "node_modules", PACKAGE);
      let absent = false;
      try { lstatSync(candidate); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        absent = true;
      }
      // An existing but broken nearest installation is terminal. Do not rescue
      // it with a different SDK found higher in the dependency tree.
      if (!absent) return entryPoint(candidate);
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Secrets SDK is not installed for this consumer");
    directory = parent;
  }
}
