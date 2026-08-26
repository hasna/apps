#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AutomationsStore,
  automationRunToWorkRun,
  exampleAutomationSpec,
  listDefaultRuntimeBindings,
  normalizeWebhookRequestToEvent,
  actionDecisionEnvelopes,
  validateAutomationSpec,
  type AutomationSpec,
  type EventEnvelopeLike,
  type WebhookEventMapping,
  type WebhookSignatureConfig,
} from "../index.js";
import {
  createTypedActionWorker,
  type TypedActionDefinitionInput,
  type TypedActionAuthority,
  type TypedActionWorker,
} from "../worker/index.js";
import type { ActorRef, JsonValue } from "@hasna/actions";
import {
  LAUNCH_FOLLOWUP_RECIPE_PACK,
  launchFollowupRecipePack,
  listLaunchFollowupRecipes,
  writeRecipePack,
  type LaunchFollowupOptions,
} from "../recipes/launch-followup.js";

interface ParsedArgs {
  json: boolean;
  dir?: string;
  rest: string[];
}

export interface RunAutomationsCliOptions {
  programName?: string;
  worker?: TypedActionWorker;
  typedActions?: TypedActionDefinitionInput[];
  authority?: TypedActionAuthority;
}

export async function runAutomationsCli(argv = Bun.argv.slice(2), options: RunAutomationsCliOptions = {}): Promise<number> {
  const parsed = parseGlobalArgs(argv);
  const command = parsed.rest[0];
  if (parsed.dir) process.env.HASNA_AUTOMATIONS_DIR = parsed.dir;

  try {
    if (!command || command === "--help" || command === "-h" || command === "help") {
      printHelp(options);
      return 0;
    }
    if (command === "--version" || command === "-v" || command === "version") {
      output(parsed, { version: packageVersion() }, () => console.log(packageVersion()));
      return 0;
    }
    if (command === "status" || command === "init") {
      const store = new AutomationsStore();
      try {
        output(parsed, store.status(), () => console.log(JSON.stringify(store.status(), null, 2)));
      } finally {
        store.close();
      }
      return 0;
    }
    if (command === "spec") {
      return runSpecCommand(parsed, options);
    }
    if (command === "validate") {
      return runValidateCommand(parsed);
    }
    if (command === "create") {
      return runCreateCommand(parsed);
    }
    if (command === "list") {
      return runListCommand(parsed);
    }
    if (command === "simulate") {
      return runSimulateCommand(parsed);
    }
    if (command === "runs") {
      return runRunsCommand(parsed, options);
    }
    if (command === "run") {
      return await runTypedRunCommand(parsed, options);
    }
    if (command === "dlq") {
      return await runDlqCommand(parsed, options);
    }
    if (command === "queue") {
      return runQueueCommand(parsed, options);
    }
    if (command === "webhooks") {
      return runWebhooksCommand(parsed, options);
    }
    if (command === "recipes") {
      return await runRecipesCommand(parsed, options);
    }
    if (command === "runtimes") {
      output(parsed, listDefaultRuntimeBindings(), () => console.log(JSON.stringify(listDefaultRuntimeBindings(), null, 2)));
      return 0;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (parsed.json) {
      console.error(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(`automations: ${message}`);
    }
    return 1;
  }
}

async function runTypedRunCommand(parsed: ParsedArgs, options: RunAutomationsCliOptions): Promise<number> {
  const args = parsed.rest.slice(1);
  const reference = args.shift();
  if (!reference || reference === "--help" || reference === "-h") {
    printRunHelp(options);
    return reference ? 0 : 1;
  }
  const detach = takeFlag(args, "--detach");
  const timeoutValue = takeOption(args, "--timeout-ms");
  const inputJson = takeOption(args, "--input-json");
  const actorId = takeOption(args, "--actor-id");
  const actorType = takeOption(args, "--actor-type") as ActorRef["type"] | undefined;
  if (args.length) throw new Error(`unknown run option: ${args[0]}`);
  const timeoutMs = timeoutValue === undefined ? undefined : numberOption(timeoutValue);
  const input = inputJson === undefined ? undefined : JSON.parse(inputJson) as JsonValue;
  const actor = actorId || actorType ? {
    id: actorId ?? "",
    type: actorType ?? "agent",
  } satisfies ActorRef : undefined;
  if (actor && !actor.id) throw new Error("--actor-id is required when --actor-type is provided");

  const suppliedWorker = options.worker;
  const store = suppliedWorker?.store ?? new AutomationsStore();
  const worker = suppliedWorker ?? createTypedActionWorker({
    store,
    definitions: options.typedActions,
    authority: options.authority,
  });
  let backgroundExecution = false;
  let closed = false;
  const closeStore = () => {
    if (!suppliedWorker && !closed) {
      closed = true;
      store.close();
    }
  };
  try {
    const receipt = await worker.run(reference, { detach, timeoutMs, input, actor, onSettled: closeStore });
    backgroundExecution = receipt.status === "running" && timeoutMs !== 0;
    output(parsed, receipt, () => console.log(JSON.stringify(receipt, null, 2)));
    return 0;
  } finally {
    if (!backgroundExecution) closeStore();
  }
}

async function runRecipesCommand(parsed: ParsedArgs, options: RunAutomationsCliOptions): Promise<number> {
  const subcommand = parsed.rest[1];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printRecipesHelp(options);
    return subcommand ? 0 : 1;
  }

  if (subcommand === "list") {
    const recipes = listLaunchFollowupRecipes();
    output(parsed, recipes, () => console.log(JSON.stringify(recipes, null, 2)));
    return 0;
  }

  if (subcommand === "render") {
    const args = parsed.rest.slice(2);
    const pack = args[0];
    if (!pack || pack === "--help" || pack === "-h") {
      printRecipesHelp(options);
      return pack ? 0 : 1;
    }
    if (pack !== LAUNCH_FOLLOWUP_RECIPE_PACK) {
      throw new Error(`Unknown recipe pack: ${pack} (expected ${LAUNCH_FOLLOWUP_RECIPE_PACK})`);
    }
    const rest = args.slice(1);
    const appId = takeOption(rest, "--app-id");
    const packageName = takeOption(rest, "--package");
    const version = takeOption(rest, "--app-version") ?? takeOption(rest, "--release-version");
    const outDir = takeOption(rest, "--out");
    const create = takeFlag(rest, "--create");
    if (!appId || !packageName || !version) {
      throw new Error("recipes render requires --app-id, --package, and --app-version");
    }
    const recipeOptions: LaunchFollowupOptions = {
      appId,
      package: packageName,
      version,
      campaignId: takeOption(rest, "--campaign-id"),
      audienceId: takeOption(rest, "--audience-id"),
      mailerySequenceId: takeOption(rest, "--sequence-id"),
      uptimeMonitorId: takeOption(rest, "--monitor-id"),
      releasedAt: takeOption(rest, "--released-at"),
      watchWindowHours: numberOption(takeOption(rest, "--watch-window-hours")),
      engagementThreshold: numberOption(takeOption(rest, "--engagement-threshold")),
    };
    const specs = launchFollowupRecipePack(recipeOptions);

    let files: string[] = [];
    if (outDir) {
      files = await writeRecipePack(outDir, specs);
    }

    const created: string[] = [];
    if (create) {
      const store = new AutomationsStore();
      try {
        for (const spec of specs) {
          created.push(store.createAutomation(spec).id);
        }
      } finally {
        store.close();
      }
    }

    const result = { pack, specs: specs.map((spec) => spec.id), files, created, rendered: specs };
    output(parsed, result, () => console.log(JSON.stringify(result, null, 2)));
    return 0;
  }

  throw new Error(`Unknown recipes command: ${subcommand}`);
}

function numberOption(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, got: ${value}`);
  return parsed;
}

function printRecipesHelp(options: RunAutomationsCliOptions = {}): void {
  const name = programName(options);
  console.log(`${name} recipes

Usage:
  ${name} [--json] recipes list
  ${name} [--dir <path>] [--json] recipes render launch-followup --app-id <appId> --package <npm-name> --app-version <semver> \\
      [--campaign-id <id>] [--audience-id <id>] [--sequence-id <id>] [--monitor-id <id>] \\
      [--released-at <iso>] [--watch-window-hours <n>] [--engagement-threshold <n>] \\
      [--out <dir>] [--create]

The launch-followup pack renders T+1/T+3/T+7 engagement checks, a non-engaged
mailery follow-up enrollment, and a release-anchored uptime regression
watch-window as automation spec files. --out writes one JSON file per spec;
--create also registers them in the local store.`);
}

function runWebhooksCommand(parsed: ParsedArgs, options: RunAutomationsCliOptions): number {
  const subcommand = parsed.rest[1];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printWebhooksHelp(options);
    return 0;
  }
  const store = new AutomationsStore();
  try {
    if (subcommand === "create") {
      const args = parsed.rest.slice(2);
      const automationId = args[0];
      if (!automationId) throw new Error("webhooks create requires an automation id");
      const id = takeOption(args, "--id");
      const path = takeOption(args, "--path");
      const source = takeOption(args, "--source");
      const type = takeOption(args, "--type");
      if (!source) throw new Error("webhooks create requires --source");
      if (!type) throw new Error("webhooks create requires --type");
      const mapping: WebhookEventMapping = {
        source,
        type,
        subject: takeOption(args, "--subject"),
        subjectPath: takeOption(args, "--subject-path"),
        dataPath: takeOption(args, "--data-path"),
        idPath: takeOption(args, "--id-path"),
        timePath: takeOption(args, "--time-path"),
        dedupeKeyPath: takeOption(args, "--dedupe-key-path"),
        dedupeKeyHeader: takeOption(args, "--dedupe-key-header"),
      };
      const secretRef = takeOption(args, "--secret-ref");
      const signature: WebhookSignatureConfig | undefined = secretRef ? {
        algorithm: "hmac-sha256",
        secretRef,
        header: takeOption(args, "--signature-header"),
        prefix: takeOption(args, "--signature-prefix"),
        encoding: takeOption(args, "--signature-encoding") as WebhookSignatureConfig["encoding"] | undefined,
      } : undefined;
      const route = store.createWebhookRoute({ id, automationId, path, mapping, signature });
      output(parsed, route, () => console.log(JSON.stringify(route, null, 2)));
      return 0;
    }
    if (subcommand === "list") {
      const routes = store.listWebhookRoutes();
      output(parsed, routes, () => console.log(JSON.stringify(routes, null, 2)));
      return 0;
    }
    if (subcommand === "show") {
      const id = parsed.rest[2];
      if (!id) throw new Error("webhooks show requires a route id or path");
      const route = store.requireWebhookRoute(id);
      output(parsed, route, () => console.log(JSON.stringify(route, null, 2)));
      return 0;
    }
    if (subcommand === "enable" || subcommand === "disable" || subcommand === "archive") {
      const id = parsed.rest[2];
      if (!id) throw new Error(`webhooks ${subcommand} requires a route id or path`);
      const status = subcommand === "enable" ? "active" : subcommand === "disable" ? "disabled" : "archived";
      const route = store.setWebhookRouteStatus(id, status);
      output(parsed, route, () => console.log(JSON.stringify(route, null, 2)));
      return 0;
    }
    if (subcommand === "rotate-secret") {
      const args = parsed.rest.slice(2);
      const id = args[0];
      if (!id) throw new Error("webhooks rotate-secret requires a route id or path");
      const secretRef = takeOption(args, "--secret-ref");
      if (!secretRef) throw new Error("webhooks rotate-secret requires --secret-ref");
      const route = store.rotateWebhookRouteSecret(id, secretRef);
      output(parsed, route, () => console.log(JSON.stringify(route, null, 2)));
      return 0;
    }
    if (subcommand === "test") {
      const args = parsed.rest.slice(2);
      const id = args[0];
      if (!id) throw new Error("webhooks test requires a route id or path");
      const bodyJson = takeOption(args, "--body-json") ?? "{}";
      const headers = parseHeaderOptions(takeOptions(args, "--header"));
      const route = store.requireWebhookRoute(id);
      const result = store.materializeWebhookRequest({ route, rawBody: bodyJson, headers, receivedAt: new Date() });
      output(parsed, result, () => console.log(JSON.stringify(result, null, 2)));
      return 0;
    }
    if (subcommand === "event") {
      const args = parsed.rest.slice(2);
      const id = args[0];
      if (!id) throw new Error("webhooks event requires a route id or path");
      const bodyJson = takeOption(args, "--body-json") ?? "{}";
      const headers = parseHeaderOptions(takeOptions(args, "--header"));
      const route = store.requireWebhookRoute(id);
      if (route.status !== "active") throw new Error(`webhook route is not active: ${route.id}`);
      const event = normalizeWebhookRequestToEvent({ route, rawBody: bodyJson, headers, receivedAt: new Date() });
      output(parsed, event, () => console.log(JSON.stringify(event, null, 2)));
      return 0;
    }
    throw new Error(`Unknown webhooks command: ${subcommand}`);
  } finally {
    store.close();
  }
}

function runValidateCommand(parsed: ParsedArgs): number {
  const file = parsed.rest[1];
  if (!file || file === "--help" || file === "-h") {
    console.log(`${programName()} validate <automation.json>`);
    return file ? 0 : 1;
  }
  try {
    const spec = readSpec(file);
    validateAutomationSpec(spec);
    output(parsed, { valid: true, spec }, () => console.log("valid"));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output(parsed, { valid: false, errors: [message] }, () => console.log(`invalid: ${message}`));
    return 1;
  }
}

function runCreateCommand(parsed: ParsedArgs): number {
  const file = parsed.rest[1];
  if (!file || file === "--help" || file === "-h") {
    console.log(`${programName()} create <automation.json>`);
    return file ? 0 : 1;
  }
  const store = new AutomationsStore();
  try {
    const record = store.createAutomation(readSpec(file));
    output(parsed, record, () => console.log(JSON.stringify(record, null, 2)));
  } finally {
    store.close();
  }
  return 0;
}

function runListCommand(parsed: ParsedArgs): number {
  const store = new AutomationsStore();
  try {
    const automations = store.listAutomations();
    output(parsed, automations, () => console.log(JSON.stringify(automations, null, 2)));
  } finally {
    store.close();
  }
  return 0;
}

function runSimulateCommand(parsed: ParsedArgs): number {
  const args = parsed.rest.slice(1);
  const eventJson = takeOption(args, "--event-json");
  const persist = takeFlag(args, "--persist");
  const file = args[0];
  if (!file || file === "--help" || file === "-h") {
    console.log(`${programName()} simulate <automation.json> [--event-json <json>] [--persist]`);
    return file ? 0 : 1;
  }
  const spec = readSpec(file);
  validateAutomationSpec(spec);
  const event = eventJson ? JSON.parse(eventJson) as EventEnvelopeLike : defaultSimulationEvent(spec);
  if (!persist) {
    const trigger = spec.triggers.find((candidate) => candidate.kind === "event") ?? spec.triggers[0];
    const eventKey = event.dedupeKey ?? event.id;
    output(parsed, {
      persisted: false,
      automation: spec.id,
      event,
      run: {
        idempotencyKey: `${spec.id}:${eventKey}`,
        trigger,
      },
      actions: spec.actions.map((step) => ({
        stepId: step.id,
        actionId: step.actionId,
        idempotencyKey: `${spec.id}:${eventKey}:${step.id}`,
      })),
    }, () => console.log(JSON.stringify({ automation: spec.id, actions: spec.actions.length }, null, 2)));
    return 0;
  }

  const store = new AutomationsStore();
  try {
    store.createAutomation(spec);
    const materialized = store.materializeEvent(event, { automationId: spec.id });
    output(parsed, materialized, () => console.log(JSON.stringify(materialized, null, 2)));
  } finally {
    store.close();
  }
  return 0;
}

async function runDlqCommand(parsed: ParsedArgs, options: RunAutomationsCliOptions): Promise<number> {
  const subcommand = parsed.rest[1];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printDlqHelp(options);
    return 0;
  }
  const store = new AutomationsStore();
  try {
    if (subcommand === "list") {
      const dead = store.listDeadLetterActions();
      output(parsed, dead, () => console.log(JSON.stringify(dead, null, 2)));
      return 0;
    }
    if (subcommand === "replay") {
      const id = parsed.rest[2];
      if (!id) throw new Error("dlq replay requires an action id");
      const existing = store.requireQueueEntry(id);
      if (existing.status === "succeeded" && existing.result?.metadata?.deliveryStatus === "partial") {
        const worker = options.worker ?? createTypedActionWorker({ store, definitions: options.typedActions, authority: options.authority });
        const receipt = await worker.replayPartial(id);
        output(parsed, receipt, () => console.log(JSON.stringify(receipt, null, 2)));
      } else {
        const action = store.readmitDeadAction(id);
        output(parsed, action, () => console.log(JSON.stringify(action, null, 2)));
      }
      return 0;
    }
    throw new Error(`Unknown dlq command: ${subcommand}`);
  } finally {
    store.close();
  }
}

function runRunsCommand(parsed: ParsedArgs, options: RunAutomationsCliOptions): number {
  const subcommand = parsed.rest[1];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printRunsHelp(options);
    return 0;
  }
  const args = parsed.rest.slice(2);
  const contract = takeFlag(args, "--contract");
  const store = new AutomationsStore();
  try {
    if (subcommand === "list") {
      const runs = store.listRuns();
      if (!contract) {
        output(parsed, runs, () => console.log(JSON.stringify(runs, null, 2)));
        return 0;
      }
      const actions = store.listQueueEntries();
      const contracts = runs.map((run) => automationRunToWorkRun(run, {
        decisions: actionDecisionEnvelopes(actions.filter((action) => action.automationRunId === run.id)),
      }));
      output(parsed, contracts, () => console.log(JSON.stringify(contracts, null, 2)));
      return 0;
    }
    if (subcommand === "show") {
      const id = args[0];
      if (!id) throw new Error("runs show requires a run id");
      const run = store.requireRun(id);
      if (!contract) {
        output(parsed, run, () => console.log(JSON.stringify(run, null, 2)));
        return 0;
      }
      const decisions = actionDecisionEnvelopes(store.listQueueEntries().filter((action) => action.automationRunId === run.id));
      const contractRun = automationRunToWorkRun(run, { decisions });
      output(parsed, contractRun, () => console.log(JSON.stringify(contractRun, null, 2)));
      return 0;
    }
    throw new Error(`Unknown runs command: ${subcommand}`);
  } finally {
    store.close();
  }
}

function runQueueCommand(parsed: ParsedArgs, options: RunAutomationsCliOptions): number {
  const subcommand = parsed.rest[1];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printQueueHelp(options);
    return 0;
  }
  const store = new AutomationsStore();
  try {
    if (subcommand === "lease") {
      const args = parsed.rest.slice(2);
      const runnerId = takeOption(args, "--runner") ?? `cli:${process.pid}`;
      const action = store.leaseNextAction({ runnerId });
      output(parsed, action ?? null, () => console.log(JSON.stringify(action ?? null, null, 2)));
      return 0;
    }
    if (subcommand === "complete") {
      const args = parsed.rest.slice(2);
      const id = args[0];
      if (!id) throw new Error("queue complete requires an action id");
      const runnerId = takeOption(args, "--runner") ?? `cli:${process.pid}`;
      const resultJson = takeOption(args, "--result-json");
      const action = store.completeAction({ actionId: id, runnerId, result: resultJson ? JSON.parse(resultJson) : undefined });
      output(parsed, action, () => console.log(JSON.stringify(action, null, 2)));
      return 0;
    }
    if (subcommand === "fail") {
      const args = parsed.rest.slice(2);
      const id = args[0];
      if (!id) throw new Error("queue fail requires an action id");
      const runnerId = takeOption(args, "--runner") ?? `cli:${process.pid}`;
      const code = takeOption(args, "--code") ?? "ACTION_FAILED";
      const message = takeOption(args, "--message") ?? "Action failed";
      const retryable = takeOption(args, "--retryable") !== "false";
      const retryBackoff = takeOption(args, "--retry-backoff-ms");
      const action = store.failAction({
        actionId: id,
        runnerId,
        retryBackoffMs: retryBackoff === undefined ? undefined : Number(retryBackoff),
        error: { code, message, retryable },
      });
      output(parsed, action, () => console.log(JSON.stringify(action, null, 2)));
      return 0;
    }
    if (subcommand === "approve") {
      const id = parsed.rest[2];
      if (!id) throw new Error("queue approve requires an action id");
      const action = store.approveAction(id, { decidedBy: `cli:${process.pid}` });
      output(parsed, action, () => console.log(JSON.stringify(action, null, 2)));
      return 0;
    }
    if (subcommand === "reject") {
      const args = parsed.rest.slice(2);
      const id = args[0];
      if (!id) throw new Error("queue reject requires an action id");
      const reason = takeOption(args, "--reason");
      const action = store.rejectAction(id, { decidedBy: `cli:${process.pid}`, reason });
      output(parsed, action, () => console.log(JSON.stringify(action, null, 2)));
      return 0;
    }
    throw new Error(`Unknown queue command: ${subcommand}`);
  } finally {
    store.close();
  }
}

function runSpecCommand(parsed: ParsedArgs, options: RunAutomationsCliOptions): number {
  const subcommand = parsed.rest[1];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printSpecHelp(options);
    return 0;
  }
  if (subcommand === "example") {
    output(parsed, exampleAutomationSpec(), () => console.log(JSON.stringify(exampleAutomationSpec(), null, 2)));
    return 0;
  }
  throw new Error(`Unknown spec command: ${subcommand}`);
}

function parseGlobalArgs(argv: string[]): ParsedArgs {
  const rest: string[] = [];
  let json = false;
  let dir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      rest.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "--json" || arg === "-j") {
      json = true;
      continue;
    }
    if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
      continue;
    }
    if (arg === "--dir") {
      dir = argv[++index];
      continue;
    }
    rest.push(...argv.slice(index));
    break;
  }
  return { json, dir, rest };
}

function readSpec(file: string): AutomationSpec {
  return JSON.parse(file === "-" ? readFileSync(0, "utf-8") : readFileSync(file, "utf-8")) as AutomationSpec;
}

function takeOption(args: string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  const equalsIndex = args.findIndex((arg) => arg.startsWith(equalsPrefix));
  if (equalsIndex !== -1) {
    const value = args[equalsIndex]?.slice(equalsPrefix.length);
    args.splice(equalsIndex, 1);
    return value;
  }
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function takeOptions(args: string[], name: string): string[] {
  const values: string[] = [];
  const equalsPrefix = `${name}=`;
  for (let index = 0; index < args.length;) {
    const arg = args[index];
    if (arg.startsWith(equalsPrefix)) {
      values.push(arg.slice(equalsPrefix.length));
      args.splice(index, 1);
      continue;
    }
    if (arg === name) {
      const value = args[index + 1];
      if (value === undefined) throw new Error(`${name} requires a value`);
      values.push(value);
      args.splice(index, 2);
      continue;
    }
    index += 1;
  }
  return values;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function defaultSimulationEvent(spec: AutomationSpec): EventEnvelopeLike {
  const trigger = spec.triggers.find((candidate) => candidate.kind === "event");
  return {
    id: `sim_${spec.id}`,
    source: trigger?.source ?? "manual",
    type: trigger?.type ?? "automation.simulated",
    subject: trigger?.subject,
    time: new Date().toISOString(),
    data: trigger?.filter ?? {},
  };
}

function parseHeaderOptions(values: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const value of values) {
    const colonIndex = value.indexOf(":");
    const equalsIndex = value.indexOf("=");
    const separatorIndex = colonIndex === -1 ? equalsIndex : equalsIndex === -1 ? colonIndex : Math.min(colonIndex, equalsIndex);
    if (separatorIndex === -1) throw new Error(`invalid header option: ${value}`);
    const name = value.slice(0, separatorIndex).trim();
    const headerValue = value.slice(separatorIndex + 1).trim();
    if (!name) throw new Error(`invalid header option: ${value}`);
    headers[name] = headerValue;
  }
  return headers;
}

function output(parsed: ParsedArgs, value: unknown, human: () => void): void {
  if (parsed.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  human();
}

function printHelp(options: RunAutomationsCliOptions = {}): void {
  const name = programName(options);
  console.log(`${name} ${packageVersion()}

Usage:
  ${name} --help
  ${name} --version
  ${name} [--dir <path>] [--json] init
  ${name} [--dir <path>] [--json] status
  ${name} [--json] spec example
  ${name} [--dir <path>] [--json] validate <automation.json>
  ${name} [--dir <path>] [--json] create <automation.json>
  ${name} [--dir <path>] [--json] list
  ${name} [--dir <path>] [--json] simulate <automation.json> [--event-json <json>] [--persist]
  ${name} [--dir <path>] [--json] run <slug>@<version> [--input-json <json>] [--timeout-ms <ms>] [--detach]
  ${name} [--dir <path>] [--json] runs list [--contract]
  ${name} [--dir <path>] [--json] runs show <run-id> [--contract]
  ${name} [--dir <path>] [--json] dlq list
  ${name} [--dir <path>] [--json] dlq replay <action-id>
  ${name} [--dir <path>] [--json] queue lease [--runner <id>]
  ${name} [--dir <path>] [--json] queue complete <action-id> [--runner <id>] [--result-json <json>]
  ${name} [--dir <path>] [--json] queue fail <action-id> [--runner <id>] [--code <code>] [--message <text>] [--retryable false] [--retry-backoff-ms <ms>]
  ${name} [--dir <path>] [--json] queue approve <action-id>
  ${name} [--dir <path>] [--json] queue reject <action-id> [--reason <text>]
  ${name} [--dir <path>] [--json] webhooks create <automation-id> --source <source> --type <type>
  ${name} [--dir <path>] [--json] webhooks list
  ${name} [--dir <path>] [--json] webhooks show <id-or-path>
  ${name} [--dir <path>] [--json] webhooks enable|disable|archive <id-or-path>
  ${name} [--dir <path>] [--json] webhooks rotate-secret <id-or-path> --secret-ref <secret://ref>
  ${name} [--dir <path>] [--json] webhooks test <id-or-path> [--body-json <json>] [--header <name:value>]
  ${name} [--dir <path>] [--json] webhooks event <id-or-path> [--body-json <json>] [--header <name:value>]
  ${name} [--json] recipes list
  ${name} [--dir <path>] [--json] recipes render launch-followup --app-id <appId> --package <npm-name> --app-version <semver> [--out <dir>] [--create]
  ${name} [--dir <path>] [--json] runtimes

Environment:
  HASNA_AUTOMATIONS_DIR or AUTOMATIONS_DATA_DIR overrides the data root
  (default ~/.hasna/automations, resolved via @hasna/paths; the XDG data home
  is adopted once the store is migrated there or HASNA_DATA_HOME is set)`);
}

function printWebhooksHelp(options: RunAutomationsCliOptions = {}): void {
  const name = programName(options);
  console.log(`${name} webhooks

Usage:
  ${name} [--dir <path>] [--json] webhooks create <automation-id> --source <source> --type <type> [--id <id>] [--path <path>]
  ${name} [--dir <path>] [--json] webhooks list
  ${name} [--dir <path>] [--json] webhooks show <id-or-path>
  ${name} [--dir <path>] [--json] webhooks enable <id-or-path>
  ${name} [--dir <path>] [--json] webhooks disable <id-or-path>
  ${name} [--dir <path>] [--json] webhooks archive <id-or-path>
  ${name} [--dir <path>] [--json] webhooks rotate-secret <id-or-path> --secret-ref <secret://ref>
  ${name} [--dir <path>] [--json] webhooks test <id-or-path> [--body-json <json>] [--header <name:value>]
  ${name} [--dir <path>] [--json] webhooks event <id-or-path> [--body-json <json>] [--header <name:value>]

Notes:
  test and event are local operator commands; they do not verify HMAC signatures.
  Use automations-daemon serve for signed network ingress.

Create options:
  --subject <value>             Static event subject
  --subject-path <path>         Subject JSON path
  --data-path <path>            JSON object path to store as event data
  --id-path <path>              JSON path for event id and dedupe fallback
  --time-path <path>            JSON path for event time
  --dedupe-key-path <path>      JSON path for deterministic dedupe key
  --dedupe-key-header <name>    Header for deterministic dedupe key
  --secret-ref <secret://ref>   Enable HMAC SHA-256 signatures using a runtime secret reference
  --signature-header <name>     Signature header, default x-hasna-signature
  --signature-prefix <prefix>   Signature prefix such as sha256=
  --signature-encoding <kind>   hex or base64`);
}

function printSpecHelp(options: RunAutomationsCliOptions = {}): void {
  const name = programName(options);
  console.log(`${name} spec

Usage:
  ${name} [--json] spec example`);
}

function printDlqHelp(options: RunAutomationsCliOptions = {}): void {
  const name = programName(options);
  console.log(`${name} dlq

Usage:
  ${name} [--dir <path>] [--json] dlq list
  ${name} [--dir <path>] [--json] dlq replay <action-id>`);
}

function printRunsHelp(options: RunAutomationsCliOptions = {}): void {
  const name = programName(options);
  console.log(`${name} runs

Usage:
  ${name} [--dir <path>] [--json] runs list [--contract]
  ${name} [--dir <path>] [--json] runs show <run-id> [--contract]`);
}

function printRunHelp(options: RunAutomationsCliOptions = {}): void {
  const name = programName(options);
  console.log(`${name} run

Usage:
  ${name} [--dir <path>] [--json] run <slug>@<version> [--input-json <json>] [--timeout-ms <ms>] [--detach]
  ${name} [--dir <path>] [--json] run <slug>@<version> [--actor-id <id>] [--actor-type <type>]

The run command executes only registered TypeScript action definitions.
--detach returns an enqueued receipt without waiting. A timeout returns a
running receipt while the supervised worker continues its durable run.`);
}

function printQueueHelp(options: RunAutomationsCliOptions = {}): void {
  const name = programName(options);
  console.log(`${name} queue

Usage:
  ${name} [--dir <path>] [--json] queue lease [--runner <id>]
  ${name} [--dir <path>] [--json] queue complete <action-id> [--runner <id>] [--result-json <json>]
  ${name} [--dir <path>] [--json] queue fail <action-id> [--runner <id>] [--code <code>] [--message <text>] [--retryable false] [--retry-backoff-ms <ms>]
  ${name} [--dir <path>] [--json] queue approve <action-id>
  ${name} [--dir <path>] [--json] queue reject <action-id> [--reason <text>]`);
}

function programName(options: RunAutomationsCliOptions = {}): string {
  return options.programName ?? "automations";
}

function packageVersion(): string {
  try {
    const packagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return JSON.parse(readFileSync(packagePath, "utf-8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const skipDefaultCliMain = (globalThis as Record<string, unknown>).__HASNA_AUTOMATIONS_SKIP_MAIN__ === true;

if (import.meta.main && !skipDefaultCliMain) {
  process.exit(await runAutomationsCli());
}
