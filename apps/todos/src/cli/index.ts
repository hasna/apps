#!/usr/bin/env bun
import { getTodosMode } from "../runtime-mode.js";

async function main(): Promise<void> {
  const mode = getTodosMode();
  const runtime = mode === "cloud" ? await import("./cloud.js") : await import("./local.js");
  await runtime.run(process.argv);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
