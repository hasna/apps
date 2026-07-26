#!/usr/bin/env bun
/**
 * Release guard: scan the ACTUAL PACKED ARTIFACT for disclosure.
 *
 * Why this exists
 * ---------------
 * Three incidents of the same shape. `@hasna/tenants@0.1.0` shipped the complete
 * list of owned apex domains to the public npm registry. `@hasna/identities`
 * through 0.4.4 shipped 630 generated markdown files naming every internal
 * mailbox on the owned domain. And `@hasna/catalog@0.1.0` shipped
 * `fixtures/apps.seed.jsonl` — 86 real application records with app ids, npm
 * names, GitHub URLs, checkout folders, project slugs, bin names, and lifecycle
 * state — a committed cache of the output of the `catalog seed` scanner that
 * this same package ships. Nothing read it at runtime.
 *
 * In every case the bytes that leaked were not the bytes a reviewer read: the
 * disclosure lived in built `dist/` bundles, or in generated data that had been
 * committed and then listed in `files`. Any check that reads `src/` is therefore
 * insufficient BY CONSTRUCTION — it inspects a different set of bytes than the
 * ones shipped.
 *
 * So this guard starts from `npm pack --dry-run --json`, which reports exactly
 * the file list npm would publish (honouring `files`, `.npmignore`, and npm's
 * built-in rules), and scans the CONTENT of those files. Whatever npm would
 * upload is what gets read.
 *
 * It runs from two places, so neither the normal gate nor a direct publish
 * misses it (see the residual `--ignore-scripts` gap below):
 *   - `bun run verify:release` — the normal pre-release gate.
 *   - `prepack` — npm's own lifecycle hook, which runs on `npm pack` AND
 *     `npm publish`. Publishing directly, without the verify script, still runs
 *     it. (The nested `npm pack` below passes `--ignore-scripts` so this hook
 *     does not re-enter itself.)
 *
 * Known limits (stated so no one mistakes this for a proof)
 * ---------------------------------------------------------
 * It matches literals in text. A value assembled at runtime (`brand + ".xyz"`),
 * encoded (base64), or fetched from a network service will not be seen. It
 * catches the shape of the incident that happened — a constant compiled into the
 * bundle, or a generated inventory committed and then packed — and every routine
 * variant of it, not an adversary hiding data on purpose. Files that are not
 * plain text are scanned as raw bytes AND as UTF-16, and then FAIL the check
 * rather than being skipped — the guard never calls a file clean that it could
 * not read.
 *
 * The `artifact-check-ignore:` escape hatch only helps for files that ship
 * verbatim in a format that HAS comments (docs, `src/**` when `files` includes
 * it). It is never honoured in `.json`/`.jsonl`/`.csv`, which have no comment
 * syntax, so a record cannot annotate itself. And a literal in TypeScript that
 * the bundler compiles into `dist/` reappears there WITHOUT the comment, so the
 * dist copy still fails. Both are deliberate: an annotation must not be able to
 * launder a value into a build output, and data must not be able to carry its
 * own exemption.
 *
 * `npm publish --ignore-scripts` skips ALL lifecycle hooks, this one included.
 * No package.json setting can defeat that flag; closing it needs a publish path
 * that runs `verify:release` (CI, or a release script). Publish through
 * `bun run verify:release` rather than reaching for `--ignore-scripts`.
 *
 * Exit codes: 0 clean · 1 violations found · 2 the guard could not run.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ── what counts as ours ──────────────────────────────────────────────────────

/**
 * Brand labels whose apex domains must never appear in a published artifact.
 * Add a label here and every `<label>.<tld>` literal becomes a release blocker.
 */
export const BRAND_DOMAIN_LABELS = ["hasna"] as const;

/** Hostname suffixes that only ever name private infrastructure. */
const INTERNAL_TLDS = ["internal", "intranet", "corp", "lan", "local", "localdomain"] as const;

const BRAND_ALTERNATION = BRAND_DOMAIN_LABELS.join("|");

/**
 * Private/carrier-grade IPv4 ranges. Deliberately EXCLUDES 127.0.0.0/8
 * (loopback) and 169.254.0.0/16 (link-local, e.g. the fixed AWS container
 * credentials address): those are well-known constants that identify no
 * deployment of ours, and flagging them would only teach reviewers to add
 * exceptions.
 */
const PRIVATE_IPV4 =
  String.raw`(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}` +
  String.raw`|192\.168\.\d{1,3}\.\d{1,3}` +
  String.raw`|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}` +
  String.raw`|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})`;

export type Severity = "disclosure" | "credential";

export interface Rule {
  id: string;
  severity: Severity;
  description: string;
  pattern: RegExp;
  /** Mask the matched text in output (credentials must never be echoed). */
  redact?: boolean;
  /** Discard a match that the pattern over-approximates. */
  ignoreMatch?: (match: string) => boolean;
}

/**
 * Trailing labels that make a dotted token a FILENAME rather than a hostname.
 * `@hasna/contracts` ships a config file called `hasna.contract.json`, and a
 * guard that fails a release because a doc comment mentions it is a guard that
 * engineers switch off. Only applied when a label FOLLOWS the apex, so a real
 * two-label domain such as `<brand>.md` is still reported.
 */
const FILE_EXTENSION_LABELS = new Set([
  "json", "js", "mjs", "cjs", "ts", "tsx", "jsx", "map", "lock", "txt", "yaml", "yml",
  "toml", "html", "css", "png", "jpg", "jpeg", "svg", "gif", "log", "bak", "tgz", "zip",
  "sh", "py", "rs", "go", "java", "rb", "php", "sql", "csv", "xml", "ini", "cfg", "conf",
]);

/**
 * Labels that are NEVER a TLD, so `<brand>.<label>` is not a hostname.
 *
 * This started as an allowlist of real TLDs and that was WRONG. An adversarial
 * review ran the 176 owned apex domains from the tenants incident through it:
 * 31 were caught and 145 — `.zone`, `.ventures`, `.capital`, `.foundation`,
 * `.software`, `.solutions`, … — were silently ignored, because an allowlist
 * turns the guard's core rule into deny-by-default. Missing an entry meant
 * missing a real domain, which is precisely the failure mode that must not exist.
 *
 * Inverted: everything is treated as a domain UNLESS the label is a known
 * non-TLD. Missing an entry here now costs a false POSITIVE, which is loud,
 * annotatable, and gets fixed — not a silent miss. The list covers the two
 * things that actually collide: file extensions, and the dotted namespace
 * segments this codebase uses for schema ids (`<brand>.identities.agent`).
 */
const NON_TLD_LABELS = new Set([
  // file extensions
  "json", "js", "mjs", "cjs", "ts", "tsx", "jsx", "map", "lock", "txt", "yaml", "yml",
  "toml", "html", "css", "png", "jpg", "jpeg", "svg", "gif", "log", "bak", "tgz", "zip",
  "sh", "py", "rs", "go", "java", "rb", "php", "sql", "csv", "xml", "ini", "cfg", "conf",
  "lockb", "d", "min", "test", "spec", "snap", "example", "sample", "tmpl", "template",
  // schema / namespace segments used as `<brand>.<segment>` identifiers
  "identities", "identity", "agent", "agents", "directory", "runtime", "machine",
  "machines", "migration", "convergence", "configs", "config", "contract", "contracts",
  "rollout", "record", "records", "schema", "event", "events", "catalog",
]);

function isFilenameNotDomain(match: string): boolean {
  const labels = match.toLowerCase().split(".");
  const last = labels[labels.length - 1]!;
  if (labels.length > 2 && FILE_EXTENSION_LABELS.has(last)) return true;
  return NON_TLD_LABELS.has(last);
}

export const RULES: Rule[] = [
  {
    id: "brand-domain",
    severity: "disclosure",
    description: "Owned apex domain literal (the 0.1.0 incident class)",
    // The trailing lookahead rejects a match that is only PART of a longer dotted
    // path: `<brand>.app.v1` is a schema id, and stopping at `<brand>.app` would
    // report a domain nobody wrote. `<brand>.co.uk` is consumed whole, so it is
    // unaffected.
    pattern: new RegExp(
      String.raw`\b(?:${BRAND_ALTERNATION})\.[a-z]{2,24}(?:\.[a-z]{2,24})?\b(?!\.[a-z0-9])`,
      "gi",
    ),
    ignoreMatch: isFilenameNotDomain,
  },
  {
    id: "brand-subdomain",
    severity: "disclosure",
    description: "Hostname under an owned apex domain",
    pattern: new RegExp(
      String.raw`\b[a-z0-9][a-z0-9-]*\.(?:${BRAND_ALTERNATION})\.[a-z]{2,24}\b(?!\.[a-z0-9])`,
      "gi",
    ),
    ignoreMatch: isFilenameNotDomain,
  },
  {
    id: "internal-host",
    severity: "disclosure",
    description: "Private-infrastructure hostname",
    // Two or more labels before an internal TLD, so ordinary property access
    // such as `config.internal` is not mistaken for a hostname.
    pattern: new RegExp(
      String.raw`\b[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*\.(?:${INTERNAL_TLDS.join("|")})\b`,
      "gi",
    ),
  },
  {
    id: "tailnet-host",
    severity: "disclosure",
    description: "Tailscale tailnet hostname",
    pattern: /\b[a-z0-9][a-z0-9-]*\.ts\.net\b/gi,
  },
  {
    id: "private-ip",
    severity: "disclosure",
    description: "Private / tailnet IPv4 address",
    pattern: new RegExp(String.raw`\b${PRIVATE_IPV4}\b`, "g"),
  },
  {
    id: "aws-resource-endpoint",
    severity: "disclosure",
    description: "Region-scoped AWS resource endpoint (identifies an account's infrastructure)",
    // Matches `name.abc123.us-east-1.rds.amazonaws.com` but not the public,
    // account-independent `truststore.pki.rds.amazonaws.com`.
    pattern: /\b[a-z0-9-]+\.[a-z]{2}-[a-z]+-\d\.(?:rds|elb|es|cache|redshift|execute-api|elasticbeanstalk)\.amazonaws\.com\b/gi,
  },
  {
    id: "aws-account-id",
    severity: "disclosure",
    description: "AWS account id (ARN or ECR registry host)",
    pattern: /(?:arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:\d{12}:|\b\d{12}\.dkr\.ecr\.)/gi,
  },
  {
    id: "internal-api-url",
    severity: "disclosure",
    description: "URL pointing at non-public infrastructure",
    // An endpoint under an owned apex, an internal TLD, a tailnet, or a private
    // address. `localhost` and `127.0.0.1` are deliberately absent: they name no
    // deployment of ours and appear in every server's own documentation.
    pattern: new RegExp(
      String.raw`\bhttps?://(?:[a-z0-9][a-z0-9-]*\.)*` +
        String.raw`(?:(?:${BRAND_ALTERNATION})\.[a-z]{2,24}` +
        String.raw`|[a-z0-9][a-z0-9-]*\.(?:${INTERNAL_TLDS.join("|")})` +
        String.raw`|[a-z0-9][a-z0-9-]*\.ts\.net)` +
        String.raw`(?::\d+)?[/\s"'\`]`,
      "gi",
    ),
  },
  {
    id: "internal-api-url-ip",
    severity: "disclosure",
    description: "URL pointing at a private IPv4 address",
    pattern: new RegExp(String.raw`\bhttps?://${PRIVATE_IPV4}(?::\d+)?`, "gi"),
  },
  {
    id: "snapshot-provenance",
    severity: "disclosure",
    description: "Provenance marker of a captured snapshot (the data it labels was scanned, not authored)",
    // Fires on a provenance key bound to a LITERAL. Code that stamps provenance
    // at runtime binds a variable (`seededFrom: options.source`) and is not a
    // snapshot; a packed file that carries `"seededFrom":"opensource-scan"` is
    // one, because the value was already resolved when the artifact was built.
    //
    // Only `…From`/`…By`/`…Source` — the keys that name WHERE data came from.
    // `…At` was tried and dropped: a timestamp is not a disclosure, every record
    // schema has one, and it fired on documentation showing an export's shape.
    // A real snapshot carries both, so nothing is lost by ignoring the weak half.
    pattern:
      /["']?(?:seeded|scanned|harvested|exported|snapshotted|captured|crawled|imported|generated|synced|derived|collected|extracted|sourced|ingested|mirrored)[_-]?(?:from|by|source)["']?\s*[:=]\s*["'`][^"'`\n]+["'`]/gi,
  },
  {
    id: "connection-string-credential",
    severity: "credential",
    description: "Connection string with an embedded password",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/"'`]+:[^\s:@/"'`]+@[^\s/"'`]+/gi,
    redact: true,
    // `http://user:@host` and a bare `redis://host` carry no secret; the pattern
    // already requires a non-empty password, so nothing further is needed here.
  },
  {
    id: "authorization-header",
    severity: "credential",
    description: "Literal Authorization header value",
    pattern: /\bauthorization["']?\s*[:=]\s*["'`]?(?:bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    redact: true,
  },
  {
    id: "aws-access-key-id",
    severity: "credential",
    description: "AWS access key id",
    pattern: /\b(?:AKIA|ASIA|AIDA|AROA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
    redact: true,
  },
  {
    id: "private-key-block",
    severity: "credential",
    description: "PEM private key block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
    redact: true,
  },
  {
    id: "github-token",
    severity: "credential",
    description: "GitHub token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
    redact: true,
  },
  {
    id: "npm-token",
    severity: "credential",
    description: "npm access token",
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/g,
    redact: true,
  },
  {
    id: "slack-token",
    severity: "credential",
    description: "Slack token",
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    redact: true,
  },
  {
    id: "provider-api-key",
    severity: "credential",
    description: "Provider API key (sk-…, AIza…)",
    pattern: /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{24,}|AIza[0-9A-Za-z_-]{35})\b/g,
    redact: true,
  },
  {
    id: "jwt",
    severity: "credential",
    description: "Serialized JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    redact: true,
  },
  {
    id: "hardcoded-secret",
    severity: "credential",
    description: "Literal assigned to a secret-looking name",
    pattern:
      /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key)\s*[:=]\s*["'`][^"'`\n]{8,}["'`]/gi,
    redact: true,
  },
];

// ── org-asset inventories (an aggregate, not a per-line, problem) ────────────

/**
 * One name is a reference; a list of them is an inventory.
 *
 * `fixtures/apps.seed.jsonl` did not leak because any single line was wrong —
 * every line was a well-formed record. It leaked because 86 of them together
 * enumerated the organization's entire application estate. No per-line rule can
 * see that. So this pass collects DISTINCT identifiers per class across the
 * whole artifact and fails when one class reaches the threshold.
 *
 * The classes are drawn along the line between what is already public and what
 * is not:
 *   - An npm package name (`@hasna/widget`) is on a public registry. Naming it
 *     discloses nothing, so it is NOT a class.
 *   - A workspace checkout folder (`open-widget`) is the maintainer's local
 *     layout. A list of them is a map of the org's working tree, so it IS one.
 *   - `iapp-*`, `platform-*`, and the `@hasnaxyz/*` scope are internal-only
 *     naming conventions and never appear in public distribution.
 */
export interface OrgAssetClass {
  id: string;
  description: string;
  patterns: RegExp[];
  /** Fold a raw match down to the identifier itself (e.g. strip a URL prefix). */
  normalize?: (match: string) => string;
}

/** Distinct identifiers of ONE class that turn a reference into an inventory. */
export const ORG_ASSET_THRESHOLD = 3;

export const ORG_ASSET_CLASSES: OrgAssetClass[] = [
  {
    id: "internal-app",
    description: "Internal application identifiers (iapp-*, platform-*, @hasnaxyz/*)",
    patterns: [
      /\b(?:iapp|platform)-[a-z0-9][a-z0-9-]*\b/gi,
      new RegExp(String.raw`@(?:${BRAND_ALTERNATION})xyz/[a-z0-9][a-z0-9-]*`, "gi"),
      new RegExp(String.raw`\b(?:${BRAND_ALTERNATION})xyz-[a-z0-9][a-z0-9-]*\b`, "gi"),
    ],
  },
  {
    id: "repo-folder",
    description: "Workspace repo checkout folder names (open-*)",
    patterns: [/\bopen-[a-z0-9][a-z0-9-]*\b/gi],
  },
  {
    id: "mailbox",
    description: "Mailboxes on an owned domain",
    patterns: [
      new RegExp(String.raw`\b[a-z0-9._%+-]+@(?:${BRAND_ALTERNATION})\.[a-z]{2,24}\b`, "gi"),
    ],
  },
  {
    // KNOWN LIMIT: this covers hostnames that ANNOUNCE themselves as private —
    // a tailnet suffix, an internal TLD, an RFC1918 address. A bare hostname
    // like `spark01` or `machine001` is indistinguishable from an ordinary
    // identifier (`es2022`, `sha256`, `utf16le`) without knowing the
    // organization's naming convention, and a pattern loose enough to catch it
    // would fire constantly. Two such hostnames DID survive this remediation
    // until an adversarial review found them by hand. If your fleet has a naming
    // convention, add it here — that is the only way this class can see it.
    id: "machine-name",
    description: "Machine / host identifiers on private infrastructure",
    patterns: [
      /\b[a-z0-9][a-z0-9-]*\.ts\.net\b/gi,
      new RegExp(
        String.raw`\b[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*\.(?:${INTERNAL_TLDS.join("|")})\b`,
        "gi",
      ),
      new RegExp(String.raw`\b${PRIVATE_IPV4}\b`, "g"),
    ],
  },
];

/**
 * Identifiers excluded from the counts above, each with the reason it is not a
 * disclosure. Kept small and explicit: every entry is a reviewed decision that
 * shows up in a diff, exactly like `ALLOWED_BINARY_PATHS`.
 *
 * A package cannot avoid naming itself — its own checkout folder appears in its
 * README, its docs, and its contribution instructions — and one self-reference
 * is not an inventory of anything.
 */
export const ALLOWED_ORG_IDENTIFIERS: ReadonlyMap<string, string> = new Map([
  ["open-catalog", "this package's own repo checkout folder; self-reference is unavoidable and discloses nothing new"],
  ["open-source", "the English compound, not a checkout folder — it appears in prose in every OSS repository"],
  ["open-sourced", "as above"],
  ["open-sourcing", "as above"],
]);

export interface OrgAssetSighting {
  classId: string;
  identifier: string;
  file: string;
  line: number;
}

export interface OrgAssetFinding {
  classId: string;
  description: string;
  identifiers: string[];
  sightings: OrgAssetSighting[];
}

export interface Violation {
  file: string;
  line: number;
  ruleId: string;
  severity: Severity;
  description: string;
  excerpt: string;
  /** Set when the hit was found by decoding the file as something other than text. */
  encoding?: string;
}

/** An `artifact-check-ignore:` annotation that suppressed a line. */
export interface HonoredIgnore {
  file: string;
  line: number;
  reason: string;
}

/**
 * Per-line escape hatch: `artifact-check-ignore: <reason>` on the same line
 * suppresses that line. It exists so a false positive gets annotated in a
 * reviewable diff instead of someone deleting the `prepack` hook — the usual
 * fate of a guard that cries wolf. Every honoured ignore is PRINTED on every
 * run, pass or fail, and a reason is mandatory.
 *
 * The marker MUST be in comment syntax (`//`, `/* … *\/`, `#`, `<!-- … -->`, or a
 * leading `*` in a block comment). An adversarial review defeated the earlier
 * bare-substring version by putting the marker inside a JSON string value: one
 * line of `fixtures/laundered.json` suppressed 10 mailboxes, 4 hosts, 5 app ids
 * and an internal API URL, and the run printed "clean". That is reachable
 * without malice — catalog ships JSONL, one record per line — so an annotation
 * that data itself can carry is not an escape hatch, it is a bypass.
 *
 * Comment syntax alone was NOT enough. A second review defeated that version
 * too, with a record ending
 * `"note":"see runbook # artifact-check-ignore: internal notes field"}` — the
 * `#` is a comment token, and the lazy reason capture happily swallows the
 * closing `"}` so the marker still reaches end of line. Five such lines hid the
 * whole 0.1.0 disclosure and `check:artifact` exited 0. See
 * `honoredIgnoreReason` for the two further conditions that close it.
 */
const IGNORE_MARKER =
  /(?:\/\/|\/\*|#|<!--|^\s*\*)\s*artifact-check-ignore:\s*(\S[^\n]*?)\s*(?:\*\/|-->)?\s*$/;

/**
 * Packed-file extensions whose format has NO comment syntax. A marker on a line
 * of one of these is a data value however it is punctuated, so the annotation is
 * never honoured there. `package.json` is covered by this too, which is why
 * `ALLOWED_LITERALS` exists as the reviewed hatch for files that cannot carry a
 * comment at all.
 */
const COMMENTLESS_EXTENSIONS = new Set(["json", "jsonl", "ndjson", "csv", "tsv"]);

function supportsComments(file: string): boolean {
  // `scanPackedArtifact` scans a packed PATH under a synthetic `<path> (path)`
  // name; the extension to judge by is the real one underneath.
  const path = file.replace(/\s*\(path\)$/, "");
  const dot = path.lastIndexOf(".");
  if (dot === -1) return true;
  return !COMMENTLESS_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/**
 * True when the character at `index` sits inside a quoted string on `line`.
 *
 * A comment token inside a string is not a comment, it is data. Only the quote
 * character that OPENED a region closes it, so a JSON blob inside a markdown
 * backtick span reads as one region rather than two.
 *
 * Deliberately conservative: an apostrophe in prose opens a region that never
 * closes, so a marker after it is not honoured. That direction is loud — the hit
 * is reported and the annotation gets rewritten — while the other direction is
 * silent, which is the failure this whole guard exists to prevent.
 */
function insideQuotes(line: string, index: number): boolean {
  let quote: string | null = null;
  const limit = Math.min(index, line.length);
  for (let i = 0; i < limit; i++) {
    const ch = line[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    }
  }
  return quote !== null;
}

/**
 * The reason on an HONOURED `artifact-check-ignore:` annotation, else null.
 *
 * Four conditions, each of which a review has already had to add:
 *   1. the marker is in comment syntax and reaches end of line (`IGNORE_MARKER`);
 *   2. the file's format has comment syntax at all — `.json`/`.jsonl`/`.csv` do
 *      not, and catalog ships JSONL one record per line;
 *   3. the comment token is not inside a quoted string;
 *   4. the captured reason carries no quote character — a reason is prose, and a
 *      quote in it means the lazy capture ran past the end of a string literal
 *      (`internal notes field"}`), which is the giveaway that the "comment" was
 *      the tail of a data value.
 */
function honoredIgnoreReason(line: string, file: string): string | null {
  const match = IGNORE_MARKER.exec(line);
  if (!match) return null;
  if (!supportsComments(file)) return null;
  if (insideQuotes(line, match.index)) return null;
  const reason = match[1]!.trim();
  if (/["'`]/.test(reason)) return null;
  return reason;
}

/**
 * Literals exempt in ONE named file each, with the reason.
 *
 * The line annotation above is the preferred hatch and covers almost everything.
 * It cannot cover JSON, which has no comments, and `package.json` is always
 * packed — so a value npm publishes as metadata regardless has no other way out.
 *
 * Empty here, and it should stay that way unless such a case actually appears.
 *
 * Every entry is pinned to a file on purpose. An exemption that applied
 * everywhere would mean a bare owned-apex literal could reappear anywhere in the
 * artifact and go unreported, which is the exact failure this guard exists to
 * prevent. Like `ALLOWED_BINARY_PATHS`, entries are reviewed decisions visible
 * in a diff, and every use is printed on every run.
 */
export const ALLOWED_LITERALS: ReadonlyArray<{ literal: string; file: string; reason: string }> = [];

function allowedLiteral(match: string, file: string): string | null {
  const hit = ALLOWED_LITERALS.find(
    (entry) => entry.file === file && entry.literal.toLowerCase() === match.toLowerCase(),
  );
  return hit ? hit.reason : null;
}

function mask(value: string): string {
  if (value.length <= 6) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 4, 20))}<redacted>`;
}

export interface ScanTextResult {
  violations: Violation[];
  ignored: HonoredIgnore[];
  /** Org-asset identifiers seen, for the aggregate inventory check. */
  sightings: OrgAssetSighting[];
}

/** Scan one file's text against every rule. Exported for unit tests. */
export function scanTextDetailed(text: string, file = "<memory>", encoding?: string): ScanTextResult {
  const violations: Violation[] = [];
  const ignored: HonoredIgnore[] = [];
  const sightings: OrgAssetSighting[] = [];
  // Split on CR as well: a minified bundle is one long line, and generated files
  // may use CRLF — a rule must not lose its line anchor because of either.
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const ignoreReason = honoredIgnoreReason(line, file);
    let lineHits = 0;
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of line.matchAll(rule.pattern)) {
        if (rule.ignoreMatch?.(match[0])) continue;
        const allowed = allowedLiteral(match[0], file);
        if (allowed) {
          ignored.push({ file, line: i + 1, reason: `allowed literal \`${match[0]}\` — ${allowed}` });
          continue;
        }
        lineHits++;
        if (ignoreReason !== null) continue;
        violations.push({
          file,
          line: i + 1,
          ruleId: rule.id,
          severity: rule.severity,
          description: rule.description,
          excerpt: rule.redact ? mask(match[0]) : match[0],
          ...(encoding ? { encoding } : {}),
        });
      }
    }
    for (const assetClass of ORG_ASSET_CLASSES) {
      for (const pattern of assetClass.patterns) {
        pattern.lastIndex = 0;
        for (const match of line.matchAll(pattern)) {
          const identifier = (assetClass.normalize?.(match[0]) ?? match[0]).toLowerCase();
          if (ALLOWED_ORG_IDENTIFIERS.has(identifier)) continue;
          const allowedHere = allowedLiteral(match[0], file);
          if (allowedHere) {
            // Recorded, not swallowed: the header promises every use is printed,
            // and a suppression nobody sees is a suppression that outlives its reason.
            ignored.push({ file, line: i + 1, reason: `allowed literal \`${match[0]}\` — ${allowedHere}` });
            continue;
          }
          lineHits++;
          if (ignoreReason !== null) continue;
          sightings.push({ classId: assetClass.id, identifier, file, line: i + 1 });
        }
      }
    }
    if (ignoreReason !== null && lineHits > 0) ignored.push({ file, line: i + 1, reason: ignoreReason });
  }
  return { violations, ignored, sightings };
}

/**
 * Fold per-line sightings into per-class inventories, keeping only the classes
 * that reached the threshold. One or two references stay silent; a list does not.
 */
export function findOrgAssetInventories(sightings: OrgAssetSighting[]): OrgAssetFinding[] {
  const findings: OrgAssetFinding[] = [];
  for (const assetClass of ORG_ASSET_CLASSES) {
    const mine = sightings.filter((s) => s.classId === assetClass.id);
    const identifiers = [...new Set(mine.map((s) => s.identifier))].sort();
    if (identifiers.length < ORG_ASSET_THRESHOLD) continue;
    findings.push({
      classId: assetClass.id,
      description: assetClass.description,
      identifiers,
      sightings: mine,
    });
  }
  return findings;
}

/** Thin wrapper returning only the violations. */
export function scanText(text: string, file = "<memory>"): Violation[] {
  return scanTextDetailed(text, file).violations;
}

// ── packed file list ─────────────────────────────────────────────────────────

export interface PackedFile {
  path: string;
  size: number;
}

/**
 * Ask npm exactly which files it would publish.
 *
 * `--ignore-scripts` is REQUIRED: this guard itself runs from `prepack`, and
 * without it the nested pack would re-enter the guard forever.
 */
export function listPackedFiles(cwd: string): PackedFile[] {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // Recursion marker for the CHILD only. If `--ignore-scripts` ever stops
    // suppressing the prepack hook, the nested guard sees this and exits 2 — a
    // loud failure instead of an infinite loop. It is never read from the
    // ambient parent environment, so it cannot serve as a kill switch.
    env: { ...process.env, CATALOG_PACK_GUARD_ACTIVE: "1" },
  });
  if (result.error) throw new Error(`could not run \`npm pack\`: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`\`npm pack --dry-run\` failed (exit ${result.status}):\n${result.stderr ?? ""}`);
  }
  const stdout = (result.stdout ?? "").trim();
  const start = stdout.indexOf("[");
  if (start === -1) throw new Error(`\`npm pack --dry-run --json\` produced no JSON:\n${stdout}`);
  const parsed = JSON.parse(stdout.slice(start)) as Array<{ files?: PackedFile[] }>;
  const files = parsed[0]?.files;
  if (!files?.length) throw new Error("`npm pack --dry-run --json` reported no files");
  return files;
}

/** A NUL byte anywhere means the file is not plain text. */
function isBinary(buf: Buffer): boolean {
  return buf.includes(0);
}

/**
 * Packed paths permitted to be non-text. EMPTY ON PURPOSE: a file this guard
 * cannot read as text is a file it cannot certify, and "unscannable" must never
 * read as "clean". Adding a path here is a reviewed decision, visible in a diff.
 */
export const ALLOWED_BINARY_PATHS: readonly string[] = [];

export interface ScanReport {
  scanned: string[];
  /** Packed files that are not plain text. Never silently tolerated. */
  binary: string[];
  violations: Violation[];
  ignored: HonoredIgnore[];
  /** Org-asset classes that reached the inventory threshold. */
  inventories: OrgAssetFinding[];
}

export function scanPackedArtifact(cwd: string): ScanReport {
  const files = listPackedFiles(cwd);
  const report: ScanReport = { scanned: [], binary: [], violations: [], ignored: [], inventories: [] };
  const sightings: OrgAssetSighting[] = [];
  for (const file of files) {
    const abs = resolve(cwd, file.path);
    if (!existsSync(abs)) {
      throw new Error(`npm would pack \`${file.path}\`, but it is missing from the working tree`);
    }
    const buf = readFileSync(abs);
    report.scanned.push(file.path);

    // The PATH is content. `@hasna/identities@0.4.4` leaked a 630-file tree whose
    // directory names were the agent slugs; a variant that put the mailboxes only
    // in filenames would have been invisible to a scan of file bodies alone.
    const asPath = scanTextDetailed(file.path.replace(/[/\\]/g, " "), `${file.path} (path)`);
    report.violations.push(...asPath.violations);
    sightings.push(...asPath.sightings);

    // latin1 maps bytes 1:1, so ASCII literals are found even in a file that is
    // not valid UTF-8 — a single NUL byte can no longer hide a domain.
    const primary = scanTextDetailed(buf.toString("latin1"), file.path);
    report.violations.push(...primary.violations);
    report.ignored.push(...primary.ignored);
    sightings.push(...primary.sightings);

    if (isBinary(buf)) {
      // Also look for UTF-16 encoded literals — the other common way an ASCII
      // string hides inside binary-looking bytes.
      const wide = scanTextDetailed(buf.toString("utf16le"), file.path, "utf16le");
      report.violations.push(...wide.violations);
      sightings.push(...wide.sightings);
      if (!ALLOWED_BINARY_PATHS.includes(file.path)) report.binary.push(file.path);
    }
  }

  report.inventories = findOrgAssetInventories(sightings);

  // A guard that scans nothing must never report success: an unbuilt or
  // mis-configured package would otherwise pass silently.
  const builtJs = report.scanned.filter((p) => p.startsWith("dist/") && p.endsWith(".js"));
  if (builtJs.length === 0) {
    throw new Error(
      "no built `dist/**/*.js` files in the packed set — run `bun run build` before packing " +
        "(refusing to report a clean artifact that contains no build output)",
    );
  }
  return report;
}

// ── entry point ──────────────────────────────────────────────────────────────

/**
 * Scan a real `.tgz`, extracting it to a temp directory first.
 *
 * `scanPackedArtifact` certifies the file LIST npm reports and then reads those
 * paths off disk, which leaves a window: a file landing between the check and
 * npm's own glob ships uncertified. An adversarial review demonstrated exactly
 * that — 106 files certified, 107 shipped, the extra one full of mailboxes.
 *
 * So `postpack` runs this against the tarball npm actually produced. That is the
 * artifact, not a prediction of it. `prepack` still runs the pre-pack scan
 * because failing BEFORE a bad tarball exists is the better error.
 */
export function scanTarball(tarballPath: string): ScanReport {
  const dir = mkdtempSync(join(tmpdir(), "artifact-check-"));
  try {
    const result = spawnSync("tar", ["-xzf", resolve(tarballPath), "-C", dir], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`could not extract \`${tarballPath}\`: ${result.stderr ?? ""}`);
    }
    const root = join(dir, "package");
    if (!existsSync(root)) throw new Error(`\`${tarballPath}\` has no package/ directory`);
    const report: ScanReport = { scanned: [], binary: [], violations: [], ignored: [], inventories: [] };
    const sightings: OrgAssetSighting[] = [];
    for (const rel of walk(root)) {
      const buf = readFileSync(join(root, rel));
      report.scanned.push(rel);
      const asPath = scanTextDetailed(rel.replace(/[/\\]/g, " "), `${rel} (path)`);
      report.violations.push(...asPath.violations);
      sightings.push(...asPath.sightings);
      const primary = scanTextDetailed(buf.toString("latin1"), rel);
      report.violations.push(...primary.violations);
      report.ignored.push(...primary.ignored);
      sightings.push(...primary.sightings);
      if (isBinary(buf)) {
        const wide = scanTextDetailed(buf.toString("utf16le"), rel, "utf16le");
        report.violations.push(...wide.violations);
        sightings.push(...wide.sightings);
        if (!ALLOWED_BINARY_PATHS.includes(rel)) report.binary.push(rel);
      }
    }
    report.inventories = findOrgAssetInventories(sightings);
    if (report.scanned.length === 0) throw new Error(`\`${tarballPath}\` unpacked to nothing`);
    return report;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function walk(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(root, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** Newest `.tgz` in `cwd`, which is what `npm pack` just wrote. */
function newestTarball(cwd: string): string | null {
  const tarballs = readdirSync(cwd)
    .filter((name) => name.endsWith(".tgz"))
    .map((name) => ({ name, mtime: statSync(join(cwd, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return tarballs[0] ? join(cwd, tarballs[0].name) : null;
}

function main(): number {
  const cwd = process.cwd();
  const tarballArg = process.argv.slice(2).find((arg) => arg.endsWith(".tgz"));
  const postpack = process.argv.includes("--postpack");

  let report: ScanReport;
  try {
    if (tarballArg) {
      report = scanTarball(tarballArg);
    } else if (postpack) {
      const found = newestTarball(cwd);
      if (!found) {
        // Nothing to check is not the same as nothing wrong, but `npm publish`
        // streams without leaving a .tgz behind, so this is expected there.
        console.log("· no tarball in the working directory; nothing to re-verify after pack");
        return 0;
      }
      console.log(`· re-verifying the tarball npm actually produced: ${found}`);
      report = scanTarball(found);
    } else {
      report = scanPackedArtifact(cwd);
    }
  } catch (error) {
    console.error(`✗ artifact check could not run: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  // Suppressions print on every run, pass or fail: an ignore nobody sees is an
  // ignore that outlives its reason.
  for (const i of report.ignored) {
    console.error(`  ! ignored ${i.file}:${i.line} — ${i.reason}`);
  }

  if (report.binary.length > 0) {
    console.error(
      `✗ ${report.binary.length} packed file(s) are not plain text, so their contents cannot be ` +
        `certified:\n${report.binary.map((p) => `    ${p}`).join("\n")}\n\n` +
        "Remove them from the package, or add them to ALLOWED_BINARY_PATHS with a reason.\n" +
        "A file this guard cannot read is a file it must not call clean.",
    );
    return 1;
  }

  if (report.violations.length === 0 && report.inventories.length === 0) {
    console.log(
      `✓ packed artifact clean — ${report.scanned.length} file(s) scanned, ` +
        `${RULES.length} rules + ${ORG_ASSET_CLASSES.length} inventory classes applied` +
        `${report.ignored.length ? `, ${report.ignored.length} line(s) ignored by annotation` : ""}`,
    );
    // Advertised on every run, pass or fail. A guard whose only visible option is
    // "delete me" is a guard that gets deleted the first time it is wrong.
    console.log("  false positive? annotate the line with `artifact-check-ignore: <reason>` — never remove the guard.");
    return 0;
  }

  if (report.violations.length > 0) {
    console.error(`✗ packed artifact would disclose ${report.violations.length} item(s):\n`);
    const byFile = new Map<string, Violation[]>();
    for (const v of report.violations) {
      byFile.set(v.file, [...(byFile.get(v.file) ?? []), v]);
    }
    for (const [file, violations] of byFile) {
      console.error(`  ${file}`);
      for (const v of violations) {
        const where = v.encoding ? `line ${v.line} (${v.encoding})` : `line ${v.line}`;
        console.error(`    ${where}  [${v.ruleId}] ${v.description}: ${v.excerpt}`);
      }
      console.error("");
    }
  }

  for (const finding of report.inventories) {
    console.error(
      `✗ packed artifact enumerates ${finding.identifiers.length} distinct ` +
        `[${finding.classId}] identifiers (threshold ${ORG_ASSET_THRESHOLD}) — ${finding.description}:\n`,
    );
    for (const identifier of finding.identifiers.slice(0, 20)) {
      const where = finding.sightings.find((s) => s.identifier === identifier)!;
      console.error(`    ${identifier}  (first seen ${where.file}:${where.line})`);
    }
    if (finding.identifiers.length > 20) {
      console.error(`    … and ${finding.identifiers.length - 20} more`);
    }
    console.error("");
  }

  console.error(
    "These bytes are what npm would publish. Remove them from the SOURCE, rebuild, and re-run.\n" +
      "Configuration belongs in environment variables; real inventories belong in a data store\n" +
      "the operator loads at runtime, not in the package.\n\n" +
      "If a hit is a genuine false positive, annotate the line with\n" +
      "  artifact-check-ignore: <reason>\n" +
      "rather than removing this guard. Every annotation is printed on every run.\n" +
      "Note: an annotation must be real comment syntax, outside any string literal,\n" +
      "in a file format that has comments — it is never honoured in .json/.jsonl/.csv.\n" +
      "It also only holds for files that ship verbatim: a literal the bundler copies\n" +
      "into `dist/` reappears there without the comment and still fails.",
  );
  return 1;
}

if (import.meta.main) {
  // Recursion detection must FAIL, never pass. An earlier version exited 0 here,
  // which turned an inherited environment variable into a silent kill switch:
  // `CATALOG_PACK_GUARD_ACTIVE=1 npm publish` would have sailed through with a
  // leak in the tarball. The nested pack passes `--ignore-scripts`, so this is
  // expected to be unreachable — and if it is ever reached, that is a defect to
  // surface, not a reason to skip the scan.
  if (process.env["CATALOG_PACK_GUARD_ACTIVE"] === "1") {
    console.error(
      "✗ artifact check re-entered itself (CATALOG_PACK_GUARD_ACTIVE already set).\n" +
        "  This variable is internal and must not be set by hand.",
    );
    process.exit(2);
  }
  process.exit(main());
}
