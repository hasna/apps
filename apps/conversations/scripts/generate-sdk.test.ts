import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { openapiSpec } from "../src/server/openapi.js";

const root = join(import.meta.dir, "..");

function methodSource(code: string, functionName: string): string {
  const marker = `    async ${functionName}(`;
  const start = code.indexOf(marker);
  if (start < 0) throw new Error(`Missing generated SDK method ${functionName}.`);
  const end = code.indexOf("\n    }", start);
  if (end < 0) throw new Error(`Generated SDK method ${functionName} has no closing boundary.`);
  return code.slice(start, end + "\n    }".length);
}

test("rewrites the current binary return shape without changing JSON operations", () => {
  const raw = generateSdkFromOpenApi(openapiSpec as any, {
    className: "ConversationsClient",
    apiKeyHeader: "x-api-key",
  }).code;
  const rawDownload = methodSource(raw, "downloadMessageAttachment");
  const rawGetMessage = methodSource(raw, "getMessage");

  expect(rawDownload).toContain('query?: { "encoding"?: "base64" }');
  expect(rawDownload).toContain(
    'Promise<{ "name": string; "mime_type": string; "size": number; "content_base64": string }>',
  );

  const result = Bun.spawnSync({
    cmd: ["bun", "run", "./scripts/generate-sdk.ts"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output =
    new TextDecoder().decode(result.stdout) +
    new TextDecoder().decode(result.stderr);
  expect(result.exitCode, output).toBe(0);

  const generated = readFileSync(join(root, "src", "sdk", "index.ts"), "utf8");
  const generatedDownload = methodSource(generated, "downloadMessageAttachment");
  const generatedGetMessage = methodSource(generated, "getMessage");

  expect(generatedDownload).toContain(
    'query: { "encoding": "base64" }, init?: RequestInit): Promise<{ "name": string; "mime_type": string; "size": number; "content_base64": string }>',
  );
  expect(generatedDownload).toContain(
    'query?: { "encoding"?: undefined }, init?: RequestInit): Promise<ArrayBuffer>',
  );
  expect(generatedDownload).toContain(
    'query?: { "encoding"?: "base64" }, init?: RequestInit): Promise<ArrayBuffer | { "name": string; "mime_type": string; "size": number; "content_base64": string }>',
  );
  expect(generatedDownload).toContain('responseType: "arrayBuffer"');
  expect(generated).toContain(
    'opts.responseType === "arrayBuffer" && !response.headers.get("content-type")?.toLowerCase().includes("application/json")',
  );
  expect(generatedGetMessage).toBe(rawGetMessage);
});
