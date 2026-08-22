/**
 * Publish guard for hasna/apps — internal-infra strings must never reach a
 * published tarball.
 *
 * For every member package, dry-run `npm pack` and scan the resulting file
 * list for internal-infra strings: `*.hasna.xyz`, ARNs, 12-digit AWS account
 * ids, the private-scope markers, and the internal platform account id. A
 * public npm package that carries any of these leaks Hasna's internal estate
 * into the open.
 *
 * Usage:
 *   bun tooling/ci/check-publish-guard.ts [--root <dir>]
 *   bun tooling/ci/check-publish-guard.ts --self-test
 *
 * Why the pack output is parsed the way it is (measured 2026-08-13):
 *
 * `npm pack --dry-run --json` runs the package's `prepack` script BEFORE it
 * writes the JSON, and npm forwards the prepack script's stdout to our stdout.
 * A member with a chatty prepack (billing: `bun run verify && bun run
 * scan:artifact`) produces 612 lines / 14118 bytes of prepack logs followed by
 * the JSON document — so `JSON.parse` on the raw stdout FAILS
 * ("Unexpected token 'b'"). `--silent` does NOT suppress the prepack stdout
 * (measured: identical failure). The previous guard swallowed that failure and
 * returned an empty entry list, reporting "0 tarball entries, 0 internal-infra
 * strings" for every chatty-prepack member while exiting 0 — a vacuous pass
 * (measured on billing, datasets, draw, models, releases, sheets, tables;
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
  { name: "hasna-xyz-domain", re: /[.]hasna[.]xyz/ },
  { name: "aws-arn", re: /arn[:]aws[:]/ },
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
];

function memberPackages(root: string): string[] {
  const apps = path.join(root, "apps");
  if (!fs.existsSync(apps)) return [];
  return fs
    .readdirSync(apps, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(apps, name, "package.json")))
    .map((name) => path.join(apps, name));
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
// ids or internal-scope strings in its BYTES. `packFileNames` runs `npm pack
// --dry-run --json`, which executes the member's `prepack` — so the packed
// files exist on disk, post-build, when this runs. Read each packed path and
// scan its text with the same pattern set, keeping the filename checks as an
// additional control. Binary and oversize files cannot be scanned textually;
// they are counted and reported rather than silently dropped.
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

function run(root: string): number {
  const pkgs = memberPackages(root);
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
    const nameHits = scanNames(names);
    const content = scanContents(pkg, names);
    const hits = [...nameHits, ...content.hits];
    const skippedNote = content.skipped > 0 ? `, ${content.skipped} binary/oversize/absent skipped` : "";
    if (hits.length > 0) {
      failed = true;
      console.error(`PUBLISH-GUARD VIOLATION in ${pkg} (${hits.length}):`);
      for (const h of hits) console.error(`  ${h.name} — pattern ${h.pattern}`);
    } else {
      console.log(
        `publish guard: ${path.basename(pkg)} — ${names.length} tarball entries, ${content.scanned} contents scanned, 0 internal-infra strings${skippedNote}`,
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
): void {
  const dir = path.join(appsRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  const pkg: Record<string, unknown> = {
    name: `@hasna/self-test-${name}`,
    version: "0.0.0",
    files: ["data"],
  };
  if (broken) {
    // A prepack that fails makes `npm pack` exit non-zero: there is no JSON
    // document to parse at all. The guard must FAIL, never pass. The fixture
    // emits one marker on stdout and one on stderr: npm forwards the prepack
    // script's stderr before its own "npm error ..." boilerplate, and the
    // guard must surface BOTH so a prepack failure names its cause (the
    // stderr marker is the shape machines' verify:pack failures take).
    pkg.scripts = { prepack: "echo broken-prepack-output && echo broken-prepack-stderr >&2 && exit 1" };
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

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  process.exit(selfTest());
}
const rootIdx = args.indexOf("--root");
const root = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();
process.exit(run(root));
