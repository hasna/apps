/**
 * Nested-package rule — one npm package per app, never a split surface.
 *
 * `rules/package-surfaces.md` (owner decision 2026-09-03): `apps/<name>` ↔
 * `@hasna/<name>` is one-to-one and carries all four surfaces; `-sdk`,
 * `-mcp`, `-cli`, `-serve` (or any other) split packages are never
 * published. The name gate (`check-names.ts`) enforces the top level only:
 * a `package.json` BELOW a member root that declares a publishable
 * `@hasna/*` name — `apps/connectors/sdk/package.json` → `@hasna/connectors-sdk`
 * (published, 0.1.6 on npm), `apps/todos/sdk/package.json` → `@hasna/todos-sdk`,
 * `apps/todos/ai/package.json` → `@hasna/todos-ai` — is exactly the split
 * the rule forbids, and nothing scanned it (T1 §3.2).
 *
 * Two plugin CATALOGS legitimately carry many nested `@hasna/*` manifests and
 * are recorded as families rather than exceptions: the connector catalog
 * (`apps/connectors/connectors/<slug>` ↔ `@hasna/connect-<slug>`, 1154
 * entries) and the hook catalog (`apps/hooks/hooks/<slug>` ↔ `@hasna/<slug>`,
 * `hook-*`, 33 entries). Neither is published (npm 404 measured 2026-09-11).
 * A family entry must still match its directory name exactly; a mismatch is
 * a violation (two connectors measured: `connect-twocaptcha`,
 * `connect-voxel-energy` — the directory carries the `connect-` prefix and
 * the name doubles it).
 *
 * Shared by the standard-adherence test (report/hard via gate-mode.ts) and
 * the `check-nested-packages.ts` gate script, so both agree byte-for-byte.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "build", ".git", ".turbo", "coverage"]);
const MAX_DEPTH = 6;

export interface NestedFamily {
  member: string;
  /** Matches the nested package.json path relative to the repo root; group 1 is the slug. */
  file: RegExp;
  expectedName: (slug: string) => string;
  reason: string;
}

export const NESTED_FAMILIES: NestedFamily[] = [
  {
    member: "connectors",
    file: /^apps\/connectors\/connectors\/([a-z0-9-]+)\/package\.json$/,
    expectedName: (slug) => `@hasna/connect-${slug}`,
    reason: "Connector catalog: one manifest per third-party connector, installed standalone, not a member surface split; not published (npm 404, 2026-09-11).",
  },
  {
    member: "hooks",
    file: /^apps\/hooks\/hooks\/(hook-[a-z0-9-]+)\/package\.json$/,
    expectedName: (slug) => `@hasna/${slug}`,
    reason: "Hook catalog: one manifest per agent hook plugin, not a member surface split; not published (npm 404, 2026-09-11).",
  },
];

export interface NestedPackageViolation {
  file: string;
  member: string;
  name: string;
  kind: "split-package" | "family-name-mismatch" | "unparseable";
  detail: string;
}

function walk(dir: string, depth: number, onFile: (absolute: string) => void): void {
  if (depth > MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(absolute, depth + 1, onFile);
    } else if (entry.isFile() && entry.name === "package.json") {
      onFile(absolute);
    }
  }
}

/** Every package.json strictly BELOW a member root, as repo-relative posix paths. */
export function nestedManifests(root: string): string[] {
  const apps = path.join(root, "apps");
  const out: string[] = [];
  if (!fs.existsSync(apps)) return out;
  for (const entry of fs.readdirSync(apps, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const memberDir = path.join(apps, entry.name);
    if (!fs.existsSync(path.join(memberDir, "package.json"))) continue;
    for (const sub of fs.readdirSync(memberDir, { withFileTypes: true })) {
      if (!sub.isDirectory() || SKIP_DIRECTORIES.has(sub.name)) continue;
      walk(path.join(memberDir, sub.name), 1, (absolute) => {
        out.push(path.relative(root, absolute).split(path.sep).join("/"));
      });
    }
  }
  return out.sort();
}

export function nestedPackageViolations(root: string, families: NestedFamily[] = NESTED_FAMILIES): NestedPackageViolation[] {
  const out: NestedPackageViolation[] = [];
  for (const file of nestedManifests(root)) {
    const member = file.split("/")[1] ?? "";
    let pkg: { name?: unknown; private?: unknown };
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    } catch {
      // Not every nested package.json is ours to parse (test fixtures with
      // deliberate garbage exist); an unparseable one cannot declare a name.
      continue;
    }
    const name = typeof pkg.name === "string" ? pkg.name : "";
    if (!name.startsWith("@hasna/")) continue;
    if (pkg.private === true) continue;
    const family = families.find((f) => f.member === member && f.file.test(file));
    if (family) {
      const slug = file.match(family.file)![1]!;
      const expected = family.expectedName(slug);
      if (name !== expected) {
        out.push({ file, member, name, kind: "family-name-mismatch", detail: `catalog entry must be named ${expected} (directory ${slug}), got ${name}` });
      }
      continue;
    }
    out.push({
      file,
      member,
      name,
      kind: "split-package",
      detail: `nested publishable package ${name} splits @hasna/${member}'s surface; fold it into the member (./sdk export, -mcp bin) or mark it private:true`,
    });
  }
  return out;
}

/** Families whose directory pattern matches nothing any more (rot). */
export function staleFamilies(root: string, families: NestedFamily[] = NESTED_FAMILIES): NestedFamily[] {
  const files = nestedManifests(root);
  return families.filter((f) => !files.some((file) => f.file.test(file)));
}

export function formatViolation(v: NestedPackageViolation): string {
  return `${v.member}: ${v.file}: ${v.kind}: ${v.detail}`;
}
