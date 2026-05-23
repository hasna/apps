/**
 * Public package release and supply-chain hardening checks.
 * Local-only validation — no network required for core checks.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { scanTextForSecrets } from "./secret-redaction.js";

export const RELEASE_CHECK_SCHEMA = "todos.release_check.v1";

export type ReleaseCheckSeverity = "error" | "warn" | "info";

export interface ReleaseCheckItem {
  id: string;
  severity: ReleaseCheckSeverity;
  message: string;
  detail?: string;
}

export interface ReleaseCheckReport {
  schema_version: typeof RELEASE_CHECK_SCHEMA;
  package_name: string;
  package_version: string;
  passed: boolean;
  errors: number;
  warnings: number;
  checks: ReleaseCheckItem[];
  checked_at: string;
}

export interface ReleaseCheckOptions {
  root_dir?: string;
  /** Skip scanning dist (for partial CI) */
  skip_dist_scan?: boolean;
}

const FORBIDDEN_DIST_PATTERNS: Array<{ id: string; pattern: RegExp; allow_in?: string[] }> = [
  { id: "platform_todos", pattern: /platform-todos|@hasnastudio\/platform-todos/i },
  { id: "stripe", pattern: /\bstripe\.(?:com|js)\b|checkout\.sessions/i },
  { id: "hardcoded_aws_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "openai_key", pattern: /\bsk-[a-zA-Z0-9]{20,}\b/ },
];

const REQUIRED_BINS = ["todos", "todos-mcp", "todos-serve"] as const;

function readPackageJson(root: string): Record<string, unknown> {
  const path = join(root, "package.json");
  if (!existsSync(path)) throw new Error(`package.json not found in ${root}`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, acc);
    else if (/\.(js|mjs|cjs|json|d\.ts)$/.test(entry)) acc.push(full);
  }
  return acc;
}

export function auditPackageContents(root: string): ReleaseCheckItem[] {
  const checks: ReleaseCheckItem[] = [];
  const pkg = readPackageJson(root);
  const files = (pkg.files as string[] | undefined) ?? [];
  const bins = pkg.bin as Record<string, string> | undefined;

  if (!files.includes("dist")) {
    checks.push({ id: "files_dist", severity: "error", message: "package.json files must include dist" });
  }

  for (const pattern of files) {
    const target = join(root, pattern);
    if (!existsSync(target)) {
      checks.push({ id: `files_missing_${pattern}`, severity: "error", message: `Published file path missing: ${pattern}` });
    }
  }

  if (!bins) {
    checks.push({ id: "bins_missing", severity: "error", message: "package.json bin entries required" });
    return checks;
  }

  for (const name of REQUIRED_BINS) {
    const rel = bins[name];
    if (!rel) {
      checks.push({ id: `bin_${name}`, severity: "error", message: `Missing bin entry: ${name}` });
      continue;
    }
    const binPath = join(root, rel);
    if (!existsSync(binPath)) {
      checks.push({ id: `bin_path_${name}`, severity: "error", message: `Bin file missing: ${rel}` });
    } else {
      checks.push({ id: `bin_ok_${name}`, severity: "info", message: `Bin present: ${name} → ${rel}` });
    }
  }

  const publish = pkg.publishConfig as Record<string, unknown> | undefined;
  if (!publish || publish.access !== "public") {
    checks.push({ id: "publish_public", severity: "warn", message: "publishConfig.access should be public" });
  }

  if (pkg.license !== "Apache-2.0") {
    checks.push({ id: "license", severity: "warn", message: "Expected Apache-2.0 license" });
  }

  return checks;
}

export function scanDistArtifacts(root: string): ReleaseCheckItem[] {
  const checks: ReleaseCheckItem[] = [];
  const distDir = join(root, "dist");
  if (!existsSync(distDir)) {
    checks.push({ id: "dist_missing", severity: "error", message: "dist/ directory not found — run bun run build" });
    return checks;
  }

  for (const file of walkFiles(distDir)) {
    const rel = relative(root, file);
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const rule of FORBIDDEN_DIST_PATTERNS) {
      if (rule.allow_in?.some((a) => rel.includes(a))) continue;
      if (rule.pattern.test(content)) {
        checks.push({
          id: `forbidden_${rule.id}`,
          severity: "error",
          message: `Forbidden pattern '${rule.id}' in ${rel}`,
        });
      }
    }

    const secretScan = scanTextForSecrets(content);
    if (!secretScan.clean) {
      checks.push({
        id: `secret_${rel}`,
        severity: "error",
        message: `Potential secret in built artifact: ${rel}`,
        detail: secretScan.matches.map((m) => m.pattern).join(", "),
      });
    }
  }

  if (checks.filter((c) => c.severity === "error").length === 0) {
    checks.push({ id: "dist_scan_clean", severity: "info", message: "dist/ artifact scan passed" });
  }

  return checks;
}

export function validateReleaseScripts(root: string): ReleaseCheckItem[] {
  const checks: ReleaseCheckItem[] = [];
  const pkg = readPackageJson(root);
  const scripts = pkg.scripts as Record<string, string> | undefined;

  if (!scripts?.prepublishOnly?.includes("build")) {
    checks.push({ id: "prepublish_build", severity: "warn", message: "prepublishOnly should run build" });
  } else {
    checks.push({ id: "prepublish_ok", severity: "info", message: "prepublishOnly runs build" });
  }

  if (!scripts?.test) {
    checks.push({ id: "test_script", severity: "warn", message: "Missing test script" });
  }

  return checks;
}

export function getReleaseWorkflowDocs(): string {
  return `# @hasna/todos Release Workflow

## Prerequisites

\`\`\`bash
bun install
bun run build
bun test
bun run src/cli/index.tsx release check
\`\`\`

## Publish (bun only)

\`\`\`bash
# 1. Verify supply-chain checks pass
todos release check

# 2. Bump version in package.json

# 3. Build and test
bun run build && bun test

# 4. Publish public package
npm publish --access public

# 5. Verify install
bun install -g @hasna/todos
todos --version
todos-mcp --help 2>&1 | head -1 || true
\`\`\`

## Checks included

- package.json \`files\` and \`bin\` audit
- dist/ forbidden pattern scan (hosted billing APIs, secrets)
- publishConfig public access
- prepublishOnly build hook

Cloud sync via \`@hasna/cloud\` is explicit opt-in — not required for local-only usage.
`;
}

export function runReleaseChecks(options: ReleaseCheckOptions = {}): ReleaseCheckReport {
  const root = options.root_dir ?? process.cwd();
  const pkg = readPackageJson(root);
  const checks = [
    ...auditPackageContents(root),
    ...validateReleaseScripts(root),
    ...(options.skip_dist_scan ? [] : scanDistArtifacts(root)),
  ];

  const errors = checks.filter((c) => c.severity === "error").length;
  const warnings = checks.filter((c) => c.severity === "warn").length;

  return {
    schema_version: RELEASE_CHECK_SCHEMA,
    package_name: String(pkg.name ?? "@hasna/todos"),
    package_version: String(pkg.version ?? "0.0.0"),
    passed: errors === 0,
    errors,
    warnings,
    checks,
    checked_at: new Date().toISOString(),
  };
}

export function formatReleaseCheckReport(report: ReleaseCheckReport): string {
  const lines = [
    `@hasna/todos release check — ${report.passed ? "PASSED" : "FAILED"}`,
    `Package: ${report.package_name}@${report.package_version}`,
    `Errors: ${report.errors} | Warnings: ${report.warnings}`,
    "",
  ];

  for (const c of report.checks) {
    const prefix = c.severity === "error" ? "✗" : c.severity === "warn" ? "!" : "·";
    lines.push(`${prefix} [${c.severity}] ${c.message}${c.detail ? ` (${c.detail})` : ""}`);
  }

  return lines.join("\n");
}
