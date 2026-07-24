#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import {
  createBenchSDK,
  type RunRecordInput,
  type RunRecordMetric,
  type ResultSummary
} from "../sdk/index.js";
import {
  dryRunPlanToContractBundle,
  resultDetailToContractBundle,
  runRecordResultToContractBundle
} from "../lib/contract-adapters.js";
import { openBenchStorage } from "../storage.js";
import { runFixtureAdapter } from "../runner.js";
import { VERSION } from "../lib/version.js";

const sdk = createBenchSDK();
let jsonRequested = false;

for (const arg of process.argv.slice(2)) {
  if (arg === "--json") {
    jsonRequested = true;
    break;
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function assertContractJson(options: { contract?: boolean; json?: boolean }): void {
  if (options.contract && !options.json) throw new Error("--contract requires --json");
}

function contractEnvelope(legacy: unknown, contracts: unknown): unknown {
  return { ok: true, legacy, contracts };
}

function printSuiteTable(rows: { id: string; name: string; category: string; status: string }[]): void {
  for (const row of rows) {
    console.log(`${chalk.cyan(row.id.padEnd(24))} ${row.category.padEnd(24)} ${row.status.padEnd(10)} ${row.name}`);
  }
}

function printResultTable(rows: ResultSummary[]): void {
  for (const row of rows) {
    console.log(`${chalk.cyan(row.runId.padEnd(40))} ${row.benchmarkId.padEnd(24)} ${row.provider.padEnd(18)} ${row.modelId}`);
  }
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function parseFiniteNumber(value: string): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) throw new Error(`Invalid number '${value}'`);
  return numericValue;
}

function parseNonNegativeInteger(value: string): number {
  const numericValue = parseFiniteNumber(value);
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    throw new Error(`Invalid non-negative integer '${value}'`);
  }
  return numericValue;
}

function parseMetric(value: string): RunRecordMetric {
  const [metricId, rawValue] = value.split("=");
  const numericValue = Number(rawValue);
  if (!metricId || rawValue === undefined || !Number.isFinite(numericValue)) {
    throw new Error(`Invalid metric '${value}', expected metric_id=number`);
  }
  return { metricId, value: numericValue };
}

function optionalNumber(input: Record<string, unknown>, key: string, integer = false): number | undefined {
  if (input[key] === undefined) return undefined;
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`usage.${key} must be a finite number`);
  if (integer && !Number.isInteger(value)) throw new Error(`usage.${key} must be an integer`);
  if (value < 0) throw new Error(`usage.${key} must be non-negative`);
  return value;
}

function parseUsage(raw: unknown): RunRecordInput["usage"] {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("usage must be a JSON object");
  }

  const input = raw as Record<string, unknown>;
  return {
    inputTokens: optionalNumber(input, "inputTokens", true),
    outputTokens: optionalNumber(input, "outputTokens", true),
    costUsd: optionalNumber(input, "costUsd"),
    latencyMs: optionalNumber(input, "latencyMs", true),
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? input.metadata as Record<string, unknown>
      : undefined
  };
}

function parseRunRecordInput(raw: unknown): Partial<RunRecordInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Run input fixture must be a JSON object");
  }

  const input = raw as Record<string, unknown>;
  const metrics = Array.isArray(input.metrics)
    ? input.metrics.map((metric) => {
      if (!metric || typeof metric !== "object" || Array.isArray(metric)) {
        throw new Error("Each metric fixture entry must be an object");
      }
      const record = metric as Record<string, unknown>;
      const metricId = typeof record.metricId === "string" ? record.metricId : record.id;
      if (typeof metricId !== "string") throw new Error("Metric fixture entries require metricId or id");
      const value = Number(record.value);
      if (!Number.isFinite(value)) throw new Error(`Metric ${metricId} value must be finite`);
      return {
        metricId,
        value,
        unit: typeof record.unit === "string" ? record.unit : undefined,
        direction: typeof record.direction === "string" ? record.direction : undefined,
        metadata: record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
          ? record.metadata as Record<string, unknown>
          : undefined
      };
    })
    : undefined;

  return {
    metrics,
    payload: input.payload,
    eventType: typeof input.eventType === "string" ? input.eventType : undefined,
    labels: input.labels && typeof input.labels === "object" && !Array.isArray(input.labels)
      ? input.labels as Record<string, unknown>
      : undefined,
    usage: parseUsage(input.usage)
  };
}

const program = new Command();

program
  .name("bench")
  .description("Benchmark aggregator and wrapper for AI model benchmark suites")
  .version(VERSION);

const suites = program.command("suites").description("Discover and inspect benchmark suites");

suites
  .command("list")
  .description("List built-in benchmark suite manifests")
  .option("--json", "Output JSON")
  .action((options: { json?: boolean }) => {
    const rows = sdk.listSuites();
    if (options.json) {
      printJson(rows);
      return;
    }
    printSuiteTable(rows.map((suite) => ({
      id: suite.id,
      name: suite.name,
      category: suite.category,
      status: suite.adapter.status
    })));
  });

suites
  .command("show")
  .argument("<id>", "Benchmark suite id")
  .option("--json", "Output JSON")
  .description("Show one benchmark suite manifest")
  .action((id: string, options: { json?: boolean }) => {
    const suite = sdk.showSuite(id);
    if (options.json) {
      printJson(suite);
      return;
    }
    console.log(`${chalk.cyan(suite.id)} ${suite.name}`);
    console.log(`${suite.category} ${suite.adapter.status} ${suite.manifestVersion}`);
  });

const manifest = program.command("manifest").description("Validate benchmark manifests");

manifest
  .command("validate")
  .argument("<path>", "Path to a benchmark manifest JSON file")
  .option("--json", "Output JSON")
  .description("Validate one benchmark manifest")
  .action((path: string, options: { json?: boolean }) => {
    const parsed = sdk.validateManifest(readJsonFile(path));
    const result = { ok: true, manifest: parsed };
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(`valid ${parsed.id}`);
  });

program
  .command("plan")
  .argument("<suite-id>", "Benchmark suite id")
  .requiredOption("--model <id>", "Model id to benchmark")
  .requiredOption("--provider <provider>", "Provider or runtime name")
  .option("--route <route>", "Optional provider route")
  .option("--json", "Output JSON")
  .option("--contract", "With --json, include canonical hasna.* contract output")
  .description("Create a dry-run benchmark execution plan without running a benchmark")
  .action((suiteId: string, options: { model: string; provider: string; route?: string; json?: boolean; contract?: boolean }) => {
    assertContractJson(options);
    const plan = sdk.plan({
      benchmarkId: suiteId,
      modelId: options.model,
      provider: options.provider,
      route: options.route
    });
    if (options.json) {
      printJson(options.contract
        ? contractEnvelope(plan, dryRunPlanToContractBundle({ ...plan, benchmark: sdk.showSuite(suiteId) }))
        : plan);
      return;
    }
    console.log(`${plan.benchmark.id} ${plan.provider}/${plan.modelId}`);
    console.log(plan.command.join(" "));
    for (const warning of plan.warnings) console.log(`warning: ${warning}`);
  });

const runs = program.command("runs").description("Record local benchmark run metadata");

runs
  .command("record")
  .argument("<suite-id>", "Benchmark suite id")
  .requiredOption("--model <id>", "Model id that produced the result")
  .requiredOption("--provider <provider>", "Provider or runtime name")
  .option("--route <route>", "Optional provider route")
  .option("--input <path>", "JSON fixture with metrics, payload, usage, and labels")
  .option("--metric <metric>", "Metric as metric_id=number; can be repeated", collect, [])
  .option("--json", "Output JSON")
  .option("--contract", "With --json, include canonical hasna.* contract output")
  .description("Record a local benchmark result without executing an external benchmark")
  .action(async (
    suiteId: string,
    options: { model: string; provider: string; route?: string; input?: string; metric: string[]; json?: boolean; contract?: boolean }
  ) => {
    assertContractJson(options);
    const fixture = options.input ? parseRunRecordInput(readJsonFile(options.input)) : {};
    const metrics = [...(fixture.metrics ?? []), ...options.metric.map(parseMetric)];
    const input = {
      benchmarkId: suiteId,
      modelId: options.model,
      provider: options.provider,
      route: options.route,
      ...fixture,
      metrics
    };
    const result = await sdk.recordRun(input);
    if (options.json) {
      printJson(options.contract
        ? contractEnvelope(result, runRecordResultToContractBundle({
          run: result.run,
          attempt: result.attempt,
          segment: result.segment,
          usage: input.usage
            ? {
              runId: result.run.id,
              attemptId: result.attempt.id,
              provider: input.provider,
              modelId: input.modelId,
              ...input.usage
            }
            : undefined
        }))
        : result);
      return;
    }
    console.log(`recorded ${result.run.id}`);
  });

runs
  .command("fixture")
  .argument("<suite-id>", "Benchmark suite id")
  .requiredOption("--model <id>", "Model id that produced the result")
  .requiredOption("--provider <provider>", "Provider or runtime name")
  .option("--input <path>", "JSON fixture payload with metrics or metric object")
  .option("--metric <metric>", "Metric as metric_id=number; can be repeated", collect, [])
  .option("--secret-ref <env>", "Credential environment variable name; can be repeated", collect, [])
  .option("--network", "Acknowledge network access for this fixture-safe run")
  .option("--sandbox", "Acknowledge sandbox capability for this fixture-safe run")
  .option("--max-cost-usd <usd>", "Maximum allowed provider cost in USD", parseFiniteNumber)
  .option("--max-input-tokens <tokens>", "Maximum allowed input tokens", parseNonNegativeInteger)
  .option("--max-output-tokens <tokens>", "Maximum allowed output tokens", parseNonNegativeInteger)
  .option("--max-runtime-ms <ms>", "Maximum allowed runtime in milliseconds", parseNonNegativeInteger)
  .option("--json", "Output JSON")
  .option("--contract", "With --json, include canonical hasna.* contract output")
  .description("Record a fixture-safe local wrapper payload and persist normalized result evidence")
  .action(async (
    suiteId: string,
    options: {
      model: string;
      provider: string;
      input?: string;
      metric: string[];
      secretRef: string[];
      network?: boolean;
      sandbox?: boolean;
      maxCostUsd?: number;
      maxInputTokens?: number;
      maxOutputTokens?: number;
      maxRuntimeMs?: number;
      json?: boolean;
      contract?: boolean;
    }
  ) => {
    assertContractJson(options);
    if (!options.input && options.metric.length === 0) {
      throw new Error("runs fixture requires --input or at least one --metric");
    }
    const payload = options.input
      ? readJsonFile(options.input)
      : { metrics: options.metric.map(parseMetric) };
    const storage = await openBenchStorage();
    let result: Awaited<ReturnType<typeof runFixtureAdapter>>;
    try {
      result = await runFixtureAdapter(storage, {
        benchmarkId: suiteId,
        modelId: options.model,
        provider: options.provider,
        payload,
        secretRefs: options.secretRef,
        network: options.network,
        sandbox: options.sandbox,
        limits: {
          maxCostUsd: options.maxCostUsd,
          maxInputTokens: options.maxInputTokens,
          maxOutputTokens: options.maxOutputTokens,
          maxRuntimeMs: options.maxRuntimeMs
        }
      });
    } finally {
      storage.close();
    }
    if (options.json) {
      printJson(options.contract
        ? contractEnvelope(result, resultDetailToContractBundle(await sdk.showResult(result.runId)))
        : result);
      return;
    }
    console.log(`ran ${result.runId}`);
  });

const results = program.command("results").description("Inspect local benchmark results");

results
  .command("list")
  .option("--json", "Output JSON")
  .description("List local benchmark result summaries")
  .action(async (options: { json?: boolean }) => {
    const rows = await sdk.listResults();
    if (options.json) {
      printJson(rows);
      return;
    }
    printResultTable(rows);
  });

results
  .command("show")
  .argument("<run-id>", "Run id")
  .option("--json", "Output JSON")
  .option("--contract", "With --json, include canonical hasna.* contract output")
  .description("Show one local benchmark result")
  .action(async (runId: string, options: { json?: boolean; contract?: boolean }) => {
    assertContractJson(options);
    const result = await sdk.showResult(runId);
    if (options.json) {
      printJson(options.contract
        ? contractEnvelope(result, resultDetailToContractBundle(result))
        : result);
      return;
    }
    console.log(`${chalk.cyan(result.runId)} ${result.benchmarkId} ${result.provider}/${result.modelId}`);
    for (const metric of result.metrics) console.log(`${metric.metricId}=${metric.value}`);
  });

program
  .command("compare")
  .argument("<left-run-id>", "Baseline run id")
  .argument("<right-run-id>", "Candidate run id")
  .option("--metric <metric-id>", "Only compare one metric")
  .option("--json", "Output JSON")
  .description("Compare metric values between two local benchmark results")
  .action(async (leftRunId: string, rightRunId: string, options: { metric?: string; json?: boolean }) => {
    const result = await sdk.compareResults(leftRunId, rightRunId, options.metric);
    if (options.json) {
      printJson(result);
      return;
    }
    for (const metric of result.metrics) {
      console.log(`${metric.metricId} ${metric.leftValue} -> ${metric.rightValue} (${metric.delta >= 0 ? "+" : ""}${metric.delta})`);
    }
  });

program
  .command("report")
  .option("--json", "Output JSON")
  .description("Summarize local benchmark storage")
  .action(async (options: { json?: boolean }) => {
    const report = await sdk.report();
    if (options.json) {
      printJson(report);
      return;
    }
    console.log(`benchmarks ${report.benchmarkCount}`);
    console.log(`runs ${report.runCount}`);
    console.log(`metrics ${report.metricCount}`);
    console.log(`segments ${report.segmentCount}`);
  });

program
  .command("doctor")
  .description("Check local open-bench storage and configuration")
  .option("--json", "Output JSON")
  .action(async (options: { json?: boolean }) => {
    const result = await sdk.doctor();
    if (options.json) {
      printJson(result);
      return;
    }
    console.log(`${result.ok ? "ok" : "failed"} ${result.home}`);
    for (const warning of result.warnings) console.log(`warning: ${warning}`);
  });

program.exitOverride();

function isExpectedCommanderExit(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const commanderError = error as { code?: unknown; exitCode?: unknown };
  return commanderError.exitCode === 0 ||
    commanderError.code === "commander.helpDisplayed" ||
    commanderError.code === "commander.version";
}

program.parseAsync(process.argv).catch((error) => {
  if (isExpectedCommanderExit(error)) return;
  const message = error instanceof Error ? error.message : String(error);
  if (jsonRequested) {
    printJson({ ok: false, error: message });
  } else {
    console.error(message);
  }
  process.exit(1);
});
