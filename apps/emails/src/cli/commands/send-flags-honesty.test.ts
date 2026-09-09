// `emails send` declared --unsubscribe-url, --track-opens, --track-clicks and
// --tracking-url, parsed all four, and read NONE of them: the mail left without
// RFC 8058 List-Unsubscribe headers and without tracking, then printed a green
// checkmark and exited 0. A parsed-and-ignored option is a false capability.
//
// Options must reach a capable API or fail before sending. Successful sends
// pass the received payload through the real adapter with a captured transport.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { resetMailDataSource } from "../../lib/mail-data-source.js";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResendAdapter } from "../../providers/resend.js";
import type { Provider, SendEmailOptions } from "../../types/index.js";
import { emailsSelfHostedOpenApi } from "../../server/self-hosted/openapi.js";
import { buildPrepublishTestEnv } from "../../../scripts/prepublish-local-test.mjs";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { registerSendCommands } from "./send.js";

let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
function captureInheritedProcessEnv(): void {
  INHERITED_PROCESS_ENV = { ...process.env };
}
function restoreInheritedProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(INHERITED_PROCESS_ENV, key)) delete process.env[key];
  }
  Object.assign(process.env, INHERITED_PROCESS_ENV);
}

interface RunResult {
  consoleOutput: string;
  errorOutput: string;
  exited: boolean;
}

/** Drive the real command in-process, capturing stdout, stderr and process.exit. */
async function runSend(args: string[]): Promise<RunResult> {
  const program = new Command();
  program.exitOverride();
  registerSendCommands(program, () => {});

  const consoleLines: string[] = [];
  const errorLines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;
  console.log = (...values: unknown[]) => { consoleLines.push(values.map(String).join(" ")); };
  (console as unknown as { error: (...v: unknown[]) => void }).error = (...values: unknown[]) => {
    errorLines.push(values.map(String).join(" "));
  };
  (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as never;

  let exited = false;
  try {
    await program.parseAsync(["node", "emails", ...args]);
  } catch (error) {
    if (!(error instanceof Error) || !/process\.exit/.test(error.message)) throw error;
    exited = true;
  } finally {
    console.log = originalLog;
    (console as unknown as { error: typeof originalError }).error = originalError;
    (process as unknown as { exit: typeof originalExit }).exit = originalExit;
  }

  return { consoleOutput: consoleLines.join("\n"), errorOutput: errorLines.join("\n"), exited };
}

// The CLI talks to an authenticated capable API fixture. Its provider adapter
// is real; only the instance's final SDK transport is captured, with no cloud I/O.
describe("emails send --unsubscribe-url through a capable API", () => {
  let stub: V1Stub;
  let server: ReturnType<typeof Bun.serve>;
  let home: string;
  const captured: Array<{ headers?: Record<string, string> }> = [];
  beforeAll(async () => {
    stub = await startV1Stub({ openapi: true });
    const adapter = new ResendAdapter({ id: "fixture-provider", api_key: crypto.randomUUID() } as Provider);
    (adapter as unknown as { client: unknown }).client = { emails: { send: async (input: { headers?: Record<string, string> }) => {
      captured.push(input);
      return { data: { id: `captured-${captured.length}` }, error: null };
    } } };
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
      if (request.headers.get("authorization") !== `Bearer ${stub.apiKey}`) return new Response("unauthorized", { status: 401 });
      const path = new URL(request.url).pathname;
      if (path === "/v1/openapi.json") return Response.json(emailsSelfHostedOpenApi);
      if (path === "/v1/messages/send" && request.method === "POST") {
        const input = await request.clone().json() as SendEmailOptions;
        await adapter.sendEmail(input);
      }
      return fetch(new Request(`${stub.baseUrl}${path}${new URL(request.url).search}`, request));
    } });
  });
  afterAll(() => { server?.stop(true); stub?.stop(); });
  beforeEach(async () => {
    await stub.reset(); captured.length = 0;
    home = mkdtempSync(join(tmpdir(), "emails-unsubscribe-api-"));
    mkdirSync(join(home, "tmp"), { mode: 0o700 });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  async function runCapableSend(args: string[]): Promise<RunResult> {
    const child = Bun.spawn({ cmd: [process.execPath, "src/cli/index.tsx", ...args],
      env: { ...buildPrepublishTestEnv(process.env, home), HASNA_STATION: `unsubscribe-${crypto.randomUUID()}`,
        HASNA_EMAILS_API_URL: server.url.origin, HASNA_EMAILS_API_KEY: stub.apiKey },
      stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), 15000);
    try {
      const [code, consoleOutput, errorOutput] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(readdirSync(home, { recursive: true }).filter(name => /\.(?:db|sqlite)(?:-|$)/.test(String(name)))).toEqual([]);
      return { consoleOutput, errorOutput, exited: code !== 0 };
    } finally { clearTimeout(timer); }
  }

  it("delivers the RFC 8058 one-click headers with the message", async () => {
    const result = await runCapableSend([
      "send", "--from", "agent@acme.com", "--to", "dest@ext.com", "--subject", "Hi", "--body", "x",
      "--unsubscribe-url", "https://acme.com/unsub",
    ]);
    expect(result.errorOutput).toBe("");
    expect(result.exited).toBe(false);
    expect(result.consoleOutput).toContain("Email sent to dest@ext.com");
    expect(await stub.list("messages")).toHaveLength(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ from: "agent@acme.com", to: ["dest@ext.com"], subject: "Hi", text: "x" });
    expect(captured[0]!.headers?.["List-Unsubscribe"]).toBe("<https://acme.com/unsub>");
    expect(captured[0]!.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  }, 20000);

  it("sends without the headers when the flag is not passed", async () => {
    const result = await runCapableSend([
      "send", "--from", "agent@acme.com", "--to", "dest@ext.com", "--subject", "Hi", "--body", "x",
    ]);
    expect(result.errorOutput).toBe("");
    expect(result.exited).toBe(false);
    expect(await stub.list("messages")).toHaveLength(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ from: "agent@acme.com", to: ["dest@ext.com"], subject: "Hi", text: "x" });
    expect(captured[0]!.headers?.["List-Unsubscribe"]).toBeUndefined();
    expect(captured[0]!.headers?.["List-Unsubscribe-Post"]).toBeUndefined();
  }, 20000);
});

// ---- against the serve API: --unsubscribe-url is refused, not dropped --------

describe("emails send --unsubscribe-url (serve API)", () => {
  let stub: V1Stub;

  beforeAll(async () => { stub = await startV1Stub(); });
  afterAll(() => stub.stop());

  beforeEach(async () => {
    captureInheritedProcessEnv();
    await stub.reset();
    stub.applyEnv();
    resetMailDataSource();
  });

  afterEach(() => {
    stub.clearEnv();
    resetMailDataSource();
    restoreInheritedProcessEnv();
  });

  it("refuses the send when the API cannot advertise unsubscribe support", async () => {
    const result = await runSend([
      "send", "--from", "agent@acme.com", "--to", "dest@ext.com", "--subject", "Hi", "--body", "x",
      "--unsubscribe-url", "https://acme.com/unsub",
    ]);

    expect(result.exited).toBe(true);
    expect(result.errorOutput).toContain("/openapi.json");
    // Nothing left: a refusal that mails anyway is worse than the silent drop.
    expect(await stub.list("messages")).toHaveLength(0);
  });
});

// Tracking options must reach a capable server; older APIs never receive a send.
describe("emails send tracking API contract", () => {
  let stub: V1Stub;
  beforeAll(async()=>{stub=await startV1Stub();}); afterAll(()=>stub.stop());
  beforeEach(async()=>{captureInheritedProcessEnv();await stub.reset();stub.applyEnv();resetMailDataSource();});
  afterEach(()=>{stub.clearEnv();resetMailDataSource();restoreInheritedProcessEnv();});
  for (const flag of ["--track-opens","--track-clicks"]) it(`refuses ${flag} when the server cannot advertise support`,async()=>{
    const result=await runSend(["send","--from","agent@acme.com","--to","dest@ext.com","--subject","Hi","--body","x",flag]);
    expect(result.exited).toBe(true); expect(result.errorOutput).toMatch(/openapi|update/); expect(await stub.list("messages")).toHaveLength(0);
  });
  it("requires a tracking switch with --tracking-url",async()=>{
    const result=await runSend(["send","--from","agent@acme.com","--to","dest@ext.com","--subject","Hi","--body","x","--tracking-url","https://track.example"]);
    expect(result.exited).toBe(true);expect(result.errorOutput).toContain("--tracking-url requires");expect(await stub.list("messages")).toHaveLength(0);
  });
});
