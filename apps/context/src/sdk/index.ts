// The `./sdk` importable surface of @hasna/context (repo law: four surfaces
// per member — CLI bin, MCP bin, -serve bin, `./sdk` module). Importable as:
//
//   import { ContextClient } from "@hasna/context/sdk";
//
// The typed HTTP client is generated from the context-serve OpenAPI document
// (hasna.contract.json package-sdk generatedFrom /openapi.json); the
// committed generated-client.ts is staleness-gated by a test.
export { ContextClient } from "./generated-client.js";
