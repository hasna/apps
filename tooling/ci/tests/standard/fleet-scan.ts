/**
 * Shared tree walker for the textual fleet-alignment gates
 * (fleet-hostnames, no-mode-vocabulary).
 *
 * One pass per member over the files a ruling can be violated in:
 *
 *   - `src/**` — code and comments (a comment is reported with a `(comment)`
 *     marker so owners can rank fixes; the vocabulary rulings forbid the
 *     words, not only the behaviour);
 *   - `hasna.contract.json`, `README.md`, `docs/**\/*.md` — the public story;
 *   - `Dockerfile*`, `docker-compose*.yml`, `deploy/**`, `infra/**`,
 *     `*.env.example` — container and task environment.
 *
 * Test material is NOT a place a convention is fixed and is skipped by path
 * shape (`*.test.*`, `*.spec.*`, `test/`, `tests/`, `__tests__/`,
 * `fixtures/`, `testing/`, `test-support/`, `test-helpers/`, `test-utils/`,
 * `__fixtures__/`, `*.fixture.*`); `CHANGELOG.md` is release
 * history and is skipped too. Anything else a gate must tolerate is an
 * explicit allowlist entry with a reason, in the gate's own file.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "build", "bin", ".git", "coverage", ".turbo", "generated", "vendor"]);
export const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml", ".toml", ".sh", ".env", ".example"]);

const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__|fixtures?|__fixtures__|testing|test-support|test-helpers|test-utils)\/|\.(?:test|spec|fixture)\.[a-z]+$|(?:^|\/)test-[a-z0-9-]+\.[a-z]+$/;

export function isTestPath(relative: string): boolean {
  return TEST_PATH.test(relative);
}

export function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("#");
}

export interface ScanFile {
  /** Path relative to the member directory (posix separators). */
  relative: string;
  absolute: string;
  /** Which scope bucket the file came from. */
  scope: "src" | "manifest" | "docs" | "container";
}

function walk(dir: string, base: string, onFile: (absolute: string, relative: string) => void): void {
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
      walk(absolute, base, onFile);
      continue;
    }
    if (!entry.isFile()) continue;
    onFile(absolute, path.relative(base, absolute).split(path.sep).join("/"));
  }
}

function isTextFile(relative: string): boolean {
  const ext = path.extname(relative);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.basename(relative);
  return base.startsWith("Dockerfile") || base.startsWith(".env");
}

/** Every file the gates scan for one member, with its scope. */
export function memberScanFiles(memberDir: string): ScanFile[] {
  const out: ScanFile[] = [];
  const push = (absolute: string, relative: string, scope: ScanFile["scope"]) => {
    if (!isTextFile(relative)) return;
    if (isTestPath(relative)) return;
    if (path.basename(relative) === "CHANGELOG.md") return;
    out.push({ relative, absolute, scope });
  };
  walk(path.join(memberDir, "src"), memberDir, (a, r) => push(a, r, "src"));
  for (const name of ["hasna.contract.json"]) {
    const p = path.join(memberDir, name);
    if (fs.existsSync(p)) push(p, name, "manifest");
  }
  for (const name of ["README.md"]) {
    const p = path.join(memberDir, name);
    if (fs.existsSync(p)) push(p, name, "docs");
  }
  walk(path.join(memberDir, "docs"), memberDir, (a, r) => push(a, r, "docs"));
  for (const entry of fs.existsSync(memberDir) ? fs.readdirSync(memberDir, { withFileTypes: true }) : []) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith("Dockerfile") || /^docker-compose.*\.ya?ml$/.test(entry.name) || entry.name.endsWith(".env.example")) {
      push(path.join(memberDir, entry.name), entry.name, "container");
    }
  }
  for (const sub of ["deploy", "infra"]) walk(path.join(memberDir, sub), memberDir, (a, r) => push(a, r, "container"));
  return out.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
}

export interface LineHit {
  relative: string;
  line: number;
  text: string;
  comment: boolean;
  scope: ScanFile["scope"];
}

/** Read a scan file and yield every line matching `pattern`. */
export function grepFile(file: ScanFile, pattern: RegExp): LineHit[] {
  let text: string;
  try {
    text = fs.readFileSync(file.absolute, "utf8");
  } catch {
    return [];
  }
  const hits: LineHit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!pattern.test(line)) continue;
    hits.push({ relative: file.relative, line: i + 1, text: line.trim().slice(0, 160), comment: isCommentLine(line), scope: file.scope });
  }
  return hits;
}

export function memberDirsIn(appsDir: string): Array<{ name: string; dir: string }> {
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(appsDir, e.name, "package.json")))
    .map((e) => ({ name: e.name, dir: path.join(appsDir, e.name) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}
