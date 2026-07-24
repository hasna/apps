#!/usr/bin/env bun
/** Deterministic guard for remote operator utilities deferred to Stage B. */
import {
  assertTodosStageARemoteAccessFloor,
  TodosHostedStorageUnavailableError,
} from "../src/storage/authority-floor.js";

export function stopDeferredStageBOperation(operation: string): never {
  try {
    assertTodosStageARemoteAccessFloor();
  } catch (error) {
    const contained = error instanceof TodosHostedStorageUnavailableError
      ? error
      : new TodosHostedStorageUnavailableError();
    if (process.argv.includes("-j") || process.argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify({
        error: "hosted_authority_unavailable",
        code: contained.code,
        reason: contained.reason,
      })}\n`);
      process.exit(1);
    }
    process.stderr.write(
      `${operation}: Stage B deferred; ${contained.code}: ${contained.reason}\n`,
    );
    process.exit(1);
  }
  throw new TodosHostedStorageUnavailableError();
}

if (import.meta.main) {
  stopDeferredStageBOperation(process.argv[2] ?? "remote operator");
}
