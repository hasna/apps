import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDatabase } from "../../db/database.js";
import { createLocalTodosProjectRegistrationAuthority } from "../../project-registration/index.js";
import type { TodosProjectRegistrationLookupRequest } from "../../project-registration/types.js";
import {
  cloudLookupProjectRegistrationReceipt,
  getTodosCloudClient,
} from "../cloud-router.js";
import { handleError, outputRecord } from "../helpers.js";

function globalJsonRequested(program: Command): boolean {
  const command = program as Command & { optsWithGlobals?: () => Record<string, unknown> };
  return command.optsWithGlobals?.()["json"] === true || program.opts()["json"] === true;
}

function readLookupRequest(path: string): TodosProjectRegistrationLookupRequest {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(`project registration lookup request must be a readable JSON file: ${path}`, {
      cause: error,
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("project registration lookup request must contain one JSON object");
  }
  return value as TodosProjectRegistrationLookupRequest;
}

export function registerProjectRegistrationCommands(program: Command): void {
  const registration = program
    .command("project-registration")
    .description("Read package-owned project registration evidence");

  registration
    .command("receipt-lookup <request-file>")
    .description("Look up one immutable registration receipt by exact stored source identity")
    .option("-j, --json", "Output as JSON")
    .action(async (requestFile: string, options: { json?: boolean }) => {
      try {
        const request = readLookupRequest(requestFile);
        const remote = getTodosCloudClient();
        const result = remote
          ? await cloudLookupProjectRegistrationReceipt(remote, request)
          : await createLocalTodosProjectRegistrationAuthority(getDatabase()).lookupReceipt(request);
        outputRecord(
          result,
          options.json === true || globalJsonRequested(program),
          "Project registration receipt",
        );
      } catch (error) {
        handleError(error);
      }
    });
}
