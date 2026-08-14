/**
 * Hook manifest model — the contract for custom/remote hooks.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, normalize } from "path";
import { z } from "zod";
import { getCustomHooksDir } from "../config.js";

export const HOOK_NAME_RE = /^[\w-]+$/;

export const manifestSchema = z.object({
  name: z.string().regex(HOOK_NAME_RE, "hook name must be /^[\\w-]+$/"),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+/, "version must be semver (e.g. 1.2.3)"),
  description: z.string().optional(),
  events: z.array(z.string()).min(1, "at least one event is required"),
  script: z.string().min(1, "script must name a relative path or inline content"),
  args: z.array(z.string()).optional(),
  timeout_ms: z.number().int().positive().optional(),
});

export type HookManifest = z.infer<typeof manifestSchema>;

export interface ParsedManifest {
  manifest: HookManifest;
  scriptPath: string;
  scriptContent: string;
  scriptIsInline: boolean;
}

export function parseManifest(json: string): HookManifest {
  const parsed = JSON.parse(json) as unknown;
  return manifestSchema.parse(parsed);
}

export function normalizeManifestName(name: string): string {
  return name.startsWith("hook-") ? name : `hook-${name}`;
}

export function shortManifestName(name: string): string {
  return name.startsWith("hook-") ? name.slice("hook-".length) : name;
}

/**
 * Resolve a manifest's script to (relative path, content).
 * A script value containing a newline is inline content; anything else is a
 * relative path resolved against the manifest directory.
 */
export function resolveScript(manifest: HookManifest, manifestDir: string): { path: string; content: string } {
  if (manifest.script.includes("\n")) {
    const ext = manifest.script.trim().startsWith("#!") ? ".sh" : ".ts";
    return { path: `script${ext}`, content: manifest.script };
  }
  const rel = normalize(manifest.script);
  if (isAbsolute(rel)) {
    throw new Error(`manifest script must be relative or inline, got absolute path '${manifest.script}'`);
  }
  const resolved = join(manifestDir, rel);
  if (!existsSync(resolved)) {
    throw new Error(`manifest script file not found: ${resolved}`);
  }
  return { path: rel, content: readFileSync(resolved, "utf-8") };
}

export function customHookDir(name: string): string {
  return join(getCustomHooksDir(), shortManifestName(name));
}

export function readCustomManifest(name: string): ParsedManifest | undefined {
  const dir = customHookDir(name);
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return undefined;
  try {
    const manifest = parseManifest(readFileSync(manifestPath, "utf-8"));
    const script = resolveScript(manifest, dir);
    return { manifest, scriptPath: join(dir, script.path), scriptContent: script.content, scriptIsInline: manifest.script.includes("\n") };
  } catch {
    return undefined;
  }
}

export function listCustomHooks(): ParsedManifest[] {
  const dir = getCustomHooksDir();
  if (!existsSync(dir)) return [];
  const results: ParsedManifest[] = [];
  for (const entry of readdirSafe(dir)) {
    const parsed = readCustomManifest(entry);
    if (parsed) results.push(parsed);
  }
  return results.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

export function writeCustomHook(
  name: string,
  manifest: HookManifest,
  scriptContent: string,
  scriptRelPath: string,
): { dir: string; scriptPath: string } {
  const dir = customHookDir(name);
  mkdirSync(dir, { recursive: true });
  const scriptPath = scriptRelPath.includes("/") ? join(dir, scriptRelPath) : join(dir, scriptRelPath);
  const scriptDir = dirname(scriptPath);
  if (scriptDir !== dir) mkdirSync(scriptDir, { recursive: true });
  writeFileSync(scriptPath, scriptContent, "utf-8");
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  return { dir, scriptPath };
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
