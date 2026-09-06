#!/usr/bin/env bun
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Check the public distribution against its declared dependencies, independently
// of workspace overrides and skipLibCheck. npm's lifecycle is disabled in the
// inner pack so this can safely run from prepack without recursive builds.
const root = resolve(import.meta.dir, "..");
const workspace = await mkdtemp(join(tmpdir(), "skills-consumer-types-"));
const env = { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  TMPDIR: workspace, NO_COLOR: "1" };

async function run(command: string[], cwd: string) {
  const child = Bun.spawn(command, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 120_000);
  try {
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (status !== 0) throw new Error(`Consumer type check command failed (${command[0]}, exit ${status}):\n${stdout.slice(-16_000)}${stderr.slice(-16_000)}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

try {
  const packed = JSON.parse(await run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", workspace], root));
  const filename = packed[0]?.filename;
  if (typeof filename !== "string" || filename !== "hasna-skills-" + packed[0]?.version + ".tgz") throw new Error("Unexpected Skills package archive");
  const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  await writeFile(join(workspace, "package.json"), JSON.stringify({ private: true, type: "module",
    dependencies: { "@hasna/skills": `file:${join(workspace, filename)}` },
    devDependencies: { typescript: "5.9.3", "@types/bun": metadata.devDependencies["@types/bun"] },
  }));
  await writeFile(join(workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
    skipLibCheck: false, noEmit: true, types: ["bun"], allowSyntheticDefaultImports: true,
  }, files: ["consumer.ts"] }));
  await writeFile(join(workspace, "consumer.ts"), `
import { createRunService, runAdmissionSchema, runTerminalSchema, type SkillsProductStore, RemoteCapabilityUnavailableError, RemoteRequestError } from "@hasna/skills/sdk";
import { RemoteSkillsClient, RemoteSkillsAuthClient, RemoteCapabilityUnavailableError as RootCapabilityError } from "@hasna/skills";
declare const store: SkillsProductStore;
const service = createRunService({ store });
const admission = runAdmissionSchema.parse({});
const version: 1 = admission.contractVersion;
const status: "admitted" = admission.status;
const terminal = runTerminalSchema.parse({});
const terminalStatus: "succeeded" | "failed" | "cancelled" | "expired" = terminal.status;
// These directives also catch accidental loss of inference to any.
// @ts-expect-error A validated run cannot have a different protocol version.
const wrongVersion: 2 = admission.contractVersion;
// @ts-expect-error Admission does not produce a terminal state.
const wrongStatus: "succeeded" = admission.status;
const client = new RemoteSkillsClient("fixture", "https://skills.example.com/api/v1");
const auth = new RemoteSkillsAuthClient("https://skills.example.com/api/v1");
const unavailable = new RemoteCapabilityUnavailableError();
const rootError: RemoteCapabilityUnavailableError = new RootCapabilityError();
const requestError: RemoteRequestError = unavailable;
const unavailableCode: "SUBSCRIPTION_CHECKOUT_UNAVAILABLE" = unavailable.code;
// @ts-expect-error Arbitrary server error codes are not part of this safe contract.
const arbitraryCode: "ARBITRARY_SERVER_CODE" = unavailable.code;
void [service, version, status, terminalStatus, wrongVersion, wrongStatus, client, auth,
  rootError, requestError, unavailableCode, arbitraryCode];
`);
  await run([process.execPath, "install", "--ignore-scripts", "--registry", "https://registry.npmjs.org"], workspace);
  await run([process.execPath, "node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], workspace);
  console.log(`Consumer types: @hasna/skills@${metadata.version} passed strict installed-package checking (skipLibCheck=false).`);
} finally { await rm(workspace, { recursive: true, force: true }); }
