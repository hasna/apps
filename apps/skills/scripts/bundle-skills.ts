#!/usr/bin/env bun
/**
 * bundle-skills — build signed, versioned bundles for the canonical skill corpus.
 *
 * The npm package ships zero corpus; this script is the CI-side producer that turns
 * the canonical corpus (the monorepo checkout: `skills/`) into one
 * tar.gz + manifest per skill, the format `skills pull` verifies and installs.
 *
 *   bun run scripts/bundle-skills.ts [--source <dir>] [--out <dir>] [--commit <sha>]
 *
 *   --source   canonical corpus: a package root with skills/, or a
 *              flat corpus dir. Default: the package root of this checkout.
 *   --out      output directory for <name>-<version>.tar.gz + .manifest.json pairs.
 *              Default: dist/bundles (gitignored).
 *   --commit   source_commit recorded in every manifest. Default: $SKILLS_SOURCE_COMMIT,
 *              else `git rev-parse HEAD` from the source tree, else "unknown".
 *
 * Signing: the manifest's `signature` is an HMAC-SHA256 of the canonical bundle bytes,
 * keyed from the SKILLS_SIGNING_KEY environment variable. The key is read from the
 * environment ONLY and is never printed, logged, or written anywhere. When the key is
 * unset every manifest is emitted unsigned with a warning on stderr — CI without the
 * secret still builds, but nothing claims authenticity it does not have.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSkillBundle,
  resolveSigningKey,
  SKILLS_SOURCE_COMMIT_ENV,
} from "../src/lib/skill-bundles.js";
import {
  listPortableSkills,
  readPortableSkillManifest,
} from "../src/lib/portable-skills.js";
import { SKILLS_SOURCE_ENV } from "../src/lib/agent-sync.js";

function parseArgs(argv: string[]): { source?: string; out?: string; commit?: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source" || arg === "--out" || arg === "--commit") {
      args[arg.slice(2)] = argv[i + 1] ?? "";
      i += 1;
    } else if (arg.startsWith("--source=") || arg.startsWith("--out=") || arg.startsWith("--commit=")) {
      args[arg.slice(2, arg.indexOf("="))] = arg.slice(arg.indexOf("=") + 1);
    } else if (arg === "--help" || arg === "-h") {
      console.log("bundle-skills [--source <dir>] [--out <dir>] [--commit <sha>]");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");

/**
 * The canonical corpus roots: the package root's skills/ directory, or a flat dir.
 * `agent-skills/` is not bundled: the fleet workflow skills there moved to the private
 * per-station store (owner ruling 2026-08-15) and distribute to station caches through
 * fleet-resources, not through the public `skills pull` bundles.
 */
function resolveSourceRoots(source: string): string[] {
  const roots: string[] = [];
  for (const sub of ["skills"]) {
    const candidate = join(source, sub);
    try {
      if (statSync(candidate).isDirectory()) roots.push(candidate);
    } catch {
      // Not a directory; fall through.
    }
  }
  return roots.length > 0 ? roots : [source];
}

function resolveSourceCommit(source: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const ambient = process.env[SKILLS_SOURCE_COMMIT_ENV]?.trim();
  if (ambient) return ambient;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const args = parseArgs(process.argv.slice(2));
const source = resolve(args.source ?? process.env[SKILLS_SOURCE_ENV] ?? PACKAGE_ROOT);
const outDir = resolve(args.out ?? join(PACKAGE_ROOT, "dist", "bundles"));
const commit = resolveSourceCommit(source, args.commit);

const roots = resolveSourceRoots(source);
const skills = roots.flatMap((root) => listPortableSkills({ rootDir: root }));
const key = resolveSigningKey();
if (!key) {
  console.warn("SKILLS_SIGNING_KEY is not set: emitting UNSIGNED manifests (no signature field).");
}

mkdirSync(outDir, { recursive: true });
let bundled = 0;
const failures: string[] = [];
for (const skill of skills) {
  try {
    const portable = readPortableSkillManifest(skill.path, skill.name);
    const built = buildSkillBundle({
      name: skill.name,
      dir: skill.path,
      version: portable.version,
      sourceCommit: commit,
      signingKey: key ?? undefined,
    });
    const base = `${skill.name}-${portable.version}`;
    const bundlePath = join(outDir, `${base}.tar.gz`);
    const manifestPath = join(outDir, `${base}.manifest.json`);
    writeFileSync(bundlePath, built.bundle.bytes);
    writeFileSync(manifestPath, `${JSON.stringify(built.manifest, null, 2)}\n`);
    // The server-side publish manifest (the multipart `manifest` part of
    // POST /api/v1/skills). Kept separate from the bundle envelope on purpose: the
    // envelope is the artifact record, this is the wire shape the server accepts.
    writeFileSync(
      join(outDir, `${base}.server.json`),
      `${JSON.stringify(serverPublishManifest(skill.name, portable, built.bundle.sha256), null, 2)}\n`,
    );
    const signed = built.manifest.signature ? "signed" : "unsigned";
    console.log(`bundled ${skill.name}@${portable.version} ${built.bundle.sha256} ${signed} ${built.bundle.fileCount} files`);
    bundled += 1;
  } catch (error) {
    failures.push(`${skill.name}: ${(error as Error).message}`);
  }
}

for (const failure of failures) {
  console.error(`bundle FAILED ${failure}`);
}
console.log(`Bundled ${bundled} skills into ${outDir}${failures.length ? ` (${failures.length} failed)` : ""}`);
if (failures.length > 0) process.exitCode = 1;

interface ServerPublishManifest {
  slug: string;
  name: string;
  displayName?: string;
  description: string;
  category: string;
  tags: string[];
  kind: string;
  version: string;
  source: string;
  bundleSha256: string;
}

/** The wire shape POST /api/v1/skills accepts, matching RemoteSkillsClient.publishSkill. */
function serverPublishManifest(
  name: string,
  portable: ReturnType<typeof readPortableSkillManifest>,
  bundleSha256: string,
): ServerPublishManifest {
  return {
    slug: name,
    name,
    ...(portable.displayName ? { displayName: portable.displayName } : {}),
    description: portable.description,
    category: portable.category ?? "Development Tools",
    tags: portable.tags ?? [],
    kind: portable.kind ?? "executable",
    version: portable.version,
    source: "upstream",
    bundleSha256,
  };
}
