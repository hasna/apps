/**
 * Hook resolution — custom directory first, bundled registry second.
 * A custom hook that collides with a bundled name shadows it.
 */

import { join } from "path";
import { existsSync } from "fs";
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
}

export function resolveHookDir(name: string): string | undefined {
  const custom = readCustomManifest(name);
  if (custom) return customHookDir(name);
  const meta = getHook(shortManifestName(name));
  if (!meta) return undefined;
  const short = shortManifestName(name);
  const bundledBase = join(__dirname, "..", "..", "hooks");
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
  };
}
