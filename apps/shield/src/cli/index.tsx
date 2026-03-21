#!/usr/bin/env node
import { Command } from "commander";
import { resolve, basename } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import chalk from "chalk";

import {
  ScannerType,
  ScanStatus,
  ReportFormat,
  Severity,
  SEVERITY_ORDER,
  type Finding,
  type ConfigFile,
} from "../types/index.js";

import {
  getDb,
  createProject,
  getProjectByPath,
  createScan,
  completeScan,
  updateScanStatus,
  listScans,
  createFinding,
  getFinding,
  listFindings,
  suppressFinding,
  getSecurityScore,
  createBaseline,
} from "../db/index.js";

import {
  runAllScanners,
  runScanner,
  getScanner,
  listScanners,
} from "../scanners/index.js";

import {
  isLLMAvailable,
  analyzeFinding as llmAnalyzeFinding,
  explainFinding as llmExplainFinding,
  suggestFix as llmSuggestFix,
} from "../llm/index.js";

import { getReporter } from "../reporters/index.js";
import { loadConfig, initProject } from "../lib/index.js";

// --- Helpers ---

function getCodeContext(filePath: string, line: number, contextLines = 5): string {
  try {
    if (!existsSync(filePath)) return "";
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, line - contextLines - 1);
    const end = Math.min(lines.length, line + contextLines);
    return lines
      .slice(start, end)
      .map((l, i) => {
        const lineNum = start + i + 1;
        const marker = lineNum === line ? ">" : " ";
        return `${marker} ${lineNum.toString().padStart(4)} | ${l}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}

function resolveScannerTypes(
  scannerArg: string | undefined,
  quick: boolean,
  config: ConfigFile,
): ScannerType[] {
  if (scannerArg) {
    const type = scannerArg as ScannerType;
    if (!Object.values(ScannerType).includes(type)) {
      console.error(
        chalk.red(`Unknown scanner type: ${scannerArg}`),
      );
      console.error(
        chalk.gray(`Available: ${Object.values(ScannerType).join(", ")}`),
      );
      process.exit(1);
    }
    return [type];
  }

  if (quick) {
    return [ScannerType.Secrets, ScannerType.Dependencies];
  }

  return config.enabled_scanners;
}

function parseSeverity(level: string): Severity {
  const map: Record<string, Severity> = {
    critical: Severity.Critical,
    high: Severity.High,
    medium: Severity.Medium,
    low: Severity.Low,
    info: Severity.Info,
  };
  return map[level.toLowerCase()] ?? Severity.Info;
}

function parseFormat(format: string): ReportFormat {
  const map: Record<string, ReportFormat> = {
    terminal: ReportFormat.Terminal,
    json: ReportFormat.Json,
    sarif: ReportFormat.Sarif,
  };
  return map[format.toLowerCase()] ?? ReportFormat.Terminal;
}

function filterBySeverity(findings: Finding[], threshold: Severity): Finding[] {
  const thresholdOrder = SEVERITY_ORDER[threshold];
  return findings.filter((f) => SEVERITY_ORDER[f.severity] <= thresholdOrder);
}

function ensureProject(scanPath: string) {
  const absPath = resolve(scanPath);
  let project = getProjectByPath(absPath);
  if (!project) {
    const name = basename(absPath);
    project = createProject(name, absPath);
  }
  return project;
}

// --- CLI ---

const program = new Command();

program
  .name("security")
  .description("AI-powered security scanner for git repos")
  .version("0.1.0");

// scan [path]
program
  .command("scan")
  .description("Run security scan on a directory")
  .argument("[path]", "Path to scan", ".")
  .option("--quick", "Quick scan (secrets + dependencies only)")
  .option("--scanner <type>", "Run specific scanner only")
  .option("--format <format>", "Output format (terminal/json/sarif)", "terminal")
  .option("--severity <level>", "Minimum severity threshold", "info")
  .option("--llm", "Enable LLM analysis of findings")
  .option("--no-cache", "Skip LLM cache")
  .action(async (path: string, options) => {
    const scanPath = resolve(path);
    if (!existsSync(scanPath)) {
      console.error(chalk.red(`Path does not exist: ${scanPath}`));
      process.exit(1);
    }

    const config = loadConfig(scanPath);
    const format = parseFormat(options.format);
    const severityThreshold = parseSeverity(options.severity);
    const scannerTypes = resolveScannerTypes(
      options.scanner,
      options.quick,
      config,
    );
    const useLLM = options.llm || config.llm_analyze;

    // Initialize DB and project
    getDb();
    const project = ensureProject(scanPath);

    // Create scan record
    const scan = createScan(project.id, scannerTypes);
    updateScanStatus(scan.id, ScanStatus.Running);

    console.log(
      chalk.bold(`\n  Scanning ${chalk.cyan(scanPath)}...`),
    );
    console.log(
      chalk.gray(
        `  Scanners: ${scannerTypes.join(", ")}`,
      ),
    );

    const startTime = Date.now();

    try {
      // Run scanners
      let findingInputs = [];

      if (scannerTypes.length === 1) {
        findingInputs = await runScanner(scannerTypes[0], scanPath, {
          ignore_patterns: config.ignore_patterns,
        });
      } else {
        // Run only selected scanners
        const results = await Promise.allSettled(
          scannerTypes.map((type) => {
            const scanner = getScanner(type);
            if (!scanner) return Promise.resolve([]);
            return scanner.scan(scanPath, {
              ignore_patterns: config.ignore_patterns,
            });
          }),
        );
        for (const result of results) {
          if (result.status === "fulfilled") {
            findingInputs.push(...result.value);
          } else {
            console.error(
              chalk.yellow(`  Warning: scanner failed - ${result.reason}`),
            );
          }
        }
      }

      // Store findings in DB
      const storedFindings: Finding[] = [];
      for (const input of findingInputs) {
        const finding = createFinding(scan.id, input);
        storedFindings.push(finding);
      }

      // Complete scan first (don't block on LLM)
      completeScan(scan.id, storedFindings.length);

      // LLM analysis — parallel batches of 5
      if (useLLM && isLLMAvailable() && storedFindings.length > 0) {
        console.log(
          chalk.gray(`  Running LLM analysis on ${storedFindings.length} findings (5 concurrent)...`),
        );
        const BATCH_SIZE = 5;
        let analyzed = 0;
        for (let i = 0; i < storedFindings.length; i += BATCH_SIZE) {
          const batch = storedFindings.slice(i, i + BATCH_SIZE);
          await Promise.allSettled(
            batch.map(async (finding) => {
              const codeContext = getCodeContext(
                resolve(scanPath, finding.file),
                finding.line,
              );
              const analysis = await llmAnalyzeFinding(finding, codeContext);
              if (analysis) {
                finding.llm_exploitability = analysis.exploitability;
              }
              analyzed++;
            }),
          );
          process.stdout.write(chalk.gray(`\r  Analyzed ${analyzed}/${storedFindings.length} findings`));
        }
        console.log();
      } else if (useLLM && !isLLMAvailable()) {
        console.log(
          chalk.yellow(
            "  LLM analysis requested but CEREBRAS_API_KEY is not set. Skipping.",
          ),
        );
      }

      const duration = Date.now() - startTime;
      console.log(
        chalk.gray(`  Completed in ${(duration / 1000).toFixed(1)}s\n`),
      );

      // Filter by severity threshold
      const filtered = filterBySeverity(storedFindings, severityThreshold);

      // Output
      const reporter = getReporter(format);
      const output = reporter.report(filtered, { ...scan, status: ScanStatus.Completed });
      if (typeof output === "string") {
        console.log(output);
      }

      // Exit with non-zero if critical/high findings
      const hasCritical = filtered.some(
        (f) => f.severity === Severity.Critical || f.severity === Severity.High,
      );
      if (hasCritical) {
        process.exit(1);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      updateScanStatus(scan.id, ScanStatus.Failed, undefined, errMsg);
      console.error(chalk.red(`  Scan failed: ${errMsg}`));
      process.exit(1);
    }
  });

// findings
program
  .command("findings")
  .description("List security findings")
  .option("--severity <level>", "Filter by severity")
  .option("--scanner <type>", "Filter by scanner type")
  .option("--file <path>", "Filter by file")
  .option("--format <format>", "Output format", "terminal")
  .option("--suppressed", "Include suppressed findings")
  .action(async (options) => {
    getDb();
    const scans = listScans(undefined, 1);
    if (scans.length === 0) {
      console.log(chalk.yellow("\n  No scans found. Run `security scan` first.\n"));
      return;
    }

    const latestScan = scans[0];
    const format = parseFormat(options.format);

    const findings = listFindings({
      scan_id: latestScan.id,
      severity: options.severity ? parseSeverity(options.severity) : undefined,
      scanner_type: options.scanner as ScannerType | undefined,
      file: options.file,
      suppressed: options.suppressed ? undefined : false,
    });

    if (findings.length === 0) {
      console.log(chalk.green("\n  No findings match the specified filters.\n"));
      return;
    }

    const reporter = getReporter(format);
    const output = reporter.report(findings, latestScan);
    if (typeof output === "string") {
      console.log(output);
    }
  });

// explain <id>
program
  .command("explain")
  .description("Get AI explanation for a finding")
  .argument("<id>", "Finding ID")
  .action(async (id: string) => {
    if (!isLLMAvailable()) {
      console.error(
        chalk.red("\n  CEREBRAS_API_KEY is not set. LLM features are unavailable.\n"),
      );
      process.exit(1);
    }

    getDb();
    const finding = getFinding(id);
    if (!finding) {
      console.error(chalk.red(`\n  Finding not found: ${id}\n`));
      process.exit(1);
    }

    // If already has explanation, show it
    if (finding.llm_explanation) {
      console.log(chalk.bold("\n  Explanation (cached):\n"));
      console.log(`  ${finding.llm_explanation}\n`);
      return;
    }

    const codeContext = getCodeContext(finding.file, finding.line);

    console.log(chalk.gray("\n  Analyzing finding with LLM...\n"));
    const explanation = await llmExplainFinding(finding, codeContext);

    if (!explanation) {
      console.error(chalk.red("  Failed to get explanation from LLM.\n"));
      process.exit(1);
    }

    console.log(chalk.bold("\n  Explanation:\n"));
    console.log(`  ${explanation}\n`);
  });

// fix <id>
program
  .command("fix")
  .description("Get AI-suggested fix for a finding")
  .argument("<id>", "Finding ID")
  .action(async (id: string) => {
    if (!isLLMAvailable()) {
      console.error(
        chalk.red("\n  CEREBRAS_API_KEY is not set. LLM features are unavailable.\n"),
      );
      process.exit(1);
    }

    getDb();
    const finding = getFinding(id);
    if (!finding) {
      console.error(chalk.red(`\n  Finding not found: ${id}\n`));
      process.exit(1);
    }

    // If already has fix, show it
    if (finding.llm_fix) {
      console.log(chalk.bold("\n  Suggested Fix (cached):\n"));
      console.log(finding.llm_fix);
      console.log();
      return;
    }

    const codeContext = getCodeContext(finding.file, finding.line);

    console.log(chalk.gray("\n  Generating fix with LLM...\n"));
    const fix = await llmSuggestFix(finding, codeContext);

    if (!fix) {
      console.error(chalk.red("  Failed to get fix suggestion from LLM.\n"));
      process.exit(1);
    }

    console.log(chalk.bold("\n  Suggested Fix:\n"));
    console.log(fix);
    console.log();
  });

// review
program
  .command("review")
  .description("Security review staged git changes")
  .action(async () => {
    let diff: string;
    try {
      diff = execSync("git diff --staged", { encoding: "utf-8" });
    } catch {
      console.error(chalk.red("\n  Failed to get staged diff. Are you in a git repo?\n"));
      process.exit(1);
    }

    if (!diff.trim()) {
      console.log(chalk.yellow("\n  No staged changes to review.\n"));
      return;
    }

    console.log(chalk.bold("\n  Reviewing staged changes...\n"));

    // Run code scanner on the staged diff by writing to a temp approach
    // We parse the diff to find changed files and scan those
    const changedFiles = diff
      .split("\n")
      .filter((line) => line.startsWith("+++ b/"))
      .map((line) => line.replace("+++ b/", ""));

    if (changedFiles.length === 0) {
      console.log(chalk.green("  No files in staged diff to review.\n"));
      return;
    }

    console.log(
      chalk.gray(`  Checking ${changedFiles.length} changed file(s)...`),
    );

    // Run secrets and code scanners on the repo, then filter to changed files
    const cwd = process.cwd();
    const config = loadConfig(cwd);

    const findingInputs = [];
    for (const scannerType of [ScannerType.Secrets, ScannerType.Code]) {
      try {
        const results = await runScanner(scannerType, cwd, {
          ignore_patterns: config.ignore_patterns,
        });
        // Filter to only changed files
        const filtered = results.filter((f) =>
          changedFiles.some((cf) => f.file.endsWith(cf) || f.file === cf),
        );
        findingInputs.push(...filtered);
      } catch {
        // Scanner may fail, continue
      }
    }

    if (findingInputs.length === 0) {
      console.log(chalk.green("\n  No security issues found in staged changes.\n"));
      return;
    }

    // Display as terminal report using temporary Finding objects
    const tempFindings: Finding[] = findingInputs.map((input, i) => ({
      id: `review-${i}`,
      scan_id: "review",
      rule_id: input.rule_id,
      scanner_type: input.scanner_type,
      severity: input.severity,
      file: input.file,
      line: input.line,
      column: input.column ?? null,
      end_line: input.end_line ?? null,
      message: input.message,
      code_snippet: input.code_snippet ?? null,
      fingerprint: `review-${i}`,
      suppressed: false,
      suppressed_reason: null,
      llm_explanation: null,
      llm_fix: null,
      llm_exploitability: null,
      created_at: new Date().toISOString(),
    }));

    const reporter = getReporter(ReportFormat.Terminal);
    reporter.report(tempFindings);
  });

// init
program
  .command("init")
  .description("Initialize security for this repository")
  .action(async () => {
    const cwd = process.cwd();
    initProject(cwd);
    console.log(
      chalk.green(`\n  Initialized security in ${chalk.cyan(cwd)}`),
    );
    console.log(chalk.gray("  Created .security/config.json"));
    console.log(
      chalk.gray("  Run `security scan` to start scanning.\n"),
    );
  });

// baseline
program
  .command("baseline")
  .description("Mark current findings as baseline (suppress)")
  .action(async () => {
    getDb();
    const scans = listScans(undefined, 1);
    if (scans.length === 0) {
      console.log(
        chalk.yellow("\n  No scans found. Run `security scan` first.\n"),
      );
      return;
    }

    const latestScan = scans[0];
    const findings = listFindings({
      scan_id: latestScan.id,
      suppressed: false,
    });

    if (findings.length === 0) {
      console.log(chalk.green("\n  No active findings to baseline.\n"));
      return;
    }

    let count = 0;
    for (const finding of findings) {
      createBaseline(finding.fingerprint, "Baselined via CLI");
      suppressFinding(finding.id, "Baselined");
      count++;
    }

    console.log(
      chalk.green(`\n  Baselined ${chalk.bold(count.toString())} findings.`),
    );
    console.log(
      chalk.gray("  These findings will be suppressed in future scans.\n"),
    );
  });

// score
program
  .command("score")
  .description("Show security score for the project")
  .action(async () => {
    getDb();
    const scans = listScans(undefined, 1);
    if (scans.length === 0) {
      console.log(
        chalk.yellow("\n  No scans found. Run `security scan` first.\n"),
      );
      return;
    }

    const latestScan = scans[0];
    const score = getSecurityScore(latestScan.id);

    console.log(chalk.bold("\n  Security Score\n"));
    console.log(chalk.gray("  " + "\u2500".repeat(40)));

    // Score display with color
    const scoreColor =
      score.score >= 80
        ? chalk.green
        : score.score >= 50
          ? chalk.yellow
          : chalk.red;

    console.log(
      `\n  ${chalk.bold("Score:")} ${scoreColor.bold(score.score.toString())}/100\n`,
    );

    // Breakdown
    if (score.critical > 0)
      console.log(chalk.red(`    Critical:  ${score.critical}`));
    if (score.high > 0)
      console.log(chalk.magenta(`    High:      ${score.high}`));
    if (score.medium > 0)
      console.log(chalk.yellow(`    Medium:    ${score.medium}`));
    if (score.low > 0)
      console.log(chalk.blue(`    Low:       ${score.low}`));
    if (score.info > 0)
      console.log(chalk.gray(`    Info:      ${score.info}`));

    console.log(
      chalk.gray(`\n    Total:     ${score.total_findings}`),
    );
    if (score.suppressed > 0) {
      console.log(
        chalk.gray(`    Suppressed: ${score.suppressed}`),
      );
    }

    console.log(
      chalk.gray(`\n    Scan: ${latestScan.id}`),
    );
    console.log();
  });

// mcp — install/uninstall MCP server for AI agents
program
  .command("mcp")
  .description("Install/uninstall security as MCP server for AI agents")
  .option("--claude", "Install for Claude Code")
  .option("--codex", "Install for Codex")
  .option("--gemini", "Install for Gemini")
  .option("--all", "Install for all agents")
  .option("--uninstall", "Uninstall instead of install")
  .option("--scope <scope>", "Claude Code scope (user/project/local)", "user")
  .action(async (options) => {
    const uninstall = options.uninstall ?? false;
    const targets: string[] = [];

    if (options.all) {
      targets.push("claude", "codex", "gemini");
    } else {
      if (options.claude) targets.push("claude");
      if (options.codex) targets.push("codex");
      if (options.gemini) targets.push("gemini");
    }

    if (targets.length === 0) {
      console.log(chalk.bold("\n  security mcp \u2014 Install MCP server for AI agents\n"));
      console.log("  Usage:");
      console.log(chalk.gray("    security mcp --claude          Install for Claude Code"));
      console.log(chalk.gray("    security mcp --codex           Install for Codex"));
      console.log(chalk.gray("    security mcp --gemini          Install for Gemini"));
      console.log(chalk.gray("    security mcp --all             Install for all agents"));
      console.log(chalk.gray("    security mcp --all --uninstall Uninstall from all"));
      console.log(chalk.gray("    security mcp --claude --scope project  Install per-project\n"));
      return;
    }

    const mcpBin = getMcpBinPath();

    for (const target of targets) {
      try {
        if (target === "claude") {
          if (uninstall) {
            execSync("claude mcp remove security", { stdio: "pipe" });
            console.log(chalk.green("  Removed from Claude Code"));
          } else {
            const scope = options.scope || "user";
            execSync(
              `claude mcp add --transport stdio --scope ${scope} security -- ${mcpBin}`,
              { stdio: "pipe" },
            );
            console.log(chalk.green(`  Installed for Claude Code (scope: ${scope})`));
          }
        } else if (target === "codex") {
          const configPath = `${process.env.HOME}/.codex/config.toml`;
          if (uninstall) {
            removeCodexMcp(configPath);
            console.log(chalk.green("  Removed from Codex"));
          } else {
            addCodexMcp(configPath, mcpBin);
            console.log(chalk.green("  Installed for Codex"));
          }
        } else if (target === "gemini") {
          const configPath = `${process.env.HOME}/.gemini/settings.json`;
          if (uninstall) {
            removeGeminiMcp(configPath);
            console.log(chalk.green("  Removed from Gemini"));
          } else {
            addGeminiMcp(configPath, mcpBin);
            console.log(chalk.green("  Installed for Gemini"));
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`  Failed for ${target}: ${msg}`));
      }
    }

    console.log();
    if (!uninstall) {
      console.log(chalk.gray("  Restart your AI agent to use security MCP tools."));
      console.log();
    }
  });

// serve
program
  .command("serve")
  .description("Start the web dashboard")
  .option("--port <port>", "Port number", "19428")
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    console.log(
      chalk.bold(
        `\n  Starting security dashboard on port ${chalk.cyan(port.toString())}...\n`,
      ),
    );

    try {
      const serverPath = "../server/index.js";
      const server = (await import(serverPath)) as Record<string, unknown>;
      if (typeof server.startServer === "function") {
        await (server.startServer as (port: number) => Promise<void>)(port);
      } else if (typeof server.default === "function") {
        await (server.default as (port: number) => Promise<void>)(port);
      } else {
        console.log(
          chalk.yellow(
            "  Server module loaded but no startServer function found.",
          ),
        );
        console.log(
          chalk.gray("  Ensure src/server/index.ts exports a startServer(port) function.\n"),
        );
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`  Failed to start server: ${errMsg}\n`));
      process.exit(1);
    }
  });

// --- MCP Install Helpers ---

function getMcpBinPath(): string {
  try {
    const resolved = execSync("which security-mcp", { encoding: "utf-8" }).trim();
    if (resolved) return resolved;
  } catch {}

  try {
    const bunBin = execSync("bun pm bin -g", { encoding: "utf-8" }).trim();
    const candidate = `${bunBin}/security-mcp`;
    if (existsSync(candidate)) return candidate;
  } catch {}

  return "security-mcp";
}

function addCodexMcp(configPath: string, mcpBin: string): void {
  let content = "";
  try {
    content = readFileSync(configPath, "utf-8");
  } catch {}

  if (content.includes("[mcp_servers.security]")) {
    content = content.replace(
      /\[mcp_servers\.security\][^\[]*/s,
      `[mcp_servers.security]\ncommand = "${mcpBin}"\nargs = []\n\n`,
    );
  } else {
    content += `\n[mcp_servers.security]\ncommand = "${mcpBin}"\nargs = []\n`;
  }

  mkdirSync(configPath.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(configPath, content, "utf-8");
}

function removeCodexMcp(configPath: string): void {
  let content = "";
  try {
    content = readFileSync(configPath, "utf-8");
  } catch {
    return;
  }
  content = content.replace(/\n?\[mcp_servers\.security\][^\[]*/s, "");
  writeFileSync(configPath, content, "utf-8");
}

function addGeminiMcp(configPath: string, mcpBin: string): void {
  mkdirSync(configPath.replace(/\/[^/]+$/, ""), { recursive: true });
  let config: Record<string, any> = {};
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {}

  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers["security"] = { command: mcpBin, args: [] };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function removeGeminiMcp(configPath: string): void {
  let config: Record<string, any> = {};
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return;
  }
  if (config.mcpServers?.["security"]) {
    delete config.mcpServers["security"];
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

program.parse();
