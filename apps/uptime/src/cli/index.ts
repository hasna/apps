#!/usr/bin/env bun
import { Command, Option } from "commander";
import chalk from "chalk";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { UptimeService } from "../service.js";
import { UptimeStore } from "../store.js";
import { ensureUptimeHome, uptimeDbPath, uptimeHome } from "../paths.js";
import { packageVersion } from "../version.js";
import { serveUptime } from "../api.js";
import { generateProbeKeyPair, signProbeResult } from "../probes.js";
import { buildAwsDeploymentPlan, buildPrivateProbeCloudConfig, renderPrivateProbeEnv } from "../cloud-plan.js";
import { buildPostgresMigrationPlan, renderPostgresMigrationPlan } from "../postgres-plan.js";
import { runHostedPublicChecksWorker } from "../workers.js";
import { runEdgeSmoke, type EdgeSmokeReport } from "../edge-smoke.js";
import type { AwsDeploymentPlan, PrivateProbeCloudConfig } from "../cloud-plan.js";
import type { PostgresMigrationPlan } from "../postgres-plan.js";
import type { ImportSource } from "../imports.js";
import type { SendUptimeReportOptions, UptimeReportDelivery } from "../report.js";
import type { CreateMonitorInput, Monitor, ProbePolicy, ProbeResultSubmission, ReportRun, ReportSchedule, ReportScheduleChannels, UpdateMonitorInput, UptimeSummary } from "../types.js";

const program = new Command();

program
  .name("uptime")
  .description("Local-first uptime and downtime monitoring")
  .version(packageVersion())
  .option("-j, --json", "print JSON");

function service(): UptimeService {
  return new UptimeService({ mode: "local" });
}

function hostedService(opts: { hostedSqliteDb?: string; allowHostedLocalStore?: boolean }): UptimeService {
  return new UptimeService({
    mode: "hosted",
    hostedSqliteDbPath: opts.hostedSqliteDb,
    allowHostedLocalStore: opts.allowHostedLocalStore,
  });
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

const reportSchedules = program
  .command("report-schedules")
  .alias("schedules")
  .description("Manage scheduled uptime reports");

reportSchedules
  .command("create <name>")
  .description("Create a scheduled uptime report")
  .requiredOption("--interval <seconds>", "report interval in seconds", parseInteger)
  .option("--next-run-at <iso>", "first due timestamp", new Date().toISOString())
  .option("--subject <subject>", "report subject")
  .option("--email <to>", "email recipients; Mailery send key is read from env at run time")
  .option("--from <email>", "Mailery from address")
  .option("--mailery-url <url>", "Mailery API URL")
  .option("--sms <phone>", "SMS recipients")
  .option("--sms-from <phone>", "Telephony from phone number")
  .option("--telephony-url <url>", "Telephony API URL")
  .option("--logs", "write scheduled report runs to Open Logs")
  .option("--logs-url <url>", "Open Logs API URL")
  .option("--logs-project <id>", "Open Logs project id")
  .option("--disabled", "create the schedule disabled")
  .option("-j, --json", "print JSON")
  .action((name, opts) => {
    try {
      const svc = service();
      const schedule = svc.createReportSchedule({
        name,
        intervalSeconds: opts.interval,
        nextRunAt: opts.nextRunAt,
        enabled: opts.disabled ? false : true,
        subject: opts.subject,
        channels: buildReportScheduleChannels(opts),
      });
      svc.close();
      print(schedule, `Created report schedule ${schedule.name}`, opts);
    } catch (error) {
      fail(error);
    }
  });

reportSchedules
  .command("list")
  .description("List scheduled uptime reports")
  .option("--all", "include disabled schedules")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const svc = service();
      const schedules = svc.listReportSchedules({ includeDisabled: opts.all });
      svc.close();
      print(schedules, renderReportSchedules(schedules), opts);
    } catch (error) {
      fail(error);
    }
  });

reportSchedules
  .command("run <id-or-name>")
  .description("Run one scheduled report now and record a run")
  .option("-j, --json", "print JSON")
  .action(async (idOrName, opts) => {
    try {
      const svc = service();
      const run = await svc.runReportSchedule(idOrName);
      svc.close();
      print(run, renderReportRuns([run]), opts);
      if (run.status === "failed") process.exit(1);
    } catch (error) {
      fail(error);
    }
  });

reportSchedules
  .command("run-due")
  .description("Run all due scheduled reports and record runs")
  .option("--now <iso>", "due timestamp", new Date().toISOString())
  .option("-j, --json", "print JSON")
  .action(async (opts) => {
    try {
      const svc = service();
      const runs = await svc.runDueReportSchedules(new Date(opts.now));
      svc.close();
      print(runs, renderReportRuns(runs), opts);
      if (runs.some((run) => run.status === "failed")) process.exit(1);
    } catch (error) {
      fail(error);
    }
  });

reportSchedules
  .command("delete <id-or-name>")
  .alias("rm")
  .description("Delete a scheduled uptime report")
  .option("-j, --json", "print JSON")
  .action((idOrName, opts) => {
    try {
      const svc = service();
      const deleted = svc.deleteReportSchedule(idOrName);
      svc.close();
      print({ deleted }, deleted ? `Deleted report schedule ${idOrName}` : `Not found: ${idOrName}`, opts);
    } catch (error) {
      fail(error);
    }
  });

reportSchedules
  .command("runs")
  .description("List scheduled report runs")
  .option("--schedule <id>", "filter by report schedule id")
  .option("--limit <n>", "max rows", parseInteger, 20)
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const svc = service();
      const runs = svc.listReportRuns({ scheduleId: opts.schedule, limit: opts.limit });
      svc.close();
      print(runs, renderReportRuns(runs), opts);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("audit")
  .description("List local audit events")
  .option("--resource-type <type>", "filter by resource type")
  .option("--resource-id <id>", "filter by resource id")
  .option("--limit <n>", "max rows", parseInteger, 20)
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const svc = service();
      const events = svc.listAuditEvents({
        resourceType: opts.resourceType,
        resourceId: opts.resourceId,
        limit: opts.limit,
      });
      svc.close();
      print(events, events.length ? events.map((event) => `${event.createdAt} ${event.action} ${sanitizeField(event.resourceType ?? "-")} ${sanitizeField(event.resourceId ?? "-")} ${sanitizeField(event.message ?? "")}`).join("\n") : "No audit events", opts);
    } catch (error) {
      fail(error);
    }
  });

const cloud = program
  .command("cloud")
  .description("Generate dry-run cloud deployment and private-probe configuration artifacts");

cloud
  .command("plan")
  .description("Generate a dry-run AWS deployment plan")
  .option("--account <name>", "AWS account/profile label", "aws-profile")
  .option("--region <region>", "AWS region", "us-east-1")
  .option("--stage <stage>", "deployment stage", "prod")
  .option("--hostname <hostname>", "hosted Open Uptime hostname", "uptime.example.com")
  .option("--workspace-id <id>", "workspace id", "workspace-id")
  .option("--vpc-id <id>", "target VPC id")
  .option("--hosted-sqlite-db <path>", "hosted SQLite path on the EFS mount")
  .option("--rds-instance-id <id>", "deprecated; ignored until the hosted Postgres adapter exists")
  .option("--database-secret-name <name>", "deprecated; ignored until the hosted Postgres adapter exists")
  .option("--ecr-repository <name>", "ECR repository name")
  .option("--image <uri>", "container image URI")
  .option("--runtime-package-version <version>", "published @hasna/uptime version for the AWS image builder")
  .option("--runtime-package-integrity <integrity>", "expected npm dist.integrity for the runtime package")
  .addOption(new Option("--protected-access-mode <mode>", "protected web access mode").choices(["cloudfront_default_domain", "alb_https_cert"]).default("cloudfront_default_domain"))
  .addOption(new Option("--cloudfront-origin-protocol-policy <policy>", "CloudFront-to-ALB origin protocol policy").choices(["http-only", "https-only"]).default("http-only"))
  .option("--cloudfront-origin-domain-name <hostname>", "origin hostname for CloudFront https-only mode; must resolve to the ALB and match certificate_arn")
  .option("--evidence-bucket <name>", "S3 evidence bucket name")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const plan = buildAwsDeploymentPlan({
        accountName: opts.account,
        region: opts.region,
        stage: opts.stage,
        hostname: opts.hostname,
        workspaceId: opts.workspaceId,
        vpcId: opts.vpcId,
        hostedSqliteDbPath: opts.hostedSqliteDb,
        rdsInstanceId: opts.rdsInstanceId,
        databaseSecretName: opts.databaseSecretName,
        ecrRepository: opts.ecrRepository,
        image: opts.image,
        runtimePackageVersion: opts.runtimePackageVersion,
        runtimePackageIntegrity: opts.runtimePackageIntegrity,
        protectedAccessMode: opts.protectedAccessMode,
        cloudfrontOriginProtocolPolicy: opts.cloudfrontOriginProtocolPolicy,
        cloudfrontOriginDomainName: opts.cloudfrontOriginDomainName,
        evidenceBucket: opts.evidenceBucket,
      });
      print(plan, renderCloudPlan(plan), opts);
    } catch (error) {
      fail(error);
    }
  });

cloud
  .command("postgres-plan")
  .description("Generate the blocked Postgres cloud-store schema and RLS migration plan")
  .option("--schema <name>", "Postgres schema name", "uptime")
  .option("--database-url <url>", "Postgres URL to validate and redact; defaults to HASNA_UPTIME_DATABASE_URL")
  .option("--workspace-setting <name>", "session setting used by RLS policies", "app.workspace_id")
  .option("--sql", "print SQL instead of the summary text")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const plan = buildPostgresMigrationPlan({
        schemaName: opts.schema,
        databaseUrl: opts.databaseUrl,
        workspaceSetting: opts.workspaceSetting,
      });
      if (opts.sql && !wantsJson(opts)) {
        console.log(renderPostgresMigrationSql(plan));
        return;
      }
      print(plan, renderPostgresMigrationPlan(plan), opts);
    } catch (error) {
      fail(error);
    }
  });

cloud
  .command("private-probe-config")
  .description("Generate hosted-targeted private probe preflight configuration")
  .option("--api-url <url>", "hosted Open Uptime API URL", "https://uptime.example.com/api/v1")
  .option("--workspace-id <id>", "workspace id", "workspace-id")
  .option("--probe-id <id>", "cloud registered private probe id")
  .option("--private-key-file <path>", "private probe key file", "~/.hasna/uptime/probes/private-probe-01.key.pem")
  .option("--machine-id <id>", "machine id", "private-probe-01")
  .option("--log-level <level>", "probe log level", "info")
  .option("--env", "print shell env file instead of summary text")
  .option("--allow-blocked-env", "print the blocked preflight env anyway for review artifacts; do not start the probe")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const config = buildPrivateProbeCloudConfig({
        apiUrl: opts.apiUrl,
        workspaceId: opts.workspaceId,
        probeId: opts.probeId,
        probePrivateKeyFile: opts.privateKeyFile,
        machineId: opts.machineId,
        logLevel: opts.logLevel,
      });
      if (opts.env && !wantsJson(opts)) {
        console.log(renderPrivateProbeEnv(config, { allowBlocked: opts.allowBlockedEnv }));
        return;
      }
      print(config, renderPrivateProbeConfig(config), opts);
    } catch (error) {
      fail(error);
    }
  });

const cloudWorkers = cloud
  .command("workers")
  .description("Inspect and run hosted worker entrypoints");

cloud
  .command("edge-smoke")
  .description("Smoke protected hosted web access without printing tokens")
  .requiredOption("--url <url>", "CloudFront or protected edge URL")
  .requiredOption("--workspace-id <id>", "workspace id to verify")
  .option("--read-token-env <name>", "environment variable containing a scoped read token", "HASNA_UPTIME_EDGE_READ_TOKEN")
  .option("--write-token-env <name>", "environment variable containing a scoped write token", "HASNA_UPTIME_EDGE_WRITE_TOKEN")
  .option("--probe-token-env <name>", "environment variable containing a scoped probe token", "HASNA_UPTIME_EDGE_PROBE_TOKEN")
  .option("--report-token-env <name>", "environment variable containing a scoped report token", "HASNA_UPTIME_EDGE_REPORT_TOKEN")
  .option("--admin-token-env <name>", "optional fallback environment variable containing a scoped admin token", "HASNA_UPTIME_EDGE_ADMIN_TOKEN")
  .option("--mutation", "create and delete a disabled smoke monitor with the write token")
  .option("--direct-origin-url <url>", "direct ALB/origin URL that must deny requests without the CloudFront origin header")
  .option("--direct-origin-allowed-status <statuses>", "comma-separated statuses accepted for direct-origin denial", parseStatusList, [403])
  .option("--allow-direct-origin-unreachable", "treat a direct-origin timeout/refusal as explicit denial evidence for private-network ALB models")
  .option("--timeout-ms <ms>", "per-request timeout in milliseconds", parseInteger, 10_000)
  .option("--smoke-id <id>", "stable smoke id for evidence and cleanup naming")
  .option("--require-promotion-ready", "exit non-zero unless mutation and direct-origin checks also passed")
  .option("-j, --json", "print JSON")
  .action(async (opts) => {
    try {
      const report = await runEdgeSmoke({
        url: opts.url,
        workspaceId: opts.workspaceId,
        readToken: readTokenEnv(opts.readTokenEnv),
        writeToken: readTokenEnv(opts.writeTokenEnv),
        probeToken: readTokenEnv(opts.probeTokenEnv),
        reportToken: readTokenEnv(opts.reportTokenEnv),
        adminToken: readTokenEnv(opts.adminTokenEnv),
        mutation: opts.mutation,
        directOriginUrl: opts.directOriginUrl,
        directOriginAllowedStatuses: opts.directOriginAllowedStatus,
        directOriginUnreachableAllowed: opts.allowDirectOriginUnreachable,
        timeoutMs: opts.timeoutMs,
        smokeId: opts.smokeId,
      });
      print(report, renderEdgeSmokeReport(report), opts);
      if (report.status === "failed" || (opts.requirePromotionReady && !report.promotionReady)) process.exit(1);
    } catch (error) {
      fail(error);
    }
  });

cloudWorkers
  .command("preflight")
  .description("Check one hosted worker entrypoint without starting work")
  .requiredOption("--role <role>", "scheduler, public-probe, reporter, or migration")
  .option("--healthcheck", "exit non-zero when hosted mode, component, or workspace env is invalid")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const preflight = buildHostedWorkerPreflight(parseWorkerRole(opts.role));
      print(preflight, renderHostedWorkerPreflight(preflight), opts);
      if (opts.healthcheck && !hostedWorkerEnvironmentOk(preflight)) process.exit(1);
    } catch (error) {
      fail(error);
    }
  });

cloudWorkers
  .command("run")
  .description("Run one hosted worker entrypoint; fails closed until cloud prerequisites exist")
  .requiredOption("--role <role>", "scheduler, public-probe, reporter, or migration")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const preflight = buildHostedWorkerPreflight(parseWorkerRole(opts.role));
      const error = `hosted ${preflight.role} worker runtime is blocked until cloud prerequisites exist`;
      if (wantsJson(opts)) {
        console.log(JSON.stringify({ ok: false, error, preflight }, null, 2));
      } else {
        console.error(chalk.red(sanitizeTerminal(error)));
        console.error(renderHostedWorkerPreflight(preflight));
      }
      process.exit(1);
    } catch (error) {
      fail(error);
    }
  });

const cloudPublicChecks = cloud
  .command("public-checks")
  .description("Run hosted public HTTP/TCP checks against the configured hosted store");

cloudPublicChecks
  .command("run-due")
  .description("Run due hosted public HTTP/TCP checks for one workspace")
  .option("--workspace-id <id>", "workspace id; defaults to HASNA_UPTIME_WORKSPACE_ID")
  .option("--now <iso>", "due timestamp", new Date().toISOString())
  .option("--hosted-sqlite-db <path>", "hosted SQLite path on cloud-mounted storage")
  .option("--allow-hosted-local-store", "allow hosted mode to use local SQLite as an explicit fallback")
  .option("-j, --json", "print JSON")
  .action(async (opts) => {
    try {
      const svc = hostedService({
        hostedSqliteDb: opts.hostedSqliteDb,
        allowHostedLocalStore: opts.allowHostedLocalStore,
      });
      const workspaceId = opts.workspaceId || process.env.HASNA_UPTIME_WORKSPACE_ID;
      const results = await svc.runDueHostedPublicChecks(new Date(opts.now), { workspaceId });
      svc.close();
      const data = { ok: true, workspaceId, checked: results.length, results };
      print(data, results.length ? renderCheckResults(results) : "No due hosted public checks", opts);
    } catch (error) {
      fail(error);
    }
  });

cloudPublicChecks
  .command("worker")
  .description("Run a bounded EFS SQLite bridge loop around hosted public checks")
  .option("--workspace-id <id>", "workspace id; defaults to HASNA_UPTIME_WORKSPACE_ID")
  .option("--interval-ms <ms>", "sleep interval between iterations", parseInteger, 30_000)
  .option("--max-runtime-ms <ms>", "stop after this many milliseconds", parseInteger)
  .option("--max-iterations <n>", "stop after this many iterations", parseInteger)
  .option("--hosted-sqlite-db <path>", "hosted SQLite path on cloud-mounted storage")
  .option("--allow-hosted-local-store", "allow hosted mode to use local SQLite as an explicit fallback")
  .option("-j, --json", "print JSON")
  .action(async (opts) => {
    const abortController = new AbortController();
    const onSignal = () => abortController.abort();
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    try {
      const svc = hostedService({
        hostedSqliteDb: opts.hostedSqliteDb,
        allowHostedLocalStore: opts.allowHostedLocalStore,
      });
      const workspaceId = opts.workspaceId || process.env.HASNA_UPTIME_WORKSPACE_ID;
      const summary = await runHostedPublicChecksWorker({
        runner: svc,
        workspaceId,
        intervalMs: opts.intervalMs,
        maxRuntimeMs: opts.maxRuntimeMs,
        maxIterations: opts.maxIterations,
        signal: abortController.signal,
        onIteration: wantsJson(opts)
          ? undefined
          : (iteration) => {
            console.log(`iteration ${iteration.iteration}: checked ${iteration.checked}`);
          },
      });
      svc.close();
      print(summary, renderHostedPublicChecksWorkerSummary(summary), opts);
    } catch (error) {
      fail(error);
    } finally {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
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

const probes = program
  .command("probes")
  .description("Manage private probe identities and signed probe result submissions");

probes
  .command("create <name>")
  .description("Create a private probe identity; generates an Ed25519 keypair unless --public-key-file is provided")
  .option("--public-key-file <path>", "PEM public key file for an externally managed probe key")
  .option("--private-key-file <path>", "where to write a generated PEM private key; required unless --public-key-file is used")
  .option("--workspace <id>", "workspace id for the local probe identity")
  .addOption(new Option("--probe-class <class>", "probe class").choices(["public", "private"]).default("private"))
  .option("--probe-location <location>", "probe location", "local")
  .option("--machine-id <id>", "machine id for private probe operators")
  .option("--disabled", "create the probe disabled")
  .option("-j, --json", "print JSON")
  .action((name, opts) => {
    let generatedPrivateKeyFile: string | undefined;
    let svc: UptimeService | undefined;
    try {
      if (opts.publicKeyFile && opts.privateKeyFile) throw new Error("Choose either --public-key-file or --private-key-file, not both");
      if (!opts.publicKeyFile && !opts.privateKeyFile) throw new Error("generated probe keys require --private-key-file");
      const generatedKeyPair = opts.publicKeyFile ? undefined : generateProbeKeyPair();
      if (generatedKeyPair) {
        writeFileSync(opts.privateKeyFile, generatedKeyPair.privateKeyPem, { mode: 0o600, flag: "wx" });
        generatedPrivateKeyFile = opts.privateKeyFile;
      }
      svc = service();
      const probe = svc.createProbe({
        name,
        publicKeyPem: opts.publicKeyFile ? readFileSync(opts.publicKeyFile, "utf8") : generatedKeyPair?.publicKeyPem,
        workspaceId: opts.workspace,
        probeClass: opts.probeClass,
        probeLocation: opts.probeLocation,
        machineId: opts.machineId,
        enabled: opts.disabled ? false : true,
      });
      svc.close();
      svc = undefined;
      const output = generatedPrivateKeyFile
        ? { ...probe, privateKeyFile: generatedPrivateKeyFile }
        : probe;
      print(output, `Created probe ${probe.name} (${probe.id})`, opts);
    } catch (error) {
      svc?.close();
      if (generatedPrivateKeyFile) {
        try {
          unlinkSync(generatedPrivateKeyFile);
        } catch {
          // Best-effort cleanup; the original create error is more useful.
        }
      }
      fail(error);
    }
  });

probes
  .command("list")
  .description("List private probe identities")
  .option("--all", "include disabled probes")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const svc = service();
      const items = svc.listProbes({ includeDisabled: opts.all });
      svc.close();
      print(items, items.length ? items.map((item) => `${item.enabled ? "enabled " : "disabled"} ${item.id} ${sanitizeField(item.workspaceId)} ${item.probeClass} ${sanitizeField(item.probeLocation)} ${sanitizeField(item.name)} ${item.lastSeenAt ?? "-"}`).join("\n") : "No probes", opts);
    } catch (error) {
      fail(error);
    }
  });

const probeJobs = probes
  .command("jobs")
  .description("Create and claim private probe check jobs");

probeJobs
  .command("create")
  .description("Create a probe check job for one monitor and schedule slot")
  .requiredOption("--monitor <id>", "monitor id")
  .requiredOption("--schedule-slot <slot>", "unique schedule slot for this monitor")
  .option("--due-at <iso>", "when the job is due", new Date().toISOString())
  .option("--workspace <id>", "workspace id for hosted-style local stores")
  .addOption(new Option("--probe-class <class>", "required probe class").choices(["public", "private"]).default("private"))
  .option("--probe-locations <locations>", "comma-separated allowed probe locations")
  .option("-j, --json", "print JSON")
  .action((opts) => {
    try {
      const svc = service();
      const probePolicy: ProbePolicy = {
        probeClass: opts.probeClass,
        locations: parseLocations(opts.probeLocations),
      };
      const job = svc.createProbeCheckJob({
        workspaceId: opts.workspace,
        monitorId: opts.monitor,
        scheduleSlot: opts.scheduleSlot,
        dueAt: opts.dueAt,
        probePolicy,
      });
      svc.close();
      print(job, `Created probe job ${job.id} for ${job.monitorId}`, opts);
    } catch (error) {
      fail(error);
    }
  });

probeJobs
  .command("claim <job-id>")
  .description("Claim a probe check job and receive its fencing token")
  .requiredOption("--probe <id>", "probe id")
  .option("--lease-ms <ms>", "lease duration in milliseconds", parseInteger, 120_000)
  .option("-j, --json", "print JSON")
  .action((jobId, opts) => {
    try {
      const svc = service();
      const job = svc.claimProbeCheckJob({
        jobId,
        probeId: opts.probe,
        leaseTtlMs: opts.leaseMs,
      });
      svc.close();
      print(job, `Claimed probe job ${job.id}`, opts);
    } catch (error) {
      fail(error);
    }
  });

probes
  .command("submit")
  .description("Submit a signed probe result locally or to a remote Open Uptime API")
  .requiredOption("--probe <id>", "probe id")
  .requiredOption("--job <id>", "claimed probe job id")
  .requiredOption("--schedule-slot <slot>", "schedule slot from the claimed job")
  .requiredOption("--fencing-token <token>", "fencing token from the claimed job")
  .requiredOption("--monitor <id>", "monitor id")
  .requiredOption("--private-key-file <path>", "PEM private key file used to sign the result")
  .addOption(new Option("--status <status>", "probe result status").choices(["up", "down"]).makeOptionMandatory())
  .option("--nonce <nonce>", "unique submission nonce")
  .option("--checked-at <iso>", "check timestamp", new Date().toISOString())
  .option("--latency <ms>", "latency in milliseconds", parseNumber)
  .option("--status-code <status>", "HTTP status code", parseInteger)
  .option("--error <message>", "failure message")
  .option("--attempts <count>", "attempt count", parseInteger, 1)
  .requiredOption("--monitor-revision <revision>", "monitor revision observed by the probe", parseInteger)
  .option("--api-url <url>", "remote Open Uptime base URL; submits to /api/probes/results unless the URL already ends in /api or /api/v1")
  .option("--token <token>", "Bearer token for the remote hosted API")
  .option("-j, --json", "print JSON")
  .action(async (opts) => {
    try {
      const submission = buildProbeSubmission(opts);
      if (opts.apiUrl) {
        const response = await fetch(probeSubmitUrl(opts.apiUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          },
          body: JSON.stringify(submission),
        });
        const body = await response.json();
        print(body, response.ok ? `Submitted probe result for ${submission.monitorId}` : JSON.stringify(body), opts);
        if (!response.ok) process.exit(1);
        return;
      }
      const svc = service();
      const result = svc.submitProbeResult(submission);
      svc.close();
      print(result, `Submitted probe result for ${submission.monitorId}`, opts);
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
  .option("--hosted-token <token>", "hosted-mode token for local/dev use; deployments should prefer scoped hosted-token JSON in secret env")
  .option("--hosted-sqlite-db <path>", "absolute SQLite database path on hosted cloud-mounted storage")
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
        hostedSqliteDbPath: opts.hostedSqliteDb,
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

function parseStatusList(value: string): number[] {
  const statuses = value.split(",").map((item) => parseInteger(item.trim()));
  if (statuses.length === 0) throw new Error("Expected at least one HTTP status");
  return statuses;
}

function readTokenEnv(name: string): string | undefined {
  const envName = name.trim();
  if (!envName) throw new Error("token environment variable name cannot be empty");
  return process.env[envName]?.trim() || undefined;
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected number, got ${value}`);
  return parsed;
}

function parseLocations(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function buildProbeSubmission(opts: {
  probe: string;
  job: string;
  scheduleSlot: string;
  fencingToken: string;
  monitor: string;
  privateKeyFile: string;
  status: "up" | "down";
  nonce?: string;
  checkedAt: string;
  latency?: number;
  statusCode?: number;
  error?: string;
  attempts?: number;
  monitorRevision: number;
}): ProbeResultSubmission {
  const input = {
    probeId: opts.probe,
    jobId: opts.job,
    scheduleSlot: opts.scheduleSlot,
    fencingToken: opts.fencingToken,
    monitorId: opts.monitor,
    nonce: opts.nonce ?? `cli_${randomUUID()}`,
    checkedAt: opts.checkedAt,
    status: opts.status,
    latencyMs: opts.latency ?? null,
    statusCode: opts.statusCode,
    error: opts.error,
    attemptCount: opts.attempts,
    monitorRevision: opts.monitorRevision,
    evidence: null,
  };
  return {
    ...input,
    signature: signProbeResult(input, readFileSync(opts.privateKeyFile, "utf8")),
  };
}

function probeSubmitUrl(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  if (/\/api\/v1$/.test(base)) return `${base}/probes/results`;
  if (/\/api$/.test(base)) return `${base}/probes/results`;
  return `${base}/api/probes/results`;
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

function buildReportScheduleChannels(opts: {
  email?: string;
  from?: string;
  maileryUrl?: string;
  sms?: string;
  smsFrom?: string;
  telephonyUrl?: string;
  logs?: boolean;
  logsUrl?: string;
  logsProject?: string;
}): ReportScheduleChannels {
  const channels: ReportScheduleChannels = {};
  if (opts.email) {
    channels.email = {
      apiUrl: opts.maileryUrl,
      from: opts.from,
      to: splitList(opts.email),
    };
  }
  if (opts.sms) {
    channels.sms = {
      apiUrl: opts.telephonyUrl,
      from: opts.smsFrom,
      to: splitList(opts.sms),
    };
  }
  if (opts.logs) {
    channels.logs = {
      apiUrl: opts.logsUrl,
      projectId: opts.logsProject,
    };
  }
  return channels;
}

function renderReportSchedules(schedules: ReportSchedule[]): string {
  if (schedules.length === 0) return "No report schedules";
  return schedules.map((schedule) => {
    const status = schedule.enabled ? "enabled " : "disabled";
    const channels = (["email", "sms", "logs"] as const).filter((channel) => Boolean(schedule.channels[channel])).join(",");
    return `${status} ${schedule.id} ${sanitizeField(schedule.name).padEnd(24)} every ${schedule.intervalSeconds}s next ${schedule.nextRunAt} ${channels}`;
  }).join("\n");
}

function renderReportRuns(runs: ReportRun[]): string {
  if (runs.length === 0) return "No report runs";
  return runs.map((run) => {
    const status = run.status === "success" ? chalk.green("success") : chalk.red("failed");
    const deliveries = run.deliveries.map((delivery) => `${delivery.channel}:${delivery.ok ? "ok" : "failed"}`).join(",");
    return `${status.padEnd(12)} ${run.id} ${run.scheduleId ?? "-"} ${run.finishedAt} ${deliveries}${run.error ? ` ${sanitizeField(run.error)}` : ""}`;
  }).join("\n");
}

function renderCloudPlan(plan: AwsDeploymentPlan): string {
  return [
    `${plan.servicePrefix} ${plan.stage} AWS plan (${plan.accountName}/${plan.region})`,
    `status: ${plan.status}`,
    `can apply: ${plan.canApply}`,
    `host: ${plan.hostname}`,
    `cluster: ${plan.resources.ecsCluster}`,
    `image: ${plan.image.uri}`,
    ...(plan.image.expectedIntegrity ? [`package integrity: ${plan.image.expectedIntegrity}`] : []),
    `image builder: ${plan.resources.imageBuilder}`,
    `dockerfile: ${plan.image.dockerfile}`,
    `infra: ${plan.infra.path}`,
    `vpc: ${plan.resources.vpcId}`,
    `efs: ${plan.resources.efsFileSystem}`,
    `hosted sqlite: ${plan.resources.hostedSqliteDbPath}`,
    `protected access: ${plan.resources.protectedAccessMode} ${plan.resources.protectedAccessUrl}`,
    ...(plan.resources.cloudfrontOrigin ? [`cloudfront origin: ${plan.resources.cloudfrontOrigin.protocolPolicy} ${plan.resources.cloudfrontOrigin.domainName}`] : []),
    `services: ${plan.resources.services.map((service) => `${service.name}:${service.desiredCount}/${service.targetDesiredCount}`).join(", ")}`,
    `evidence bucket: ${plan.resources.evidenceBucket}`,
    `blockers: ${plan.blockers.length}`,
    "live AWS mutation: false",
  ].join("\n");
}

function renderPrivateProbeConfig(config: PrivateProbeCloudConfig): string {
  return [
    `${config.machineId} ${config.mode} config`,
    `status: ${config.status}`,
    `can start: ${config.canStart}`,
    `api: ${config.env.HASNA_UPTIME_API_URL}`,
    `workspace: ${config.env.HASNA_UPTIME_WORKSPACE_ID}`,
    `probe: ${config.env.HASNA_UPTIME_PRIVATE_PROBE_ID ?? "<required>"}`,
    `key file: ${config.env.HASNA_UPTIME_PRIVATE_PROBE_KEY_FILE}`,
    `blockers: ${config.blockers.length}`,
    "private key inline: false",
    "token inline: false",
  ].join("\n");
}

function renderPostgresMigrationSql(plan: PostgresMigrationPlan): string {
  return [
    "-- Open Uptime Postgres migration plan",
    "-- Review and apply only through the approved private infra/runbook path.",
    "-- This CLI never connects to Postgres or prints database credentials.",
    ...plan.migrationStatements,
    ...plan.rlsStatements,
  ].join("\n\n");
}

interface HostedPublicChecksWorkerSummary {
  kind: "open-uptime.hosted-public-checks-worker";
  status: "completed" | "stopped";
  workspaceId: string | null;
  iterations: number;
  checked: number;
  startedAt: string;
  finishedAt: string;
}

function renderHostedPublicChecksWorkerSummary(summary: HostedPublicChecksWorkerSummary): string {
  return [
    "hosted public checks worker",
    `status: ${summary.status}`,
    `workspace: ${summary.workspaceId ?? "<unset>"}`,
    `iterations: ${summary.iterations}`,
    `checked: ${summary.checked}`,
    `started: ${summary.startedAt}`,
    `finished: ${summary.finishedAt}`,
  ].join("\n");
}

type HostedWorkerRole = "scheduler" | "public-probe" | "reporter" | "migration";

interface HostedWorkerPreflight {
  kind: "open-uptime.hosted-worker-preflight";
  role: HostedWorkerRole;
  status: "blocked";
  canStart: false;
  mode: string;
  component: string;
  workspaceId: string | null;
  blockers: string[];
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  nextActions: string[];
}

function parseWorkerRole(value: string): HostedWorkerRole {
  if (value === "scheduler" || value === "public-probe" || value === "reporter" || value === "migration") return value;
  throw new Error(`Unknown hosted worker role: ${value}`);
}

function buildHostedWorkerPreflight(role: HostedWorkerRole): HostedWorkerPreflight {
  const mode = process.env.HASNA_UPTIME_MODE?.trim() || "";
  const component = process.env.HASNA_UPTIME_COMPONENT?.trim() || "";
  const workspaceId = process.env.HASNA_UPTIME_WORKSPACE_ID?.trim() || "";
  const checks = [
    { name: "hosted-mode", ok: mode === "hosted", detail: mode || "<unset>" },
    { name: "component", ok: !component || component === role, detail: component || "<unset>" },
    { name: "workspace", ok: Boolean(workspaceId), detail: workspaceId || "<unset>" },
    { name: "postgres-schema-plan", ok: true, detail: "available through uptime cloud postgres-plan" },
    { name: "postgres-adapter", ok: false, detail: "async runtime store not implemented" },
    { name: "cloud-worker-leases", ok: false, detail: "not implemented" },
  ];
  if (role === "reporter") {
    checks.push({ name: "cloud-channel-refs", ok: false, detail: "not implemented" });
  }
  if (role === "public-probe") {
    checks.push({ name: "public-probe-job-claims", ok: false, detail: "not implemented" });
  }
  if (role === "migration") {
    checks.push({ name: "cloud-migration-plan", ok: false, detail: "not implemented" });
  }
  const blockers = checks
    .filter((check) => !check.ok)
    .map((check) => `${check.name}: ${check.detail}`);
  return {
    kind: "open-uptime.hosted-worker-preflight",
    role,
    status: "blocked",
    canStart: false,
    mode: mode || "<unset>",
    component: component || "<unset>",
    workspaceId: workspaceId || null,
    blockers,
    checks,
    nextActions: hostedWorkerNextActions(role),
  };
}

function hostedWorkerNextActions(role: HostedWorkerRole): string[] {
  const shared = [
    "Keep the ECS service desired count at 0 until this preflight reports canStart=true.",
    "Review uptime cloud postgres-plan, then move authoritative hosted state from the EFS SQLite bridge to the async Postgres store with transactional leases.",
  ];
  if (role === "scheduler") {
    return [
      ...shared,
      "Implement deterministic check_jobs creation with a scheduler lease and duplicate-slot protection.",
    ];
  }
  if (role === "public-probe") {
    return [
      ...shared,
      "Implement cloud job claiming, fencing tokens, target-policy decision logs, and result ingestion for public HTTP/TCP checks.",
    ];
  }
  if (role === "reporter") {
    return [
      ...shared,
      "Implement workspace-authorized report channel refs, idempotent delivery keys, retry/backoff, and delivery alarms.",
    ];
  }
  return [
    ...shared,
    "Implement reviewed cloud schema migrations with dry-run counts, backup evidence, and rollback instructions.",
  ];
}

function renderHostedWorkerPreflight(preflight: HostedWorkerPreflight): string {
  return [
    `${preflight.role} hosted worker preflight`,
    `status: ${preflight.status}`,
    `can start: ${preflight.canStart}`,
    `mode: ${sanitizeField(preflight.mode)}`,
    `component: ${sanitizeField(preflight.component)}`,
    `workspace: ${sanitizeField(preflight.workspaceId ?? "<unset>")}`,
    `blockers: ${preflight.blockers.length}`,
    ...preflight.blockers.map((blocker) => `- ${sanitizeField(blocker)}`),
  ].join("\n");
}

function renderEdgeSmokeReport(report: EdgeSmokeReport): string {
  return [
    "protected edge smoke",
    `status: ${report.status}`,
    `promotion ready: ${report.promotionReady}`,
    `edge: ${sanitizeField(report.edgeUrl)}`,
    `workspace: ${sanitizeField(report.workspaceId ?? "<unset>")}`,
    `direct origin: ${report.directOriginUrl ? sanitizeField(report.directOriginUrl) : "<not checked>"}`,
    `direct origin unreachable allowed: ${report.directOriginUnreachableAllowed}`,
    ...report.checks.map((check) => {
      const state = check.skipped ? "skipped" : check.ok ? "ok" : "failed";
      const status = check.status === undefined ? "" : ` http=${check.status}`;
      return `- ${state.padEnd(7)} ${check.name}${status} ${sanitizeField(check.detail)}`;
    }),
    ...(report.nextActions.length ? ["next actions:", ...report.nextActions.map((action) => `- ${sanitizeField(action)}`)] : []),
  ].join("\n");
}

function hostedWorkerEnvironmentOk(preflight: HostedWorkerPreflight): boolean {
  return preflight.checks
    .filter((check) => check.name === "hosted-mode" || check.name === "component" || check.name === "workspace")
    .every((check) => check.ok);
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
