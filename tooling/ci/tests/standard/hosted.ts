/**
 * Hosted-member resolution — shared by every fleet-alignment gate.
 *
 * "Hosted" means the member is served behind the fleet gateway
 * (`https://api.hasna.com/<app>`) and its client bins are expected to fail
 * closed without a credential. Three signals make a member hosted, any one is
 * enough:
 *
 *   1. it is a `source: "monorepo"` entry of the hosted registry
 *      (`tooling/fleet/hosted-apps.json`, hasna/apps#1595);
 *   2. its `hasna.contract.json` declares `hosting` including `hasna-saas`;
 *   3. its `hasna.contract.json` declares `placement.hosted === true` (the
 *      manifest field @hasna/contracts 1.1.0 adds; read defensively so the
 *      gates work before and after that kit lands).
 *
 * The registry is the operational source of truth today (it is what the
 * fleet-key drift lane probes); the manifest signals let a member declare
 * itself hosted without a registry edit. A member listed nowhere is a
 * user-hosted / local-by-design tool and is outside the hosted gates.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { APPS_DIR, REPO_ROOT } from "./census";

export const HOSTED_REGISTRY_PATH = path.join(REPO_ROOT, "tooling", "fleet", "hosted-apps.json");

interface RegistryEntry {
  app?: string;
  source?: string;
}

export function hostedRegistryMembers(registryPath: string = HOSTED_REGISTRY_PATH): string[] {
  let doc: { apps?: RegistryEntry[] };
  try {
    doc = JSON.parse(fs.readFileSync(registryPath, "utf8")) as { apps?: RegistryEntry[] };
  } catch {
    return [];
  }
  return (doc.apps ?? [])
    .filter((e) => e.source === "monorepo" && typeof e.app === "string")
    .map((e) => e.app as string)
    .sort();
}

export function manifestDeclaresHosted(memberDir: string): boolean {
  const manifestPath = path.join(memberDir, "hasna.contract.json");
  if (!fs.existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      hosting?: unknown;
      placement?: { hosted?: unknown };
    };
    if (Array.isArray(manifest.hosting) && manifest.hosting.includes("hasna-saas")) return true;
    if (manifest.placement && manifest.placement.hosted === true) return true;
  } catch {
    return false;
  }
  return false;
}

/** Hosted members present in `appsDir` (registry ∪ manifest signals), sorted. */
export function hostedMembersIn(appsDir: string = APPS_DIR, registryPath: string = HOSTED_REGISTRY_PATH): string[] {
  const out = new Set<string>();
  for (const name of hostedRegistryMembers(registryPath)) {
    if (fs.existsSync(path.join(appsDir, name, "package.json"))) out.add(name);
  }
  for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(appsDir, entry.name);
    if (!fs.existsSync(path.join(dir, "package.json"))) continue;
    if (manifestDeclaresHosted(dir)) out.add(entry.name);
  }
  return [...out].sort();
}

export function isHostedMember(name: string, appsDir: string = APPS_DIR): boolean {
  return hostedMembersIn(appsDir).includes(name);
}
