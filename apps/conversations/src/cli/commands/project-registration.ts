import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { closeDb } from "../../lib/db.js";
import type {
  ProjectChannelRegistrationOperationIntent,
  ProjectChannelRegistrationLookupRequest,
  ProjectChannelRegistrationRequest,
  ProjectChannelRegistrationReadRequest,
} from "../../lib/project-channel-registration.js";
import { assertProjectChannelRegistrationOperationIntent } from "../../lib/project-channel-registration.js";
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

function requestObject(path: string, opts: OutputOptions): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    emitCliError("The request file must contain one JSON object.", opts);
  }
  return parsed as Record<string, unknown>;
}

function registrationRequest(
  path: string,
  opts: OutputOptions,
  expectedIntent?: ProjectChannelRegistrationOperationIntent,
): ProjectChannelRegistrationRequest {
  const parsed = requestObject(path, opts);
  const targetDigest = typeof parsed.target_digest === "string"
    ? parsed.target_digest.trim()
    : "";
  if (!targetDigest) {
    emitCliError("The request file must include target_digest.", opts);
  }
  const { target_digest: _targetDigest, target: _target, ...request } = parsed;
  const parsedRequest = {
    ...request,
    target: remoteTarget(targetDigest),
  } as unknown as ProjectChannelRegistrationRequest;
  if (expectedIntent) {
    assertProjectChannelRegistrationOperationIntent(parsedRequest, expectedIntent);
  }
  return parsedRequest;
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
    .description("Conditionally create an absent project channel from one contract request JSON file")
    .requiredOption("--request <path>", "Contract request JSON file")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      try {
        printJson(await getStore().registerProjectChannel(
          registrationRequest(opts.request, opts, "create"),
        ));
      } finally {
        closeDb();
      }
    });

  registration
    .command("bind-existing")
    .description("Conditionally bind one existing channel to a Projects workspace without recreating it")
    .requiredOption("--request <path>", "Bind-existing contract request JSON file")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      try {
        printJson(await getStore().registerProjectChannel(
          registrationRequest(opts.request, opts, "bind_existing"),
        ));
      } finally {
        closeDb();
      }
    });

  registration
    .command("lookup-receipt")
    .description("Look up one exact terminal project channel registration receipt")
    .requiredOption("--request <path>", "Terminal receipt lookup request JSON file")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      try {
        printJson(await getStore().lookupProjectChannelRegistrationReceipt(
          requestObject(opts.request, opts) as unknown as ProjectChannelRegistrationLookupRequest,
        ));
      } finally {
        closeDb();
      }
    });

  registration
    .command("compensate")
    .description("Conditionally inverse an accepted project channel registration")
    .requiredOption("--request <path>", "Inverse contract request JSON file")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      try {
        printJson(await getStore().compensateProjectChannelRegistration(
          registrationRequest(opts.request, opts),
        ));
      } finally {
        closeDb();
      }
    });

  registration
    .command("verify-inverse")
    .description("Verify accepted inverse receipt and target absence or restored ownership")
    .requiredOption("--request <path>", "Inverse contract request JSON file")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      try {
        printJson(await getStore().verifyProjectChannelRegistrationInverse(
          registrationRequest(opts.request, opts),
        ));
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
