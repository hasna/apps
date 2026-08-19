#!/usr/bin/env bun
/**
 * Member bootstrap generator for hasna/apps.
 *
 * Creates a conforming new member from tooling/member-scaffold/template:
 *
 *   - four surfaces: `<name>` CLI bin, `<name>-mcp` bin, `<name>-serve` bin,
 *     `./sdk` export (repo law 4 in AGENTS.md);
 *   - hasna.contract.json at contracts kit 0.11.1 (schema
 *     hasna.service_contract.v1) with api/mcp/cli/sdk serviceSurfaces and a
 *     sqlite-only storage block;
 *   - tsconfig.json extending ../../tsconfig.base.json (the base's stated
 *     purpose: NEW members adopt it — see the inheritance census note in
 *     tsconfig.base.json);
 *   - changeset wiring: writes `.changeset/<name>-bootstrap.md` with a
 *     `minor` bump so the versioning suite accepts the new package;
 *   - gates wiring: `contract:check` (contracts repo-conformance), `verify`
 *     (typecheck + test + build + contract:check), and the standard
 *     scripts the root gates and turbo consume (build/test/typecheck).
 *
 * Usage:
 *   bun tooling/member-scaffold/generate-member.ts <kebab-name> ["description"]
 *   bun tooling/member-scaffold/generate-member.ts <kebab-name> --out <dir>   # fixture/CI
 *
 * The generator refuses a non-kebab-case name and an existing apps/<name>
 * target (idempotency: never clobber a member).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCAFFOLD_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(SCAFFOLD_DIR, "template");

function usage(): never {
  console.error("usage: bun tooling/member-scaffold/generate-member.ts <kebab-name> [\"description\"] [--out <dir>]");
  process.exit(2);
}

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : undefined;
const positional = outIdx >= 0 ? args.slice(0, outIdx) : args;
if (positional.length < 1) usage();
const name = positional[0];
const description = positional[1] ?? `@hasna/${name}`;

if (!NAME_RE.test(name)) {
  console.error(`invalid member name "${name}": must be kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`);
  process.exit(2);
}

const repoRoot = outDir ?? path.resolve(SCAFFOLD_DIR, "..", "..");
const appsDir = path.join(repoRoot, "apps");
const target = path.join(appsDir, name);
if (fs.existsSync(target)) {
  console.error(`refusing to generate: ${target} already exists (idempotency — never clobber a member)`);
  process.exit(2);
}

function copyTemplate(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyTemplate(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

const upper = name.toUpperCase().replace(/-/g, "_");
const substitute = (text: string): string =>
  text.replaceAll("__MEMBER__", name).replaceAll("__MEMBER_UPPER__", upper).replaceAll("__MEMBER_DESC__", description);

function writeTree(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      writeTree(p);
    } else {
      const original = fs.readFileSync(p, "utf8");
      fs.writeFileSync(p, substitute(original));
    }
  }
}

fs.mkdirSync(target, { recursive: true });
copyTemplate(TEMPLATE_DIR, target);
writeTree(target);

// changeset wiring — the versioning suite requires a pending changeset for a
// new package (version-without-changeset is a hard gate in test:versioning).
const changesetDir = path.join(repoRoot, ".changeset");
if (fs.existsSync(changesetDir)) {
  const changeset = `"@hasna/${name}": minor
---

Bootstrap @hasna/${name} as a new hasna/apps member (generated from tooling/member-scaffold):

- Four surfaces: \`${name}\` CLI bin, \`${name}-mcp\` bin, \`${name}-serve\` bin, \`./sdk\` export.
- hasna.contract.json at contracts kit 0.11.1 (schema hasna.service_contract.v1).
- tsconfig extending tsconfig.base.json; contract:check + verify gates wired.
`;
  fs.writeFileSync(path.join(changesetDir, `${name}-bootstrap.md`), changeset);
}

console.log(`generated ${path.relative(repoRoot, target)}`);
console.log(`next steps:`);
console.log(`  bun install                       # add @hasna/contracts devDep + refresh bun.lock`);
console.log(`  bun run check:names && bun run check:manifests   # the census gates`);
console.log(`  cd apps/${name} && bun run verify  # typecheck + test + build + contract:check`);
console.log(`  # the changeset is at .changeset/${name}-bootstrap.md`);
