import * as fs from "fs";
import * as path from "path";
import {
  type Scanner,
  type FindingInput,
  type ScannerRunOptions,
  ScannerType,
  Severity,
  DEFAULT_CONFIG,
} from "../types/index.js";
import { walkDirectory, getCodeSnippet } from "./secrets.js";

// --- Config pattern scanners ---

function scanCorsConfig(filePath: string, content: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Wildcard CORS
    if (/Access-Control-Allow-Origin.*\*/i.test(line) || /cors\s*\(\s*\{\s*origin\s*:\s*['"]?\*/i.test(line) || /origin\s*:\s*['"]\*['"]/i.test(line)) {
      findings.push({
        rule_id: "config-cors-wildcard",
        scanner_type: ScannerType.Config,
        severity: Severity.High,
        file: filePath,
        line: lineNum,
        message: "Wildcard CORS origin (*) allows any domain to make requests",
        code_snippet: getCodeSnippet(content, lineNum),
      });
    }

    // cors({ origin: true }) — allows all origins
    if (/cors\s*\(\s*\{\s*origin\s*:\s*true/i.test(line)) {
      findings.push({
        rule_id: "config-cors-open",
        scanner_type: ScannerType.Config,
        severity: Severity.High,
        file: filePath,
        line: lineNum,
        message: "CORS origin set to true allows all origins",
        code_snippet: getCodeSnippet(content, lineNum),
      });
    }
  }

  return findings;
}

function scanDebugMode(filePath: string, content: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const lines = content.split("\n");
  const basename = path.basename(filePath);

  // Only check production-relevant config files
  const isProductionConfig = /prod|deploy|docker-compose|Dockerfile|\.env(?!\.local|\.dev|\.test)/i.test(basename);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (/DEBUG\s*[=:]\s*(?:true|1|yes|on)\b/i.test(line)) {
      findings.push({
        rule_id: "config-debug-enabled",
        scanner_type: ScannerType.Config,
        severity: isProductionConfig ? Severity.High : Severity.Low,
        file: filePath,
        line: lineNum,
        message: "Debug mode enabled — may expose sensitive information in production",
        code_snippet: getCodeSnippet(content, lineNum),
      });
    }

    if (/NODE_ENV\s*[=:]\s*['"]?development['"]?/i.test(line) && isProductionConfig) {
      findings.push({
        rule_id: "config-dev-mode-production",
        scanner_type: ScannerType.Config,
        severity: Severity.High,
        file: filePath,
        line: lineNum,
        message: "NODE_ENV set to development in production config",
        code_snippet: getCodeSnippet(content, lineNum),
      });
    }
  }

  return findings;
}

function scanSecurityHeaders(filePath: string, content: string): FindingInput[] {
  const findings: FindingInput[] = [];

  // Check if this is an Express app entry file
  if (/(?:express\(\)|createServer|app\.listen)/i.test(content)) {
    if (!/helmet/i.test(content)) {
      findings.push({
        rule_id: "config-missing-helmet",
        scanner_type: ScannerType.Config,
        severity: Severity.Medium,
        file: filePath,
        line: 1,
        message: "Express app without helmet middleware — security headers not set",
      });
    }
  }

  return findings;
}

function scanInsecureCookies(filePath: string, content: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Detect cookie setting without security flags
    if (/(?:cookie|set-cookie|setCookie|session)/i.test(line)) {
      // Look ahead a few lines for security flags
      const block = lines.slice(i, Math.min(i + 10, lines.length)).join("\n");

      if (/cookie/i.test(block) && /[=:]\s*\{/i.test(block)) {
        if (!/httpOnly\s*:\s*true/i.test(block)) {
          findings.push({
            rule_id: "config-cookie-no-httponly",
            scanner_type: ScannerType.Config,
            severity: Severity.Medium,
            file: filePath,
            line: lineNum,
            message: "Cookie configuration missing httpOnly flag",
            code_snippet: getCodeSnippet(content, lineNum),
          });
        }

        if (!/secure\s*:\s*true/i.test(block)) {
          findings.push({
            rule_id: "config-cookie-no-secure",
            scanner_type: ScannerType.Config,
            severity: Severity.Medium,
            file: filePath,
            line: lineNum,
            message: "Cookie configuration missing secure flag",
            code_snippet: getCodeSnippet(content, lineNum),
          });
        }

        if (!/sameSite\s*:/i.test(block)) {
          findings.push({
            rule_id: "config-cookie-no-samesite",
            scanner_type: ScannerType.Config,
            severity: Severity.Medium,
            file: filePath,
            line: lineNum,
            message: "Cookie configuration missing sameSite attribute",
            code_snippet: getCodeSnippet(content, lineNum),
          });
        }
      }
    }
  }

  return findings;
}

function scanEnvExposure(scanPath: string): FindingInput[] {
  const findings: FindingInput[] = [];

  // Check if .env exists
  const envFile = path.join(scanPath, ".env");
  if (!fs.existsSync(envFile)) return findings;

  // Check if .env is in .gitignore
  const gitignorePath = path.join(scanPath, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, "utf-8");
    const hasEnvIgnore = gitignore.split("\n").some((line) => {
      const trimmed = line.trim();
      return trimmed === ".env" || trimmed === ".env*" || trimmed === "*.env";
    });

    if (!hasEnvIgnore) {
      findings.push({
        rule_id: "config-env-not-gitignored",
        scanner_type: ScannerType.Config,
        severity: Severity.High,
        file: ".gitignore",
        line: 1,
        message: ".env file exists but is not listed in .gitignore — secrets may be committed",
      });
    }
  } else {
    findings.push({
      rule_id: "config-no-gitignore",
      scanner_type: ScannerType.Config,
      severity: Severity.High,
      file: ".env",
      line: 1,
      message: ".env file exists but no .gitignore found — secrets may be committed",
    });
  }

  return findings;
}

function scanDockerfile(filePath: string, content: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const lines = content.split("\n");
  let hasUserDirective = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    if (/^USER\s+/i.test(line) && !/root/i.test(line)) {
      hasUserDirective = true;
    }

    // Running as root explicitly
    if (/^USER\s+root\b/i.test(line)) {
      findings.push({
        rule_id: "config-docker-root",
        scanner_type: ScannerType.Config,
        severity: Severity.High,
        file: filePath,
        line: lineNum,
        message: "Docker container running as root user",
        code_snippet: getCodeSnippet(content, lineNum),
      });
    }

    // Exposing many ports
    if (/^EXPOSE\s+/i.test(line)) {
      const ports = line.replace(/^EXPOSE\s+/i, "").split(/\s+/).filter(Boolean);
      if (ports.length > 3) {
        findings.push({
          rule_id: "config-docker-many-ports",
          scanner_type: ScannerType.Config,
          severity: Severity.Low,
          file: filePath,
          line: lineNum,
          message: `Docker container exposes ${ports.length} ports — consider minimizing attack surface`,
          code_snippet: getCodeSnippet(content, lineNum),
        });
      }
    }
  }

  if (!hasUserDirective && path.basename(filePath) === "Dockerfile") {
    findings.push({
      rule_id: "config-docker-no-user",
      scanner_type: ScannerType.Config,
      severity: Severity.Medium,
      file: filePath,
      line: 1,
      message: "Dockerfile has no USER directive — container will run as root by default",
    });
  }

  return findings;
}

function scanPackageJsonLockfile(scanPath: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const pkgPath = path.join(scanPath, "package.json");

  if (!fs.existsSync(pkgPath)) return findings;

  const hasLockfile =
    fs.existsSync(path.join(scanPath, "package-lock.json")) ||
    fs.existsSync(path.join(scanPath, "yarn.lock")) ||
    fs.existsSync(path.join(scanPath, "pnpm-lock.yaml")) ||
    fs.existsSync(path.join(scanPath, "bun.lockb")) ||
    fs.existsSync(path.join(scanPath, "bun.lock"));

  if (!hasLockfile) {
    findings.push({
      rule_id: "config-no-lockfile",
      scanner_type: ScannerType.Config,
      severity: Severity.Medium,
      file: "package.json",
      line: 1,
      message: "No lockfile found — dependency versions are not pinned, risking supply chain attacks",
    });
  }

  return findings;
}

// --- Config files to scan with code patterns ---

const CONFIG_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".json", ".yml", ".yaml",
  ".toml", ".env", ".conf", ".cfg", ".ini",
]);

const CONFIG_FILENAMES = new Set([
  "next.config.js", "next.config.ts", "next.config.mjs",
  "vite.config.js", "vite.config.ts",
  "docker-compose.yml", "docker-compose.yaml",
  "Dockerfile",
  "nginx.conf",
  ".env", ".env.production", ".env.staging",
]);

function isConfigFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return CONFIG_FILENAMES.has(basename) || CONFIG_EXTENSIONS.has(ext);
}

// --- Scanner ---

export const configScanner: Scanner = {
  name: "Config Scanner",
  type: ScannerType.Config,
  description: "Scans for insecure configurations including CORS, debug mode, missing security headers, and exposed secrets",

  async scan(scanPath: string, options?: ScannerRunOptions): Promise<FindingInput[]> {
    const ignorePatterns = options?.ignore_patterns ?? DEFAULT_CONFIG.ignore_patterns;
    const findings: FindingInput[] = [];

    // Root-level checks
    findings.push(...scanEnvExposure(scanPath));
    findings.push(...scanPackageJsonLockfile(scanPath));

    // Scan config files
    const files = walkDirectory(scanPath, ignorePatterns, isConfigFile);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const relativePath = path.relative(scanPath, file);
        const basename = path.basename(file);

        findings.push(...scanCorsConfig(relativePath, content));
        findings.push(...scanDebugMode(relativePath, content));
        findings.push(...scanSecurityHeaders(relativePath, content));
        findings.push(...scanInsecureCookies(relativePath, content));

        if (basename === "Dockerfile" || basename.startsWith("Dockerfile.")) {
          findings.push(...scanDockerfile(relativePath, content));
        }
      } catch {
        // Skip unreadable files
      }
    }

    return findings;
  },
};

export default configScanner;
