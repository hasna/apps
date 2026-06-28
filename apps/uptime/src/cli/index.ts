#!/usr/bin/env bun
import { Command, Option } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { UptimeService } from "../service.js";
import { UptimeStore } from "../store.js";
import { ensureUptimeHome, uptimeDbPath, uptimeHome } from "../paths.js";
import { packageVersion } from "../version.js";
import { serveUptime } from "../api.js";
import type { ImportSource } from "../imports.js";
import type { SendUptimeReportOptions, UptimeReportDelivery } from "../report.js";
import type { CreateMonitorInput, Monitor, UpdateMonitorInput, UptimeSummary } from "../types.js";

const program = new Command();

program
  .name("uptime")
  .description("Local-first uptime and downtime monitoring")
  .version(packageVersion())
  .option("-j, --json", "print JSON");

function service(): UptimeService {
  return new UptimeService({ mode: "local" });
}

function wantsJson(opts?: { json?: boolean }): boolean {
  return Boolean(opts?.json || program.opts().json);
}

function print(value: unknown, text: string, opts?: { json?: boolean }): void {
  if (wantsJson(opts)) console.log(JSON.stringify(value, null, 2));
  else console.log(sanitizeTerminal(text));
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (program.opts().json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(chalk.red(sanitizeTerminal(message)));
  process.exit(1);
}

program
  .command("init")
  .description("Initialize the local uptime store")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      ensureUptimeHome();
      const svc = service();
      svc.close();
      const data = { ok: true, home: uptimeHome(), dbPath: uptimeDbPath(), exists: existsSync(uptimeDbPath()) };
      print(data, `Initialized ${data.dbPath}`, opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("add <name>")
  .description("Add an HTTP or TCP monitor")
  .option("--url <url>", "HTTP/HTTPS URL to check")
  .option("--tcp <host>", "TCP host to connect to")
  .option("--port <port>", "TCP port", parseInteger)
  .option("--method <method>", "HTTP method", "GET")
  .option("--expected-status <status>", "exact expected HTTP status", parseInteger)
  .option("--interval <seconds>", "check interval in seconds", parseInteger, 60)
  .option("--timeout <ms>", "check timeout in milliseconds", parseInteger, 5000)
  .option("--retries <count>", "retry count before recording a down result", parseInteger, 0)
  .option("--disabled", "create the monitor disabled")
  .option("-j, --json", "print JSON")
  .action((name, opts) => {
    try {
      if (opts.url && opts.tcp) throw new Error("Choose either --url or --tcp, not both");
      const input: CreateMonitorInput = opts.tcp
        ? {
          name,
          kind: "tcp",
          host: opts.tcp,
          port: opts.port,
          intervalSeconds: opts.interval,
          timeoutMs: opts.timeout,
          retryCount: opts.retries,
          enabled: opts.disabled ? false : true,
        }
        : {
          name,
          kind: "http",
          url: opts.url,
          method: opts.method,
          expectedStatus: opts.expectedStatus,
          intervalSeconds: opts.interval,
          timeoutMs: opts.timeout,
          retryCount: opts.retries,
          enabled: opts.disabled ? false : true,
        };
      const svc = service();
      const monitor = svc.createMonitor(input);
      svc.close();
      print(monitor, `Added ${monitor.name} (${monitor.kind})`, opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("list")
  .description("List monitors")
  .option("--all", "include disabled monitors")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const svc = service();
      const monitors = svc.listMonitors({ includeDisabled: opts.all });
      svc.close();
      print(monitors, renderMonitors(monitors), opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("get <id-or-name>")
  .description("Show one monitor")
  .option("-j, --json", "print JSON")
  .action((idOrName, opts) => {
    try {
      const svc = service();
      const monitor = svc.getMonitor(idOrName);
      svc.close();
      if (!monitor) throw new Error(`Monitor not found: ${idOrName}`);
      print(monitor, renderMonitorDetail(monitor), opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("update <id-or-name>")
  .description("Update monitor configuration")
  .option("--name <name>", "new monitor name")
  .option("--url <url>", "switch/update to an HTTP/HTTPS URL")
  .option("--tcp <host>", "switch/update to a TCP host")
  .option("--port <port>", "TCP port", parseInteger)
  .option("--method <method>", "HTTP method")
  .option("--expected-status <status>", "exact expected HTTP status", parseInteger)
  .option("--interval <seconds>", "check interval in seconds", parseInteger)
  .option("--timeout <ms>", "check timeout in milliseconds", parseInteger)
  .option("--retries <count>", "retry count before recording a down result", parseInteger)
  .option("--enable", "enable the monitor")
  .option("--disable", "disable the monitor")
  .option("-j, --json", "print JSON")
  .action((idOrName, opts) => {
    try {
      if (opts.url && opts.tcp) throw new Error("Choose either --url or --tcp, not both");
      if (opts.enable && opts.disable) throw new Error("Choose either --enable or --disable, not both");
      const input: UpdateMonitorInput = {};
      if (opts.name !== undefined) input.name = opts.name;
      if (opts.url !== undefined) {
        input.kind = "http";
        input.url = opts.url;
      }
      if (opts.tcp !== undefined) {
        input.kind = "tcp";
        input.host = opts.tcp;
      }
      if (opts.port !== undefined) input.port = opts.port;
      if (opts.method !== undefined) input.method = opts.method;
      if (opts.expectedStatus !== undefined) input.expectedStatus = opts.expectedStatus;
      if (opts.interval !== undefined) input.intervalSeconds = opts.interval;
      if (opts.timeout !== undefined) input.timeoutMs = opts.timeout;
      if (opts.retries !== undefined) input.retryCount = opts.retries;
      if (opts.enable) {
        input.enabled = true;
      }
      if (opts.disable) {
        input.enabled = false;
      }
      const svc = service();
      const monitor = svc.updateMonitor(idOrName, input);
      svc.close();
      print(monitor, `Updated ${monitor.name}`, opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("pause <id-or-name>")
  .description("Disable a monitor")
  .option("-j, --json", "print JSON")
  .action((idOrName, opts) => {
    try {
      const svc = service();
      const monitor = svc.updateMonitor(idOrName, { enabled: false });
      svc.close();
      print(monitor, `Paused ${monitor.name}`, opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("resume <id-or-name>")
  .description("Enable a monitor")
  .option("-j, --json", "print JSON")
  .action((idOrName, opts) => {
    try {
      const svc = service();
      const monitor = svc.updateMonitor(idOrName, { enabled: true });
      svc.close();
      print(monitor, `Resumed ${monitor.name}`, opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("remove <id-or-name>")
  .alias("rm")
  .description("Remove a monitor and its local history")
  .option("-j, --json", "print JSON")
  .action((idOrName, opts) => {
    try {
      const svc = service();
      const deleted = svc.deleteMonitor(idOrName);
      svc.close();
      print({ deleted }, deleted ? `Removed ${idOrName}` : `Not found: ${idOrName}`, opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("check [id-or-name]")
  .description("Run a check for one monitor, or all monitors with --all")
  .option("--all", "check all enabled monitors")
  .option("-j, --json", "print JSON")
  .action(async (idOrName, opts) => {
    try {
      const svc = service();
      const result = opts.all ? await svc.checkAll() : await svc.checkMonitor(idOrName ?? "");
      svc.close();
      print(result, Array.isArray(result) ? renderCheckResults(result) : renderCheckResults([result]), opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("summary")
  .description("Show uptime summary")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const svc = service();
      const summary = svc.summary();
      svc.close();
      print(summary, renderSummary(summary), opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("report")
  .description("Build or send an uptime report through Mailery, Telephony, or Open Logs")
  .option("--email <to>", "send an email report to one or more comma-separated recipients through Mailery")
  .option("--from <email>", "Mailery from address")
  .option("--mailery-url <url>", "Mailery API URL")
  .option("--send-key <key>", "Mailery scoped send key")
  .option("--sms <phone>", "send an SMS report to one or more comma-separated phone numbers through Telephony")
  .option("--sms-from <phone>", "Telephony from phone number")
  .option("--telephony-url <url>", "Telephony API URL")
  .option("--logs", "write the report to Open Logs structured logs")
  .option("--logs-url <url>", "Open Logs API URL")
  .option("--logs-api-key <key>", "Open Logs API key")
  .option("--logs-project <id>", "Open Logs project id")
  .option("--subject <subject>", "report subject")
  .option("--dry-run", "print the report without sending")
  .option("-j, --json", "print JSON")
  .action(async (opts) => {
    try {
      const svc = service();
      const wantsDelivery = Boolean(opts.email || opts.sms || opts.logs);
      if (opts.dryRun || !wantsDelivery) {
        const report = svc.buildReport({ subject: opts.subject });
        svc.close();
        print(report, report.text, opts);
        return;
      }
      const input: SendUptimeReportOptions = {
        subject: opts.subject,
        email: opts.email ? {
          apiUrl: opts.maileryUrl,
          sendKey: opts.sendKey,
          from: opts.from,
          to: splitList(opts.email),
        } : undefined,
        sms: opts.sms ? {
          apiUrl: opts.telephonyUrl,
          from: opts.smsFrom,
          to: splitList(opts.sms),
        } : undefined,
        logs: opts.logs ? {
          apiUrl: opts.logsUrl,
          apiKey: opts.logsApiKey,
          projectId: opts.logsProject,
        } : undefined,
      };
      const deliveries = await svc.sendReport(input);
      svc.close();
      const failed = deliveries.filter((delivery) => !delivery.ok);
      print(deliveries, renderDeliveries(deliveries), opts);
      if (failed.length > 0) process.exit(1);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("results")
  .description("List recent check results")
  .option("--monitor <id>", "filter by monitor id")
  .option("--limit <n>", "max rows", parseInteger, 20)
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const svc = service();
      const results = svc.listResults({ monitorId: opts.monitor, limit: opts.limit });
      svc.close();
      print(results, renderCheckResults(results), opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("incidents")
  .description("List incidents")
  .addOption(new Option("--status <status>", "incident status").choices(["open", "closed"]))
  .option("--monitor <id>", "filter by monitor id")
  .option("--limit <n>", "max rows", parseInteger, 20)
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const svc = service();
      const incidents = svc.listIncidents({ status: opts.status, monitorId: opts.monitor, limit: opts.limit });
      svc.close();
      print(incidents, incidents.length ? incidents.map((i) => `${i.status.padEnd(6)} ${sanitizeField(i.monitorId)} ${i.openedAt} ${sanitizeField(i.reason ?? "")}`).join("\n") : "No incidents", opts);
    } catch (error) {
      fail(error);
    }
  });

const imports = program
  .command("imports")
  .description("Preview, apply, and rollback inventory imports");

imports
  .command("preview")
  .description("Preview monitor candidates from an import source without writing")
  .requiredOption("--source <source>", "manual, projects, servers, domains, or deployment")
  .option("--record <json>", "one JSON record")
  .option("--file <path>", "JSON file containing an array or { records }")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const svc = service();
      const preview = svc.previewImport(parseImportPayload(opts));
      svc.close();
      print(preview, renderImportPreview(preview), opts);
    } catch (error) {
      fail(error);
    }
  });

imports
  .command("apply")
  .description("Apply monitor candidates from an import source idempotently")
  .requiredOption("--source <source>", "manual, projects, servers, domains, or deployment")
  .option("--record <json>", "one JSON record")
  .option("--file <path>", "JSON file containing an array or { records }")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const svc = service();
      const result = svc.applyImport(parseImportPayload(opts));
      svc.close();
      print(result, `Applied import batch ${result.batchId}: ${renderImportTotals(result.totals)}`, opts);
    } catch (error) {
      fail(error);
    }
  });

imports
  .command("rollback <batch-id>")
  .description("Rollback config changes from an import batch while preserving check history")
  .option("-j, --json", "print JSON")
  .action((batchId, opts) => {
    try {
      const svc = service();
      const result = svc.rollbackImport(batchId);
      svc.close();
      print(result, `Rolled back import batch ${result.batchId}`, opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("backup [path]")
  .description("Create and verify a local SQLite backup")
  .option("-j, --json", "print JSON")
  .action((path, opts) => {
    try {
      const svc = service();
      const backup = svc.backup(path);
      const check = svc.verifyBackup(backup.backupPath);
      svc.close();
      const data = { ok: check.ok, backup, check };
      print(data, `Backed up ${backup.sourcePath} to ${backup.backupPath} (${backup.bytes} bytes)`, opts);
      if (!check.ok) process.exit(1);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("restore <backup-path>")
  .description("Restore a verified local SQLite backup")
  .option("--db <path>", "destination database path", uptimeDbPath())
  .option("--yes", "confirm overwrite of the destination database")
  .option("-j, --json", "print JSON")
  .action((backupPath, opts) => {
    try {
      if (!opts.yes) throw new Error("restore requires --yes");
      const restored = UptimeStore.restoreBackup(backupPath, opts.db);
      const check = UptimeStore.verifyBackup(opts.db);
      const data = { ok: check.ok, restored, check };
      print(data, `Restored ${backupPath} to ${opts.db}`, opts);
      if (!check.ok) process.exit(1);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("serve")
  .description("Serve the local API and dashboard")
  .option("--host <host>", "host to bind", "127.0.0.1")
  .option("--port <port>", "port", parseInteger, 3899)
  .option("--check", "run the scheduler while serving")
  .addOption(new Option("--mode <mode>", "runtime mode").choices(["local", "hosted"]).default("local"))
  .option("--api-token <token>", "token required for non-loopback mutation hosts")
  .option("--hosted-token <token>", "scoped hosted-mode token")
  .option("--allow-hosted-local-store", "allow hosted mode to use local SQLite as an explicit fallback")
  .option("--allow-unsafe-remote-mutations", "allow state-changing requests from non-loopback hosts without a token")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const { server } = serveUptime({
        host: opts.host,
        port: opts.port,
        check: opts.check,
        mode: opts.mode,
        apiToken: opts.apiToken,
        hostedToken: opts.hostedToken,
        allowHostedLocalStore: opts.allowHostedLocalStore,
        allowUnsafeRemoteMutations: opts.allowUnsafeRemoteMutations,
      });
      const data = { ok: true, url: `http://${server.hostname}:${server.port}`, scheduler: Boolean(opts.check), mode: opts.mode };
      if (wantsJson(opts)) console.log(JSON.stringify(data, null, 2));
      else console.log(`Open Uptime listening on ${chalk.cyan(data.url)}`);
    } catch (error) {
      fail(error);
    }
  });

function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Expected integer, got ${value}`);
  return parsed;
}

function renderMonitors(monitors: Monitor[]): string {
  if (monitors.length === 0) return "No monitors";
  return monitors.map((monitor) => {
    const target = monitor.kind === "tcp" ? `${monitor.host}:${monitor.port}` : monitor.url;
    const status = renderStatus(monitor.status).padEnd(14);
    return `${status} ${sanitizeField(monitor.name).padEnd(24)} ${monitor.kind.padEnd(4)} ${sanitizeField(target ?? "")}`;
  }).join("\n");
}

function renderMonitorDetail(monitor: Monitor): string {
  const target = monitor.kind === "tcp" ? `${monitor.host}:${monitor.port}` : monitor.url;
  return [
    `${chalk.bold(sanitizeField(monitor.name))} ${renderStatus(monitor.status)}`,
    `id: ${monitor.id}`,
    `kind: ${monitor.kind}`,
    `target: ${sanitizeField(target ?? "")}`,
    `interval: ${monitor.intervalSeconds}s`,
    `timeout: ${monitor.timeoutMs}ms`,
    `retries: ${monitor.retryCount}`,
    `enabled: ${monitor.enabled}`,
    `last checked: ${monitor.lastCheckedAt ?? "-"}`,
  ].join("\n");
}

function renderCheckResults(results: { status: string; monitorId: string; checkedAt: string; latencyMs: number | null; error: string | null }[]): string {
  if (results.length === 0) return "No results";
  return results.map((result) => {
    const latency = result.latencyMs == null ? "-" : `${result.latencyMs}ms`;
    return `${renderStatus(result.status).padEnd(12)} ${sanitizeField(result.monitorId)} ${result.checkedAt} ${latency} ${sanitizeField(result.error ?? "")}`;
  }).join("\n");
}

function parseImportPayload(opts: { source: string; record?: string; file?: string }) {
  if (opts.record && opts.file) throw new Error("Choose either --record or --file, not both");
  const raw = opts.record ?? (opts.file ? readFileSync(opts.file, "utf8") : undefined);
  if (!raw) throw new Error("imports require --record or --file");
  const parsed = JSON.parse(raw) as unknown;
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records)
      ? (parsed as { records: unknown[] }).records
      : [parsed];
  return { source: opts.source as ImportSource, records };
}

function renderImportPreview(preview: { totals: Record<string, number>; items: Array<{ action: string; candidate: { name: string; kind: string }; reason: string | null }> }): string {
  const rows = preview.items.map((item) => `${item.action.padEnd(9)} ${sanitizeField(item.candidate.name).padEnd(24)} ${item.candidate.kind}${item.reason ? ` ${sanitizeField(item.reason)}` : ""}`);
  return [`Import preview: ${renderImportTotals(preview.totals)}`, ...rows].join("\n");
}

function renderImportTotals(totals: Record<string, number>): string {
  return Object.entries(totals)
    .filter(([, count]) => count > 0)
    .map(([action, count]) => `${action}=${count}`)
    .join(" ") || "no changes";
}

function renderSummary(summary: UptimeSummary): string {
  const lines = [
    `monitors: ${summary.totals.monitors}  up: ${summary.totals.up}  down: ${summary.totals.down}  open incidents: ${summary.totals.openIncidents}`,
  ];
  for (const item of summary.monitors) {
    const uptime = item.uptimePercent == null ? "-" : `${item.uptimePercent.toFixed(2)}%`;
    const latency = item.averageLatencyMs == null ? "-" : `${item.averageLatencyMs}ms`;
    lines.push(`${renderStatus(item.monitor.status).padEnd(12)} ${sanitizeField(item.monitor.name).padEnd(24)} uptime ${uptime.padStart(8)} latency ${latency}`);
  }
  return lines.join("\n");
}

function renderDeliveries(deliveries: UptimeReportDelivery[]): string {
  if (deliveries.length === 0) return "No report deliveries requested";
  return deliveries.map((delivery) => {
    const status = delivery.ok ? chalk.green("sent") : chalk.red("failed");
    const detail = delivery.ok ? delivery.id ?? delivery.status ?? "" : delivery.error ?? "";
    return `${status.padEnd(12)} ${delivery.channel}${detail ? ` ${sanitizeField(String(detail))}` : ""}`;
  }).join("\n");
}

function renderStatus(status: string): string {
  if (status === "up") return chalk.green("up");
  if (status === "down") return chalk.red("down");
  if (status === "paused") return chalk.yellow("paused");
  return chalk.gray(status);
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function sanitizeTerminal(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}

function sanitizeField(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}

program.parseAsync(process.argv);
