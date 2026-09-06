import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeliveryResult } from "../types.js";

const standalonePath = new URL("../../dist/cli/index.js", import.meta.url).pathname;
const commanderPath = new URL("../../dist/commander.js", import.meta.url).pathname;
const sdkPath = new URL("../../dist/index.js", import.meta.url).pathname;
const commanderModule = createRequire(import.meta.url).resolve("commander");

const cases = [
  { name: "failed HTTP delivery", status: "failed", responseStatus: 503, exitCode: 1, requests: 1, add: [], test: [] },
  { name: "successful HTTP delivery", status: "success", responseStatus: 200, exitCode: 0, requests: 1, add: [], test: [] },
  { name: "filter mismatch honored", status: "skipped", responseStatus: 200, exitCode: 0, requests: 0, add: ["--type", "other.*"], test: ["--honor-filters"] },
  { name: "disabled channel honored", status: "skipped", responseStatus: 200, exitCode: 0, requests: 0, add: ["--disabled"], test: ["--honor-filters"] },
  { name: "default test bypasses disabled state and filters", status: "success", responseStatus: 200, exitCode: 0, requests: 1, add: ["--disabled", "--type", "other.*"], test: [] },
  { name: "private target denied by default", status: "failed", responseStatus: 200, exitCode: 1, requests: 0, add: [], test: [], allowlist: undefined },
  { name: "empty allowlist denies private target", status: "failed", responseStatus: 200, exitCode: 1, requests: 0, add: [], test: [], allowlist: " ,  " },
  { name: "different host allowlist denies target", status: "failed", responseStatus: 200, exitCode: 1, requests: 0, add: [], test: [], allowlist: "127.0.0.2" },
  { name: "wildcard does not allow private target", status: "failed", responseStatus: 200, exitCode: 1, requests: 0, add: [], test: [], allowlist: "127.*" },
  { name: "comma-separated exact allowlist permits target", status: "success", responseStatus: 200, exitCode: 0, requests: 1, add: [], test: [], allowlist: " 127.0.0.2, 127.0.0.1, " },
  { name: "custom factory retains SDK default denial despite CLI allowlist", status: "failed", responseStatus: 200, exitCode: 1, requests: 0, add: [], test: [], customFactory: true },
] as const;

// Test the shipped standalone bundle and the same public Commander adapter
// embedded by consumer apps. Canonical build/generated-artifact checks keep
// these tracked dist files tied to the source under review.
describe("built channel-test CLI exit contract", () => {
  for (const surface of ["standalone", "commander"] as const) {
    for (const json of [true, false]) {
      for (const scenario of cases) {
        const customFactory = "customFactory" in scenario && scenario.customFactory;
        if (customFactory && surface !== "commander") continue;
        test(`${surface} ${json ? "JSON" : "human"}: ${scenario.name}`, async () => {
          const home = mkdtempSync(join(tmpdir(), "events-channel-exit-"));
          const dataDir = join(home, "events");
          const requests: Array<{ method: string; type: string }> = [];
          const children: ReturnType<typeof Bun.spawn>[] = [];
          const server = Bun.serve({
            hostname: "127.0.0.1", port: 0,
            async fetch(request) {
              const payload = await request.json() as { type: string };
              requests.push({ method: request.method, type: payload.type });
              return new Response("owned delivery response", { status: scenario.responseStatus });
            },
          });
          const embeddedPath = join(home, "embedded.ts");
          writeFileSync(embeddedPath, `
            import { Command } from ${JSON.stringify(commanderModule)};
            import { registerEventsCommands } from ${JSON.stringify(commanderPath)};
            import { EventsClient, JsonEventsStore } from ${JSON.stringify(sdkPath)};
            const program = new Command().option("--json", "Print JSON");
            registerEventsCommands(program, {
              source: "fixture", dataDir: process.env.HASNA_EVENTS_DIR,
              ${customFactory ? `createClient: () => new EventsClient({
                store: new JsonEventsStore(process.env.HASNA_EVENTS_DIR),
              }),` : ""}
            });
            await program.parseAsync(process.argv);
          `);
          const env: Record<string, string> = {
            HOME: home, TMPDIR: home, PATH: "/usr/bin:/bin", NO_COLOR: "1",
            HASNA_EVENTS_DIR: dataDir,
          };
          const allowlist = "allowlist" in scenario ? scenario.allowlist : "127.0.0.1";
          if (allowlist !== undefined) env.HASNA_EVENTS_ALLOW_PRIVATE_WEBHOOK_TARGETS = allowlist;
          async function run(args: readonly string[], jsonOutput: boolean) {
            const child = Bun.spawn([
              process.execPath, "run", "--no-env-file",
              ...(surface === "standalone" ? [standalonePath, "--dir", dataDir] : [embeddedPath]),
              ...(jsonOutput ? ["--json"] : []), ...args,
            ], { cwd: home, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
            children.push(child);
            const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
            try {
              const [exitCode, stdout, stderr] = await Promise.all([
                child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
              ]);
              return { exitCode, stdout, stderr };
            } finally { clearTimeout(deadline); }
          }
          try {
            const added = await run([
              "channels", "add", `http://127.0.0.1:${server.port}/delivery`, "--id", "probe",
              "--retry-attempts", "1", "--timeout-ms", "2000", ...scenario.add,
            ], true);
            expect(added.exitCode).toBe(0);
            expect(JSON.parse(added.stdout).id).toBe("probe");
            expect(requests).toHaveLength(0);

            const result = await run(["channels", "test", "probe", "--type", "fixture.test", ...scenario.test], json);
            const deliveries = JSON.parse(readFileSync(join(dataDir, "deliveries.json"), "utf8")) as DeliveryResult[];
            expect(deliveries).toHaveLength(1);
            expect(deliveries[0]).toMatchObject({ channelId: "probe", status: scenario.status });
            expect(deliveries[0]!.attempts).toHaveLength(1);
            expect(requests).toHaveLength(scenario.requests);
            if (scenario.requests) {
              expect(requests[0]).toEqual({ method: "POST", type: "fixture.test" });
              expect(deliveries[0]!.attempts[0]).toMatchObject({
                status: scenario.status, responseStatus: scenario.responseStatus, responseBody: "owned delivery response",
              });
            } else {
              expect(deliveries[0]!.attempts[0]!.status).toBe(scenario.status);
              expect(deliveries[0]!.attempts[0]!.responseStatus).toBeUndefined();
              if (scenario.status === "failed") expect(deliveries[0]!.attempts[0]!.error).toContain("SSRF guard");
            }
            expect(result.stderr).toBe("");
            if (json) expect(JSON.parse(result.stdout)).toEqual(deliveries[0]);
            else expect(result.stdout.trim()).toBe(`${scenario.status}: probe`);
            expect(result.exitCode).toBe(scenario.exitCode);
          } finally {
            for (const child of children) {
              if (child.exitCode === null) child.kill("SIGKILL");
              await child.exited;
            }
            await server.stop(true);
            rmSync(home, { recursive: true, force: true });
          }
        }, 30_000);
      }
    }
  }
});
