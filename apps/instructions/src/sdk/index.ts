/**
 * `@hasna/instructions/sdk` — the importable module surface of the ONE
 * `@hasna/instructions` package (package-surfaces rule: one package per app,
 * never a split `-sdk`). Built as a self-contained bundle: node builtins only,
 * the `@hasna/contracts` resolver inlined at build time
 * (`sdk-bundle-self-contained.test.ts` keeps it that way).
 *
 * Credentials and the service authority come from the one shared
 * `@hasna/contracts` client chain (hasna/apps#1720), resolved fresh on EVERY
 * request:
 *
 *   import { createInstructionsV1ClientFromEnv } from "@hasna/instructions/sdk";
 *   const client = createInstructionsV1ClientFromEnv();
 *   const { configs = [] } = await client.listConfigs({ category: "rules" });
 *
 * An explicit `baseUrl` requires an explicit `apiKey` (hasna/apps#1794): the
 * SDK never attaches the machine's fleet key to an authority the caller chose.
 */
export {
  INSTRUCTIONS_SDK_APP,
  createInstructionsV1ClientFromEnv,
  resolveInstructionsSdkTransport,
} from "./resolve.js";
export type {
  InstructionsSdkEnv,
  InstructionsSdkKeychainOptions,
  InstructionsSdkResolveOptions,
  InstructionsSdkTransportReport,
} from "./resolve.js";

// Versioned /v1 client, generated from the serve OpenAPI document
// (src/server/openapi.ts). Regenerate with `bun run scripts/generate-sdk.ts`.
export * from "./v1.generated.js";
