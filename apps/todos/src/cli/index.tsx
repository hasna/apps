#!/usr/bin/env bun
import {
  assertTodosCliStageAContainment,
  exitWithTodosCliStageAError,
  isTodosCliPureMetadataInvocation,
} from "./stage-a.js";
import { renderTodosCliMetadata } from "./metadata.js";

try {
  assertTodosCliStageAContainment();
} catch (error) {
  exitWithTodosCliStageAError(error);
}

const args = process.argv.slice(2);
if (isTodosCliPureMetadataInvocation(args)) {
  if (!renderTodosCliMetadata(args)) {
    exitWithTodosCliStageAError(new Error("HOSTED_AUTHORITY_UNAVAILABLE"), args);
  }
} else {
  await import("./runtime.js");
}
