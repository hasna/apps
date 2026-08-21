import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { scanDeploymentIdentifiers, scanPaths } from "./check-package-secrets.ts";

// Synthetic sentinels only. These are assembled from nonsense segments that
// cannot collide with any real resource, so this file never becomes the thing
// the guard exists to prevent. Every assertion below that proves the guard FIRES
// uses one of these; nothing in this file is a real identifier.
const SENTINEL_NAME = "qzsyn-prod-zzkind-wwexample";
const SENTINEL_SINGLE_COMPONENT = "qzsyn-prod-zzkind";
const SENTINEL_TEMPLATE = "qzsyn-prod-zzkind-{name}";
const SENTINEL_ARN = `arn:aws:ec2:eu-west-1:${"9".repeat(12)}:instance/x`;
const SENTINEL_RESOURCE_ID = `i-${"0".repeat(17)}`;
const SENTINEL_RDS_HOST = `qzsyn.${"a".repeat(12)}.eu-west-1.rds.amazonaws.com`;
// Synthetic token-shaped sentinels for the widened all-text rules. Assembled so
// the literal source never contains a value the guard would flag.
const SENTINEL_NPM_TOKEN = `npm_${"x".repeat(40)}`;
const SENTINEL_URL_PASSWORD = `${"y".repeat(12)}`;

const roots: string[] = [];

function makeTree(files: Record<string, string>): { dir: string; paths: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "pkg-secret-guard-"));
  roots.push(dir);
  const paths: string[] = [];
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
    paths.push(full);
  }
  return { dir, paths };
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const GUARD_SCRIPT = fileURLToPath(new URL("./check-package-secrets.ts", import.meta.url));

// A minimal git-tracked npm package, so the guard's real entrypoint can run
// end to end: it unions `git ls-files` with `npm pack --dry-run`, so a fixture
// needs both a git index and a package.json to exercise the path a publish takes.
function makeGitPackage(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "guard-fixture-"));
  roots.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "guard-fixture", version: "0.0.0", files: ["**/*"] }, null, 2)}\n`,
  );
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  execFileSync("git", ["init", "-q", "."], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
  return dir;
}

function runGuardIn(dir: string): { code: number | null; stdout: string; stderr: string } {
  const run = spawnSync("bun", [GUARD_SCRIPT], { cwd: dir, encoding: "utf-8" });
  return { code: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

const CENSUS = /(\d+) tracked \+ packed file\(s\) scanned/;

describe("deployment-identifier rules — the guard must be able to FIRE", () => {
  test("flags a convention-built resource name presented as infrastructure", () => {
    const findings = scanDeploymentIdentifiers("x.md", [`| EC2 Instance | \`${SENTINEL_NAME}\` |`]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe("deployment-resource-name");
    expect(findings[0]!.line).toBe(1);
  });

  test("flags the documented shape when the component is one segment", () => {
    const findings = scanDeploymentIdentifiers("x.md", [`| EC2 Instance | \`${SENTINEL_SINGLE_COMPONENT}\` |`]);

    expect(findings.map((f) => f.rule)).toEqual(["deployment-resource-name"]);
  });

  // BOTH ARITIES, each against a negative control that differs ONLY in the
  // resource-kind word.
  //
  // The house standard writes the pattern as `<workload>-<env>-<component>[-<role>]`
  // — the role segment is bracketed, so ONE component is the documented default
  // and two is the variant. An earlier revision of this rule required two or
  // more, which exempted the default; measured against the standard's own worked
  // examples, 9 of its 18 distinct convention-shaped names were single-component
  // and none of them matched.
  //
  // The paired negative controls are the load-bearing half. Fixing the arity gap
  // meant loosening the name shape, and the obvious way to get that wrong is to
  // let the rule decay into "any hyphenated name containing an environment-looking
  // segment" — measured at 67 matches across 30 files, overwhelmingly false, and
  // unusable. Asserting the positive alone cannot catch that decay, because a
  // rule with no second signal still passes every positive. Each control below is
  // the same line with only the resource-kind word swapped out, so the pair fails
  // if either the arity fix or the two-signal design regresses.
  test("fires on BOTH arities, and stays silent when only the kind word is removed", () => {
    const row = (kind: string, name: string) => `| ${kind} | \`${name}\` |`;

    for (const name of [SENTINEL_SINGLE_COMPONENT, SENTINEL_NAME]) {
      expect(scanDeploymentIdentifiers("x.md", [row("S3 Bucket", name)]).map((f) => f.rule)).toEqual([
        "deployment-resource-name",
      ]);
      expect(scanDeploymentIdentifiers("x.md", [row("Label", name)])).toEqual([]);
    }
  });

  test("flags the single-component form end to end, through file selection", () => {
    // Through scanPaths rather than the matcher alone, so the regression covers
    // the whole path a real publish would take — selection, read, then rule —
    // rather than only the last step of it. The bypass this closes was reachable
    // precisely because all three had to line up.
    const { paths } = makeTree({
      "README.md": `| EC2 Instance | \`${SENTINEL_SINGLE_COMPONENT}\` |`,
      "Makefile": `EC2_HOST ?= ${SENTINEL_SINGLE_COMPONENT}`,
    });

    const { findings, scanned } = scanPaths(paths);

    expect(scanned).toBe(2);
    expect(findings.map((f) => f.rule)).toEqual(["deployment-resource-name", "deployment-resource-name"]);
  });

  test("flags the naming TEMPLATE, not only concrete names", () => {
    // Publishing the pattern makes every sibling resource's name derivable, so
    // scrubbing concrete names alone would leave the disclosure intact.
    const findings = scanDeploymentIdentifiers("x.md", [`| RDS Database | \`${SENTINEL_TEMPLATE}\` |`]);

    expect(findings.map((f) => f.rule)).toEqual(["deployment-resource-name"]);
  });

  test("flags provider-assigned identifiers with no second signal needed", () => {
    expect(scanDeploymentIdentifiers("x.ts", [SENTINEL_ARN]).map((f) => f.rule)).toEqual(["cloud-resource-arn"]);
    expect(scanDeploymentIdentifiers("x.ts", [`id = "${SENTINEL_RESOURCE_ID}"`]).map((f) => f.rule)).toEqual([
      "cloud-resource-id",
    ]);
    expect(scanDeploymentIdentifiers("x.ts", [`url=${SENTINEL_RDS_HOST}`]).map((f) => f.rule)).toEqual([
      "managed-database-endpoint",
    ]);
  });

  test("reports the correct 1-based line number", () => {
    const findings = scanDeploymentIdentifiers("x.md", ["", "", `S3 Bucket: ${SENTINEL_NAME}`]);

    expect(findings[0]!.line).toBe(3);
  });
});

describe("deployment-identifier rules — the guard must be able to PASS", () => {
  test("ordinary prose does not trip it", () => {
    const prose = [
      "This connector talks to the production API.",
      "Set the host in your environment before running a live sync.",
      "Each instance of the client keeps its own cache.",
      "The database is created on first run.",
    ];

    expect(scanDeploymentIdentifiers("README.md", prose)).toEqual([]);
  });

  test("ordinary code does not trip it", () => {
    const code = [
      "const client = new Client({ baseUrl: process.env.API_URL });",
      "export type Instance = { id: string; host: string };",
      "if (env === 'production') { enableCache(); }",
      "await db.query('select 1');",
    ];

    expect(scanDeploymentIdentifiers("client.ts", code)).toEqual([]);
  });

  test("a hyphenated name alone is NOT enough — the line must also present it as infrastructure", () => {
    // This is the whole reason the rule needs two signals. Third-party ids and
    // package names routinely contain an environment-looking segment; without
    // this the guard fires on correct code and gets ignored.
    expect(scanDeploymentIdentifiers("x.ts", [`const model = "${SENTINEL_NAME}";`])).toEqual([]);
    expect(scanDeploymentIdentifiers("x.ts", [`projectId: "project-live-abcd-efgh"`])).toEqual([]);
  });

  test("an infrastructure word alone is NOT enough", () => {
    expect(scanDeploymentIdentifiers("x.md", ["| EC2 Instance | configured per deployment |"])).toEqual([]);
    expect(scanDeploymentIdentifiers("x.md", ["S3 Bucket: set via S3_BUCKET (no default)"])).toEqual([]);
  });

  test("dev/test/stage/qa are NOT environment segments", () => {
    // Measured: including them turned 19 true findings into 67 matches across 30
    // files, on a connector directory named `trigger-dev-api-platform` and on
    // API-key fixtures. A guard that fires on correct code teaches everyone to
    // dismiss it, and the dismissal carries to the hit that is real.
    for (const seg of ["dev", "test", "stage", "qa"]) {
      expect(scanDeploymentIdentifiers("x.md", [`EC2 Instance: qzsyn-${seg}-zzkind-wwexample`])).toEqual([]);
    }
  });

  test("a placeholder-shaped resource id does not trip the provider rules", () => {
    expect(scanDeploymentIdentifiers("x.md", ["instance id looks like i-0123 (short form)"])).toEqual([]);
    expect(scanDeploymentIdentifiers("x.md", ["s3://bucket/key is the generic form"])).toEqual([]);
  });
});

describe("the guard never emits what it found", () => {
  test("no finding carries the matched text", () => {
    const findings = scanDeploymentIdentifiers("x.md", [
      `| EC2 Instance | \`${SENTINEL_NAME}\` |`,
      SENTINEL_ARN,
      `host=${SENTINEL_RDS_HOST}`,
    ]);

    expect(findings.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(findings);
    for (const value of [SENTINEL_NAME, SENTINEL_ARN, SENTINEL_RDS_HOST]) {
      expect(serialised).not.toContain(value);
    }
  });
});

// These assert the guard's EMITTED TEXT, by running the real entrypoint and
// reading what it printed — not scanPaths()'s return value.
//
// That distinction is the whole point and I got it wrong once already. The
// earlier revision asserted `expect(scanned).toBe(2)` and believed the census
// was covered; deleting `(${census})` from the fail-path console.error left the
// suite fully green at 19 pass / 0 fail, because a returned number and a printed
// line are different things and only one of them is the deliverable.
//
// It matters beyond tidiness: the CI step name is identical before and after the
// scan was widened, so the file count is the ONLY observable that distinguishes
// the widened guard from the narrow one, and a release gate outside this
// repository keys on `scanned > 20000` in this output. If the number silently
// stops being printed on the fail path, that external gate reads the absence as
// a pass. So the number needs a test that fails when it goes missing.
describe("the emitted report carries the file census on BOTH paths", () => {
  test("FAIL path prints the scanned count alongside the findings", () => {
    const dir = makeGitPackage({ "README.md": `# S3 Bucket: ${SENTINEL_SINGLE_COMPONENT}` });

    const { code, stderr } = runGuardIn(dir);

    expect(code).toBe(1);
    expect(stderr).toContain("finding(s) detected");
    // The assertion that actually binds the fix: the census is in the OUTPUT.
    expect(stderr).toMatch(CENSUS);
    // And it is the real count, not a literal someone could hardcode: the
    // fixture ships exactly README.md and package.json.
    expect(Number(stderr.match(CENSUS)![1])).toBe(2);
    // The report still never echoes what it matched.
    expect(stderr).not.toContain(SENTINEL_SINGLE_COMPONENT);
  });

  test("PASS path prints the scanned count too", () => {
    const dir = makeGitPackage({ "README.md": "# nothing to see\n" });

    const { code, stdout } = runGuardIn(dir);

    expect(code).toBe(0);
    expect(stdout).toMatch(CENSUS);
    expect(Number(stdout.match(CENSUS)![1])).toBe(2);
  });
});

describe("file selection — the gate is what was actually broken", () => {
  // The original guard's pattern set was fine; its `shouldScan` opened only
  // .npmrc / bunfig / lockfile basenames, so .md, Makefile, .conf and
  // .env.example were never read at all. A test that exercised only the regexes
  // would pass while the class stayed invisible, so these assertions go through
  // scanPaths(), which does the selection and the reading.
  test("scans the extensions that the original gate excluded", () => {
    const line = `EC2 Instance: ${SENTINEL_NAME}`;
    const { paths } = makeTree({
      "README.md": line,
      "Makefile": `EC2_HOST ?= ${SENTINEL_NAME}`,
      ".env.example": `# EC2_INSTANCE=${SENTINEL_NAME}`,
      "nginx.conf": `# upstream host ${SENTINEL_NAME}`,
      "index.ts": `// s3 bucket ${SENTINEL_NAME}`,
    });

    const { findings, scanned } = scanPaths(paths);

    expect(scanned).toBe(5);
    expect(new Set(findings.map((f) => f.rule))).toEqual(new Set(["deployment-resource-name"]));
    expect(findings).toHaveLength(5);
  });

  test("a clean tree passes and reports what it read", () => {
    const { paths } = makeTree({
      "README.md": "# A connector\n\nNothing to see.\n",
      "Makefile": "build:\n\tbun run build\n",
    });

    const { findings, scanned } = scanPaths(paths);

    expect(findings).toEqual([]);
    expect(scanned).toBe(2);
  });

  test("package-manager rules still apply to package-manager files", () => {
    const { paths } = makeTree({ ".npmrc": `//registry.npmjs.org/:${"_auth" + "Token"}=literal-value-here\n` });

    expect(scanPaths(paths).findings.map((f) => f.rule)).toEqual(["npmrc-literal-auth"]);
  });

  test("a credentialed URL in a bunfig.toml is flagged (all-text rules cover config files)", () => {
    // Cycle-1 review finding: scanBunConfig used to run only token patterns,
    // so a credentialed URL inside a supported Bun config escaped the
    // all-text rule. scanLineRules now applies to every scanned text file.
    const { paths } = makeTree({
      "bunfig.toml": `minimumReleaseAge = 604800\n[install]\nregistry = "https://user:${SENTINEL_URL_PASSWORD}@registry.example.com"\n`,
    });

    const { findings, scanned } = scanPaths(paths);

    expect(scanned).toBe(1);
    expect(findings.map((f) => f.rule)).toEqual(["package-manager-url-credentials"]);
  });

  test("npmrc/bunfig do not double-report the shared line rules", () => {
    // scanNpmrc/scanBunConfig keep only their format-specific checks; the
    // token/credentialed-URL rules run exactly once via scanLineRules.
    const { paths } = makeTree({
      ".npmrc": `https://user:${SENTINEL_URL_PASSWORD}@registry.example.com\n`,
      "bunfig.toml": `minimumReleaseAge = 604800\ninstall = "https://user:${SENTINEL_URL_PASSWORD}@registry.example.com"\n`,
    });

    const { findings } = scanPaths(paths);

    expect(findings.map((f) => f.rule)).toEqual(["package-manager-url-credentials", "package-manager-url-credentials"]);
  });

  test("token-shaped values are flagged in NON-package-manager text files", () => {
    // P1 remediation: token rules used to run only on package-manager files, so
    // a leaked value sitting in a README, a source file, or a GENERATED BUNDLE
    // shipped untouched. The 1.4.1 changelog documents a real credential-adjacent
    // leak that existed only in the compiled bin/index.js.
    const { paths } = makeTree({
      "README.md": `Install with: ${SENTINEL_NPM_TOKEN}\n`,
      "dist/index.js": `const token = ${JSON.stringify(SENTINEL_NPM_TOKEN)};\n`,
    });

    const { findings, scanned } = scanPaths(paths);

    expect(scanned).toBe(2);
    expect(findings.map((f) => f.rule)).toEqual(["literal-npm-token", "literal-npm-token"]);
  });

  test("credentialed URLs are flagged in non-package-manager text files", () => {
    const { paths } = makeTree({
      "docs/install.md": `Clone via https://user:${SENTINEL_URL_PASSWORD}@example.com/repo.git\n`,
    });

    const { findings, scanned } = scanPaths(paths);

    expect(scanned).toBe(1);
    expect(findings.map((f) => f.rule)).toEqual(["package-manager-url-credentials"]);
  });

  test("ordinary prose and code stay silent under the widened rules", () => {
    const { paths } = makeTree({
      "README.md": "Install with bun install -g @hasna/connectors\n",
      "src/index.ts": "const url = process.env.API_URL ?? 'http://localhost:3000';\n",
      "dist/index.js": "var x=1;\n",
    });

    const { findings, scanned } = scanPaths(paths);

    expect(findings).toEqual([]);
    expect(scanned).toBe(3);
  });

  test("binary-by-extension files are not read", () => {
    const { paths } = makeTree({ "logo.png": `EC2 Instance: ${SENTINEL_NAME}` });

    const { findings, scanned } = scanPaths(paths);

    expect(scanned).toBe(0);
    expect(findings).toEqual([]);
  });

  test("symlinks and absent paths are skipped and counted separately", () => {
    const { dir, paths } = makeTree({ "real.md": "nothing here\n" });
    const link = join(dir, "link.md");
    symlinkSync(join(dir, "does-not-exist-target.md"), link);

    const result = scanPaths([...paths, link, join(dir, "never-created.md")]);

    expect(result.scanned).toBe(1);
    expect(result.symlinks).toBe(1);
    expect(result.absent).toBe(1);
    expect(result.findings).toEqual([]);
  });
});
