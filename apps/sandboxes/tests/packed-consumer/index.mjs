// Packed-tarball smoke: validates the PUBLISHED surface of @hasnaxyz/sandboxes.
// After the R1 iapp migration the package is a client SDK + MCP (the domain
// service + provider adapters are server-internal, not exported).
import DefaultClient, {
  SandboxesClient,
  SandboxesApiError,
} from "@hasnaxyz/sandboxes";
import * as mcp from "@hasnaxyz/sandboxes/mcp";

if (DefaultClient !== SandboxesClient) {
  throw new Error("default export must be the SandboxesClient class");
}
if (typeof SandboxesClient !== "function") {
  throw new Error("SandboxesClient is not constructable");
}
if (typeof SandboxesApiError !== "function") {
  throw new Error("SandboxesApiError is not exported");
}

const client = new SandboxesClient({ apiUrl: "http://127.0.0.1:1/v1", apiKey: "unused" });
for (const method of [
  "health",
  "whoami",
  "allocate",
  "listSandboxes",
  "getSandbox",
  "destroySandbox",
  "createCheckpoint",
  "listCheckpoints",
  "mintApiKey",
]) {
  if (typeof client[method] !== "function") {
    throw new Error(`SandboxesClient is missing method ${method}`);
  }
}

if (typeof mcp.createMcpServer !== "function") {
  throw new Error("MCP entry must export createMcpServer");
}

console.log("packed SDK + MCP surface OK");
