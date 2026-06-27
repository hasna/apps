#!/usr/bin/env bun
import { Command, Option } from "commander";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { UptimeService } from "../service.js";
import { ensureUptimeHome, uptimeDbPath, uptimeHome } from "../paths.js";
import { packageVersion } from "../version.js";
import { serveUptime } from "../api.js";
import type { CreateMonitorInput, Monitor, UpdateMonitorInput, UptimeSummary } from "../types.js";

const program = new Command();

program
  .name("uptime")
  .description("Local-first uptime and downtime monitoring")
  .version(packageVersion())
  .option("-j, --json", "print JSON");

function service(): UptimeService {
  return new UptimeService();
}

function wantsJson(opts?: { json?: boolean }): boolean {
  return Boolean(opts?.json || program.opts().json);
}

function print(value: unknown, text: string, opts?: { json?: boolean }): void {
  if (wantsJson(opts)) console.log(JSON.stringify(value, null, 2));
  else console.log(text);
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (program.opts().json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(chalk.red(message));
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
      print(incidents, incidents.length ? incidents.map((i) => `${i.status.padEnd(6)} ${i.monitorId} ${i.openedAt} ${i.reason ?? ""}`).join("\n") : "No incidents", opts);
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
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const { server } = serveUptime({ host: opts.host, port: opts.port, check: opts.check });
      const data = { ok: true, url: `http://${server.hostname}:${server.port}`, scheduler: Boolean(opts.check) };
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
    const target = monitor.kind === "http" ? monitor.url : `${monitor.host}:${monitor.port}`;
    const status = renderStatus(monitor.status).padEnd(14);
    return `${status} ${monitor.name.padEnd(24)} ${monitor.kind.padEnd(4)} ${target}`;
  }).join("\n");
}

function renderMonitorDetail(monitor: Monitor): string {
  const target = monitor.kind === "http" ? monitor.url : `${monitor.host}:${monitor.port}`;
  return [
    `${chalk.bold(monitor.name)} ${renderStatus(monitor.status)}`,
    `id: ${monitor.id}`,
    `kind: ${monitor.kind}`,
    `target: ${target}`,
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
    return `${renderStatus(result.status).padEnd(12)} ${result.monitorId} ${result.checkedAt} ${latency} ${result.error ?? ""}`;
  }).join("\n");
}

function renderSummary(summary: UptimeSummary): string {
  const lines = [
    `monitors: ${summary.totals.monitors}  up: ${summary.totals.up}  down: ${summary.totals.down}  open incidents: ${summary.totals.openIncidents}`,
  ];
  for (const item of summary.monitors) {
    const uptime = item.uptimePercent == null ? "-" : `${item.uptimePercent.toFixed(2)}%`;
    const latency = item.averageLatencyMs == null ? "-" : `${item.averageLatencyMs}ms`;
    lines.push(`${renderStatus(item.monitor.status).padEnd(12)} ${item.monitor.name.padEnd(24)} uptime ${uptime.padStart(8)} latency ${latency}`);
  }
  return lines.join("\n");
}

function renderStatus(status: string): string {
  if (status === "up") return chalk.green("up");
  if (status === "down") return chalk.red("down");
  if (status === "paused") return chalk.yellow("paused");
  return chalk.gray(status);
}

program.parseAsync(process.argv);
