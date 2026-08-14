/**
 * Hook manifest model — the contract for custom/remote hooks.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "fs";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "path";
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
 * A manifest script path resolved outside its hook's own directory.
 * Carries the offending path so callers can surface it verbatim.
 */
export class ScriptContainmentError extends Error {
  constructor(path: string, hookDir: string, raw?: string) {
    super(
      raw && raw !== path
        ? `manifest script escapes the hook directory: '${path}' (from '${raw}') resolves outside '${hookDir}'`
        : `manifest script escapes the hook directory: '${path}' resolves outside '${hookDir}'`,
    );
    this.name = "ScriptContainmentError";
  }
}

function isWithin(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

/**
 * Lexical containment: the resolved target must sit under the root without
 * touching the filesystem. Catches `../` and absolute escapes.
 */
function assertContainedLexical(target: string, root: string, raw?: string): string {
  const lexical = resolve(target);
  const rootLexical = resolve(root);
  if (!isWithin(lexical, rootLexical)) {
    throw new ScriptContainmentError(target, root, raw);
  }
  return lexical;
}

/**
 * Realpath of a path that may not exist yet: realpath the nearest existing
 * ancestor, then re-join the remainder. This resolves symlinks in every
 * existing component, so a symlink that points outside is caught.
 */
function realpathNearest(path: string): string {
  const tail: string[] = [];
  let cur = path;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    tail.unshift(basename(cur));
    cur = parent;
  }
  return join(realpathSync(cur), ...tail);
}

/**
 * Containment with symlink resolution: the resolved target must stay inside
 * the root after realpath on both sides. `root` must already exist.
 */
function assertContainedReal(root: string, target: string, raw?: string): void {
  const rootReal = realpathSync(root);
  const targetReal = realpathNearest(target);
  if (!isWithin(targetReal, rootReal)) {
    throw new ScriptContainmentError(target, root, raw);
  }
}

/**
 * Full containment check (lexical + symlink resolution). Requires `root` to
 * exist. For write targets that do not exist yet, call
 * assertContainedLexical first (before creating anything), then create the
 * root, then call assertContainedReal.
 */
export function assertContained(target: string, root: string, raw?: string): string {
  const lexical = assertContainedLexical(target, root, raw);
  assertContainedReal(root, lexical, raw);
  return lexical;
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
  const resolved = assertContained(join(manifestDir, rel), manifestDir, manifest.script);
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
  } catch (err) {
    // A containment violation is an attack, not a malformed manifest: surface
    // it loudly instead of degrading to "hook not found".
    if (err instanceof ScriptContainmentError) throw err;
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
  // Refuse escaping script paths BEFORE any filesystem mutation, so a hostile
  // manifest cannot create anything outside the hook's own directory.
  if (isAbsolute(scriptRelPath)) {
    throw new ScriptContainmentError(scriptRelPath, dir);
  }
  const scriptPath = scriptRelPath.includes("/") ? join(dir, scriptRelPath) : join(dir, scriptRelPath);
  assertContainedLexical(scriptPath, dir, scriptRelPath);
  mkdirSync(dir, { recursive: true });
  // Symlink resolution now that the hook dir exists: a symlinked component
  // that points outside is caught before any write.
  assertContainedReal(dir, scriptPath, scriptRelPath);
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
