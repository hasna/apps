/**
 * Built-bin resolution for the client gates (fail-closed black box, SQLite
 * isolation). These gates read BUILT artifacts — a member's `<name>` and
 * `<name>-mcp` bins as `package.json#bin` declares them — so they run in the
 * `client-gates` CI job after the hosted members are built, not in the
 * source-only standard suite.
 *
 * A bin may be a thin shim (`#!/usr/bin/env bun` + `await import("../cli/x.mjs")`,
 * notes) rather than the bundle itself; `bundleText` follows RELATIVE
 * import/require specifiers two hops deep so the scan reads the code the
 * shim runs. Bare package imports are not followed: a dependency that opens
 * SQLite would appear as its specifier in the bundle (or as a declared
 * dependency), which is the member's own isolation problem to fix.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface ResolvedBin {
  member: string;
  bin: string;
  /** Path declared in package.json#bin (posix, relative to the member). */
  declared: string;
  absolute: string;
  exists: boolean;
}

export function declaredBins(memberDir: string): Record<string, string> {
  const manifest = path.join(memberDir, "package.json");
  if (!fs.existsSync(manifest)) return {};
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf8")) as { bin?: string | Record<string, string>; name?: string };
  if (typeof pkg.bin === "string") return { [path.basename(memberDir)]: pkg.bin };
  return pkg.bin ?? {};
}

export function resolveBin(memberDir: string, bin: string): ResolvedBin | null {
  const bins = declaredBins(memberDir);
  const declared = bins[bin];
  if (!declared) return null;
  const absolute = path.resolve(memberDir, declared);
  return { member: path.basename(memberDir), bin, declared: declared.replace(/^\.\//, ""), absolute, exists: fs.existsSync(absolute) };
}

const RELATIVE_SPECIFIER = /(?:import\s*\(\s*|from\s+|require\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const SHIM_MAX_BYTES = 16 * 1024;

/** The bin's text plus the text of relative modules a thin shim loads (≤ 2 hops). */
export function bundleText(binPath: string): { files: string[]; text: string } {
  const files: string[] = [];
  const seen = new Set<string>();
  const parts: string[] = [];
  const visit = (file: string, depth: number) => {
    const real = path.resolve(file);
    if (seen.has(real) || !fs.existsSync(real)) return;
    seen.add(real);
    const text = fs.readFileSync(real, "utf8");
    files.push(real);
    parts.push(text);
    if (depth >= 2 || text.length > SHIM_MAX_BYTES) return;
    for (const m of text.matchAll(RELATIVE_SPECIFIER)) {
      const spec = m[1]!;
      const candidates = [spec, `${spec}.js`, `${spec}.mjs`, `${spec}/index.js`, `${spec}/index.mjs`];
      for (const c of candidates) {
        const p = path.resolve(path.dirname(real), c);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          visit(p, depth + 1);
          break;
        }
      }
    }
  };
  visit(binPath, 0);
  return { files, text: parts.join("\n") };
}

/**
 * One harmless authenticated READ per hosted CLI — the verb the T4 black-box
 * probe used (reports/T4-failclosed-probe.md). A fail-closed client exits
 * non-zero on it without a credential and opens no store. Unlisted members
 * get `list`.
 */
export const HOSTED_READ_COMMANDS: Record<string, string[]> = {
  attachments: ["status"],
  calendar: ["list"],
  contacts: ["list"],
  conversations: ["read"],
  domains: ["domain", "list"],
  economy: ["today"],
  emails: ["stats"],
  files: ["stats"],
  hooks: ["categories"],
  instructions: ["status"],
  knowledge: ["list"],
  logs: ["tail"],
  loops: ["status"],
  mementos: ["list"],
  messages: ["status"],
  notes: ["list"],
  projects: ["list"],
  recordings: ["list"],
  secrets: ["items", "list"],
  shortlinks: ["stats"],
  skills: ["categories"],
  telephony: ["number", "list"],
  todos: ["list"],
};

export function readCommandFor(member: string): string[] {
  return HOSTED_READ_COMMANDS[member] ?? ["list"];
}

/** `HASNA_CLIENT_GATES_REQUIRE_BUILT=1` makes an unbuilt bin a violation (the client-gates CI job builds first). */
export function requireBuilt(): boolean {
  return process.env.HASNA_CLIENT_GATES_REQUIRE_BUILT === "1";
}
