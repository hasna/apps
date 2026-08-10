import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { closeDb } from "../../lib/db.js";
import type {
  ProjectChannelRegistrationRequest,
  ProjectChannelRegistrationReadRequest,
} from "../../lib/project-channel-registration.js";
import { getStore } from "../../lib/store/index.js";
import { printJson } from "../../lib/stdout.js";
import { emitCliError } from "../cli-error.js";

type OutputOptions = { json?: boolean };

function positiveInteger(value: unknown, name: string, opts: OutputOptions): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    emitCliError(`${name} must be a positive integer.`, opts);
  }
  return parsed;
}

function pageLimit(value: unknown, opts: OutputOptions): number {
  const parsed = positiveInteger(value, "--limit", opts);
  if (parsed > 1000) {
    emitCliError("--limit must not exceed 1000.", opts);
  }
  return parsed;
}

function optionalMessageCursor(value: unknown, opts: OutputOptions): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    emitCliError("--cursor must be a non-negative integer message id.", opts);
  }
  return parsed;
}

function remoteTarget(digest: string) {
  return {
    digest,
    withOwnedPath<T>(_consumer: (absolutePath: string) => T): T {
      throw new Error("project registration target paths are not available through the CLI.");
    },
  };
}

function collectionBounds(opts: {
  responseByteLimit: unknown;
  timeBudgetMs: unknown;
  json?: boolean;
}) {
  return {
    response_byte_limit: positiveInteger(
      opts.responseByteLimit,
      "--response-byte-limit",
      opts,
    ),
    time_budget_ms: positiveInteger(opts.timeBudgetMs, "--time-budget-ms", opts),
    call_limit: 1 as const,
  };
}

export function registerProjectRegistrationCommands(program: Command): void {
  const registration = program
    .command("project-registration")
    .description("Package-owned project channel registration and producer readback");

  registration
    .command("capability")
    .description("Read the stable Conversations registration capability")
    .option("-j, --json", "Output as JSON")
    .action(async () => {
      try {
        printJson(await getStore().projectChannelRegistrationCapability());
      } finally {
        closeDb();
      }
    });

  registration
    .command("create")
    .description("Conditionally register a project channel from one contract request JSON file")
    .requiredOption("--request <path>", "Contract request JSON file")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      try {
        const parsed = JSON.parse(readFileSync(opts.request, "utf8")) as Record<string, unknown>;
        const targetDigest = typeof parsed.target_digest === "string"
          ? parsed.target_digest.trim()
          : "";
        if (!targetDigest) {
          emitCliError("The request file must include target_digest.", opts);
        }
        const { target_digest: _targetDigest, target: _target, ...request } = parsed;
        printJson(await getStore().registerProjectChannel({
          ...request,
          target: remoteTarget(targetDigest),
        } as unknown as ProjectChannelRegistrationRequest));
      } finally {
        closeDb();
      }
    });

  registration
    .command("channels")
    .description("List one bounded stable-id page of channels owned by a Projects workspace")
    .requiredOption("--project <workspace-id>", "Immutable Projects workspace id")
    .option("--cursor <channel-id>", "Exclusive stable chn_ cursor")
    .option("--limit <count>", "Maximum items in this page", "100")
    .option("--response-byte-limit <bytes>", "Maximum serialized response bytes", "1048576")
    .option("--time-budget-ms <milliseconds>", "Maximum local read time", "5000")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      try {
        printJson(await getStore().listProjectChannelRegistrationPage({
          project_id: opts.project,
          cursor: opts.cursor,
          max_items: pageLimit(opts.limit, opts),
          ...collectionBounds(opts),
        }));
      } finally {
        closeDb();
      }
    });

  registration
    .command("messages")
    .description("List one bounded message page inherited from a project-owned channel")
    .argument("<channel-id>", "Stable chn_ channel id")
    .requiredOption("--project <workspace-id>", "Immutable Projects workspace id")
    .option("--cursor <message-id>", "Exclusive numeric local message cursor")
    .option("--limit <count>", "Maximum items in this page", "100")
    .option("--response-byte-limit <bytes>", "Maximum serialized response bytes", "1048576")
    .option("--time-budget-ms <milliseconds>", "Maximum local read time", "5000")
    .option("-j, --json", "Output as JSON")
    .action(async (channelId, opts) => {
      try {
        printJson(await getStore().listProjectChannelMessagePage({
          project_id: opts.project,
          target_id: channelId,
          cursor: optionalMessageCursor(opts.cursor, opts),
          max_items: pageLimit(opts.limit, opts),
          ...collectionBounds(opts),
        }));
      } finally {
        closeDb();
      }
    });

  registration
    .command("read-channel")
    .description("Read exact revision and digest for one registered channel id")
    .argument("<channel-id>", "Stable chn_ channel id")
    .requiredOption("--target-digest <digest>", "Caller-owned target snapshot digest")
    .option("--channel <canonical-slug>", "Require this exact canonical channel slug")
    .option("--response-byte-limit <bytes>", "Maximum serialized response bytes", "1048576")
    .option("--time-budget-ms <milliseconds>", "Maximum local read time", "5000")
    .option("-j, --json", "Output as JSON")
    .action(async (channelId, opts) => {
      try {
        const request: ProjectChannelRegistrationReadRequest = {
          resource_kind: "channel",
          target_id: channelId,
          target_selector: opts.channel,
          target: remoteTarget(opts.targetDigest),
          ...collectionBounds(opts),
        };
        printJson(await getStore().readProjectChannelRegistrationExact(request));
      } finally {
        closeDb();
      }
    });
}
