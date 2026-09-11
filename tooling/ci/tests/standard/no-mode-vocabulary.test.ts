/**
 * no-mode-vocabulary — standard-adherence suite, fleet-alignment gate.
 *
 * Rulings (d)/(e): there is no "mode". A client is hosted and fails closed;
 * a server is configured by a DSN. The vocabulary that kept a second axis
 * alive is retired from the public tree:
 *
 *   - `self_hosted` / `self-hosted` — the emails ClientMode enum and its 693
 *     descendants (T1 §3.6);
 *   - `*_STORAGE_MODE` — the storage switch env family
 *     (`HASNA_TODOS_STORAGE_MODE`, `MEMENTOS_STORAGE_MODE`, …);
 *   - `*_MODE` read from the environment as a store/transport switch
 *     (`TODOS_MODE`, `EMAILS_MODE`, `APP_MODE`, `CLOUD_MODE`, …). Only lines
 *     that READ the variable are matched (`process.env.X_MODE`, `env.X_MODE`,
 *     `env["X_MODE"]`, `Bun.env.X_MODE`, `getEnv("X_MODE")`), so a UI colour
 *     mode or a test-only toggle is not confused with a storage switch; the
 *     non-storage suffixes below are excluded outright.
 *   - `fleet-env`, `fleet.env`, `.hasna/cloud` — the retired credential
 *     locations. A comment saying "never read" is skipped for this pattern
 *     (the resolver documents what it refuses); code, strings, manifests and
 *     docs are not.
 *
 * Skipped by shape: test material and CHANGELOGs (fleet-scan.ts). Comment
 * hits on the vocabulary patterns are reported with `(comment)`.
 *
 * MODE: report-only at landing (GATE_MODES in gate-mode.ts). Owners: emails
 * (mode.ts, emails-credentials.ts, storage-backend.ts), todos, mementos,
 * hooks, logs, contacts, attachments, economy per T1 §3.6; docs/env-var-naming.md
 * still lists `_MODE` names as canonical and must change with them.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { APPS_DIR } from "./census";
import { assertGate } from "./gate-mode";
import { grepFile, memberDirsIn, memberScanFiles, type LineHit } from "./fleet-scan";

export const GATE = "no-mode-vocabulary";

const NON_STORAGE_MODE_SUFFIX = /_(?:TEST|DEV|DEBUG|PROCESSING|POST_PROCESSING|COLOR|COLOUR|OUTPUT|UI|CI|LOG|RENDER|DISPLAY|EDITOR|VIM|STRICT|DRY_RUN|VERBOSE|QUIET|INTERACTIVE|SAFE|FAST|SLOW|PERF|BATCH|STREAM|COMPAT|LEGACY_TEST)_MODE\b/;
const ENV_READ = /(?:process\.env|Bun\.env|\benv)\s*(?:\.|\[\s*["'`])\s*(?:HASNA_)?[A-Z][A-Z0-9_]*_MODE\b|\b(?:getEnv|readEnv|envString|envValue|requireEnv|optionalEnv|env)\(\s*["'`](?:HASNA_)?[A-Z][A-Z0-9_]*_MODE["'`]/;

export const PATTERNS: Array<{ name: string; re: RegExp; skipComments?: boolean; envReadOnly?: boolean }> = [
  { name: "self-hosted-vocabulary", re: /\bself[_-]hosted\b/i },
  { name: "storage-mode-env", re: /\b[A-Z][A-Z0-9_]*_STORAGE_MODE\b/ },
  { name: "mode-switch-env-read", re: ENV_READ, envReadOnly: true, skipComments: true },
  { name: "retired-credential-location", re: /fleet-env\b|fleet\.env\b|\.hasna\/cloud\b|\bhasna\/cloud\//, skipComments: true },
];

/**
 * A docs/manifest line that NEGATES the vocabulary ("nothing reads
 * ~/.hasna/fleet-env", "HASNA_X_STORAGE_MODE no longer selects a backend") is
 * the documentation of a refusal, not a live use. Only docs-scope lines are
 * eligible, and only for the two location/switch patterns; code is never
 * excused this way.
 */
const NEGATED_DOC_LINE = /\b(?:never|nothing reads|not read|no longer|retired|deprecated|removed|refus|is an error|ignored|not consulted|forbid)/i;
const NEGATION_ELIGIBLE = new Set(["retired-credential-location", "storage-mode-env"]);

export const ALLOWLIST: Array<{ member: string; path: RegExp; pattern: string; reason: string }> = [
  // The connector catalog tags third-party products with the vendor's own
  // vocabulary ("self-hosted" GitLab, Gotify, …); the tag describes the
  // vendor's deployment model, not a Hasna client mode.
  { member: "connectors", path: /^src\/lib\/connectors\/[a-z0-9-]+\.ts$/, pattern: "self-hosted-vocabulary", reason: "vendor catalog tags describing third-party products" },
];

export interface VocabularyViolation {
  member: string;
  pattern: string;
  hit: LineHit;
}

export function modeVocabularyViolations(appsDir: string = APPS_DIR): VocabularyViolation[] {
  const out: VocabularyViolation[] = [];
  for (const { name, dir } of memberDirsIn(appsDir)) {
    for (const file of memberScanFiles(dir)) {
      for (const p of PATTERNS) {
        for (const hit of grepFile(file, p.re)) {
          if (p.skipComments && hit.comment) continue;
          if (p.envReadOnly && NON_STORAGE_MODE_SUFFIX.test(hit.text)) continue;
          if (NEGATION_ELIGIBLE.has(p.name) && file.scope === "docs" && NEGATED_DOC_LINE.test(hit.text)) continue;
          // A *_STORAGE_MODE read is already reported by storage-mode-env.
          if (p.envReadOnly && /_STORAGE_MODE\b/.test(hit.text)) continue;
          if (ALLOWLIST.some((a) => a.member === name && a.pattern === p.name && a.path.test(hit.relative))) continue;
          out.push({ member: name, pattern: p.name, hit });
        }
      }
    }
  }
  return out;
}

export function formatViolation(v: VocabularyViolation): string {
  return `${v.member}: ${v.hit.relative}:${v.hit.line}: ${v.pattern}${v.hit.comment ? " (comment)" : ""}: ${v.hit.text}`;
}

describe("standard-adherence: no mode vocabulary (rulings d, e)", () => {
  test("no member spells self_hosted, *_STORAGE_MODE, a *_MODE env switch, fleet-env/fleet.env or .hasna/cloud", () => {
    const violations = modeVocabularyViolations();
    const perMember = new Map<string, number>();
    for (const v of violations) perMember.set(v.member, (perMember.get(v.member) ?? 0) + 1);
    const perPattern = new Map<string, number>();
    for (const v of violations) perPattern.set(v.pattern, (perPattern.get(v.pattern) ?? 0) + 1);
    console.info(
      `[${GATE}] census: ${violations.length} hit(s) across ${perMember.size} member(s): ${[...perMember.entries()].map(([m, n]) => `${m}=${n}`).join(" ")} | by pattern: ${[...perPattern.entries()].map(([m, n]) => `${m}=${n}`).join(" ")}`,
    );
    // Report the per-member/pattern census in full but cap the line list so
    // the CI log stays readable while emails carries hundreds of hits.
    const lines = violations.map(formatViolation);
    const shown = lines.length > 400 ? [...lines.slice(0, 400), `… ${lines.length - 400} more (see the census line)`] : lines;
    assertGate(GATE, shown, "delete the mode axis: clients fail closed, servers take a DSN; rename *_MODE storage switches away and drop the retired locations");
  }, 120_000);

  test("allowlist hygiene: every entry still matches something (no rot)", () => {
    const stale = ALLOWLIST.filter((a) => {
      const dir = path.join(APPS_DIR, a.member);
      if (!fs.existsSync(dir)) return true;
      const p = PATTERNS.find((x) => x.name === a.pattern);
      if (!p) return true;
      return !memberScanFiles(dir).some((f) => a.path.test(f.relative) && grepFile(f, p.re).length > 0);
    });
    expect(stale.map((a) => `${a.member} ${a.path} ${a.pattern}`), "stale ALLOWLIST entries — delete them").toEqual([]);
  });

  test("self-test: fires on each planted vocabulary form; stays silent on the fail-closed shape, a UI mode and test material", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "no-mode-vocabulary-self-test-"));
    try {
      const apps = path.join(root, "apps");
      const bad = path.join(apps, "bad");
      fs.mkdirSync(path.join(bad, "src"), { recursive: true });
      fs.writeFileSync(path.join(bad, "package.json"), JSON.stringify({ name: "@hasna/bad" }));
      fs.writeFileSync(
        path.join(bad, "src", "mode.ts"),
        [
          'export type ClientMode = "self_hosted" | "cloud";',
          'const storage = process.env.HASNA_BAD_STORAGE_MODE ?? "sqlite";',
          'const mode = Bun.env.BAD_MODE;',
          'const legacy = env["HASNA_BAD_MODE"];',
          'const file = join(home, ".hasna/cloud/bad.env");',
          '// never read fleet-env here (allowed as a comment)',
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(bad, "README.md"),
        "Set `BAD_MODE=self-hosted` to run against `~/.hasna/fleet-env/bad.env`.\n\nNothing reads `~/.hasna/fleet-env` any more (negated: silent).\n",
      );

      const good = path.join(apps, "good");
      fs.mkdirSync(path.join(good, "src"), { recursive: true });
      fs.writeFileSync(path.join(good, "package.json"), JSON.stringify({ name: "@hasna/good" }));
      fs.writeFileSync(
        path.join(good, "src", "client.ts"),
        [
          'const color = process.env.GOOD_COLOR_MODE ?? "auto";',
          'const testing = env.GOOD_TEST_MODE === "1";',
          'const transport = resolveClientTransport("good"); // fails closed without a credential',
          'const MODE_LABEL = "hosted"; // a constant named *_MODE is not an env read',
        ].join("\n"),
      );
      fs.writeFileSync(path.join(good, "src", "client.test.ts"), 'process.env.GOOD_STORAGE_MODE = "self_hosted";\n');
      fs.writeFileSync(path.join(good, "CHANGELOG.md"), "- removed GOOD_STORAGE_MODE and the self-hosted mode\n");

      const v = modeVocabularyViolations(apps);
      const badByPattern = new Map<string, number>();
      for (const x of v.filter((y) => y.member === "bad")) badByPattern.set(x.pattern, (badByPattern.get(x.pattern) ?? 0) + 1);
      expect(badByPattern.get("self-hosted-vocabulary")).toBe(2); // mode.ts + README
      expect(badByPattern.get("storage-mode-env")).toBe(1);
      expect(badByPattern.get("mode-switch-env-read")).toBe(2); // Bun.env.BAD_MODE + env["HASNA_BAD_MODE"]
      expect(badByPattern.get("retired-credential-location")).toBe(2); // .hasna/cloud in code + fleet-env in README (comment skipped)
      expect(v.filter((x) => x.member === "good").map(formatViolation)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
