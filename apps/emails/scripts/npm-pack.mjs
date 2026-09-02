import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const execution = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 };

export function assertSupportedNpmVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match || !match.slice(1).every((part) => Number.isSafeInteger(Number(part)))) {
    throw new Error("artifact scan: npm --version returned an invalid release version; npm >=11.0.0 is required");
  }
  if (Number(match[1]) < 11) {
    throw new Error(`artifact scan: npm ${version} is unsupported; npm >=11.0.0 is required to suppress prepare lifecycle scripts`);
  }
}

export function npmPackArgs(destination) {
  // The enclosing prepack may itself run under npm's inherited dry-run setting.
  return ["pack", ".", "--json", "--pack-destination", destination, "--ignore-scripts", "--workspaces=false", "--dry-run=false"];
}

export function resolveNpmArchive(output, destination, manifest) {
  let entries;
  try { entries = JSON.parse(output); }
  catch { throw new Error("artifact scan: npm pack did not return valid JSON"); }
  if (!Array.isArray(entries) || entries.length !== 1) {
    throw new Error("artifact scan: npm pack must return exactly one artifact");
  }
  const entry = entries[0];
  if (entry?.name !== manifest.name || entry?.version !== manifest.version) {
    throw new Error("artifact scan: npm artifact identity does not match the source manifest");
  }
  if (typeof entry.filename !== "string" || !/^[a-z0-9][a-z0-9._-]*\.tgz$/i.test(entry.filename)) {
    throw new Error("artifact scan: npm pack returned an invalid archive filename");
  }
  const archive = join(destination, entry.filename);
  let valid = false;
  try {
    const stats = lstatSync(archive);
    valid = stats.isFile() && stats.size > 0;
  } catch { /* Missing files and dry-run-only output fail closed. */ }
  if (!valid) throw new Error("artifact scan: npm pack did not create a nonempty local regular archive");
  return archive;
}

export function assertSafePackagePath(path) {
  if (typeof path !== "string" || !path.startsWith("package/") || /[\\\x00-\x1f\x7f]/.test(path)) {
    throw new Error("artifact scan: unsafe archive member path");
  }
  const parts = path.replace(/\/$/, "").split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("artifact scan: unsafe archive member path");
  }
}

export function assertSafeArchive(archive) {
  let names, types;
  try {
    names = execFileSync("tar", ["-tzf", archive], execution).trimEnd().split("\n");
    types = execFileSync("tar", ["-tvzf", archive], execution).trimEnd().split("\n");
  } catch { throw new Error("artifact scan: cannot enumerate the complete archive"); }
  if (!names.length || names.length !== types.length) throw new Error("artifact scan: invalid archive member listing");
  const seen = new Set();
  for (let index = 0; index < names.length; index++) {
    assertSafePackagePath(names[index]);
    const normalized = names[index].replace(/\/$/, "");
    if (seen.has(normalized) || !/^[-d]/.test(types[index])) {
      throw new Error("artifact scan: archive has duplicate or non-regular members");
    }
    seen.add(normalized);
  }
}

/** Pack actual npm bytes, with no lifecycle execution or alternate package manager. */
export function packNpmArtifact(packageRoot, destination) {
  let version;
  try { version = execFileSync("npm", ["--version"], { ...execution, cwd: packageRoot }).trim(); }
  catch { throw new Error("artifact scan: could not determine npm version; npm >=11.0.0 is required"); }
  assertSupportedNpmVersion(version);
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  let output;
  try { output = execFileSync("npm", npmPackArgs(destination), { ...execution, cwd: packageRoot }); }
  catch { throw new Error("artifact scan: npm pack failed (subprocess diagnostics withheld)"); }
  const archive = resolveNpmArchive(output, destination, manifest);
  assertSafeArchive(archive);
  let packedManifest;
  try { packedManifest = JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], execution)); }
  catch { throw new Error("artifact scan: cannot read packed package identity"); }
  if (packedManifest.name !== manifest.name || packedManifest.version !== manifest.version) {
    throw new Error("artifact scan: packed manifest identity does not match the source manifest");
  }
  return archive;
}
