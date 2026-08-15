/**
 * Hook resolution — custom directory first, bundled registry second.
 * A custom hook that collides with a bundled name shadows it.
 */

import { dirname, join } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { getHook, type HookEvent, type HookMeta } from "./registry.js";
import { customHookDir, readCustomManifest, shortManifestName } from "./manifest.js";

export type HookSource = "custom" | "bundled";

export interface ResolvedHook {
  name: string;
  source: HookSource;
  version: string;
  events: string[];
  description: string;
  scriptPath: string;
  meta: HookMeta;
  /** The hook's own declared timeout (manifest timeout_ms), or null. */
  timeoutMs: number | null;
}

/**
 * Locate the bundled hooks directory at runtime from the executing module's
 * own location. A bare `__dirname` is baked to the builder's path at bundle
 * time, so bundled hooks resolve only on the machine that built the package
 * (0.6.0/0.6.1 regression); `import.meta.url` is preserved at runtime by the
 * bun build target, so resolution follows the installed package instead.
 */
export function resolveBundledHooksDir(moduleDir: string = dirname(fileURLToPath(import.meta.url))): string {
  const sourceLayout = join(moduleDir, "..", "..", "hooks");
  if (existsSync(join(sourceLayout, "hook-gitguard"))) return sourceLayout;
  return join(moduleDir, "..", "hooks");
}

export function resolveHookDir(name: string): string | undefined {
  const custom = readCustomManifest(name);
  if (custom) return customHookDir(name);
  const meta = getHook(shortManifestName(name));
  if (!meta) return undefined;
  const short = shortManifestName(name);
  const bundledBase = resolveBundledHooksDir();
  const direct = join(bundledBase, short);
  if (existsSync(direct)) return direct;
  const prefixed = join(bundledBase, `hook-${short}`);
  return existsSync(prefixed) ? prefixed : undefined;
}

export function resolveScriptPath(name: string): string | undefined {
  const custom = readCustomManifest(name);
  if (custom) return custom.scriptPath;
  const dir = resolveHookDir(name);
  if (!dir) return undefined;
  const script = join(dir, "src", "hook.ts");
  return existsSync(script) ? script : undefined;
}

export function resolveHookMeta(name: string): HookMeta | undefined {
  const custom = readCustomManifest(name);
  if (custom) {
    const { manifest } = custom;
    return {
      name: shortManifestName(manifest.name),
      displayName: manifest.description ? manifest.name : manifest.name,
      description: manifest.description ?? "Custom hook",
      version: manifest.version,
      category: "Workflow Automation",
      event: (manifest.events[0] ?? "PostToolUse") as HookEvent,
      events: manifest.events as HookEvent[],
      matcher: "",
      tags: ["custom"],
    };
  }
  return getHook(shortManifestName(name));
}

export function resolveHook(name: string): ResolvedHook | undefined {
  const custom = readCustomManifest(name);
  if (custom) {
    const meta = resolveHookMeta(name)!;
    return {
      name: shortManifestName(custom.manifest.name),
      source: "custom",
      version: custom.manifest.version,
      events: custom.manifest.events,
      description: custom.manifest.description ?? "Custom hook",
      scriptPath: custom.scriptPath,
      meta,
      timeoutMs: custom.manifest.timeout_ms ?? null,
    };
  }
  const meta = getHook(shortManifestName(name));
  const scriptPath = resolveScriptPath(name);
  if (!meta || !scriptPath) return undefined;
  return {
    name: shortManifestName(name),
    source: "bundled",
    version: meta.version,
    events: meta.events && meta.events.length > 0 ? meta.events : [meta.event],
    description: meta.description,
    scriptPath,
    meta,
    timeoutMs: null,
  };
}
