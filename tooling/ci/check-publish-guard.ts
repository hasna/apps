/**
 * Publish guard for hasna/apps — internal-infra strings must never reach a
 * published tarball.
 *
 * For every member package, dry-run `npm pack` and scan the resulting file
 * list for internal-infra strings: `*.hasna.xyz` (every spelling, template
 * forms included — see INTERNAL_PATTERNS and CONTENT_EXCEPTIONS), ARNs, 12-digit AWS account
 * ids, the private-scope markers, the internal platform account id, and local
 * filesystem paths from an out-of-root build. A public npm package that
 * carries any of these leaks Hasna's internal estate — or an author's machine
 * layout and username — into the open.
 *
 * Usage:
 *   bun tooling/ci/check-publish-guard.ts [--root <dir>]                     # every member (local default)
 *   bun tooling/ci/check-publish-guard.ts --changed-since <base> [--root]    # CI: members whose tarball can differ from <base>
 *   bun tooling/ci/check-publish-guard.ts --self-test
 *
 * SCOPING (2026-09-11). `npm pack --dry-run` runs each member's `prepack`, and
 * most prepacks run the member's full verify (typecheck + tests + build). So
 * one member's pack-time flake reddens this REQUIRED check for every other
 * package in the commit — measured on the release commit fb59fb6a, which went
 * red for four unrelated packages because of the @hasna/trash concurrency
 * test. A member's tarball is a function of its own directory, the in-tree
 * members it bundles, and the shared inputs (root package.json, bun.lock,
 * turbo.json, tsconfig.base.json, tooling/, ci.yml). `--changed-since <base>`
 * therefore packs exactly the members whose `apps/<m>/**` changed in
 * `<base>...HEAD` plus every in-tree member that depends on one of them
 * (transitively), and falls back to EVERY member when a shared input changed
 * (bun.lock counts only when its third-party `packages` section differs — a
 * release commit's workspace-version regeneration is member-scoped) or when
 * <base> cannot be resolved (conservative: never a vacuous pass). A
 * PR that changes no member and no shared input packs nothing and says so.
 * Without the flag the guard scans every member, as before.
 *
 * Why the pack output is parsed the way it is (measured 2026-08-13):
 *
 * `npm pack --dry-run --json` runs the package's `prepack` script BEFORE it
 * writes the JSON, and npm forwards the prepack script's stdout to our stdout.
 * A member with a chatty prepack (e.g. `bun run verify && bun run
 * scan:artifact`) produces 612 lines / 14118 bytes of prepack logs followed by
 * the JSON document — so `JSON.parse` on the raw stdout FAILS
 * ("Unexpected token 'b'"). `--silent` does NOT suppress the prepack stdout
 * (measured: identical failure). The previous guard swallowed that failure and
 * returned an empty entry list, reporting "0 tarball entries, 0 internal-infra
 * strings" for every chatty-prepack member while exiting 0 — a vacuous pass
 * (measured on datasets, draw, models, releases, sheets, tables;
 * only the four members with silent prepacks were actually scanned).
 *
 * The JSON document is always the LAST thing npm writes (prepack runs first),
 * so it is a suffix of the captured stdout. Both streams are captured
 * separately (fleet capture-path rule: never `2>&1`, never a pipe). The raw
 * stdout is parsed first; if that fails, the suffix JSON array is located with
 * a string-aware backward bracket-balance walk from the final non-whitespace
 * char (which must be `]`) and parsed. Any pack failure — npm non-zero exit,
 * no JSON document, unbalanced brackets, a missing `files` array, a zero-file
 * report, or `entryCount` disagreeing with `files.length` — FAILS the guard
 * (exit 1). The guard never degrades to an empty scan.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const INTERNAL_PATTERNS: Array<{ name: string; re: RegExp; contentRe?: RegExp }> = [
  // The content form of the domain detector fires on EVERY spelling of the
  // internal origin domain: a concrete label (`secrets.hasna.xyz`), a
  // placeholder template (`<app>.hasna.xyz`, `${name}.hasna.xyz`,
  // `*.hasna.xyz`) and the bare apex (`hasna.xyz`). Until 2026-09-11 the
  // template forms were deliberately excused as "no internal identity"; the
  // fleet-alignment ruling (c) retires the origin domain from every public
  // artifact — the gateway `https://api.hasna.com/<app>` is the only
  // authority a package may name — so the template form is exactly the
  // string a consumer would copy into a config. Measured on the fully built
  // tree (npm pack --dry-run per member, 2026-09-11): the flip fires on six
  // members' comments and docs only, each recorded in CONTENT_EXCEPTIONS with
  // its owner; nothing fires in code.
  { name: "hasna-xyz-domain", re: /[.]hasna[.]xyz/, contentRe: /(?:^|[^A-Za-z0-9_])hasna[.]xyz\b|[.]hasna[.]xyz\b/im },
  // The content form of the ARN detector requires an account-bearing or
  // concrete-resource ARN. The strict name scan keeps the catch-all; the
  // content form drops the measured benign class of placeholder templates in
  // dynamic ARN construction — `arn:aws:s3:::${bucket}` (measured on
  // @hasna/emails buildSesBucketPolicy), which carries no internal identity.
  // Real ARNs — `arn:aws:iam::123456789012:role/x`, `arn:aws:s3:::bucket` —
  // still fire in content.
  { name: "aws-arn", re: /arn[:]aws[:]/, contentRe: /arn:aws:(?:[a-z0-9-]+:[a-z0-9-]*:[0-9]{12}|s3:::[^$"'\s`]+)/ },
  // The content form of the account-id detector drops two measured benign
  // classes that a bare word-boundary 12-digit run fires on in generated
  // bundles (measured on @hasna/conversations 0.7.4): the trailing segment of
  // a UUID (preceded by a 4-hex segment and "-", e.g. ...-8222-222222222222)
  // and epoch-millis numeric literals in bundled dependency code (preceded by
  // an arithmetic operator and space, e.g. "+ 946684800000"). Real leak
  // shapes still fire: ARNs, quoted/coloned config values, env assignments,
  // hyphenated labels ("account-123456789012") and function arguments
  // ("accountId(123456789012)"). The name scan keeps the strict catch-all.
  { name: "aws-account-id", re: /\b[0-9]{12}\b/, contentRe: /(?<![0-9a-fA-F]{4}-)(?<![+*/-] )\b[0-9]{12}\b/ },
  { name: "hasna-internal-org", re: /hasna[-]internal/ },
  { name: "internal-apps", re: /internal[-]apps/ },
  { name: "hasna-internal-scope", re: /@hasna[-]internal/ },
  { name: "internal-platform-account", re: new RegExp("7898" + "77399345") },
  // A LOCAL FILESYSTEM PATH in packed content leaks the author's directory
  // layout (and local username where the path includes one), and makes the
  // bundle non-reproducible — the same source built from a different checkout
  // location produces different bytes. Measured shipped in the live
  // @hasna/contracts@1.0.0 tarball: 62 bundler banner comments in dist/index.js
  // plus more in the other dist bundles, all of the shape an out-of-root build
  // produces (introduced by #1708; the #1744 in-root rebuild restored the
  // canonical `../../node_modules/...` form). Two detector shapes:
  //
  // (1) Deep relative escapes — `../../../../../../../Workspace/50-repositories/
  //     hasna/apps/node_modules/...` (7+ levels, exiting the checkout into the
  //     author's directory layout before reaching the dependency store). Entry
  //     names cannot fire this detector: npm pack entry names are always clean
  //     relative paths (`..` segments are normalized out of the manifest). The
  //     content form drops the two measured benign classes in committed source
  //     and bundles — an escape run that lands DIRECTLY on the hoisted
  //     dependency store (`../../../../../../node_modules/hono/...`, connectors'
  //     per-connector server bundles) or on an in-repo source dir
  //     (`../../../../src/lib/runner.js`, connectors' gmail test import). Both
  //     stay inside the repo, carry no author identity and rebuild identically
  //     from any checkout; a run that lands anywhere else — an author
  //     directory — fires. The exemption lookaheads are preceded by a
  //     maximal-run guard `(?!\.\.\/)`: without it, regex backtracking matches
  //     only 4 of a 6-deep run, leaving `../` before the exempted landing and
  //     firing on the benign shape anyway.
  { name: "local-relative-escape", re: /(?:\.\.\/){4,}/, contentRe: /(?:\.\.\/){4,}(?!\.\.\/)(?!node_modules\/)(?!src\/)/ },
  // (2) Absolute author-home paths — `/Users/<name>/`, `/home/<name>/`,
  //     `C:\Users\<name>\`. The strict form carries all three shapes (inert in
  //     the name scan: entry names are clean relative paths and no member ships
  //     a `home`/`Users` directory segment, so a `/<name>/` continuation can
  //     only be machine-injected). The content form fires ONLY on the Windows
  //     shape: measured across all 43 members' packable content, arming the
  //     unix shapes in content turns the guard red on today's tree — eleven
  //     members deliberately author real `/Users/...` and `/home/...` paths
  //     into SHIPPED docs, examples, config defaults and tests (@hasna/contracts
  //     DEPLOYMENT_CONTROL_PLANE_CONTRACT.md and provider-live-mode examples,
  //     monitor's `--workspace` CLI defaults, hooks' python fallback paths,
  //     bridge's example config, dispatch/events/projects/todos READMEs), which
  //     are byte-indistinguishable from a machine-injected leak — no contentRe
  //     refinement can keep them silent without gutting the detector. Those
  //     authored paths are deliberate content that must be sanitized out of the
  //     tarballs first (follow-up hygiene); the machine-injection class does not
  //     wait on them — this toolchain's bundler banners are RELATIVE (the #1708
  //     leak carried no home directory at all), so the relative-escape detector
  //     above catches it. Windows home paths have zero measured occurrences in
  //     any member's packable content and stay armed.
  { name: "local-home-path", re: /\/(Users|home)\/[A-Za-z0-9._-]+[/]|C:[/\\]{1,2}Users[/\\]/i, contentRe: /C:[/\\]{1,2}Users[/\\]/i },
];

/**
 * Recorded content exceptions — two-sided, like the census registries.
 *
 * Each entry names a member, the packed entry (regex over the tarball path)
 * and the pattern it may match, with the reason and the owner who removes
 * it. A hit that matches an entry is reported as `excepted` and does not
 * fail the guard. An entry whose packed file is present in this run's pack
 * list but no longer matches is STALE and fails the guard (delete it). An
 * entry whose file is absent from the pack list (the member's dist was not
 * built at guard time) is neither honored nor stale — it is skipped, so an
 * unbuilt member cannot mask a leak or manufacture a red.
 *
 * Measured 2026-09-11 on the fully built tree after the hasna-xyz-domain
 * content form was widened to template spellings: six files, all comments
 * or docs explaining the pre-gateway origin. Owner: the member's
 * fleet-alignment PR (W6 for todos; the member lane otherwise).
 */
export const CONTENT_EXCEPTIONS: Array<{ member: string; entry: RegExp; pattern: string; reason: string }> = [
  { member: "conversations", entry: /^dist\/lib\/store\/status-location\.d\.ts$/, pattern: "hasna-xyz-domain", reason: "doc comment names the `<app>.hasna.xyz` origin as the pre-#1512 todos exception; scrub with the status-location rewrite." },
  { member: "economy", entry: /^dist\/lib\/api-display-url\.d\.ts$/, pattern: "hasna-xyz-domain", reason: "doc comment names the `<app>.hasna.xyz` origin as the pre-#1512 todos exception; scrub with the api-display-url rewrite." },
  { member: "secrets", entry: /^dist\/api-display-url\.d\.ts$/, pattern: "hasna-xyz-domain", reason: "doc comment names the `<app>.hasna.xyz` origin as the pre-#1512 todos exception; scrub with the api-display-url rewrite." },
  { member: "telephony", entry: /^src\/lib\/request-origin\.ts$/, pattern: "hasna-xyz-domain", reason: "packed source comment explains forwarded-origin recovery with a `<app>.hasna.xyz` example; reword to the gateway form." },
  { member: "guardrails", entry: /^docs\/boundaries\.md$/, pattern: "hasna-xyz-domain", reason: "boundaries doc explains the gateway→origin hop with `<app>.hasna.xyz`; reword to 'origin' once the origins are private." },
  { member: "todos", entry: /^docs\/native-storage\.md$/, pattern: "hasna-xyz-domain", reason: "native-storage doc names the `<app>.hasna.xyz` origin; reword to the gateway form (W6 todos alignment PR)." },
];

/**
 * A CHANGELOG is release history: an entry that says "removed the
 * *.hasna.xyz default" must be allowed to say so. Only the domain pattern is
 * exempted there — an ARN or account id in a changelog is still a leak.
 */
const CHANGELOG_EXEMPT_PATTERNS = new Set(["hasna-xyz-domain"]);

function isChangelog(entryName: string): boolean {
  return path.basename(entryName) === "CHANGELOG.md";
}

function memberPackages(root: string): string[] {
  const apps = path.join(root, "apps");
  if (!fs.existsSync(apps)) return [];
  return fs
    .readdirSync(apps, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .filter((name) => fs.existsSync(path.join(apps, name, "package.json")))
    .map((name) => path.join(apps, name));
}

/** Root-level inputs that can change ANY member's tarball. A change here scans every member. */
export const SHARED_TARBALL_INPUTS: RegExp[] = [
  /^package\.json$/,
  /^turbo\.json$/,
  /^tsconfig\.base\.json$/,
  /^\.npmrc$/,
  /^tooling\//,
  /^\.github\/workflows\/ci\.yml$/,
];

/**
 * bun.lock is handled separately: a release commit regenerates it, but only
 * its `workspaces` section (the in-tree members' own versions and dependency
 * specs) — those members are in the changed set already. Only the `packages`
 * section (third-party resolutions) can change what a member BUNDLES, so only
 * a diff there widens the scan to every member. The section is compared as
 * text from its top-level key to the end of file (bun writes top-level keys in
 * a fixed order: lockfileVersion, workspaces, packages); an unreadable side
 * counts as changed (conservative).
 */
export function packagesSectionChanged(lockBase: string | null, lockHead: string | null): boolean {
  if (lockBase === null || lockHead === null) return true;
  const section = (text: string) => {
    const i = text.indexOf('\n  "packages": {');
    return i < 0 ? text : text.slice(i);
  };
  return section(lockBase) !== section(lockHead);
}

export interface Selection {
  /** Member directories (absolute) to pack and scan. */
  members: string[];
  scope: "all" | "changed" | "none";
  reason: string;
  /** Member directories skipped as unchanged (for the report). */
  skipped: string[];
}

function gitLines(root: string, args: string[]): string[] | null {
  try {
    const out = execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/** `apps/<m>/...` -> `<m>` (a nested workspace like apps/notes/server belongs to `notes`). */
export function memberOfPath(relative: string): string | null {
  const m = /^apps\/([^/]+)\//.exec(relative);
  return m ? m[1] : null;
}

/** In-tree dependency edges: member -> members that DEPEND on it (they bundle its dist). */
export function inTreeDependents(root: string, memberDirs: string[]): Map<string, Set<string>> {
  const nameToMember = new Map<string, string>();
  const deps = new Map<string, Set<string>>();
  for (const dir of memberDirs) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (typeof pkg.name === "string") nameToMember.set(pkg.name, path.basename(dir));
    } catch {
      /* unreadable manifest: no edges */
    }
  }
  for (const dir of memberDirs) {
    let pkg: any;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const member = path.basename(dir);
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const depName of Object.keys(pkg[section] ?? {})) {
        const target = nameToMember.get(depName);
        if (!target || target === member) continue;
        if (!deps.has(target)) deps.set(target, new Set());
        deps.get(target)!.add(member);
      }
    }
  }
  return deps;
}

/**
 * Decide which members `--changed-since <base>` packs. Conservative in every
 * ambiguous direction: an unresolvable base, a changed shared input, or a git
 * failure all select EVERY member. Only a diff that touches nothing a tarball
 * is built from selects none.
 */
export function selectMembers(root: string, base: string | null): Selection {
  const all = memberPackages(root);
  if (base === null) return { members: all, scope: "all", reason: "no --changed-since base: every member", skipped: [] };
  const resolved = gitLines(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  if (!resolved || resolved.length === 0) {
    return { members: all, scope: "all", reason: `base ${base} cannot be resolved: scanning every member (conservative)`, skipped: [] };
  }
  const changed = gitLines(root, ["diff", "--name-only", `${base}...HEAD`]);
  if (changed === null) return { members: all, scope: "all", reason: `git diff ${base}...HEAD failed: scanning every member (conservative)`, skipped: [] };
  const shared = changed.filter((f) => SHARED_TARBALL_INPUTS.some((re) => re.test(f)));
  let lockNote = "";
  if (changed.includes("bun.lock")) {
    // Raw text on both sides: the section key is matched with its indentation.
    let baseLock: string | null;
    try {
      baseLock = execFileSync("git", ["show", `${base}:bun.lock`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    } catch {
      baseLock = null;
    }
    let headLock: string | null;
    try {
      headLock = fs.readFileSync(path.join(root, "bun.lock"), "utf8");
    } catch {
      headLock = null;
    }
    if (packagesSectionChanged(baseLock, headLock)) {
      shared.push("bun.lock (packages section changed)");
    } else {
      lockNote = "; bun.lock changed in its workspaces section only (member-scoped)";
    }
  }
  if (shared.length > 0) {
    return { members: all, scope: "all", reason: `shared tarball input(s) changed vs ${base}: ${shared.slice(0, 5).join(", ")}${shared.length > 5 ? ", …" : ""}`, skipped: [] };
  }
  const changedMembers = new Set<string>();
  for (const f of changed) {
    const m = memberOfPath(f);
    if (m) changedMembers.add(m);
  }
  const dependents = inTreeDependents(root, all);
  const queue = [...changedMembers];
  while (queue.length > 0) {
    const m = queue.pop()!;
    for (const d of dependents.get(m) ?? []) {
      if (!changedMembers.has(d)) {
        changedMembers.add(d);
        queue.push(d);
      }
    }
  }
  const members = all.filter((dir) => changedMembers.has(path.basename(dir)));
  const skipped = all.filter((dir) => !changedMembers.has(path.basename(dir)));
  if (members.length === 0) {
    return { members, scope: "none", reason: `no member directory and no shared tarball input changed vs ${base} (${changed.length} file(s) changed)${lockNote}`, skipped };
  }
  return {
    members,
    scope: "changed",
    reason: `${members.length} member(s) changed vs ${base} (incl. in-tree dependents), ${skipped.length} unchanged skipped${lockNote}`,
    skipped,
  };
}

function scanNames(names: string[]): Array<{ name: string; pattern: string }> {
  const hits: Array<{ name: string; pattern: string }> = [];
  for (const n of names) {
    for (const p of INTERNAL_PATTERNS) {
      if (p.re.test(n)) hits.push({ name: n, pattern: p.name });
    }
  }
  return hits;
}

// Entry-name scanning alone is not enough: a generated bundle or dashboard
// asset whose NAME is clean can still carry `*.hasna.xyz`, ARNs, AWS account
// ids, internal-scope strings or local filesystem paths in its BYTES.
// `packFileNames` runs `npm pack --dry-run --json`, which executes the
// member's `prepack` — so the packed files exist on disk, post-build, when
// this runs. Read each packed path and scan its text with the same pattern
// set, keeping the filename checks as an additional control. Binary and
// oversize files cannot be scanned textually; they are counted and reported
// rather than silently dropped.
const MAX_CONTENT_BYTES = 4 * 1024 * 1024;

function scanContents(
  pkgDir: string,
  names: string[],
): { hits: Array<{ name: string; pattern: string }>; scanned: number; skipped: number } {
  const hits: Array<{ name: string; pattern: string }> = [];
  let scanned = 0;
  let skipped = 0;
  for (const name of names) {
    const full = path.join(pkgDir, name);
    let buf: Buffer;
    try {
      buf = fs.readFileSync(full);
    } catch {
      // npm pack --dry-run can enumerate allowlisted paths that are absent on
      // disk (clean-checkout enumeration). Counted, never silently dropped.
      skipped++;
      continue;
    }
    if (buf.length === 0) continue;
    if (buf.length > MAX_CONTENT_BYTES || buf.includes(0)) {
      skipped++;
      continue;
    }
    const text = buf.toString("utf-8");
    for (const p of INTERNAL_PATTERNS) {
      if (isChangelog(name) && CHANGELOG_EXEMPT_PATTERNS.has(p.name)) continue;
      if ((p.contentRe ?? p.re).test(text)) hits.push({ name, pattern: p.name });
    }
    scanned++;
  }
  return { hits, scanned, skipped };
}

/**
 * npm writes the `--json` pack document (a JSON array) as the LAST thing on
 * stdout, after the prepack script's forwarded logs. Walk backward from the
 * final non-whitespace char (which must be `]`) tracking bracket balance and
 * string state (a `]` or `[` inside a quoted string is not a bracket), and
 * slice from the depth-0 opening bracket. Throws when the suffix is not a
 * JSON array.
 */
function extractJsonArraySuffix(raw: string): string {
  let i = raw.length - 1;
  while (i >= 0 && /\s/.test(raw[i])) i--;
  if (i < 0 || raw[i] !== "]") {
    throw new Error("pack output has no JSON array document (npm wrote no --json array)");
  }
  let depth = 0;
  let inString = false;
  for (; i >= 0; i--) {
    const c = raw[i];
    if (inString) {
      if (c === '"') {
        let backslashes = 0;
        for (let j = i - 1; j >= 0 && raw[j] === "\\"; j--) backslashes++;
        if (backslashes % 2 === 0) inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "]") {
      depth++;
    } else if (c === "[") {
      depth--;
      if (depth === 0) return raw.slice(i);
    }
  }
  throw new Error("pack output brackets do not balance to a single JSON array");
}

function parsePackJson(raw: string): { entryCount: number; files: Array<{ path?: string }> } {
  const tryParse = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  let parsed = tryParse(raw);
  if (parsed === null) {
    const doc = extractJsonArraySuffix(raw);
    parsed = tryParse(doc);
    if (parsed === null) throw new Error("extracted pack JSON document does not parse");
  }
  const first: any = Array.isArray(parsed) ? parsed[0] : null;
  if (!first || !Array.isArray(first.files)) {
    throw new Error("pack JSON has no files array");
  }
  const files = first.files as Array<{ path?: string }>;
  const entryCount = typeof first.entryCount === "number" ? first.entryCount : files.length;
  if (files.length === 0 || entryCount === 0) {
    throw new Error(
      `pack JSON reports zero files (entryCount=${entryCount}, files.length=${files.length}) — refusing a vacuous pass`,
    );
  }
  if (entryCount !== files.length) {
    throw new Error(
      `entryCount (${entryCount}) does not match files.length (${files.length}) — truncated or interleaved parse`,
    );
  }
  return { entryCount, files };
}

function packFileNames(pkgDir: string): string[] {
  let out: string;
  try {
    // Both streams captured separately (fleet capture-path rule). The stdout
    // buffer is the raw npm stream, prepack logs and all; stderr stays out of
    // the parse entirely.
    out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: pkgDir,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e: any) {
    // The prepack script's own stderr is forwarded by npm to npm's stderr
    // (measured 2026-08-20 on npm 11 with a synthetic failing prepack: the
    // script's error lines appear between the "> prepack" banner and the
    // final "npm error ..." boilerplate block). The stdout side carries the
    // prepack's stdout — build logs and, on failure, npm's `--json` error
    // document. A 5-line stderr tail shows ONLY the boilerplate ("command
    // failed", "sh -c bun run verify:pack", "A complete log...") and hides
    // the actual prepack failure, so every prepack failure reads as
    // "command failed" with no cause. Capture a generous stderr tail so the
    // failing step is visible; both streams stay bounded by maxBuffer.
    const stdoutTail = String(e?.stdout ?? "")
      .trim()
      .split("\n")
      .slice(-40)
      .join("\n");
    const stderrTail = String(e?.stderr ?? "")
      .trim()
      .split("\n")
      .slice(-200)
      .join("\n");
    throw new Error(
      `npm pack --dry-run --json failed in ${pkgDir}` +
        (stdoutTail ? `\n  prepack output tail:\n    ${stdoutTail}` : "") +
        (stderrTail ? `\n  npm stderr tail:\n    ${stderrTail}` : ""),
    );
  }
  const { files } = parsePackJson(out);
  return files.map((f) => f.path ?? "");
}

/**
 * Whether a member's types contract requires packed `.d.ts` files — a
 * top-level `types` field or any `exports` entry carrying a `types` key that
 * names a `.d.ts` path. Such a member MUST ship at least one `.d.ts` in its
 * packed tarball; a tarball with zero declarations breaks every typed
 * consumer while the entry scan still reports "0 internal-infra strings"
 * (row 312913f1: prepare scripts that ran clean+build without the
 * declaration emit destroyed the .d.ts their own prepack had just produced).
 * Members whose declared types are their shipped TypeScript SOURCE (e.g.
 * @hasna/monitor: types: ./src/index.ts, no dist, prepack scans only) are
 * exempt — the `.ts` files ARE the types contract, and they pack no `.d.ts`
 * by design.
 */
function declaresTypes(pkgDir: string): boolean {
  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  } catch {
    return false;
  }
  const declared: string[] = [];
  if (typeof pkg.types === "string" && pkg.types.length > 0) declared.push(pkg.types);
  const exp = pkg.exports;
  if (exp && typeof exp === "object") {
    for (const value of Object.values(exp)) {
      if (value && typeof value === "object" && typeof (value as any).types === "string") {
        declared.push((value as any).types);
      }
    }
  }
  return declared.some((t) => t.endsWith(".d.ts"));
}

/**
 * Whether a member's tarball reflects a REAL build — it contains built JS
 * output. The declarations check fires only then: a member whose dist was
 * never built at guard time (prepack = artifact-scan only, CI builds only
 * the seven prepare:ordered members) packs no JS either, and flagging it
 * would be a false positive (measured: crawl, guardrails, markdown,
 * telephony — builds all end in `tsc --emitDeclarationOnly`, their
 * dist simply does not exist in the guard's checkout). A tarball WITH built
 * JS but zero `.d.ts` is a build whose declarations were destroyed or never
 * emitted — exactly the class to fail.
 */
function packsBuiltJs(names: string[]): boolean {
  return names.some((n) => n.endsWith(".js"));
}

/**
 * The declared `bin` entries of a member that are ABSENT from the packed file
 * list. The `bin` map is the consumer-executable contract: a shipped tarball
 * that lost an entry installs a CLI that does not exist. Measured class
 * (2026-08-24, npm 10): @hasna/skills' `prepare` ran `build:js`, which began
 * with the shared `clean` (`rm -rf bin/ dist/`) — npm 10 executes `prepare`
 * during `npm pack` even under `--ignore-scripts`, so the packlist was
 * computed AFTER prepare had deleted the bin entries its own prepack had just
 * built, and the release guard reported every declared bin packed=false.
 * npm 11 skips prepare under `--ignore-scripts`, so the CI gate went green
 * locally while the outer pack's tarball STILL shipped bin-less (measured:
 * 0 bin/ paths in the npm 11 dry-run manifest). The check is version-
 * independent because it inspects the pack list, not the lifecycle.
 */
function missingDeclaredBins(pkgDir: string, names: string[]): string[] {
  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  } catch {
    return [];
  }
  const bin = pkg.bin;
  if (!bin) return [];
  const declared: string[] =
    typeof bin === "string" ? [bin] : Object.values(bin).filter((v): v is string => typeof v === "string");
  return declared
    .map((p) => p.replace(/^\.\//, ""))
    .filter((p) => p.length > 0 && !names.includes(p));
}

function run(root: string, exceptions: typeof CONTENT_EXCEPTIONS = CONTENT_EXCEPTIONS, selection?: Selection): number {
  const pkgs = selection ? selection.members : memberPackages(root);
  if (selection) {
    console.log(`publish guard: scope=${selection.scope} — ${selection.reason}`);
    if (selection.skipped.length > 0) console.log(`publish guard: skipped as unchanged: ${selection.skipped.map((d) => path.basename(d)).join(", ")}`);
    if (selection.scope === "none") {
      console.log("publish guard: no tarball can differ from the base — nothing to pack (scoped run)");
      return 0;
    }
  }
  if (pkgs.length === 0) {
    console.log("publish guard: 0 member packages — nothing to scan");
    return 0;
  }
  let failed = false;
  for (const pkg of pkgs) {
    let names: string[];
    try {
      names = packFileNames(pkg);
    } catch (e: any) {
      failed = true;
      console.error(`PUBLISH-GUARD FAILED in ${pkg}: ${e.message}`);
      continue;
    }
    if (declaresTypes(pkg) && packsBuiltJs(names) && !names.some((n) => n.endsWith(".d.ts"))) {
      failed = true;
      console.error(
        `PUBLISH-GUARD FAILED in ${pkg}: package.json declares .d.ts type paths (types field or exports.*.types) and the tarball packs built JS but 0 .d.ts — a prepare script is destroying the declarations its prepack emitted`,
      );
      continue;
    }
    // Declared-bin coverage. Gated on packsBuiltJs exactly like the .d.ts
    // check: a member whose dist was never built at guard time (prepack =
    // artifact-scan only) packs no JS at all and its absent bin is a
    // build-state artifact, not a regression — flagging it would be a false
    // positive on the measured unbuilt class (crawl, guardrails, markdown,
    // telephony). A tarball WITH built JS but missing declared bin entries is
    // a build whose executables were destroyed or never emitted.
    const missingBins = missingDeclaredBins(pkg, names);
    if (missingBins.length > 0 && packsBuiltJs(names)) {
      failed = true;
      console.error(
        `PUBLISH-GUARD FAILED in ${pkg}: package.json declares bin entries that the tarball does not pack (${missingBins.join(", ")}) — a prepare script is deleting the executables its prepack emitted`,
      );
      continue;
    }
    const nameHits = scanNames(names);
    const content = scanContents(pkg, names);
    const member = path.basename(pkg);
    const mine = exceptions.filter((e) => e.member === member);
    const isExcepted = (h: { name: string; pattern: string }) => mine.some((e) => e.pattern === h.pattern && e.entry.test(h.name));
    const excepted = content.hits.filter(isExcepted);
    const hits = [...nameHits, ...content.hits.filter((h) => !isExcepted(h))];
    // Two-sided: an exception whose packed file is present but clean is stale.
    const stale = mine.filter((e) => names.some((n) => e.entry.test(n)) && !content.hits.some((h) => h.pattern === e.pattern && e.entry.test(h.name)));
    for (const e of stale) {
      failed = true;
      console.error(`PUBLISH-GUARD STALE EXCEPTION in ${pkg}: ${e.entry} no longer matches ${e.pattern} — delete its CONTENT_EXCEPTIONS entry`);
    }
    const skippedNote = content.skipped > 0 ? `, ${content.skipped} binary/oversize/absent skipped` : "";
    const exceptedNote = excepted.length > 0 ? `, ${excepted.length} recorded exception(s): ${excepted.map((h) => h.name).join(", ")}` : "";
    if (hits.length > 0) {
      failed = true;
      console.error(`PUBLISH-GUARD VIOLATION in ${pkg} (${hits.length}):`);
      for (const h of hits) console.error(`  ${h.name} — pattern ${h.pattern}`);
    } else {
      console.log(
        `publish guard: ${member} — ${names.length} tarball entries, ${content.scanned} contents scanned, 0 internal-infra strings${skippedNote}${exceptedNote}`,
      );
    }
  }
  return failed ? 1 : 0;
}

function fixturePackage(
  appsRoot: string,
  name: string,
  files: string[],
  broken: boolean,
  contents?: Record<string, string>,
  extra?: { scripts?: Record<string, string>; fields?: Record<string, unknown> },
): void {
  const dir = path.join(appsRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  const pkg: Record<string, unknown> = {
    name: `@hasna/self-test-${name}`,
    version: "0.0.0",
    files: ["data"],
  };
  if (extra?.fields) Object.assign(pkg, extra.fields);
  if (broken) {
    // A prepack that fails makes `npm pack` exit non-zero: there is no JSON
    // document to parse at all. The guard must FAIL, never pass. The fixture
    // emits one marker on stdout and one on stderr: npm forwards the prepack
    // script's stderr before its own "npm error ..." boilerplate, and the
    // guard must surface BOTH so a prepack failure names its cause (the
    // stderr marker is the shape machines' verify:pack failures take).
    pkg.scripts = { prepack: "echo broken-prepack-output && echo broken-prepack-stderr >&2 && exit 1" };
  } else if (extra?.scripts) {
    pkg.scripts = extra.scripts;
  }
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  for (const f of files) {
    fs.writeFileSync(path.join(dir, "data", f), contents?.[f] ?? "fixture content\n");
  }
}

function capture(fn: () => number): { rc: number; lines: string[] } {
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: any[]) => lines.push(a.map(String).join(" "));
  console.error = (...a: any[]) => lines.push(a.map(String).join(" "));
  try {
    return { rc: fn(), lines };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

function selfTest(): number {
  let failed = false;
  const check = (name: string, ok: boolean) => {
    console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}`);
    if (!ok) failed = true;
  };
  // String-level checks (fast, no npm): the blocklist can fire AND stay silent.
  const blockedNames = [
    `internal.${"hasna" + "." + "xyz"}/config.json`,
    `deploy/${"arn" + ":aws:" + "iam"}.txt`,
    `secrets/${"1".repeat(12)}-key.json`,
    `deploy/${"hasna" + "-" + "internal"}/platform.yml`,
    `pkg/${"internal" + "-" + "apps"}/cohort.json`,
    `scoped/${"@hasna" + "-" + "internal"}/x.tgz`,
    `account/${"7898" + "77399345"}.json`,
  ];
  const cleanNames = ["dist/index.js", "readme.md", "bin/cli.js", "src/sdk.ts"];
  const badHits = scanNames(blockedNames);
  const fired = new Set(badHits.map((h) => h.name)).size;
  check(`blocklist fires on seeded internal-infra names (${fired}/${blockedNames.length})`, fired === blockedNames.length);
  check(`blocklist stays silent on clean tarball names (0 hits)`, scanNames(cleanNames).length === 0);

  // Parser-level checks: garbage must throw, never yield an empty list.
  let parserThrew = false;
  try {
    parsePackJson("not json at all");
  } catch {
    parserThrew = true;
  }
  check("unparseable pack output throws (never degrades to an empty scan)", parserThrew);
  parserThrew = false;
  try {
    parsePackJson(`prepack noise\n]unbalanced`);
  } catch {
    parserThrew = true;
  }
  check("unbalanced pack output throws", parserThrew);

  // Pack-path checks: real `npm pack --dry-run --json` runs over fixture
  // packages through the SAME run() path the guard uses.
  const blockedFile = `${"hasna" + "-internal"}-platform.yml`;
  const accountFile = `account-${"7898" + "77399345"}.json`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-guard-self-test-"));
  try {
    const brokenRoot = path.join(root, "broken-root");
    fs.mkdirSync(brokenRoot, { recursive: true });
    fixturePackage(path.join(brokenRoot, "apps"), "self-test-broken", ["ok.txt"], true);
    const broken = capture(() => run(brokenRoot));
    const brokenOut = broken.lines.join("\n");
    check(
      "broken pack (prepack exit 1) FAILS the guard (rc=1, reported, not silent)",
      broken.rc === 1 && brokenOut.includes("PUBLISH-GUARD FAILED") && brokenOut.includes("self-test-broken"),
    );
    check(
      "broken pack surfaces the prepack's own output tail (cause visible, not just npm boilerplate)",
      broken.rc === 1 && brokenOut.includes("prepack output tail") && brokenOut.includes("broken-prepack-output"),
    );
    check(
      "broken pack surfaces the prepack's stderr (the shape machines verify:pack failures take)",
      broken.rc === 1 && brokenOut.includes("npm stderr tail") && brokenOut.includes("broken-prepack-stderr"),
    );

    const blockedRoot = path.join(root, "blocked-root");
    fs.mkdirSync(blockedRoot, { recursive: true });
    fixturePackage(path.join(blockedRoot, "apps"), "self-test-blocked", [blockedFile, accountFile], false);
    const blocked = capture(() => run(blockedRoot));
    const blockedOut = blocked.lines.join("\n");
    check(
      "seeded blocked string in a pack entry FIRES (rc=1, violation named)",
      blocked.rc === 1 &&
        blockedOut.includes("PUBLISH-GUARD VIOLATION") &&
        blockedOut.includes(blockedFile) &&
        blockedOut.includes(accountFile),
    );

    const cleanRoot = path.join(root, "clean-root");
    fs.mkdirSync(cleanRoot, { recursive: true });
    fixturePackage(path.join(cleanRoot, "apps"), "self-test-clean", ["ok.txt", "readme.md"], false);
    const clean = capture(() => run(cleanRoot));
    const cleanOut = clean.lines.join("\n");
    const entries = parseInt(cleanOut.match(/(\d+) tarball entries/)?.[1] ?? "0", 10);
    check(
      "clean pack PASSES and is non-vacuous (rc=0, >=1 real tarball entry)",
      clean.rc === 0 && entries >= 1,
    );

    // Content-scan checks: a pack entry whose NAME is clean but whose BYTES
    // carry an internal-infra string must FAIL the guard (the defect the
    // previous name-only scan could not see), and the content census must be
    // on the pass line so a content scan that silently read nothing is
    // distinguishable from one that read the files.
    const contentRoot = path.join(root, "content-root");
    fs.mkdirSync(contentRoot, { recursive: true });
    fixturePackage(
      path.join(contentRoot, "apps"),
      "self-test-content",
      ["notes.txt"],
      false,
      { "notes.txt": `deploy endpoint: https://api.${"hasna" + "." + "xyz"}\n` },
    );
    const content = capture(() => run(contentRoot));
    const contentOut = content.lines.join("\n");
    check(
      "internal-infra string in a pack entry's CONTENT FIRES even with a clean name (rc=1, pattern named)",
      content.rc === 1 &&
        contentOut.includes("PUBLISH-GUARD VIOLATION") &&
        contentOut.includes("notes.txt") &&
        contentOut.includes("hasna-xyz-domain"),
    );
    check(
      "clean pack reports the content scan census (entries + contents scanned)",
      clean.rc === 0 &&
        /\d+ tarball entries, \d+ contents scanned, 0 internal-infra strings/.test(cleanOut),
    );

    // Content-form refinements: a real account-bearing ARN in content FIRES,
    // while the measured benign placeholder templates (dynamic ARN
    // construction and host defaults with no internal identity) stay SILENT.
    const arnRoot = path.join(root, "arn-root");
    fs.mkdirSync(arnRoot, { recursive: true });
    fixturePackage(
      path.join(arnRoot, "apps"),
      "self-test-arn",
      ["policy.json"],
      false,
      { "policy.json": `{"Resource": "arn:aws:iam::123456789012:role/example"}\n` },
    );
    const arn = capture(() => run(arnRoot));
    const arnOut = arn.lines.join("\n");
    check(
      "real account-bearing ARN in a pack entry's CONTENT FIRES (rc=1, pattern named)",
      arn.rc === 1 && arnOut.includes("PUBLISH-GUARD VIOLATION") && arnOut.includes("aws-arn"),
    );

    const templateRoot = path.join(root, "template-root");
    fs.mkdirSync(templateRoot, { recursive: true });
    fixturePackage(
      path.join(templateRoot, "apps"),
      "self-test-template",
      ["policy.json"],
      false,
      { "policy.json": `{"Resource": "arn:aws:s3:::${"${bucket}"}/*"}\n` },
    );
    const template = capture(() => run(templateRoot));
    const templateOut = template.lines.join("\n");
    check(
      "placeholder ARN template in CONTENT stays SILENT (rc=0, no violation)",
      template.rc === 0 && !templateOut.includes("PUBLISH-GUARD VIOLATION"),
    );

    // Domain spellings (ruling c): the template form `${name}.hasna.xyz`,
    // the `<app>.hasna.xyz` form and the bare apex all FIRE in content now;
    // a CHANGELOG entry naming the domain does not (release history).
    const domainRoot = path.join(root, "domain-root");
    fs.mkdirSync(domainRoot, { recursive: true });
    fixturePackage(
      path.join(domainRoot, "apps"),
      "self-test-domain",
      ["host.json", "readme.md", "apex.txt", "CHANGELOG.md"],
      false,
      {
        "host.json": `{"Host": "https://${"${name}"}.hasna.xyz"}\n`,
        "readme.md": "The origin is `https://<app>.hasna.xyz` behind the gateway.\n",
        "apex.txt": `apex ${"hasna" + "." + "xyz"} only\n`,
        "CHANGELOG.md": `- removed the *.${"hasna" + "." + "xyz"} default\n`,
      },
    );
    const domain = capture(() => run(domainRoot));
    const domainOut = domain.lines.join("\n");
    check(
      "template `${name}.hasna.xyz`, `<app>.hasna.xyz` and bare apex in CONTENT FIRE (rc=1, three entries named)",
      domain.rc === 1 && domainOut.includes("data/host.json") && domainOut.includes("data/readme.md") && domainOut.includes("data/apex.txt"),
    );
    check("a CHANGELOG naming the domain stays SILENT (release history)", !domainOut.includes("data/CHANGELOG.md"));

    // Recorded exception arms: an entry silences exactly its file; a stale
    // entry (file packed, pattern absent) FAILS the guard.
    const excepted = capture(() =>
      run(domainRoot, [
        { member: "self-test-domain", entry: /^data\/host\.json$/, pattern: "hasna-xyz-domain", reason: "fixture" },
        { member: "self-test-domain", entry: /^data\/readme\.md$/, pattern: "hasna-xyz-domain", reason: "fixture" },
        { member: "self-test-domain", entry: /^data\/apex\.txt$/, pattern: "hasna-xyz-domain", reason: "fixture" },
      ]),
    );
    const exceptedOut = excepted.lines.join("\n");
    check(
      "recorded content exceptions silence exactly their entries (rc=0, 3 recorded exceptions reported)",
      excepted.rc === 0 && exceptedOut.includes("3 recorded exception(s)") && !exceptedOut.includes("PUBLISH-GUARD VIOLATION"),
    );
    const stale = capture(() =>
      run(domainRoot, [
        { member: "self-test-domain", entry: /^data\/host\.json$/, pattern: "hasna-xyz-domain", reason: "fixture" },
        { member: "self-test-domain", entry: /^data\/readme\.md$/, pattern: "hasna-xyz-domain", reason: "fixture" },
        { member: "self-test-domain", entry: /^data\/apex\.txt$/, pattern: "hasna-xyz-domain", reason: "fixture" },
        { member: "self-test-domain", entry: /^data\/CHANGELOG\.md$/, pattern: "hasna-xyz-domain", reason: "fixture: packed but exempt -> stale" },
      ]),
    );
    check("a stale recorded exception (file packed, no hit) FAILS the guard", stale.rc === 1 && stale.lines.join("\n").includes("STALE EXCEPTION"));
    const unbuiltException = capture(() =>
      run(domainRoot, [
        { member: "self-test-domain", entry: /^data\/host\.json$/, pattern: "hasna-xyz-domain", reason: "fixture" },
        { member: "self-test-domain", entry: /^data\/readme\.md$/, pattern: "hasna-xyz-domain", reason: "fixture" },
        { member: "self-test-domain", entry: /^data\/apex\.txt$/, pattern: "hasna-xyz-domain", reason: "fixture" },
        { member: "self-test-domain", entry: /^dist\/not-built\.d\.ts$/, pattern: "hasna-xyz-domain", reason: "fixture: not in the pack list -> skipped, not stale" },
      ]),
    );
    check("an exception whose file is absent from the pack list is skipped, not stale (rc=0)", unbuiltException.rc === 0);

    // Local-filesystem-path checks (issue #1774). The exact #1708 defect
    // shape — a bundler banner comment escaping the checkout into the
    // author's directory layout — and a Windows absolute home path must
    // FIRE; both land in a content scan through the same run() path the
    // guard uses.
    const localPathRoot = path.join(root, "local-path-root");
    fs.mkdirSync(localPathRoot, { recursive: true });
    fixturePackage(
      path.join(localPathRoot, "apps"),
      "self-test-local-path",
      ["notes.txt"],
      false,
      {
        "notes.txt":
          `// ${"../".repeat(7)}Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/index.js\n` +
          `const cache = "C:\\\\Users\\\\alice\\\\AppData\\\\Local\\\\x";\n`,
      },
    );
    const localPath = capture(() => run(localPathRoot));
    const localPathOut = localPath.lines.join("\n");
    check(
      "deep relative-escape into an author directory in CONTENT FIRES (rc=1, pattern named)",
      localPath.rc === 1 &&
        localPathOut.includes("PUBLISH-GUARD VIOLATION") &&
        localPathOut.includes("notes.txt") &&
        localPathOut.includes("local-relative-escape"),
    );
    check(
      "Windows absolute home path in CONTENT FIRES (rc=1, pattern named)",
      localPath.rc === 1 &&
        localPathOut.includes("PUBLISH-GUARD VIOLATION") &&
        localPathOut.includes("notes.txt") &&
        localPathOut.includes("local-home-path"),
    );

    // Two-sided negative control for the same class: the canonical in-root
    // bundle banner (2 escapes), an escape run landing directly on the
    // hoisted dependency store (connectors' committed shape), an in-repo
    // source import (connectors' gmail test shape) and deliberately authored
    // unix home paths in docs content (the measured eleven-member class) all
    // stay SILENT — no false positive on today's packable content.
    const cleanLocalRoot = path.join(root, "clean-local-root");
    fs.mkdirSync(cleanLocalRoot, { recursive: true });
    fixturePackage(
      path.join(cleanLocalRoot, "apps"),
      "self-test-clean-local",
      ["notes.txt"],
      false,
      {
        "notes.txt":
          `// ../../node_modules/.bun/zod@3.25.76/index.js\n` +
          `// ../../../../../../node_modules/hono/dist/request.js\n` +
          `import { run } from "../../../../src/lib/runner.js";\n` +
          `const home = "/home/hasna/workspace";\n` +
          `const users = "/Users/hasna/.hasna/cache";\n`,
      },
    );
    const cleanLocal = capture(() => run(cleanLocalRoot));
    const cleanLocalOut = cleanLocal.lines.join("\n");
    check(
      "canonical banners, dep-store/source escape runs and authored unix home paths in CONTENT stay SILENT (rc=0, no violation)",
      cleanLocal.rc === 0 && !cleanLocalOut.includes("PUBLISH-GUARD VIOLATION"),
    );

    // Pack-order checks (row 312913f1). The guard packs every member by
    // iterating the apps directory, so pack order MUST be deterministic —
    // lexicographic — across checkouts. Before the fix the order was the raw
    // `readdirSync` seed, which is a filesystem property and not a contract:
    // the CI checkout (ext4 hash order) seeded browser BEFORE mementos and
    // the guard passed, while the local checkout seeded mementos before
    // browser and the guard failed at browser's prepack (TS7016, mementos'
    // dist declarations wiped by its own prepare). PASSING state: the
    // returned order equals the lexicographic order of the member names,
    // whatever order the fixture directories were created in. FAILING state:
    // any seed order — measured red pre-fix on this very fixture (the
    // insertion order in which the fixture directories were created), and
    // the CI-vs-local divergence in the wild.
    const sortRoot = path.join(root, "sort-root");
    fs.mkdirSync(sortRoot, { recursive: true });
    for (const name of ["zeta", "alpha", "memento", "browser"]) {
      fixturePackage(path.join(sortRoot, "apps"), name, ["ok.txt"], false);
    }
    const memberNames = memberPackages(sortRoot).map((p) => path.basename(p));
    check(
      "memberPackages returns lexicographically sorted member order (readdir seed independent)",
      JSON.stringify(memberNames) === JSON.stringify([...memberNames].sort()) &&
        JSON.stringify(memberNames) === JSON.stringify(["alpha", "browser", "memento", "zeta"]),
    );

    // Declarations-presence checks (row 312913f1). A member that declares
    // types in package.json but whose tarball packs ZERO .d.ts ships a
    // types-less package to every consumer while the guard reports "0
    // internal-infra strings" — the measured class: prepare scripts that ran
    // clean+build without the declaration emit, destroying the .d.ts their
    // own prepack had just produced. The fixture below mimics exactly that:
    // prepack emits dist/index.d.ts, prepare deletes it and rebuilds JS only.
    const wiperRoot = path.join(root, "wiper-root");
    fs.mkdirSync(wiperRoot, { recursive: true });
    fixturePackage(
      path.join(wiperRoot, "apps"),
      "self-test-wiper",
      [],
      false,
      undefined,
      {
        fields: { files: ["dist"], types: "dist/index.d.ts" },
        scripts: {
          prepack:
            "mkdir -p dist && printf 'export const x = 1;\\n' > dist/index.js && printf 'export declare const x: number;\\n' > dist/index.d.ts",
          prepare:
            "rm -rf dist && mkdir -p dist && printf 'export const x = 1;\\n' > dist/index.js",
        },
      },
    );
    const wiper = capture(() => run(wiperRoot));
    const wiperOut = wiper.lines.join("\n");
    check(
      "member declaring types that packs 0 .d.ts (prepare wipes prepack's declarations) FAILS the guard (rc=1)",
      wiper.rc === 1 &&
        wiperOut.includes("PUBLISH-GUARD FAILED") &&
        wiperOut.includes("self-test-wiper") &&
        wiperOut.includes(".d.ts"),
    );

    const keepRoot = path.join(root, "keep-root");
    fs.mkdirSync(keepRoot, { recursive: true });
    fixturePackage(
      path.join(keepRoot, "apps"),
      "self-test-kept-dts",
      [],
      false,
      undefined,
      {
        fields: { files: ["dist"], types: "dist/index.d.ts" },
        scripts: {
          prepack:
            "mkdir -p dist && printf 'export const x = 1;\\n' > dist/index.js && printf 'export declare const x: number;\\n' > dist/index.d.ts",
          prepare:
            "mkdir -p dist && printf 'export const x = 1;\\n' > dist/index.js && printf 'export declare const x: number;\\n' > dist/index.d.ts",
        },
      },
    );
    const kept = capture(() => run(keepRoot));
    const keptOut = kept.lines.join("\n");
    check(
      "member declaring types that packs .d.ts (prepare keeps prepack's declarations) PASSES (rc=0, non-vacuous)",
      kept.rc === 0 && /\d+ tarball entries/.test(keptOut) && !keptOut.includes("PUBLISH-GUARD FAILED"),
    );

    // Declared-bin coverage checks (2026-08-24, npm 10). A member whose
    // package.json declares a bin entry but whose tarball packs NONE of them
    // ships a CLI that does not exist — the measured class: @hasna/skills'
    // prepare ran build:js, which began with the shared clean (`rm -rf bin/
    // dist/`), and npm 10 executes prepare during npm pack even under
    // --ignore-scripts, so the packlist lost every declared bin. The fixture
    // mimics exactly that: prepare deletes bin/ after prepack (not present
    // here) built it. data/ok.js keeps the tarball a real build so the
    // packsBuiltJs gate is on.
    const binWiperRoot = path.join(root, "bin-wiper-root");
    fs.mkdirSync(binWiperRoot, { recursive: true });
    fixturePackage(
      path.join(binWiperRoot, "apps"),
      "self-test-bin-wiper",
      ["ok.js"],
      false,
      undefined,
      {
        fields: { files: ["bin", "data"], bin: { x: "bin/x.js" } },
        scripts: { prepare: "rm -rf bin && mkdir -p bin" },
      },
    );
    const binWiper = capture(() => run(binWiperRoot));
    const binWiperOut = binWiper.lines.join("\n");
    check(
      "member declaring bin entries that the tarball does not pack (prepare wipes bin/) FAILS the guard (rc=1, entry named)",
      binWiper.rc === 1 &&
        binWiperOut.includes("PUBLISH-GUARD FAILED") &&
        binWiperOut.includes("self-test-bin-wiper") &&
        binWiperOut.includes("bin/x.js"),
    );

    const binKeepRoot = path.join(root, "bin-keep-root");
    fs.mkdirSync(binKeepRoot, { recursive: true });
    fixturePackage(
      path.join(binKeepRoot, "apps"),
      "self-test-bin-kept",
      ["ok.js"],
      false,
      undefined,
      {
        fields: { files: ["bin", "data"], bin: { x: "bin/x.js" } },
        scripts: { prepare: "mkdir -p bin && printf 'console.log(1)\\n' > bin/x.js" },
      },
    );
    const binKept = capture(() => run(binKeepRoot));
    const binKeptOut = binKept.lines.join("\n");
    check(
      "member declaring bin entries that the tarball packs (prepare keeps bin/) PASSES (rc=0, non-vacuous)",
      binKept.rc === 0 && /\d+ tarball entries/.test(binKeptOut) && !binKeptOut.includes("PUBLISH-GUARD FAILED"),
    );

    // A member declaring types whose dist was never built at guard time
    // (prepack does not build; CI builds only prepare:ordered members) packs
    // no built JS — the declarations check must NOT fire on it (measured
    // false-positive class: crawl, guardrails, markdown, telephony — their
    // builds all end in tsc emit, their dist simply does not exist in the
    // guard's checkout; todos and skills now build via the chain).
    const unbuiltRoot = path.join(root, "unbuilt-root");
    fs.mkdirSync(unbuiltRoot, { recursive: true });
    fixturePackage(
      path.join(unbuiltRoot, "apps"),
      "self-test-unbuilt",
      ["ok.txt"],
      false,
      undefined,
      { fields: { types: "dist/index.d.ts" } },
    );
    const unbuilt = capture(() => run(unbuiltRoot));
    const unbuiltOut = unbuilt.lines.join("\n");
    check(
      "member declaring types with NO built JS in the tarball (dist never built) PASSES (rc=0, non-vacuous)",
      unbuilt.rc === 0 && /\d+ tarball entries/.test(unbuiltOut) && !unbuiltOut.includes("PUBLISH-GUARD FAILED"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  if (failed) {
    console.error("self-test FAILED — the guard cannot be trusted");
    return 1;
  }
  console.log("self-test: PASS (fires, stays silent, and fails loudly on broken packs)");
  return 0;
}

/**
 * Two-sided self-test of the `--changed-since` selection over a real git
 * fixture: a changed member selects itself and its in-tree dependents; an
 * unchanged member is skipped; a shared-input change selects every member; a
 * diff touching nothing tarball-relevant selects none; an unresolvable base
 * selects every member (conservative).
 */
function selectionSelfTest(): number {
  let failed = false;
  const check = (name: string, ok: boolean) => {
    console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}`);
    if (!ok) failed = true;
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "publish-guard-selection-"));
  try {
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
    const g = (...a: string[]) => execFileSync("git", a, { cwd: tmp, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "@hasna/apps", private: true, workspaces: ["apps/*"] }, null, 2));
    fixturePackage(path.join(tmp, "apps"), "a", ["x.txt"], false);
    fixturePackage(path.join(tmp, "apps"), "b", ["x.txt"], false, undefined, { fields: { dependencies: { "@hasna/self-test-a": "workspace:*" } } });
    fixturePackage(path.join(tmp, "apps"), "c", ["x.txt"], false);
    fs.writeFileSync(path.join(tmp, "README.md"), "root readme\n");
    g("init", "-q", "-b", "main");
    g("add", "-A");
    g("commit", "-q", "-m", "base\n\nAgent: fixture");
    const base = g("rev-parse", "HEAD");
    const names = (sel: Selection) => sel.members.map((d) => path.basename(d)).sort().join(",");

    fs.writeFileSync(path.join(tmp, "apps", "a", "data", "x.txt"), "changed\n");
    g("commit", "-qam", "change a\n\nAgent: fixture");
    const s1 = selectMembers(tmp, base);
    check("a changed -> a and its dependent b selected, c skipped", s1.scope === "changed" && names(s1) === "a,b" && s1.skipped.map((d) => path.basename(d)).join(",") === "c");

    fs.writeFileSync(path.join(tmp, "README.md"), "root readme changed\n");
    g("commit", "-qam", "readme only\n\nAgent: fixture");
    const s2 = selectMembers(tmp, g("rev-parse", "HEAD~1"));
    check("a diff touching nothing tarball-relevant selects none (scope none)", s2.scope === "none" && s2.members.length === 0);

    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "@hasna/apps", private: true, workspaces: ["apps/*"], x: 1 }, null, 2));
    g("commit", "-qam", "root package.json\n\nAgent: fixture");
    const s3 = selectMembers(tmp, g("rev-parse", "HEAD~1"));
    check("a shared tarball input (root package.json) selects every member", s3.scope === "all" && names(s3) === "a,b,c");

    const s4 = selectMembers(tmp, "no-such-ref");
    check("an unresolvable base selects every member (conservative, never vacuous)", s4.scope === "all" && names(s4) === "a,b,c" && /cannot be resolved/.test(s4.reason));

    const s5 = selectMembers(tmp, null);
    check("no base selects every member (local default)", s5.scope === "all" && names(s5) === "a,b,c");

    // bun.lock: a workspaces-only regeneration (release commit) stays
    // member-scoped; a packages-section change widens to every member.
    const lock = (wsVersion: string, pkgHash: string) =>
      `{\n  "lockfileVersion": 1,\n  "workspaces": {\n    "apps/a": { "name": "@hasna/self-test-a", "version": "${wsVersion}" },\n  },\n  "packages": {\n    "zod": ["zod@3.25.76", "", {}, "${pkgHash}"],\n  },\n}\n`;
    fs.writeFileSync(path.join(tmp, "bun.lock"), lock("0.0.1", "sha512-A"));
    g("add", "bun.lock");
    g("commit", "-qm", "lock base\n\nAgent: fixture");
    fs.writeFileSync(path.join(tmp, "bun.lock"), lock("0.0.2", "sha512-A"));
    fs.writeFileSync(path.join(tmp, "apps", "a", "data", "x.txt"), "release\n");
    g("commit", "-qam", "release a\n\nAgent: fixture");
    const s6 = selectMembers(tmp, g("rev-parse", "HEAD~1"));
    check("bun.lock workspaces-only regeneration stays member-scoped (a + dependent b, c skipped)", s6.scope === "changed" && names(s6) === "a,b" && /workspaces section only/.test(s6.reason));
    fs.writeFileSync(path.join(tmp, "bun.lock"), lock("0.0.2", "sha512-B"));
    g("commit", "-qam", "dep bump\n\nAgent: fixture");
    const s7 = selectMembers(tmp, g("rev-parse", "HEAD~1"));
    check("bun.lock packages-section change widens to every member", s7.scope === "all" && names(s7) === "a,b,c" && /packages section changed/.test(s7.reason));
    check("packagesSectionChanged treats an unreadable side as changed (conservative)", packagesSectionChanged(null, "x") && packagesSectionChanged("x", null));

    // run() with a scope-none selection exits 0 and says so, without packing.
    const none = capture(() => run(tmp, [], s2));
    check("run() on a scope-none selection packs nothing and exits 0 with the reason printed", none.rc === 0 && none.lines.join("\n").includes("nothing to pack"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failed) {
    console.error("selection self-test FAILED — the scoping cannot be trusted");
    return 1;
  }
  console.log("selection self-test: PASS (selects changed + dependents, skips unchanged, widens to all on shared inputs / unresolvable base)");
  return 0;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    process.exit(selfTest() || selectionSelfTest());
  }
  const rootIdx = args.indexOf("--root");
  const root = rootIdx >= 0 ? args[rootIdx + 1]! : process.cwd();
  const sinceIdx = args.indexOf("--changed-since");
  const base = sinceIdx >= 0 ? (args[sinceIdx + 1] ?? null) : null;
  if (sinceIdx >= 0 && !base) {
    console.error("usage: --changed-since <base-ref>");
    process.exit(2);
  }
  process.exit(run(root, CONTENT_EXCEPTIONS, base === null ? undefined : selectMembers(root, base)));
}
