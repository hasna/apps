/**
 * Custom hook install — sources outside the bundled registry.
 *
 * git URL  -> shallow clone, read manifest, copy into the custom dir
 * local    -> copy a directory containing manifest.json
 * https    -> fetch manifest.json (+ relative script file when needed)
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getCustomHooksDir } from "../config.js";
import { parseManifest, resolveScript, shortManifestName, writeCustomHook, type HookManifest } from "./manifest.js";

export type CustomSourceKind = "git" | "local" | "url";

export interface CustomInstallResult {
  name: string;
  version: string;
  kind: CustomSourceKind;
  source: string;
  dir: string;
  scriptPath: string;
}

function manifestAt(dir: string): HookManifest | undefined {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) return undefined;
  try {
    return parseManifest(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
}

function copyManifestDir(srcDir: string, source: string, kind: CustomSourceKind): CustomInstallResult {
  const manifest = manifestAt(srcDir);
  if (!manifest) {
    throw new Error(`No valid manifest.json found at ${srcDir}`);
  }
  return writeFromManifest(manifest, srcDir, source, kind);
}

function writeFromManifest(manifest: HookManifest, srcDir: string, source: string, kind: CustomSourceKind): CustomInstallResult {
  const script = resolveScript(manifest, srcDir);
  const name = shortManifestName(manifest.name);
  const { dir, scriptPath } = writeCustomHook(name, manifest, script.content, script.path);
  return { name, version: manifest.version, kind, source, dir, scriptPath };
}

async function cloneToTemp(gitUrl: string): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), "hooks-install-"));
  const proc = Bun.spawn(["git", "clone", "--depth", "1", "--quiet", gitUrl, join(tmp, "repo")], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  void stdout;
  if (exitCode !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`git clone failed (${exitCode}): ${stderr.trim()}`);
  }
  return join(tmp, "repo");
}

function isGitUrl(value: string): boolean {
  return value.startsWith("git@") || value.startsWith("ssh://") || value.startsWith("file://") || value.endsWith(".git");
}

export function isCustomSource(value: string): boolean {
  if (isGitUrl(value)) return true;
  if (value.startsWith("http://") || value.startsWith("https://")) return true;
  return existsSync(value);
}

export async function installCustomSource(source: string): Promise<CustomInstallResult> {
  if (isGitUrl(source)) {
    const repoDir = await cloneToTemp(source);
    try {
      return copyManifestDir(repoDir, source, "git");
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  }

  if (source.startsWith("http://") || source.startsWith("https://")) {
    return installManifestUrl(source);
  }

  if (!existsSync(source)) {
    throw new Error(`No such local path: ${source}`);
  }
  if (source.endsWith("manifest.json")) {
    const manifest = parseManifest(readFileSync(source, "utf-8"));
    return writeFromManifest(manifest, source.substring(0, source.lastIndexOf("/")), source, "local");
  }
  return copyManifestDir(source, source, "local");
}

async function installManifestUrl(url: string): Promise<CustomInstallResult> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to fetch manifest (${res.status}): ${url}`);
  }
  const manifest = parseManifest(await res.text());
  let script: { path: string; content: string };
  if (manifest.script.includes("\n")) {
    script = { path: "script.ts", content: manifest.script };
  } else {
    const base = url.substring(0, url.lastIndexOf("/"));
    const scriptUrl = `${base}/${manifest.script}`;
    const scriptRes = await fetch(scriptUrl, { redirect: "follow" });
    if (!scriptRes.ok) {
      throw new Error(`Failed to fetch script (${scriptRes.status}): ${scriptUrl}`);
    }
    script = { path: manifest.script, content: await scriptRes.text() };
  }
  const name = shortManifestName(manifest.name);
  const { dir, scriptPath } = writeCustomHook(name, manifest, script.content, script.path);
  return { name, version: manifest.version, kind: "url", source: url, dir, scriptPath };
}

export function ensureCustomDir(): string {
  const dir = getCustomHooksDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
