#!/usr/bin/env bun
/**
 * Contract-gate checks for this repo's own wiring.
 *
 * These are the assertions that catch a hasna.contract.json which merely *looks*
 * like a service contract, and a release gate wired to a command that cannot
 * run. `contracts repo-conformance` is the authority on conformance; this module
 * exists so the failure is caught by `bun test` and CI, offline, without the
 * repo depending on the kit at runtime.
 *
 * Run `bun scripts/contract-gate.ts` for the offline checks, or add `--online`
 * to also confirm that every contracts subcommand named in package.json is one
 * the pinned kit actually exposes.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const REPO_ROOT = join(import.meta.dir, "..");
export const MANIFEST_PATH = join(REPO_ROOT, "hasna.contract.json");
export const PACKAGE_PATH = join(REPO_ROOT, "package.json");

/** Top-level keys the hasna.service_contract.v1 schema defines. */
const MANIFEST_KEYS = [
  "$schema",
  "schema",
  "name",
  "class",
  "contractVersion",
  "kitVersion",
  "description",
  "bins",
  "hosting",
  "serviceSurfaces",
  "storage",
  "metadata",
] as const;

const MANIFEST_CLASSES = ["library", "cli-with-store", "service", "saas"] as const;
const STORAGE_BACKENDS = ["sqlite", "postgresql"] as const;

/** Bin suffixes the contract allowlists for an app named `<name>`. */
const ALLOWED_BIN_SUFFIXES = [
  "",
  "-cli",
  "-mcp",
  "-serve",
  "-worker",
  "-runner",
  "-daemon",
  "-migrate",
  "-doctor",
] as const;

export type Manifest = Record<string, unknown>;
export type PackageJson = {
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
  exports?: Record<string, unknown>;
};

export function readManifest(path = MANIFEST_PATH): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

export function readPackageJson(path = PACKAGE_PATH): PackageJson {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

/** The pinned kit spec, e.g. `@hasna/contracts@0.8.5`, taken from kitVersion. */
export function contractsKitSpec(manifest: Manifest = readManifest()): string {
  const version = manifest["kitVersion"];
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("hasna.contract.json is missing kitVersion; the kit spec cannot be pinned");
  }
  return `@hasna/contracts@${version}`;
}

/**
 * Structural problems with the manifest: the wrong schema literal, a missing
 * required key, or an invented top-level key. This is deliberately narrower than
 * the kit's own validator — it is the offline tripwire, not the authority.
 */
export function manifestShapeIssues(manifest: Manifest): string[] {
  const issues: string[] = [];

  if (manifest["schema"] !== "hasna.service_contract.v1") {
    issues.push(`schema must be "hasna.service_contract.v1", got ${JSON.stringify(manifest["schema"])}`);
  }
  if (manifest["contractVersion"] !== "v1") {
    issues.push(`contractVersion must be "v1", got ${JSON.stringify(manifest["contractVersion"])}`);
  }
  if (typeof manifest["name"] !== "string" || manifest["name"].length === 0) {
    issues.push("name is required");
  }
  if (!MANIFEST_CLASSES.includes(manifest["class"] as (typeof MANIFEST_CLASSES)[number])) {
    issues.push(`class must be one of ${MANIFEST_CLASSES.join(", ")}, got ${JSON.stringify(manifest["class"])}`);
  }
  if (typeof manifest["kitVersion"] !== "string" || manifest["kitVersion"].length === 0) {
    issues.push("kitVersion is required");
  }

  const storage = manifest["storage"] as Record<string, unknown> | undefined;
  if (storage && !STORAGE_BACKENDS.includes(storage["backend"] as (typeof STORAGE_BACKENDS)[number])) {
    issues.push(
      `storage.backend must be one of ${STORAGE_BACKENDS.join(", ")}, got ${JSON.stringify(storage["backend"])}`,
    );
  }

  const unknown = Object.keys(manifest).filter(
    (key) => !MANIFEST_KEYS.includes(key as (typeof MANIFEST_KEYS)[number]),
  );
  if (unknown.length > 0) {
    issues.push(`unrecognized top-level keys: ${unknown.join(", ")}`);
  }

  return issues;
}

/** Declared bins that fall outside the contract's bin allowlist. */
export function binAllowlistIssues(manifest: Manifest): string[] {
  const name = manifest["name"];
  if (typeof name !== "string") return [];
  const allowed = new Set(ALLOWED_BIN_SUFFIXES.map((suffix) => `${name}${suffix}`));
  const bins = Array.isArray(manifest["bins"]) ? (manifest["bins"] as string[]) : [];
  return bins.filter((bin) => !allowed.has(bin)).map((bin) => `bin "${bin}" is not allowlisted`);
}

/**
 * package.json bins that are neither declared in the manifest nor recorded as a
 * pending rename. `contracts repo-conformance` reports every undeclared bin;
 * this narrows it to the *undocumented* ones so a known, owner-blocked rename
 * does not hide a new drift.
 */
export function undocumentedBinIssues(manifest: Manifest, pkg: PackageJson): string[] {
  const declared = new Set(Array.isArray(manifest["bins"]) ? (manifest["bins"] as string[]) : []);
  const metadata = manifest["metadata"] as Record<string, unknown> | undefined;
  const alignment = metadata?.["contractAlignment"] as Record<string, unknown> | undefined;
  const pending = Array.isArray(alignment?.["pendingBinRenames"])
    ? (alignment["pendingBinRenames"] as { bin?: string }[])
    : [];
  const recorded = new Set(pending.map((entry) => entry.bin).filter((bin): bin is string => Boolean(bin)));

  return Object.keys(pkg.bin ?? {})
    .filter((bin) => !declared.has(bin) && !recorded.has(bin))
    .map(
      (bin) =>
        `package.json ships bin "${bin}" that the manifest neither declares nor records under metadata.contractAlignment.pendingBinRenames`,
    );
}

/**
 * Problems with the contract storage shape (0.11.1 schema): the retired legacy
 * `mode` key, a missing or invalid `backend`, or a sqlite backend without the
 * canonical sqlitePath. `contracts repo-conformance` is the authority; this is
 * the offline tripwire so `bun test` catches a stale shape without the kit.
 */
export function storageBackendIssues(manifest: Manifest): string[] {
  const issues: string[] = [];
  const storage = manifest["storage"] as Record<string, unknown> | undefined;
  if (!storage) {
    issues.push("storage is required for a cli-with-store manifest");
    return issues;
  }
  if ("mode" in storage) {
    issues.push("storage.mode is the retired legacy shape; the 0.11.1 schema declares storage.backend");
  }
  const backend = storage["backend"];
  if (typeof backend !== "string" || !STORAGE_BACKENDS.includes(backend as (typeof STORAGE_BACKENDS)[number])) {
    issues.push(`storage.backend must be one of ${STORAGE_BACKENDS.join(", ")}, got ${JSON.stringify(backend)}`);
  }
  if (backend === "sqlite") {
    const sqlitePath = storage["sqlitePath"];
    if (typeof sqlitePath !== "string" || !sqlitePath.endsWith(".db")) {
      issues.push("storage.sqlitePath is required and must end in .db for a sqlite backend");
    }
  }
  const engines = storage["engines"];
  if (engines !== undefined && !Array.isArray(engines)) {
    issues.push("storage.engines must be an array");
  }
  return issues;
}

/**
 * The daemon surface is real end to end: `<name>-daemon` is declared in the
 * manifest bin list, carried by a supported CLI-kind service surface, present
 * in package.json bin, and backed by an entry file that resolves. A bin that
 * only exists in the manifest is a contract that cannot run.
 */
export function daemonSurfaceIssues(manifest: Manifest, pkg: PackageJson): string[] {
  const name = manifest["name"];
  if (typeof name !== "string") return [];
  const daemonBin = `${name}-daemon`;
  const issues: string[] = [];

  const declaredBins = Array.isArray(manifest["bins"]) ? (manifest["bins"] as string[]) : [];
  if (!declaredBins.includes(daemonBin)) {
    issues.push(`manifest bins do not declare ${daemonBin}`);
  }

  const surfaces = Array.isArray(manifest["serviceSurfaces"])
    ? (manifest["serviceSurfaces"] as Record<string, unknown>[])
    : [];
  const hasSurface = surfaces.some(
    (surface) => surface["bin"] === daemonBin && surface["kind"] === "cli" && surface["status"] === "supported",
  );
  if (!hasSurface) {
    issues.push(`no supported cli service surface declares bin ${daemonBin}`);
  }

  const bins = pkg.bin ?? {};
  if (!(daemonBin in bins)) {
    issues.push(`package.json bin does not ship ${daemonBin}`);
  } else {
    const target = bins[daemonBin];
    if (typeof target === "string" && !existsSync(join(REPO_ROOT, target))) {
      issues.push(`package.json bin ${daemonBin} targets ${target}, which does not exist`);
    }
  }
  return issues;
}

/**
 * The SDK surface is real end to end: a supported sdk service surface declares
 * exportSubpath "./sdk", package.json exports carries that subpath, and the
 * export target file resolves. An SDK the package cannot import is not a
 * surface.
 */
export function sdkSurfaceIssues(manifest: Manifest, pkg: PackageJson): string[] {
  const issues: string[] = [];
  const surfaces = Array.isArray(manifest["serviceSurfaces"])
    ? (manifest["serviceSurfaces"] as Record<string, unknown>[])
    : [];
  const sdk = surfaces.find((surface) => surface["kind"] === "sdk");
  if (!sdk) {
    issues.push("no sdk service surface is declared");
    return issues;
  }
  if (sdk["status"] !== "supported") {
    issues.push(`sdk surface must be supported, got ${JSON.stringify(sdk["status"])}`);
  }
  const subpath = sdk["exportSubpath"];
  if (typeof subpath !== "string" || subpath !== "./sdk") {
    issues.push(`sdk surface must declare exportSubpath "./sdk", got ${JSON.stringify(subpath)}`);
  }

  const targets: string[] = [];
  const exportsField = pkg.exports;
  if (exportsField && typeof exportsField === "object") {
    const entry = exportsField["./sdk"];
    if (typeof entry === "string") {
      targets.push(entry);
    } else if (entry && typeof entry === "object") {
      for (const value of Object.values(entry)) {
        if (typeof value === "string") targets.push(value);
      }
    }
  }
  if (targets.length === 0) {
    issues.push('package.json exports does not carry "./sdk"');
  }
  for (const target of targets) {
    if (!existsSync(join(REPO_ROOT, target))) {
      issues.push(`package.json exports "./sdk" targets ${target}, which does not exist`);
    }
  }
  return issues;
}

/** Every script name reachable from `entry`, following `bun run`/`npm run` and pre/post hooks. */
export function reachableScripts(scripts: Record<string, string>, entry: string): Set<string> {
  const reached = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (reached.has(name) || !(name in scripts)) continue;
    reached.add(name);

    for (const hook of [`pre${name}`, `post${name}`]) {
      if (hook in scripts) queue.push(hook);
    }
    const body = scripts[name] ?? "";
    for (const match of body.matchAll(/(?:bun|npm|pnpm|yarn)\s+run\s+([\w:.@/-]+)/g)) {
      const referenced = match[1];
      if (referenced && referenced in scripts) queue.push(referenced);
    }
  }

  return reached;
}

/**
 * Problems with the published-artifact gate: a declared scan script that does
 * not exist, or a prepack that never reaches it. Either one means the gate is
 * decorative.
 */
export function artifactGateIssues(manifest: Manifest, pkg: PackageJson): string[] {
  const issues: string[] = [];
  const scripts = pkg.scripts ?? {};
  const metadata = manifest["metadata"] as Record<string, unknown> | undefined;
  const release = metadata?.["release"] as Record<string, unknown> | undefined;
  const artifactScan = release?.["artifactScan"] as Record<string, unknown> | undefined;
  const declared = artifactScan?.["script"];

  if (typeof declared !== "string" || declared.length === 0) {
    issues.push("metadata.release.artifactScan.script is required for a published package");
    return issues;
  }
  if (!(declared in scripts)) {
    issues.push(`metadata.release.artifactScan.script names "${declared}", which is not a package script`);
  }
  if (!("prepack" in scripts)) {
    issues.push("no prepack script: the gate can be bypassed by publishing directly");
  } else if (declared in scripts && !reachableScripts(scripts, "prepack").has(declared)) {
    issues.push(`prepack does not reach "${declared}"`);
  }

  return issues;
}

/** `contracts` CLI invocations in package.json scripts, with the version each pins. */
export function contractsInvocations(pkg: PackageJson): { script: string; version: string | null; subcommand: string | null }[] {
  const found: { script: string; version: string | null; subcommand: string | null }[] = [];
  for (const [script, body] of Object.entries(pkg.scripts ?? {})) {
    for (const match of body.matchAll(/(?:bunx|npx|pnpx)\s+(?:--\S+\s+)*@hasna\/contracts(@[^\s]+)?\s*([\w:-]+)?/g)) {
      found.push({
        script,
        version: match[1] ? match[1].slice(1) : null,
        subcommand: match[2] ?? null,
      });
    }
  }
  return found;
}

/** Unpinned or drifted `@hasna/contracts` invocations in package.json scripts. */
export function contractsPinIssues(manifest: Manifest, pkg: PackageJson): string[] {
  const kitVersion = manifest["kitVersion"];
  const issues: string[] = [];
  for (const invocation of contractsInvocations(pkg)) {
    if (!invocation.version) {
      issues.push(`script "${invocation.script}" invokes @hasna/contracts without a version pin`);
    } else if (invocation.version !== kitVersion) {
      issues.push(
        `script "${invocation.script}" pins @hasna/contracts@${invocation.version}, but kitVersion is ${String(kitVersion)}`,
      );
    }
  }
  return issues;
}

/** Subcommands of the pinned kit CLI, read from its own `--help` output. */
export function pinnedKitSubcommands(manifest: Manifest = readManifest()): string[] {
  const result = Bun.spawnSync(["bunx", contractsKitSpec(manifest), "--help"], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  if (result.exitCode !== 0) {
    throw new Error(`${contractsKitSpec(manifest)} --help exited ${result.exitCode}\n${output}`);
  }
  const commandsSection = output.split(/^Commands:$/m)[1] ?? "";
  return [...commandsSection.matchAll(/^\s{2}([a-z][\w-]*)/gm)].map((match) => match[1] as string);
}

/** Subcommands named in package.json that the pinned kit CLI does not expose. */
export function unknownSubcommandIssues(manifest: Manifest, pkg: PackageJson): string[] {
  const known = new Set(pinnedKitSubcommands(manifest));
  return contractsInvocations(pkg)
    .filter((invocation) => invocation.subcommand && !known.has(invocation.subcommand))
    .map(
      (invocation) =>
        `script "${invocation.script}" runs "contracts ${String(invocation.subcommand)}", which the pinned kit does not expose`,
    );
}

if (import.meta.main) {
  const online = process.argv.includes("--online");
  const manifest = readManifest();
  const pkg = readPackageJson();

  const issues = [
    ...manifestShapeIssues(manifest),
    ...storageBackendIssues(manifest),
    ...binAllowlistIssues(manifest),
    ...undocumentedBinIssues(manifest, pkg),
    ...daemonSurfaceIssues(manifest, pkg),
    ...sdkSurfaceIssues(manifest, pkg),
    ...artifactGateIssues(manifest, pkg),
    ...contractsPinIssues(manifest, pkg),
    ...(online ? unknownSubcommandIssues(manifest, pkg) : []),
  ];

  if (issues.length > 0) {
    for (const issue of issues) console.error(`fail contract-gate: ${issue}`);
    process.exit(1);
  }
  console.log(
    `pass contract-gate: manifest shape, storage.backend, bin allowlist, daemon bin, SDK export, artifact gate, and kit pin${online ? ", kit subcommands" : ""}`,
  );
}
