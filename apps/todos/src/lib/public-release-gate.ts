export type PackageJson = {
  name?: string;
  version?: string;
  license?: string;
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  files?: string[];
  workspaces?: string[];
  packageManager?: string;
  scripts?: Record<string, string>;
  publishConfig?: {
    registry?: string;
    access?: string;
  };
  repository?: {
    type?: string;
    url?: string;
    directory?: string;
  };
  homepage?: string;
  bugs?: {
    url?: string;
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  gitHead?: string;
};

export type TextFile = {
  path: string;
  text: string;
};

export type ReleaseGateFailure = {
  check: string;
  message: string;
};

export type ReleaseProvenance = {
  packageName?: string;
  packageVersion?: string;
  repository?: string;
  gitCommit?: string;
  gitTree?: string;
  sourceTreeSha256?: string;
  generatedAt?: string;
};

export type ReleaseSourceIdentity = {
  gitCommit: string;
  gitTree: string;
  sourceTreeSha256: string;
};

export type ReleaseGateAuthority = {
  mode: "review" | "publish" | null;
  authoritative: boolean;
  expectedCommit: string | undefined;
  skipped: string[];
};

export type TrackedWorktreeProof = {
  path: string;
  headType: string;
  headMode: string;
  headObject: string;
  actualType: "blob" | "symlink" | "missing" | "other";
  actualMode: string | null;
  actualObject: string | null;
};

export type InstallSmokeCommand = {
  command: string;
  args: string[];
  required?: boolean;
};

const PACKAGE_NAME = "@hasna/todos";
const REPOSITORY_URL = "https://github.com/hasna/todos.git";
const HOMEPAGE_URL = "https://github.com/hasna/todos";
const ISSUES_URL = "https://github.com/hasna/todos/issues";

const FORBIDDEN_DEPENDENCY_PARTS = [
  "aws",
  "cloudflare",
  "stripe",
  "cerebras",
  `hasna${"studio"}`,
  `platform${"-"}todos`,
];

const LEGACY_CLOUD_PACKAGE = `@hasna/${"cloud"}`;
const LEGACY_OPEN_CLOUD = `${"open"}-${"cloud"}`;
const LEGACY_CLOUD_MCP = `${"cloud"}-${"mcp"}`;
const LEGACY_REGISTER_CLOUD_TOOLS = `register${"Cloud"}Tools`;
const LEGACY_REGISTER_CLOUD_COMMANDS = `register${"Cloud"}Commands`;
const LEGACY_SHARED_ENV_PREFIX = `HASNA_${"CLOUD"}`;
const LEGACY_RDS_ENV_NAME = `HASNA_${"RDS"}_PASSWORD`;
const LEGACY_CLOUD_FLAG = `--${"cloud"}`;

const FORBIDDEN_TEXT_PATTERNS: RegExp[] = [
  new RegExp(`github\\.com/hasna/${"open"}-todos`, "i"),
  wordPattern(`${"open"}-todos`),
  /npm install -g @hasna\/todos/i,
  /npm install @hasna\/todos-sdk/i,
  /bun add -g @hasna\/todos/i,
  /https:\/\/api\.cerebras\.ai/i,
  /\bCEREBRAS_API_KEY\b/,
  /\bTODOS_API_URL\b/,
  /\bTODOS_MODE\b/,
  /\bAWS_[A-Z0-9_]+\b/,
  /\bCLOUDFLARE_[A-Z0-9_]+\b/,
  /\bSTRIPE_[A-Z0-9_]+\b/,
  new RegExp(escapeRegExp(LEGACY_CLOUD_PACKAGE), "i"),
  wordPattern(LEGACY_OPEN_CLOUD),
  wordPattern(LEGACY_CLOUD_MCP),
  wordPattern(LEGACY_REGISTER_CLOUD_TOOLS),
  wordPattern(LEGACY_REGISTER_CLOUD_COMMANDS),
  new RegExp(`\\b${escapeRegExp(LEGACY_SHARED_ENV_PREFIX)}[_A-Z0-9]*\\b`),
  wordPattern(LEGACY_RDS_ENV_NAME),
  new RegExp(`${escapeRegExp(LEGACY_CLOUD_FLAG)}\\b`),
  /\bcloud[- ]sync\b/i,
  new RegExp(`hasna${"studio"}`, "i"),
  new RegExp(`platform${"-"}todos`, "i"),
];

/**
 * Narrow, named exemptions from {@link FORBIDDEN_TEXT_PATTERNS}. Each entry names ONE
 * module, ONE pattern, and — load-bearing, added after PR #161's own review — ONE
 * `occurrence` regex naming the EXACT known-safe substring the match is expected to come
 * from. Never widen a pattern or an occurrence to make a file pass; add a line here (with
 * a real occurrence) or fix the file.
 *
 * WHY `occurrence` EXISTS AND MUST NEVER BE DROPPED (measured, not theoretical — reviewer
 * `pr161-reviewer`, PR #161 NO_GO comment 5155307992, 2026-08-02): an exemption keyed only
 * on (module, pattern) exempts the PATTERN IN THAT FILE, full stop — not just the one known
 * literal. Constructed proof: with only a (module, pattern) key, a real
 * `require("@hasna/cloud")` planted in the *same* file as the inert contracts literal
 * produced ZERO `public-text-boundary` failures, and a genuine `open-cloud` import ALONE
 * (no contracts literal present at all) also passed silently. `dist/server/index.js` is
 * exactly the wrong file to have that hole in: `bun build src/server/index.ts` carries no
 * `--external` flags at all, so it inlines the entire `@hasna/contracts` dependency graph —
 * a future contracts release shipping real code touching either runtime would land right
 * there and pass unnoticed.
 *
 * So `validatePublicTextSurfaces` does not skip a matching pattern outright for an exempt
 * module. It strips every occurrence of `exemption.occurrence` from the file's text first,
 * THEN re-tests the pattern against what remains. The known-inert literal disappears and
 * the file passes; anything else that also matches the forbidden pattern — a real import, a
 * different reference, the pattern appearing without the safe context — survives the strip
 * and still fails. An exemption with no real occurrence to strip therefore protects nothing
 * and must not be added; the occurrence is the safety property, not an implementation detail.
 *
 * This mirrors, for the published artifacts, the exemption `src/no-cloud-boundary.test.ts`
 * already carries for the corresponding source file. The boundary is enforced at two
 * points — that test and this release gate — and an exemption applied to only one of them
 * produces a module that builds, typechecks, tests and merges but can never be published.
 */
const FORBIDDEN_SHARED_CLOUD_RUNTIMES_LITERAL =
  /\[\s*"@hasna\/cloud"\s*,\s*"open-cloud"\s*\]/g;

// Built the same split-string way as LEGACY_CLOUD_PACKAGE etc. above. This file's own
// legacy-alias regex in FORBIDDEN_TEXT_PATTERNS dodges its sibling source-level scan
// (src/no-cloud-boundary.test.ts) only because a `\b` escape sequence happens to sit
// immediately in front of it in that one spelling — an accident of that exact literal, not a
// rule to depend on again. Any other spelling of the same variable name in this file — quoted,
// with nothing word-shaped in front of it — is a genuine boundary match and trips that scan.
// Splitting the string here, the same way the constants above split theirs, avoids relying on
// the accident twice.
const LEGACY_TODOS_API_URL = `TODOS${"_API_URL"}`;
const LEGACY_TODOS_MODE = `TODOS${"_MODE"}`;
const LEGACY_TODOS_STORAGE_MODE = `TODOS${"_STORAGE_MODE"}`;

// The test-isolation scrub list (REMOVED_TODOS_ENV_KEYS in src/testing.ts) is
// the only surviving surface that names the retired storage-mode keys: it must
// NAME them in order to delete them from a test environment. Its emitted tail
// spells the sibling-key pair either multi-line (built .js) or single-line
// (declaration .d.ts), so one occurrence regex matches both emits and nothing
// else: a live bracket-indexed read of the bare mode key is not preceded by
// the sibling key, so it survives the strip and still fails the boundary.
const LEGACY_STORAGE_MODE_RATCHET_TAIL = new RegExp(
  `"${escapeRegExp(LEGACY_TODOS_STORAGE_MODE)}",\\s*"${escapeRegExp(LEGACY_TODOS_MODE)}"`,
  "g",
);

// The admitted-local redaction blanks the unprefixed alias by assignment. The
// occurrence is the exact assignment shape emitted by stage-a; a read of the
// same variable is not followed by an assignment to an empty string and still
// fails.
const LEGACY_TODOS_API_URL_SCRUB = new RegExp(`env\\.${escapeRegExp(LEGACY_TODOS_API_URL)} = ""`, "g");

// The retirement note in the cutover runbook quotes the backticked bare alias
// inside a sentence naming the retired pair; the occurrence is the backticked
// token plus the sentence tail, so a bare mention elsewhere in the file is not
// stripped.
const RUNBOOK_RETIREMENT_NOTE = new RegExp(`\`${escapeRegExp(LEGACY_TODOS_MODE)}\`\\) are RETIRED`, "g");

/**
 * Keyword-assignment secret shapes. Declared ABOVE TEXT_BOUNDARY_EXEMPTIONS on
 * purpose: the exemptions array references SECRET_PATTERNS[3] for the
 * contracts-sentinel exemption, and a reference below the declaration would
 * hit the temporal dead zone at module evaluation (the same ReferenceError
 * class #103 shipped once — a later const referenced at import time).
 */
const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/,
  /ASIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  /\b[A-Za-z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_]*\s*=\s*['"][^'"\r\n]{12,}/,
];

const TEXT_BOUNDARY_EXEMPTIONS: { module: string; pattern: RegExp; occurrence: RegExp; reason: string }[] = [
  {
    module: "dist/testing",
    pattern: /\bTODOS_API_URL\b/,
    occurrence: new RegExp(`"${escapeRegExp(LEGACY_TODOS_API_URL)}"`, "g"),
    reason:
      "the test-store scrub list must NAME the legacy unprefixed hosted-routing aliases in " +
      "order to blank them, and those aliases are live — src/lib/config.ts, src/server/serve.ts, " +
      "src/server/cloud.ts and the SDK client all still read the unprefixed forms. This module " +
      "exists to keep consumer tests OFF a hosted store, never to reach one. Scoped to the " +
      "quoted scrub-list entry only: an unquoted, live reference to that same variable name " +
      "read straight off the environment elsewhere in this file is not this literal and " +
      "would still fail the boundary.",
  },
  {
    module: "dist/server/index",
    pattern: new RegExp(escapeRegExp(LEGACY_CLOUD_PACKAGE), "i"),
    occurrence: FORBIDDEN_SHARED_CLOUD_RUNTIMES_LITERAL,
    reason:
      "@hasna/contracts@0.5.2 ships FORBIDDEN_SHARED_CLOUD_RUNTIMES = [\"@hasna/cloud\", \"open-cloud\"] " +
      "as validator schema data — it NAMES the runtimes a manifest must not depend on, it does not " +
      "depend on them. Only the server build target skips `--external '@hasna/contracts'`, so that " +
      "literal array is inlined here and only here (measured: exactly this array literal, twice, at " +
      "dist/server/index.js — once as FORBIDDEN_SHARED_CLOUD_RUNTIMES and once as its bundler-renamed " +
      "duplicate FORBIDDEN_SHARED_CLOUD_RUNTIMES2). The occurrence regex strips only that exact " +
      "bracketed pair, so a real `require(\"@hasna/cloud\")` or a bare `open-cloud` reference " +
      "anywhere in this file — including alongside the literal — still fails.",
  },
  {
    module: "dist/server/index",
    pattern: wordPattern(LEGACY_OPEN_CLOUD),
    occurrence: FORBIDDEN_SHARED_CLOUD_RUNTIMES_LITERAL,
    reason:
      "the other half of the same FORBIDDEN_SHARED_CLOUD_RUNTIMES literal — see the @hasna/cloud " +
      "exemption immediately above for the full explanation and the same occurrence scoping.",
  },
  // —————— retired storage-mode vocabulary (PR #171) ——————
  // PR #171 removed the storage-mode env selection axis. Two surfaces must still name
  // the retired keys: the test-isolation scrub list (which deletes them from test
  // environments) and the cutover runbook (which documents the retirement). The
  // admitted-local redaction blanks the unprefixed API-url alias. Those names are
  // deprecation vocabulary, not live reads — every one of the exemptions below strips
  // only the exact emitted array-tail or assignment shape, so any OTHER spelling (a
  // bracket-indexed read, a bare token in a different context, a new env var) survives
  // the strip and still fails the boundary.
  {
    module: "dist/cli/index",
    pattern: /\bTODOS_API_URL\b/,
    occurrence: LEGACY_TODOS_API_URL_SCRUB,
    reason:
      "the admitted-local redaction must NAME the unprefixed alias in order to blank it " +
      "(src/cli/stage-a.ts); it neutralizes hosted routing, it does not reach it. Scoped to " +
      "the exact emitted assignment shape: a read of the same variable is not followed by an " +
      "empty-string assignment and would still fail.",
  },
  {
    module: "dist/testing",
    pattern: /\bTODOS_MODE\b/,
    occurrence: LEGACY_STORAGE_MODE_RATCHET_TAIL,
    reason:
      "the test-isolation module ships the retired storage-mode key list it exists to delete, " +
      "and must NAME them to do so. Scoped to the quoted array-tail pair only — mirrors the " +
      "existing API-alias exemption this module already carries for the same reason.",
  },
  {
    module: "docs/CUTOVER-RUNBOOK.md",
    pattern: /\bTODOS_MODE\b/,
    occurrence: RUNBOOK_RETIREMENT_NOTE,
    reason:
      "the cutover runbook documents the storage-mode retirement and must NAME the retired " +
      "variables to tell operators to delete them. Scoped to the backticked token inside the " +
      "retirement sentence: a bare mention elsewhere in the file is not stripped and still " +
      "fails.",
  },
  // —————— known-safe contracts sentinel in the server bundle (release-review P1, 2026-08-22) ——————
  // `bun build src/server/index.ts` is the one todos build target that carries NO
  // --external flags, so it inlines the entire @hasna/contracts dependency graph.
  // contracts/src/auth/store.ts exports API_KEY_ISSUANCE_PENDING_REASON =
  // "credential_delivery_pending" — a known-safe issuance-state constant, not a
  // credential — and its assignment shape (KEYWORD-name = quoted-12+-chars) is
  // indistinguishable from SECRET_PATTERNS[3]'s keyword-assignment detector. This
  // exemption strips ONLY that exact known-safe assignment from the built server
  // bundle, then re-tests the pattern against what remains; a real secret-shaped
  // assignment anywhere in the same file — a different name, a different value, a
  // second occurrence — survives the strip and still fails the scan. The same
  // literal in any other module is not exempted.
  {
    module: "dist/server/index",
    pattern: SECRET_PATTERNS[3],
    occurrence: /\bAPI_KEY_ISSUANCE_PENDING_REASON\s*=\s*"credential_delivery_pending"/g,
    reason:
      "the @hasna/contracts issuance-state sentinel (contracts/src/auth/store.ts) is inlined " +
      "into the server bundle by the no-external build target and matches the keyword-assignment " +
      "secret detector by shape while carrying no credential. The occurrence regex names the " +
      "exact known-safe assignment emit, so a real `*_SECRET/TOKEN/PASSWORD/API_KEY = \"…12+…\"` " +
      "anywhere in this file — including alongside the sentinel — still fails the scan.",
  },
];

/**
 * Returns `file.text` with every exempt, known-safe occurrence for this (path, pattern)
 * removed. If the pattern still matches what remains, the match is NOT exempt — it came
 * from somewhere other than the named literal, and `validatePublicTextSurfaces` must
 * report it. A file with no matching exemption gets its text back unchanged.
 */
function stripExemptOccurrences(path: string, pattern: RegExp, text: string): string {
  // Match on the module path so the packed form ("package/dist/testing.js") and the built
  // form ("dist/testing.d.ts") resolve to the same entry, without letting a substring like
  // "dist/testing-helpers.js" inherit the exemption.
  const modulePath = /^(?:package\/)?(.+?)(?:\.d)?\.[cm]?[jt]s$/.exec(path)?.[1]
    // Non-js surfaces (docs/*.md etc.) resolve to their exact path so an exemption can
    // name one file and only that file — never a sibling or a directory.
    ?? path.replace(/^package\//, "");
  let stripped = text;
  for (const exemption of TEXT_BOUNDARY_EXEMPTIONS) {
    if (exemption.pattern.source !== pattern.source || exemption.module !== modulePath) continue;
    stripped = stripped.replace(exemption.occurrence, "");
  }
  return stripped;
}

const INSTALL_SMOKE_COMMANDS: InstallSmokeCommand[] = [
  { command: "bun", args: ["add", "--cwd", "<install-root>", "<tarball>", "--minimum-release-age=0"] },
  { command: "bash", args: ["-lc", "test -x <install-root>/node_modules/.bin/todos && test -x <install-root>/node_modules/.bin/todos-mcp && test -x <install-root>/node_modules/.bin/todos-serve"] },
  { command: "<install-root>/node_modules/.bin/todos", args: ["--version"] },
  { command: "<install-root>/node_modules/.bin/todos", args: ["--help"] },
  { command: "<install-root>/node_modules/.bin/todos-mcp", args: ["--help"] },
  { command: "<install-root>/node_modules/.bin/todos-serve", args: ["--port=<port>", "--host", "127.0.0.1", "--no-open"] },
];

export function validateRootPackageMetadata(packageJson: PackageJson): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  addIf(failures, packageJson.name !== PACKAGE_NAME, "package-name", `package name must be ${PACKAGE_NAME}`);
  addIf(failures, !isSemver(packageJson.version), "package-version", "package version must be a valid semver version");
  addIf(failures, packageJson.license !== "Apache-2.0", "package-license", "package license must be Apache-2.0");
  addIf(failures, packageJson.main !== "dist/index.js", "package-main", "main must point at dist/index.js");
  addIf(failures, packageJson.types !== "dist/index.d.ts", "package-types", "types must point at dist/index.d.ts");
  addIf(
    failures,
    packageJson.publishConfig?.registry !== "https://registry.npmjs.org",
    "publish-registry",
    "publishConfig.registry must be the public npm registry",
  );
  addIf(
    failures,
    packageJson.publishConfig?.access !== "public",
    "publish-access",
    "publishConfig.access must be public",
  );
  addIf(
    failures,
    packageJson.repository?.url !== REPOSITORY_URL,
    "repository-url",
    `repository.url must be ${REPOSITORY_URL}`,
  );
  addIf(failures, packageJson.homepage !== HOMEPAGE_URL, "homepage", `homepage must be ${HOMEPAGE_URL}`);
  addIf(failures, packageJson.bugs?.url !== ISSUES_URL, "bugs-url", `bugs.url must be ${ISSUES_URL}`);

  const bin = packageJson.bin ?? {};
  addIf(failures, bin.todos !== "dist/cli/index.js", "bin-todos", "todos bin must resolve to dist/cli/index.js");
  addIf(failures, bin["todos-mcp"] !== "dist/mcp/index.js", "bin-mcp", "todos-mcp bin must resolve to dist/mcp/index.js");
  addIf(failures, bin["todos-serve"] !== "dist/server/index.js", "bin-serve", "todos-serve bin must resolve to dist/server/index.js");
  addIf(failures, Object.hasOwn(bin, "todos-remote"), "bin-remote", "package must not expose a hosted remote CLI bin");
  addIf(failures, Object.hasOwn(packageJson.exports ?? {}, "./remote"), "export-remote", "package must not export hosted remote code");

  const files = packageJson.files ?? [];
  for (const required of ["dist", "LICENSE", "README.md"]) {
    addIf(failures, !files.includes(required), "package-files", `files must include ${required}`);
  }
  const allowedFiles = ["dist", "postinstall.js", "LICENSE", "README.md"];
  for (const file of files) {
    addIf(failures, !allowedFiles.includes(file), "package-files-extra", `files must not include unbuilt or unreviewed path ${file}`);
  }
  addIf(failures, packageJson.packageManager !== "bun@1.3.14", "package-manager", "packageManager must pin bun@1.3.14");
  failures.push(...validatePackLifecycleScripts(packageJson));

  for (const name of Object.keys(packageJson.dependencies ?? {})) {
    const lower = name.toLowerCase();
    const forbidden = FORBIDDEN_DEPENDENCY_PARTS.find((part) => lower.includes(part));
    addIf(failures, Boolean(forbidden), "dependency-boundary", `dependency ${name} looks cloud/private (${forbidden})`);
  }

  return failures;
}

export function validateBunReleaseToolchain(actualVersion: string | undefined): ReleaseGateFailure[] {
  return actualVersion === "1.3.14" ? [] : [{
    check: "release-bun-version",
    message: `release verification requires Bun 1.3.14, received ${actualVersion ?? "unknown"}`,
  }];
}

export function validateSdkPackageMetadata(packageJson: PackageJson): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  addIf(failures, packageJson.name !== "@hasna/todos-sdk", "sdk-name", "SDK package name must be @hasna/todos-sdk");
  addIf(failures, packageJson.publishConfig?.access !== "public", "sdk-publish-access", "SDK publishConfig.access must be public");
  addIf(failures, packageJson.repository?.url !== REPOSITORY_URL, "sdk-repository-url", `SDK repository.url must be ${REPOSITORY_URL}`);
  addIf(failures, packageJson.homepage !== HOMEPAGE_URL, "sdk-homepage", `SDK homepage must be ${HOMEPAGE_URL}`);
  addIf(failures, packageJson.bugs?.url !== ISSUES_URL, "sdk-bugs-url", `SDK bugs.url must be ${ISSUES_URL}`);
  return failures;
}

export function validatePublicTextSurfaces(files: TextFile[]): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  for (const file of files) {
    for (const pattern of FORBIDDEN_TEXT_PATTERNS) {
      const textAfterExemptions = stripExemptOccurrences(file.path, pattern, file.text);
      addIf(failures, pattern.test(textAfterExemptions), "public-text-boundary", `${file.path} matches forbidden pattern ${pattern}`);
    }
    for (const pattern of SECRET_PATTERNS) {
      const textAfterExemptions = stripExemptOccurrences(file.path, pattern, file.text);
      addIf(failures, pattern.test(textAfterExemptions), "secret-scan", `${file.path} looks like it contains a secret`);
    }
  }

  const readme = findRootReadme(files);
  if (!readme) {
    failures.push({
      check: "readme-install",
      message: `no root README.md was collected, so ${README_INSTALL_COMMAND} could not be checked`
        + ` (surfaces seen: ${files.length === 0 ? "none" : files.map((file) => file.path).join(", ")})`,
    });
  } else {
    addIf(
      failures,
      !readme.text.includes(README_INSTALL_COMMAND),
      "readme-install",
      `${readme.path} must document ${README_INSTALL_COMMAND}`,
    );
  }

  return failures;
}

const README_INSTALL_COMMAND = "bun install -g @hasna/todos";

/**
 * Select the ROOT README, and only the root README.
 *
 * The previous selector was `path === "README.md" || path.endsWith("/README.md")`,
 * which also matched `sdk/README.md`. `Array.prototype.find` returns the FIRST
 * match, and the source-tree collector in scripts/verify-public-release.ts builds
 * its list from `readdirSync`, whose order is unsorted filesystem order rather
 * than alphabetical. So which README the install check read depended on the
 * filesystem: on a checkout that enumerated `README.md` before `sdk/`, the gate
 * read the right file and passed; on one that enumerated `sdk/` first, it read
 * `sdk/README.md` — which documents `bun add @hasna/todos-sdk`, exactly as it
 * should — and failed while naming README.md in the message. That is how
 * @hasna/todos@0.15.0 failed this gate against a README that contains the
 * required line twice.
 *
 * Matching is anchored instead of suffixed, and tolerates the single `package/`
 * prefix that scanExtractedPackedFiles puts on entries from an extracted
 * tarball, so both callers select the same file regardless of enumeration order.
 */
function findRootReadme(files: TextFile[]): TextFile | undefined {
  return files.find((file) => file.path.replaceAll("\\", "/").replace(/^package\//, "") === "README.md");
}

export function isPublicReleaseTextSurface(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("docs/")) return true;
  return new Set([
    "README.md",
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "package.json",
    "sdk/README.md",
    "sdk/package.json",
  ]).has(normalized);
}

function collectPackageTargets(value: unknown, targets: Set<string>): void {
  if (typeof value === "string") {
    if (!value.startsWith("#") && !value.includes("*")) targets.add(value.replace(/^\.\//, ""));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPackageTargets(item, targets);
    return;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) collectPackageTargets(nested, targets);
  }
}

export function derivePackedPackageTargets(packageJson: PackageJson): string[] {
  const targets = new Set<string>();
  collectPackageTargets(packageJson.main, targets);
  collectPackageTargets(packageJson.types, targets);
  collectPackageTargets(packageJson.bin, targets);
  collectPackageTargets(packageJson.exports, targets);
  return [...targets].filter(Boolean).sort().map((target) => `package/${target}`);
}

export function validatePackedPackageFiles(paths: string[], packageJson?: PackageJson): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  const requiredPaths = new Set([
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/dist/cli/index.js",
    "package/dist/mcp/index.js",
    "package/dist/server/index.js",
    "package/dist/release-provenance.json",
  ]);
  if (packageJson) {
    for (const target of derivePackedPackageTargets(packageJson)) requiredPaths.add(target);
    for (const entry of packageJson.files ?? []) {
      const packedEntry = `package/${entry.replace(/^\.\//, "").replace(/\/$/, "")}`;
      const contributes = paths.some((path) => path === packedEntry || path.startsWith(`${packedEntry}/`));
      addIf(failures, !contributes, "package-files-empty", `package files entry ${entry} contributes no packed path`);
    }
  }
  for (const required of [...requiredPaths].sort()) {
    addIf(failures, !paths.includes(required), "pack-contents", `packed package must include ${required}`);
  }

  for (const path of paths) {
    addIf(failures, path.startsWith("package/src/"), "pack-source", `packed package must not include source file ${path}`);
    addIf(failures, path.startsWith("package/.github/"), "pack-github", `packed package must not include GitHub config ${path}`);
    addIf(failures, path.includes(".env"), "pack-env", `packed package must not include env file ${path}`);
    addIf(failures, path.includes(".secrets"), "pack-secrets", `packed package must not include secrets path ${path}`);
  }

  return failures;
}

export function validatePackedProvenanceMetadata(
  packageJson: PackageJson,
  sourcePackageJson?: PackageJson,
): ReleaseGateFailure[] {
  const failures = validateRootPackageMetadata(packageJson);
  addIf(
    failures,
    sourcePackageJson !== undefined && packageJson.version !== sourcePackageJson.version,
    "packed-version",
    "packed package version must match the clean source package version",
  );
  return failures;
}

export function validateReleaseProvenanceMetadata(
  provenance: ReleaseProvenance,
  packageJson: PackageJson,
  expectedSource?: ReleaseSourceIdentity,
): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  addIf(
    failures,
    provenance.packageName !== PACKAGE_NAME,
    "provenance-package-name",
    `release provenance packageName must be ${PACKAGE_NAME}`,
  );
  addIf(
    failures,
    provenance.packageVersion !== packageJson.version,
    "provenance-package-version",
    "release provenance packageVersion must match package.json",
  );
  addIf(
    failures,
    provenance.repository !== REPOSITORY_URL,
    "provenance-repository",
    `release provenance repository must be ${REPOSITORY_URL}`,
  );
  addIf(
    failures,
    !provenance.gitCommit || !/^[0-9a-f]{40}$/i.test(provenance.gitCommit),
    "provenance-git-commit",
    "release provenance gitCommit must be a 40-character commit SHA",
  );
  addIf(
    failures,
    !provenance.gitTree || !/^[0-9a-f]{40}$/i.test(provenance.gitTree),
    "provenance-git-tree",
    "release provenance gitTree must be a 40-character tree SHA",
  );
  addIf(
    failures,
    !provenance.sourceTreeSha256 || !/^[0-9a-f]{64}$/i.test(provenance.sourceTreeSha256),
    "provenance-source-hash",
    "release provenance sourceTreeSha256 must be a 64-character SHA-256 digest",
  );
  addIf(
    failures,
    !provenance.generatedAt || Number.isNaN(Date.parse(provenance.generatedAt)),
    "provenance-generated-at",
    "release provenance generatedAt must be an ISO timestamp",
  );
  if (expectedSource) {
    addIf(
      failures,
      provenance.gitCommit !== expectedSource.gitCommit,
      "provenance-commit-match",
      "release provenance commit must match the clean source commit",
    );
    addIf(
      failures,
      provenance.gitTree !== expectedSource.gitTree,
      "provenance-tree-match",
      "release provenance tree must match the clean source tree",
    );
    addIf(
      failures,
      provenance.sourceTreeSha256 !== expectedSource.sourceTreeSha256,
      "provenance-source-hash-match",
      "release provenance source hash must match the clean source tree listing",
    );
  }
  return failures;
}

// A dirty release tree is only actionable if the gate says WHICH path is dirty.
// Reporting the count alone forced a reader to reproduce the whole CI run just
// to learn the filename: run 30822824396 failed with "(1 change found)" and the
// offending path appeared nowhere in its 625KB log. The porcelain text is
// already in hand here, so naming the entries costs nothing and turns the next
// occurrence from a guess into a read. Entries are capped so a pathological
// tree cannot bury the rest of the failure list.
const MAX_REPORTED_WORKTREE_ENTRIES = 20;

export function validateReleaseRepositoryState(porcelainStatus: string): ReleaseGateFailure[] {
  if (!porcelainStatus.trim()) return [];
  const lines = porcelainStatus.split(/\r?\n/).filter(Boolean);
  const entries = lines.length;
  const shown = lines.slice(0, MAX_REPORTED_WORKTREE_ENTRIES).map((line) => line.trimEnd());
  const omitted = entries - shown.length;
  const detail = omitted > 0 ? `${shown.join("; ")}; and ${omitted} more` : shown.join("; ");
  return [{
    check: "release-worktree-dirty",
    message: `release input must be a clean tracked tree with no untracked files (${entries} change${entries === 1 ? "" : "s"} found): ${detail}`,
  }];
}

export function classifyReleaseGateAuthority(
  args: string[],
  expectedCommitFromEnvironment?: string,
  lifecycleEvent?: string,
): ReleaseGateAuthority {
  const skipped: string[] = [];
  let hasCliExpectedCommit = false;
  let mode: ReleaseGateAuthority["mode"] = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--skip-npm-view") skipped.push("npm-view");
    else if (arg === "--skip-install-smoke") skipped.push("install-smoke");
    else if (arg === "--expected-commit" || arg.startsWith("--expected-commit=")) {
      hasCliExpectedCommit = true;
      if (arg === "--expected-commit") index += 1;
    }
    else if (arg === "--mode") {
      const candidate = args[index + 1];
      if (candidate === "review" || candidate === "publish") mode = candidate;
      index += 1;
    } else if (arg.startsWith("--mode=")) {
      const candidate = arg.slice("--mode=".length);
      if (candidate === "review" || candidate === "publish") mode = candidate;
    }
  }
  const expectedCommit = mode === "publish" ? expectedCommitFromEnvironment?.trim() || undefined : undefined;
  return {
    mode,
    authoritative: mode === "publish" && lifecycleEvent === "prepublishOnly" && skipped.length === 0 && !hasCliExpectedCommit &&
      Boolean(expectedCommit && /^[0-9a-f]{40}$/i.test(expectedCommit)),
    expectedCommit,
    skipped,
  };
}

export function validateReleaseGateArguments(
  args: string[],
  options: { expectedCommit?: string; lifecycleEvent?: string } = {},
): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  const allowedFlags = new Set(["--skip-npm-view", "--skip-install-smoke"]);
  const authority = classifyReleaseGateAuthority(args, options.expectedCommit, options.lifecycleEvent);
  if (args.includes("--skip-build")) {
    failures.push({
      check: "release-build-required",
      message: "release verification must rebuild the artifact from the clean source commit",
    });
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--mode") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) continue;
    if (arg === "--expected-commit" || arg.startsWith("--expected-commit=")) {
      failures.push({
        check: "release-expected-commit-argument",
        message: "expected commit must come only from HASNA_TODOS_EXPECTED_COMMIT in publish mode",
      });
      if (arg === "--expected-commit") index += 1;
      continue;
    }
    if (arg !== "--skip-build" && !allowedFlags.has(arg)) {
      failures.push({ check: "release-argument", message: `unsupported release verification argument: ${arg}` });
    }
  }
  if (!authority.mode) {
    failures.push({ check: "release-mode", message: "release verification requires --mode=review or --mode=publish" });
  }
  if (authority.mode === "publish" && (!authority.expectedCommit || !/^[0-9a-f]{40}$/i.test(authority.expectedCommit))) {
    failures.push({ check: "release-expected-commit", message: "publish mode requires HASNA_TODOS_EXPECTED_COMMIT with a 40-character commit" });
  }
  if (authority.mode === "publish" && options.lifecycleEvent !== "prepublishOnly") {
    failures.push({ check: "release-publish-lifecycle", message: "publish mode is valid only during npm_lifecycle_event=prepublishOnly" });
  }
  if (authority.mode === "publish" && authority.skipped.length > 0) {
    failures.push({ check: "release-prepublish-skip", message: "prepublishOnly must not use skip flags" });
  }
  return failures;
}

export function validateExpectedReleaseCommit(expected: string, actual: string): ReleaseGateFailure[] {
  return expected === actual ? [] : [{
    check: "release-expected-commit-match",
    message: `release commit ${actual} does not match externally supplied expected commit ${expected}`,
  }];
}

export function validateReleaseIndexFlags(output: string): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const tag = line[0] ?? "";
    const path = line.slice(2);
    if (tag.toUpperCase() === "S") {
      failures.push({ check: "release-index-skip-worktree", message: `tracked release input uses skip-worktree: ${path}` });
    }
    if (/^[a-z]$/.test(tag)) {
      failures.push({ check: "release-index-assume-unchanged", message: `tracked release input uses assume-unchanged: ${path}` });
    }
  }
  return failures;
}

export function validateTrackedWorktreeProof(entries: TrackedWorktreeProof[]): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  for (const entry of entries) {
    if (entry.actualType === "missing" || entry.actualType === "other") {
      failures.push({ check: "release-tracked-type", message: `tracked path type differs from HEAD: ${entry.path}` });
      continue;
    }
    const expectedType = entry.headMode === "120000" ? "symlink" : "blob";
    if (entry.headType !== "blob" || entry.actualType !== expectedType) {
      failures.push({ check: "release-tracked-type", message: `tracked path type differs from HEAD: ${entry.path}` });
      continue;
    }
    if (entry.actualMode !== entry.headMode) {
      failures.push({ check: "release-tracked-mode", message: `tracked path mode differs from HEAD: ${entry.path}` });
    }
    if (entry.actualObject !== entry.headObject) {
      failures.push({
        check: expectedType === "symlink" ? "release-tracked-symlink" : "release-tracked-blob",
        message: `tracked ${expectedType} bytes differ from HEAD: ${entry.path}`,
      });
    }
  }
  return failures;
}

export function isPackedTextContent(content: Uint8Array): boolean {
  if (content.includes(0)) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    let disallowedControls = 0;
    for (const character of text) {
      const code = character.charCodeAt(0);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) disallowedControls += 1;
    }
    return disallowedControls === 0;
  } catch {
    return false;
  }
}

export function validatePackedBinaryFile(path: string): ReleaseGateFailure[] {
  // The @hasna/todos tarball ships no binary files; any packed binary file is
  // not allowlisted.
  return [{ check: "pack-binary-allowlist", message: `packed binary file is not allowlisted: ${path}` }];
}

export function resolveReleaseProvenanceTimestamp(
  sourceDateEpoch: string | undefined,
  commitEpoch: string,
): string {
  const selected = sourceDateEpoch ?? commitEpoch;
  if (!/^\d+$/.test(selected)) {
    throw new Error(sourceDateEpoch !== undefined ? "SOURCE_DATE_EPOCH must be whole epoch seconds" : "commit timestamp must be whole epoch seconds");
  }
  const milliseconds = Number(selected) * 1000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error("release provenance epoch is out of range");
  return new Date(milliseconds).toISOString();
}

export function validateReproducibleArtifactIntegrity(
  first: string,
  second: string,
  firstManifest?: string,
  secondManifest?: string,
): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  addIf(failures, first !== second, "tarball-reproducibility", "two clean builds produced different tarball bytes");
  addIf(
    failures,
    firstManifest !== undefined && secondManifest !== undefined && firstManifest !== secondManifest,
    "payload-reproducibility",
    "two clean builds produced different sorted payload manifests",
  );
  return failures;
}

export function validatePackLifecycleScripts(packageJson: PackageJson): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  for (const name of ["prepack", "prepare", "postpack", "prepublish", "publish", "postpublish"]) {
    addIf(
      failures,
      Boolean(packageJson.scripts?.[name]),
      "pack-lifecycle-mutation",
      `package script ${name} is forbidden because the final npm publish pack must equal the verified pack`,
    );
  }
  addIf(
    failures,
    packageJson.scripts?.["verify:release"] !== "bun run scripts/verify-public-release.ts --mode=review",
    "release-review-script",
    "verify:release must invoke explicit non-authoritative review mode",
  );
  addIf(
    failures,
    packageJson.scripts?.["verify:release-review"] !== "bun run scripts/verify-npm-release-agent-review.ts",
    "release-agent-review-script",
    "verify:release-review must invoke the package-owned independent-agent receipt gate",
  );
  addIf(
    failures,
    packageJson.scripts?.prepublishOnly !== "bun run scripts/verify-public-release.ts --mode=publish",
    "release-publish-script",
    "prepublishOnly must invoke strict publish mode",
  );
  return failures;
}

export function getNpmPackArgs(destination: string): string[] {
  return ["pack", "--ignore-scripts", "--json", "--pack-destination", destination];
}

export function validateReleaseArtifactIntegrity(
  reportedIntegrity: string | undefined,
  computedIntegrity: string,
): ReleaseGateFailure[] {
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(computedIntegrity)) {
    return [{ check: "tarball-integrity", message: "computed tarball integrity must be a valid sha512 SRI value" }];
  }
  if (reportedIntegrity === undefined) {
    return [{ check: "tarball-integrity-reported", message: "npm pack must report integrity for verification" }];
  }
  if (reportedIntegrity !== undefined && reportedIntegrity !== computedIntegrity) {
    return [{ check: "tarball-integrity", message: "packed tarball bytes do not match the packer's reported integrity" }];
  }
  return [];
}

export function validateNpmView(packageName: string, rawJson: string): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [{ check: "npm-view", message: "npm view did not return valid JSON" }];
  }

  if (!parsed || typeof parsed !== "object") {
    return [{ check: "npm-view", message: "npm view returned an empty response" }];
  }

  const record = parsed as Record<string, unknown>;
  addIf(failures, record.name !== packageName, "npm-view-name", `npm registry did not return ${packageName}`);
  addIf(failures, typeof record.version !== "string", "npm-view-version", "npm registry did not return a public version");
  return failures;
}

export function getInstallSmokeCommands(
  tarball = "<tarball>",
  port = "<port>",
  installRoot = "<install-root>",
): InstallSmokeCommand[] {
  return INSTALL_SMOKE_COMMANDS.map((step) => ({
    ...step,
    command: step.command.replace("<install-root>", installRoot),
    args: step.args.map((arg) => arg
      .replace("<tarball>", tarball)
      .replace("<port>", port)
      .replaceAll("<install-root>", installRoot)),
  }));
}

export function validateInstallSmokeCommands(commands: InstallSmokeCommand[]): ReleaseGateFailure[] {
  const failures: ReleaseGateFailure[] = [];
  const rendered = commands.map((step) => [step.command, ...step.args].join(" "));

  addIf(
    failures,
    !rendered.some((line) => line.startsWith("bun add --cwd ") && line.includes(".tgz")),
    "install-smoke-bun-install",
    `install smoke must install ${PACKAGE_NAME} into an isolated --cwd with bun add`,
  );
  addIf(
    failures,
    rendered.some((line) => /^npm\s+(install|i|exec|x)\b/.test(line) || /^npx\b/.test(line)),
    "install-smoke-npm",
    "install smoke must not use npm or npx for installation/execution",
  );

  addIf(
    failures,
    rendered.some((line) => /\bbun\s+(install|add|remove)\s+-g\b/.test(line)),
    "install-smoke-global-install",
    "install smoke must never mutate the global Bun installation",
  );

  for (const expected of ["node_modules/.bin/todos --version", "node_modules/.bin/todos --help", "node_modules/.bin/todos-mcp --help"]) {
    addIf(failures, !rendered.some((line) => line.includes(expected)), "install-smoke-command", `install smoke must run ${expected}`);
  }

  const joined = rendered.join("\n");
  for (const pattern of FORBIDDEN_TEXT_PATTERNS) {
    addIf(failures, pattern.test(joined), "install-smoke-boundary", `install smoke matches forbidden pattern ${pattern}`);
  }

  return failures;
}

function addIf(failures: ReleaseGateFailure[], condition: boolean, check: string, message: string): void {
  if (condition) failures.push({ check, message });
}

function isSemver(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function wordPattern(word: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
