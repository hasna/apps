#!/usr/bin/env bun
/**
 * fleet-key — mint-or-verify a hosted app's client API key, and check the
 * whole fleet for drift (hasna/apps#1595).
 *
 * Two callers, one implementation:
 *
 *   bun tooling/fleet/fleet-key.ts provision --app <app> [--manifest <ssm-name>]
 *       Run by each deploy lane AFTER a successful rollout. Verifies
 *       hasna/oss/<app>/api-key against the freshly deployed origin and mints
 *       it when it is missing or refused, so a fresh deploy never leaves a
 *       service nothing can call.
 *
 *   bun tooling/fleet/fleet-key.ts drift [--json] [--strict] [--apps a,b]
 *       Run daily. Checks every app in tooling/fleet/hosted-apps.json and exits
 *       non-zero with an #incidents-ready report when any key is missing or
 *       dead.
 *
 *   bun tooling/fleet/fleet-key.ts apps [--json] [--source monorepo|external]
 *       Print the registry. Used by humans and by the workflow that needs the
 *       list without duplicating it.
 *
 * Exit codes: 0 clean, 1 findings, 2 usage/configuration error.
 *
 * No key value is ever printed. Every line this command writes carries app
 * names, HTTP statuses and verdicts only.
 */
import {
  checkApp,
  createIo,
  loadRegistry,
  mintTargetFrom,
  missingMintTargetMessage,
  partition,
  renderIncidentReport,
  runMintTask,
  type FleetApp,
  type Io,
  type KeyAssessment,
} from "./key-provisioning.ts";

const DEFAULT_REGION = process.env.AWS_REGION ?? "us-east-1";

interface Args {
  command: string;
  app?: string;
  apps?: string[];
  manifest?: string;
  source?: string;
  region: string;
  json: boolean;
  strict: boolean;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    command: argv[0] ?? "",
    region: DEFAULT_REGION,
    json: false,
    strict: false,
    dryRun: false,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${flag} requires a value`);
      i += 1;
      return v;
    };
    switch (flag) {
      case "--app":
        args.app = value();
        break;
      case "--apps":
        args.apps = value()
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);
        break;
      case "--manifest":
        args.manifest = value();
        break;
      case "--source":
        args.source = value();
        if (args.source !== "monorepo" && args.source !== "external") {
          throw new Error("--source must be monorepo or external");
        }
        break;
      case "--region":
        args.region = value();
        break;
      case "--json":
        args.json = true;
        break;
      case "--strict":
        args.strict = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`unknown flag ${flag}`);
    }
  }
  return args;
}

function usage(): string {
  return [
    "usage:",
    "  bun tooling/fleet/fleet-key.ts provision --app <app> [--manifest <ssm-name>] [--region <r>] [--dry-run]",
    "  bun tooling/fleet/fleet-key.ts drift [--apps a,b] [--json] [--strict] [--region <r>]",
    "  bun tooling/fleet/fleet-key.ts apps [--json] [--source monorepo|external]",
  ].join("\n");
}

function findApp(registry: readonly FleetApp[], app: string): FleetApp {
  const found = registry.find((entry) => entry.app === app);
  if (!found) {
    throw new Error(
      `${app} is not in tooling/fleet/hosted-apps.json. Add it there in the same change that routes it ` +
        "through the gateway — an app nobody listed is an app nobody checks.",
    );
  }
  return found;
}

/** `provision`: verify, and mint when the key is missing or refused. */
async function provision(args: Args, io: Io): Promise<number> {
  if (!args.app) throw new Error("provision requires --app");
  const target = findApp(loadRegistry(), args.app);
  const manifestName = args.manifest ?? `/hasna/deploy/${target.app}`;

  let assessment = await checkApp(target, io, args.region);
  console.log(`[fleet-key] ${assessment.app}: ${assessment.state} — ${assessment.detail}`);
  if (assessment.state === "verified" || assessment.state === "exempt") return 0;

  // `unverifiable` is never a reason to mint: a probe that proved nothing must
  // not be answered by writing a new credential over a possibly-good one.
  if (assessment.state === "unverifiable") {
    console.error(`[fleet-key] refusing to mint for ${target.app}: the probe proved nothing. ${assessment.detail}`);
    return 1;
  }

  if (args.dryRun) {
    console.log(`[fleet-key] --dry-run: would mint ${target.keySecretId} for ${target.app}`);
    return 1;
  }

  let manifest: Record<string, unknown>;
  try {
    const raw = await io.aws([
      "ssm",
      "get-parameter",
      "--region",
      args.region,
      "--name",
      manifestName,
      "--query",
      "Parameter.Value",
      "--output",
      "text",
    ]);
    manifest = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    console.error(`[fleet-key] could not read the deploy manifest ${manifestName}: ${(e as Error).message}`);
    console.error(missingMintTargetMessage(target.app, manifestName));
    return 1;
  }

  const mintTarget = mintTargetFrom(manifest);
  if (!mintTarget) {
    console.error(missingMintTargetMessage(target.app, manifestName));
    return 1;
  }

  console.log(`[fleet-key] minting ${target.keySecretId} via ${mintTarget.taskFamily} in ${mintTarget.cluster}`);
  const exit = await runMintTask(mintTarget, io, args.region, `fleet-key-${target.app}`);
  if (exit !== 0) {
    console.error(`[fleet-key] mint task ${mintTarget.taskFamily} exited ${exit}; ${target.keySecretId} unchanged`);
    return 1;
  }

  assessment = await checkApp(target, io, args.region);
  console.log(`[fleet-key] ${assessment.app} after mint: ${assessment.state} — ${assessment.detail}`);
  return assessment.state === "verified" || assessment.state === "exempt" ? 0 : 1;
}

/** `drift`: check every registered app and report. */
async function drift(args: Args, io: Io): Promise<number> {
  const registry = loadRegistry();
  const selected = args.apps?.length ? args.apps.map((a) => findApp(registry, a)) : registry;

  const assessments: KeyAssessment[] = [];
  for (const app of selected) {
    assessments.push(await checkApp(app, io, args.region));
  }

  const { failures, warnings, passes, exempt } = partition(assessments, { strict: args.strict });
  const report = renderIncidentReport({
    failures,
    warnings,
    passes,
    exempt,
    runUrl:
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : undefined,
  });

  if (args.json) {
    console.log(JSON.stringify({ assessments, failures, warnings, passes, exempt, report }, null, 2));
  } else {
    for (const a of assessments) console.log(`[fleet-key] ${a.app}: ${a.state} — ${a.detail}`);
    console.log("");
    console.log(report);
  }

  // The workflow posts this verbatim; GITHUB_OUTPUT keeps it out of the shell.
  if (process.env.GITHUB_OUTPUT) {
    const delimiter = `EOF_${Math.random().toString(36).slice(2)}`;
    await Bun.write(
      process.env.GITHUB_OUTPUT,
      (await safeRead(process.env.GITHUB_OUTPUT)) +
        `failures=${failures.length}\n` +
        `report<<${delimiter}\n${report}\n${delimiter}\n`,
    );
  }

  return failures.length > 0 ? 1 : 0;
}

async function safeRead(file: string): Promise<string> {
  try {
    return await Bun.file(file).text();
  } catch {
    return "";
  }
}

/** `apps`: print the registry. */
function listApps(args: Args): number {
  const registry = loadRegistry().filter((a) => !args.source || a.source === args.source);
  if (args.json) console.log(JSON.stringify(registry, null, 2));
  else for (const a of registry) console.log(`${a.app}\t${a.source}\t${a.baseUrl}\t${a.keySecretId}`);
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    console.error(usage());
    return 2;
  }

  const io = createIo();
  try {
    switch (args.command) {
      case "provision":
        return await provision(args, io);
      case "drift":
        return await drift(args, io);
      case "apps":
        return listApps(args);
      default:
        console.error(usage());
        return 2;
    }
  } catch (e) {
    console.error(`[fleet-key] ${(e as Error).message}`);
    return 2;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
