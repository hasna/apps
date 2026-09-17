import { afterEach, beforeEach, expect, test } from "bun:test";
import { processForwardingRules } from "./forwarding.js";
import { resetSelfHostedConfigCache } from "../db/self-hosted-store.js";

let original: NodeJS.ProcessEnv;
beforeEach(() => { original = { ...process.env }; });
let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(original, key)) delete process.env[key];
  }
  Object.assign(process.env, original);
  resetSelfHostedConfigCache();
});
test("an API client runs forwarding on its authenticated service without a local database", async () => {
  const requests: string[] = [];
  const credential = crypto.randomUUID();
  const authenticated: boolean[] = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url).pathname);
      authenticated.push(
        req.headers.get("authorization") === `Bearer ${credential}`,
      );
      return Response.json({
        attempted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        pending: 0,
        items: [],
      });
    },
  });
  delete process.env.EMAILS_DB_PATH;
  delete process.env.HASNA_EMAILS_DB_PATH;
  delete process.env["HASNA_EMAILS_LOCAL"];
  process.env.HASNA_EMAILS_API_URL = server.url.origin;
  process.env.EMAILS_SESSION_TOKEN = credential;
  resetSelfHostedConfigCache();
  expect(await processForwardingRules()).toMatchObject({
    attempted: 0,
    sent: 0,
  });
  expect(requests).toEqual(["/v1/forwarding/run"]);
  expect(authenticated).toEqual([true]);
});
