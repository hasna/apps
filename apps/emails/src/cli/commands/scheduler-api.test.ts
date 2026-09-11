import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { Command } from "commander";
import { registerMiscCommands, runSchedulerTick } from "./misc.remote.js";
import { resetSelfHostedConfigCache } from "../../db/self-hosted-store.js";
let child: ReturnType<typeof Bun.spawn>;
let origin: string;
let original: NodeJS.ProcessEnv;
const script = `const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){const body=await req.json();if(new URL(req.url).pathname!=='/v1/scheduled/run')return new Response('wrong path',{status:404});return Response.json({scheduled:{attempted:body.limit,sent:body.limit,failed:0,pending:0,skipped:0},items:[],sequences:{attempted:body.sequence_limit,sent:body.sequence_limit,failed:0,pending:0,skipped:0},sequence_items:[],sequence_execution:body.sequence_limit===0?'not_requested':'executed'});}});console.log(server.url.origin);`;
beforeAll(async () => {
  child = Bun.spawn([process.execPath, "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  origin = new TextDecoder().decode((await reader.read()).value).trim();
  reader.releaseLock();
});
afterAll(() => child.kill());
beforeEach(() => {
  original = { ...process.env };
  process.env.HASNA_EMAILS_API_URL = origin;
  process.env.EMAILS_SESSION_TOKEN = crypto.randomUUID();
  delete process.env.HASNA_EMAILS_DB_PATH;
  delete process.env.EMAILS_DB_PATH;
  resetSelfHostedConfigCache();
});
afterEach(() => {
  for (const key of Object.keys(process.env))
    if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
  resetSelfHostedConfigCache();
  process.exitCode = 0;
});
for (const args of [["schedule", "run"], ["scheduler"]])
  test(`${args.join(" ")} --once invokes the scheduled-job API`, async () => {
    const p = new Command();
    p.exitOverride();
    let result: any;
    registerMiscCommands(p, (x) => {
      result = x;
    });
    await p.parseAsync(["bun", "emails", ...args, "--once", "--limit", "3"]);
    expect(result.scheduled.attempted).toBe(3);
    expect(result.sequence_execution).toBe("executed");
    expect(result.sequences.sent).toBe(10);
  });
test("programmatic scheduler tick returns measured counts", async () => {
  expect((await runSchedulerTick({ scheduledLimit: 2 })).scheduled.sent).toBe(
    2,
  );
});

test("sequence limit zero explicitly skips sequences", async()=> {const result=await runSchedulerTick({sequenceLimit:0});expect(result.sequences.attempted).toBe(0);});
