import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { openapiSpec } from "../src/server/openapi.js";

type GeneratorModule = typeof import("./generate-sdk.js");

const root = join(import.meta.dir, "..");
const trackedSdkPath = join(root, "src", "sdk", "index.ts");
const trackedSdkRelativePath = relative(root, trackedSdkPath);
const decoder = new TextDecoder();
let generatorModulePromise: Promise<GeneratorModule> | undefined;

interface TrackedSdkSnapshot {
  path: string;
  size: number;
  modifiedAtNs: string;
  changedAtNs: string;
  sha256: string;
  gitDiffExitCode: number;
  gitDiff: string;
}

function runGit(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

function snapshotTrackedSdk(): TrackedSdkSnapshot {
  const bytes = readFileSync(trackedSdkPath);
  const metadata = statSync(trackedSdkPath, { bigint: true });
  const quiet = runGit(["diff", "--quiet", "HEAD", "--", trackedSdkRelativePath]);
  if (quiet.exitCode !== 0 && quiet.exitCode !== 1) {
    throw new Error(`Unable to inspect tracked SDK diff state: ${quiet.stderr}`);
  }
  const diff = runGit(["diff", "--no-ext-diff", "HEAD", "--", trackedSdkRelativePath]);
  if (diff.exitCode !== 0) {
    throw new Error(`Unable to inspect tracked SDK diff: ${diff.stderr}`);
  }
  return {
    path: realpathSync(trackedSdkPath),
    size: Number(metadata.size),
    modifiedAtNs: metadata.mtimeNs.toString(),
    changedAtNs: metadata.ctimeNs.toString(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    gitDiffExitCode: quiet.exitCode,
    gitDiff: diff.stdout,
  };
}

function expectTrackedSdkUnchanged(before: TrackedSdkSnapshot): void {
  expect(snapshotTrackedSdk()).toEqual(before);
}

function loadGeneratorModule(): Promise<GeneratorModule> {
  generatorModulePromise ??= (async () => {
    const before = snapshotTrackedSdk();
    await Bun.sleep(25);
    const moduleUrl = new URL("./generate-sdk.ts?test-import-safety", import.meta.url).href;
    const generatorModule = (await import(moduleUrl)) as GeneratorModule;
    expectTrackedSdkUnchanged(before);
    return generatorModule;
  })();
  return generatorModulePromise;
}

function methodSource(code: string, functionName: string): string {
  const marker = `    async ${functionName}(`;
  const start = code.indexOf(marker);
  if (start < 0) throw new Error(`Missing generated SDK method ${functionName}.`);
  const end = code.indexOf("\n    }", start);
  if (end < 0) throw new Error(`Generated SDK method ${functionName} has no closing boundary.`);
  return code.slice(start, end + "\n    }".length);
}

test("imports the generator without writing the tracked SDK", async () => {
  const generatorModule = await loadGeneratorModule();

  expect(typeof generatorModule.generateSdkSource).toBe("function");
  expect(typeof generatorModule.writeGeneratedSdk).toBe("function");
});

test("rewrites the current binary return shape without changing JSON operations", async () => {
  const { generateSdkSource } = await loadGeneratorModule();
  const createSchema = openapiSpec.paths["/v1/project-registration/channels"]
    .post.requestBody.content["application/json"].schema;
  const bindSchema = openapiSpec.paths["/v1/project-registration/channels/bind-existing"]
    .post.requestBody.content["application/json"].schema;
  expect(createSchema.required).toEqual([]);
  expect(bindSchema.required).toEqual(["operation_intent", "bind_existing"]);
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

  const generated = generateSdkSource().code;
  const generatedDownload = methodSource(generated, "downloadMessageAttachment");
  const generatedGetMessage = methodSource(generated, "getMessage");
  const generatedRegisterProjectChannel = methodSource(generated, "registerProjectChannel");

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
  expect(generatedRegisterProjectChannel).toContain(
    'body: { "operation_intent"?: "create" } & Record<string, unknown>',
  );
  expect(generatedGetMessage).toBe(rawGetMessage);
});

test("keeps tracked SDK bytes unchanged for isolated changed-version generation and write failure", async () => {
  const { writeGeneratedSdk } = await loadGeneratorModule();
  const before = snapshotTrackedSdk();
  const tempRoot = mkdtempSync(join(tmpdir(), "conversations-sdk-generate-"));

  try {
    const changedVersionSpec = structuredClone(openapiSpec);
    changedVersionSpec.info.version = "9.9.9-test";

    const outputPath = join(tempRoot, "success", "index.ts");
    const written = writeGeneratedSdk({
      spec: changedVersionSpec,
      outputPath,
    });
    const outputBytes = readFileSync(outputPath);
    const output = outputBytes.toString("utf8");

    expect(written.outputPath).toBe(outputPath);
    expect(realpathSync(outputPath)).toBe(outputPath);
    expect(statSync(outputPath).size).toBe(outputBytes.byteLength);
    expect(written.operations).toBeGreaterThan(0);
    expect(output).toContain("// Source: ConversationsClient 9.9.9-test");
    expectTrackedSdkUnchanged(before);

    const failurePath = join(tempRoot, "write-failure");
    mkdirSync(failurePath);
    let writeError: unknown;
    try {
      writeGeneratedSdk({
        spec: changedVersionSpec,
        outputPath: failurePath,
      });
    } catch (error) {
      writeError = error;
    }

    expect(writeError).toBeInstanceOf(Error);
    expect((writeError as NodeJS.ErrnoException).code).toBe("EISDIR");
    expectTrackedSdkUnchanged(before);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  expect(existsSync(tempRoot)).toBe(false);
  expectTrackedSdkUnchanged(before);
});
