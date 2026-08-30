import type { Command } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync, readdirSync, statSync, watch, createReadStream, openSync, readSync, closeSync } from "fs";
import { join } from "path";
import { REGISTRY } from "../registry.js";
import { HASNA_HOME, dataPath, dirExists } from "../utils.js";

const ACTIVITY_LOG = join(HASNA_HOME, "cloud", "activity.log");

const SERVICE_COLORS = [
  chalk.cyan,
  chalk.magenta,
  chalk.yellow,
  chalk.green,
  chalk.blue,
  chalk.red,
  chalk.white,
  chalk.gray,
  chalk.cyanBright,
  chalk.magentaBright,
  chalk.yellowBright,
  chalk.greenBright,
  chalk.blueBright,
  chalk.redBright,
];

function getServiceColor(service: string, colorMap: Map<string, (s: string) => string>): (s: string) => string {
  if (!colorMap.has(service)) {
    const idx = colorMap.size % SERVICE_COLORS.length;
    colorMap.set(service, SERVICE_COLORS[idx]);
  }
  return colorMap.get(service)!;
}

interface LogFile {
  service: string;
  path: string;
}

function findLogFiles(services?: string[]): LogFile[] {
  const results: LogFile[] = [];
  if (existsSync(ACTIVITY_LOG)) {
    results.push({ service: "cloud", path: ACTIVITY_LOG });
  }
  const targets = services && services.length > 0 ? REGISTRY.filter((p) => services.includes(p.name)) : REGISTRY;
  for (const pkg of targets) {
    const dp = dataPath(pkg.dataDir);
    if (!dirExists(dp)) continue;
    try {
      const entries = readdirSync(dp, { recursive: true });
      for (const entry of entries) {
        if (!String(entry).endsWith(".log")) continue;
        const full = join(dp, String(entry));
        try {
          if (statSync(full).isFile()) {
            results.push({ service: pkg.name, path: full });
          }
        } catch {
          /* unreadable */
        }
      }
    } catch {
      /* unreadable dir */
    }
  }
  return results;
}

function parseDuration(dur: string): number | null {
  const match = dur.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

function isErrorLine(line: string): boolean {
  const lower = line.toLowerCase();
  return lower.includes("error") || lower.includes("fail") || lower.includes("fatal") || lower.includes("panic");
}

function extractTimestamp(line: string): Date | null {
  const isoMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
  if (isoMatch) {
    const d = new Date(isoMatch[1]);
    if (!isNaN(d.getTime())) return d;
  }
  const bracketMatch = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
  if (bracketMatch) {
    const d = new Date(bracketMatch[1]);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function readLastLines(filePath: string, maxLines: number): string[] {
  try {
    // Read only the tail of the file (up to ~256 KiB) instead of the whole
    // log, so `logs --tail` stays bounded on large files.
    const { size } = statSync(filePath);
    const TAIL_BYTES = 256 * 1024;
    const fd = openSync(filePath, "r");
    try {
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      const content = buf.toString("utf8");
      const lines = content.split("\n").filter(Boolean);
      return lines.slice(-maxLines);
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
}

function formatLine(service: string, line: string, colorFn: (s: string) => string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  return `${chalk.dim("[")}${colorFn(service.padEnd(14))}${chalk.dim("]")} ${trimmed}`;
}

export function registerLogsCommand(program: Command): void {
  program
    .command("logs [services...]")
    .description("Unified log stream across services")
    .option("--errors", "Only show error lines")
    .option("--since <duration>", "Filter logs from duration ago (e.g. 1h, 30m, 2d)")
    .option("--tail <lines>", "Number of recent lines to show initially", "50")
    .option("--no-follow", "Print logs and exit without following")
    .action((services: string[], opts) => {
      const logFiles = findLogFiles(services.length > 0 ? services : undefined);
      if (logFiles.length === 0) {
        console.log(chalk.yellow("No log files found."));
        console.log(chalk.dim(`  Checked: ${ACTIVITY_LOG}`));
        console.log(chalk.dim(`  And per-service directories under ${HASNA_HOME}/`));
        return;
      }
      const colorMap = new Map<string, (s: string) => string>();
      const tailCount = parseInt(opts.tail, 10) || 50;
      let cutoff: Date | null = null;
      if (opts.since) {
        const ms = parseDuration(opts.since);
        if (ms === null) {
          console.error(chalk.red(`Invalid duration: ${opts.since}. Use format like 1h, 30m, 2d`));
          process.exit(1);
        }
        cutoff = new Date(Date.now() - ms);
      }
      console.log(chalk.bold("agency logs") + chalk.dim(` — streaming ${logFiles.length} log file(s)\n`));
      for (const lf of logFiles) {
        console.log(chalk.dim(`  ${lf.service}: ${lf.path}`));
      }
      console.log();
      for (const lf of logFiles) {
        const colorFn = getServiceColor(lf.service, colorMap);
        const lines = readLastLines(lf.path, tailCount);
        for (const line of lines) {
          if (opts.errors && !isErrorLine(line)) continue;
          if (cutoff) {
            const ts = extractTimestamp(line);
            if (ts && ts < cutoff) continue;
          }
          const formatted = formatLine(lf.service, line, colorFn);
          if (formatted) console.log(formatted);
        }
      }
      if (!opts.follow) return;
      console.log(chalk.dim(`\n--- watching for new lines (Ctrl+C to stop) ---\n`));
      const watchers: Array<{ close: () => void }> = [];
      const filePositions = new Map<string, number>();
      for (const lf of logFiles) {
        try {
          const size = statSync(lf.path).size;
          filePositions.set(lf.path, size);
        } catch {
          filePositions.set(lf.path, 0);
        }
      }
      for (const lf of logFiles) {
        const colorFn = getServiceColor(lf.service, colorMap);
        try {
          const watcher = watch(lf.path, () => {
            try {
              const currentSize = statSync(lf.path).size;
              const prevSize = filePositions.get(lf.path) || 0;
              if (currentSize <= prevSize) {
                filePositions.set(lf.path, currentSize);
                return;
              }
              const stream = createReadStream(lf.path, {
                start: prevSize,
                end: currentSize - 1,
                encoding: "utf8",
              });
              let buffer = "";
              stream.on("data", (chunk: string) => {
                buffer += chunk;
              });
              stream.on("end", () => {
                const newLines = buffer.split("\n").filter(Boolean);
                for (const line of newLines) {
                  if (opts.errors && !isErrorLine(line)) continue;
                  if (cutoff) {
                    const ts = extractTimestamp(line);
                    if (ts && ts < cutoff) continue;
                  }
                  const formatted = formatLine(lf.service, line, colorFn);
                  if (formatted) console.log(formatted);
                }
              });
              filePositions.set(lf.path, currentSize);
            } catch {
              /* ignore */
            }
          });
          watchers.push(watcher);
        } catch {
          /* ignore */
        }
      }
      process.on("SIGINT", () => {
        for (const w of watchers) {
          w.close();
        }
        console.log(chalk.dim(`\nStopped.`));
        process.exit(0);
      });
    });
}
