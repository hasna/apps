#!/usr/bin/env bun
/**
 * secrets-serve bin entrypoint. Boots the cloud HTTP API.
 */
import { startCloudServer } from "./serve.js";

startCloudServer().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
