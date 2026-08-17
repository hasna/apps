// Generator for the vendored Hasna storage kit.
//
// Stamps the canonical templates in `./templates` into a target repo at
// `src/generated/storage-kit/`, records a checksum manifest, and writes the
// tracked `kitVersion` into the repo's `hasna.contract.json`. A `check` mode
// lets CI fail on stale or hand-edited kits via hash comparison.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Ordered list of template files that make up the kit. */
export const KIT_TEMPLATE_FILES = [
  "own.ts",
  "backend.ts",
  "tls.ts",
  "query.ts",
  "pool.ts",
  "migrations.ts",
  "health.ts",
  "index.ts",
  "README.md",
] as const;

/** Files emitted by older kit versions and removed during regeneration. */
export const RETIRED_KIT_FILES = ["mode.ts"] as const;

/** The dependency the generated kit is provenance-bound to. */
const KIT_DEPENDENCY_NAME = "@hasna/contracts";

export type KitTemplateFile = (typeof KIT_TEMPLATE_FILES)[number];

/** Relative directory the kit is stamped into inside a target repo. */
export const KIT_TARGET_SUBDIR = "src/generated/storage-kit";
export const KIT_MANIFEST_FILE = ".storage-kit-manifest.json";
export const KIT_VERSION_PLACEHOLDER = "__KIT_VERSION__";

export interface KitManifest {
  generator: string;
  kitVersion: string;
  files: Record<string, string>;
}

/** Parse `X.Y` out of a version or range spec; null when unparseable. */
function baseMajorMinor(spec: string): { major: number; minor: number } | null {
  const m = spec.trim().match(/^[\^~><=*\s]*(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/**
 * Whether a kit version is compatible with the target repo's declared
 * `@hasna/contracts` dependency range. `null` means "no verdict" — the range
 * or version is unparseable (`workspace:`, `*`, prerelease) and the check
 * stays silent rather than guessing.
 *
 * The comparison is major.minor only. In the fleet's 0.x lineage a minor
 * line is the compatibility boundary (`^0.8.5` means `0.8.x`), so a kit
 * stamped on a different minor line than the declared dependency is drift
 * even when the generated files happen to be self-contained.
 */
export function kitMatchesDeclaredDependency(kitVersion: string, declared: string): boolean | null {
  if (declared.trim() === "*" || declared.includes("workspace:") || declared.includes(" || ")) return null;
  const opMatch = declared.trim().match(/^([\^~><=]*)\s*(\d+\.\d+)/);
  if (!opMatch) return null;
  const op = opMatch[1];
  const dep = baseMajorMinor(declared);
  const kit = baseMajorMinor(kitVersion);
  if (!dep || !kit) return null;
  if (kit.major !== dep.major) return op === ">=" || op === ">";
  if (op === ">=" || op === ">") return kit.minor >= dep.minor;
  return kit.minor === dep.minor;
}

/** Read the target repo's declared `@hasna/contracts` dependency, if any. */
export function readDeclaredKitDependency(targetRepo: string): string | null {
  const pkgPath = join(resolve(targetRepo), "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    for (const section of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      const declared = pkg[section]?.[KIT_DEPENDENCY_NAME];
      if (typeof declared === "string" && declared.length > 0) return declared;
    }
  } catch {
    // An unreadable package.json is not kit drift; the hash check still runs.
  }
  return null;
}


function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** Walk up from `start` to the `@hasna/contracts` package root (has package.json). */
export function findPackageRoot(start: string = moduleDir()): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "@hasna/contracts") return dir;
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate the @hasna/contracts package root.");
}

/** Resolve the templates directory. */
export function resolveTemplatesDir(): string {
  const candidates = [
    join(moduleDir(), "templates"),
    join(findPackageRoot(), "src", "kit", "templates"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.ts"))) return candidate;
  }
  throw new Error(`Kit templates not found. Looked in: ${candidates.join(", ")}`);
}

/** Read the `@hasna/contracts` version — the value stamped as KIT_VERSION. */
export function getKitVersion(): string {
  const pkg = JSON.parse(readFileSync(join(findPackageRoot(), "package.json"), "utf8")) as {
    version?: string;
  };
  if (!pkg.version) throw new Error("@hasna/contracts package.json has no version.");
  return pkg.version;
}

function tsHeader(version: string): string {
  return [
    "// @generated by @hasna/contracts vendor-kit — DO NOT EDIT.",
    `// KIT_VERSION: ${version}`,
    "// Regenerate: bunx @hasna/contracts vendor-kit   Verify (CI): contracts vendor-kit --check",
    "",
    "",
  ].join("\n");
}

/** Render a single template into its final, stamped content for `version`. */
export function renderKitFile(file: KitTemplateFile, version: string, templatesDir = resolveTemplatesDir()): string {
  const raw = readFileSync(join(templatesDir, file), "utf8");
  const withVersion = raw.split(KIT_VERSION_PLACEHOLDER).join(version);
  if (file.endsWith(".ts")) return tsHeader(version) + withVersion;
  return withVersion;
}

export function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex")}`;
}

export interface RenderedKit {
  version: string;
  files: Record<string, string>;
  manifest: KitManifest;
}

/** Render the entire kit (all files + manifest) for `version` without touching disk. */
export function renderKit(version: string = getKitVersion()): RenderedKit {
  const templatesDir = resolveTemplatesDir();
  const files: Record<string, string> = {};
  const manifestFiles: Record<string, string> = {};
  for (const file of KIT_TEMPLATE_FILES) {
    const content = renderKitFile(file, version, templatesDir);
    files[file] = content;
    manifestFiles[file] = sha256(content);
  }
  const manifest: KitManifest = {
    generator: "@hasna/contracts vendor-kit",
    kitVersion: version,
    files: manifestFiles,
  };
  return { version, files, manifest };
}

export interface GenerateKitOptions {
  targetRepo: string;
  version?: string;
  /** Update `hasna.contract.json` kitVersion. Default true. */
  writeContract?: boolean;
}

export interface GenerateKitResult {
  version: string;
  targetDir: string;
  written: string[];
  removed: string[];
  contractUpdated: boolean;
}

/** Stamp the kit into `targetRepo`. Overwrites the generated dir deterministically. */
export function generateKit(options: GenerateKitOptions): GenerateKitResult {
  const version = options.version ?? getKitVersion();
  const rendered = renderKit(version);
  const targetDir = join(resolve(options.targetRepo), KIT_TARGET_SUBDIR);
  mkdirSync(targetDir, { recursive: true });

  const removed: string[] = [];
  for (const file of RETIRED_KIT_FILES) {
    const path = join(targetDir, file);
    if (!existsSync(path)) continue;
    unlinkSync(path);
    removed.push(file);
  }

  const written: string[] = [];
  for (const file of KIT_TEMPLATE_FILES) {
    const content = rendered.files[file];
    if (content === undefined) continue;
    writeFileSync(join(targetDir, file), content, "utf8");
    written.push(file);
  }
  writeFileSync(
    join(targetDir, KIT_MANIFEST_FILE),
    JSON.stringify(rendered.manifest, null, 2) + "\n",
    "utf8",
  );
  written.push(KIT_MANIFEST_FILE);

  let contractUpdated = false;
  if (options.writeContract !== false) {
    contractUpdated = writeKitVersionToContract(resolve(options.targetRepo), version);
  }

  return { version, targetDir, written, removed, contractUpdated };
}

/** Write `kitVersion` into `<targetRepo>/hasna.contract.json` if present. */
export function writeKitVersionToContract(targetRepo: string, version: string): boolean {
  const contractPath = join(targetRepo, "hasna.contract.json");
  if (!existsSync(contractPath)) return false;
  const contract = JSON.parse(readFileSync(contractPath, "utf8")) as Record<string, unknown>;
  if (contract.kitVersion === version) return false;
  contract.kitVersion = version;
  writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n", "utf8");
  return true;
}

export type KitFileStatus = "ok" | "modified" | "missing";

export interface KitCheckFileResult {
  file: string;
  status: KitFileStatus;
}

export interface KitCheckResult {
  ok: boolean;
  version: string;
  targetDir: string;
  files: KitCheckFileResult[];
  extras: string[];
  /** Present when the on-disk manifest records a different kitVersion. */
  staleVersion: string | null;
  /**
   * Present when the target repo declares an `@hasna/contracts` dependency on
   * a different minor line than the kit it carries — e.g. kit 0.4.2 under a
   * `^0.8.5` dependency. The remedy is regenerating the kit or aligning the
   * dependency, never hand-editing the kit.
   */
  depVersionMismatch: { kitVersion: string; declared: string } | null;
}

export interface CheckKitOptions {
  targetRepo: string;
  version?: string;
}

/**
 * Compare the on-disk kit against a fresh render for `version` (defaults to the
 * installed package version). Any content difference — stale version or a hand
 * edit — surfaces as `modified`/`missing`. Extra files are reported too.
 */
export function checkKit(options: CheckKitOptions): KitCheckResult {
  const version = options.version ?? getKitVersion();
  const rendered = renderKit(version);
  const targetDir = join(resolve(options.targetRepo), KIT_TARGET_SUBDIR);

  const files: KitCheckFileResult[] = [];
  for (const file of KIT_TEMPLATE_FILES) {
    const path = join(targetDir, file);
    if (!existsSync(path)) {
      files.push({ file, status: "missing" });
      continue;
    }
    const actual = sha256(readFileSync(path, "utf8"));
    const expected = rendered.manifest.files[file];
    files.push({ file, status: actual === expected ? "ok" : "modified" });
  }

  const expectedNames = new Set<string>([...KIT_TEMPLATE_FILES, KIT_MANIFEST_FILE]);
  const extras: string[] = [];
  if (existsSync(targetDir)) {
    for (const entry of readdirSync(targetDir)) {
      if (!expectedNames.has(entry)) extras.push(entry);
    }
  }

  let staleVersion: string | null = null;
  let manifestKitVersion: string | null = null;
  const manifestPath = join(targetDir, KIT_MANIFEST_FILE);
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as KitManifest;
      manifestKitVersion = manifest.kitVersion;
      if (manifest.kitVersion !== version) staleVersion = manifest.kitVersion;
    } catch {
      staleVersion = null;
    }
  }

  let depVersionMismatch: KitCheckResult["depVersionMismatch"] = null;
  const declared = readDeclaredKitDependency(options.targetRepo);
  if (declared && staleVersion === null) {
    const kitVersion = manifestKitVersion ?? version;
    const matches = kitMatchesDeclaredDependency(kitVersion, declared);
    if (matches === false) {
      depVersionMismatch = { kitVersion, declared };
    }
  }

  const ok = files.every((f) => f.status === "ok") && extras.length === 0 && depVersionMismatch === null;
  return { ok, version, targetDir, files, extras, staleVersion, depVersionMismatch };
}
