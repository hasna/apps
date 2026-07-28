import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomationsStore } from "../index.js";
import { handleWebhookRequest, startWebhookServer } from "../daemon/index.js";

let dataDir = "";

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "hasna-automations-cli-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

async function runCli(args: string[]) {
  const child = Bun.spawn({
    cmd: ["bun", "run", "src/cli/index.ts", "--dir", dataDir, "--json", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function runDaemon(args: string[]) {
  const child = Bun.spawn({
    cmd: ["bun", "run", "src/daemon/index.ts", "--dir", dataDir, "--json", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("automations CLI", () => {
  test("package bin surface uses contract-allowlisted entrypoints", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as {
      bin: Record<string, string>;
    };

    expect(packageJson.bin.automations).toBe("dist/cli/index.js");
    expect(packageJson.bin["automations-daemon"]).toBe("dist/daemon/index.js");
    expect(Object.keys(packageJson.bin).sort()).toEqual(["automations", "automations-daemon"]);
  });

  test("prints help, initializes status, and outputs example specs", async () => {
    const help = await runCli(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("automations");
    expect(help.stdout).toContain("status");

    const status = await runCli(["status"]);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      service: "automations",
      counts: { automations: 0 },
    });

    const example = await runCli(["spec", "example"]);
    expect(example.exitCode).toBe(0);
    expect(JSON.parse(example.stdout)).toMatchObject({
      id: "tickets.escalate-critical",
      triggers: [{ kind: "event" }],
    });
  });

  test("daemon status exists and run records a heartbeat", async () => {
    const before = await runDaemon(["status"]);
    expect(before.exitCode).toBe(0);
    expect(JSON.parse(before.stdout).daemon.active).toBe(false);

    const run = await runDaemon(["run", "--once"]);
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: true });

    const after = await runDaemon(["status"]);
    expect(after.exitCode).toBe(0);
    expect(JSON.parse(after.stdout).daemon).toMatchObject({
      active: true,
      metadata: { mode: "run" },
    });
  });

  test("daemon run stays alive without --once", async () => {
    const child = Bun.spawn({
      cmd: [
        "bun",
        "run",
        "src/daemon/index.ts",
        "--dir",
        dataDir,
        "--json",
        "run",
        "--interval-ms",
        "100",
        "--ttl-ms",
        "500",
      ],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const race = await Promise.race([
      child.exited.then((exitCode) => ({ kind: "exited" as const, exitCode })),
      Bun.sleep(250).then(() => ({ kind: "running" as const })),
    ]);
    expect(race.kind).toBe("running");
    child.kill();
    await child.exited;
  });

  test("handles concurrent fresh DB initialization", async () => {
    const first = Bun.spawn({
      cmd: ["bun", "run", "src/cli/index.ts", "--dir", dataDir, "--json", "status"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const second = Bun.spawn({
      cmd: ["bun", "run", "src/daemon/index.ts", "--dir", dataDir, "--json", "run", "--once"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [firstOut, firstErr, firstExit, secondOut, secondErr, secondExit] = await Promise.all([
      new Response(first.stdout).text(),
      new Response(first.stderr).text(),
      first.exited,
      new Response(second.stdout).text(),
      new Response(second.stderr).text(),
      second.exited,
    ]);

    expect(firstExit).toBe(0);
    expect(secondExit).toBe(0);
    expect(firstErr).toBe("");
    expect(secondErr).toBe("");
    expect(JSON.parse(firstOut)).toMatchObject({ service: "automations" });
    expect(JSON.parse(secondOut)).toMatchObject({ ok: true });
  });

  test("creates, lists, simulates, claims, fails, and replays from the CLI", async () => {
    const specPath = join(dataDir, "automation.json");
    writeFileSync(specPath, JSON.stringify({
      schemaVersion: "1.0",
      id: "tickets.escalate-critical",
      name: "Escalate critical tickets",
      version: "1.0.0",
      triggers: [{ kind: "event", source: "open-events", type: "ticket.created", filter: { priority: "critical" } }],
      actions: [{ id: "create-escalation-task", actionId: "todos.create", input: { title: "Escalate critical ticket" } }],
    }, null, 2));

    const validate = await runCli(["validate", specPath]);
    expect(validate.exitCode).toBe(0);
    expect(JSON.parse(validate.stdout).valid).toBe(true);

    const create = await runCli(["create", specPath]);
    expect(create.exitCode).toBe(0);
    expect(JSON.parse(create.stdout).id).toBe("tickets.escalate-critical");

    const list = await runCli(["list"]);
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout)).toHaveLength(1);

    const drySimulate = await runCli(["simulate", specPath, "--event-json", JSON.stringify({
      id: "evt_cli_dry",
      dedupeKey: "ticket:cli:deduped",
      source: "open-events",
      type: "ticket.created",
      data: { priority: "critical" },
    })]);
    expect(drySimulate.exitCode).toBe(0);
    expect(JSON.parse(drySimulate.stdout)).toMatchObject({
      persisted: false,
      run: { idempotencyKey: "tickets.escalate-critical:ticket:cli:deduped" },
      actions: [{ idempotencyKey: "tickets.escalate-critical:ticket:cli:deduped:create-escalation-task" }],
    });

    const simulate = await runCli(["simulate", specPath, "--persist", "--event-json", JSON.stringify({
      id: "evt_cli",
      source: "open-events",
      type: "ticket.created",
      data: { priority: "critical" },
    })]);
    expect(simulate.exitCode).toBe(0);
    const materialized = JSON.parse(simulate.stdout);
    const runId = materialized[0].run.id;
    const actionId = materialized[0].actions[0].id;

    const runs = await runCli(["runs", "list"]);
    expect(runs.exitCode).toBe(0);
    expect(JSON.parse(runs.stdout)[0]).toMatchObject({ id: runId, status: "materialized" });

    const contractRuns = await runCli(["runs", "list", "--contract"]);
    expect(contractRuns.exitCode).toBe(0);
    expect(JSON.parse(contractRuns.stdout)[0]).toMatchObject({
      schema: "hasna.work_run.v1",
      id: `automation_run_${runId}`,
      status: "pending",
      metadata: { originalStatus: "materialized" },
    });

    const contractRun = await runCli(["runs", "show", runId, "--contract"]);
    expect(contractRun.exitCode).toBe(0);
    expect(JSON.parse(contractRun.stdout)).toMatchObject({
      schema: "hasna.work_run.v1",
      status: "pending",
    });

    const claim = await runCli(["queue", "claim", "--runner", "cli-test"]);
    expect(claim.exitCode).toBe(0);
    expect(JSON.parse(claim.stdout)).toMatchObject({ id: actionId, status: "claimed", claimedBy: "cli-test" });

    for (let index = 0; index < 3; index += 1) {
      if (index > 0) {
        const reclaimed = await runCli(["queue", "claim", "--runner", "cli-test"]);
        expect(reclaimed.exitCode).toBe(0);
      }
      const failed = await runCli(["queue", "fail", actionId, "--runner", "cli-test", "--code", "CLI_FAIL", "--message", "failed", "--retry-backoff-ms", "0"]);
      expect(failed.exitCode).toBe(0);
    }

    const dlq = await runCli(["dlq", "list"]);
    expect(dlq.exitCode).toBe(0);
    expect(JSON.parse(dlq.stdout)[0]).toMatchObject({ id: actionId, status: "dead" });

    const replay = await runCli(["dlq", "replay", actionId]);
    expect(replay.exitCode).toBe(0);
    expect(JSON.parse(replay.stdout)).toMatchObject({ id: actionId, status: "queued" });

    const runtimes = await runCli(["runtimes"]);
    expect(runtimes.exitCode).toBe(0);
    expect(JSON.parse(runtimes.stdout)[0]).toMatchObject({
      kind: "open-loops",
      handoff: "claim-queue",
      metadata: {
        eventEnvelope: {
          exportCommand: "automations webhooks event <route-id-or-path> --body-json <json>",
          openLoopsCommand: "loops events handle generic",
        },
      },
    });
  }, 20000);

  test("manages webhook routes from the CLI and materializes local test deliveries", async () => {
    const specPath = join(dataDir, "webhook-automation.json");
    writeFileSync(specPath, JSON.stringify({
      schemaVersion: "1.0",
      id: "webhook.github-main",
      name: "GitHub webhook",
      version: "1.0.0",
      triggers: [{ kind: "webhook", source: "github", type: "push", filter: { branch: "main" } }],
      actions: [{ id: "record", actionId: "actions.record" }],
    }, null, 2));

    const createAutomation = await runCli(["create", specPath]);
    expect(createAutomation.exitCode).toBe(0);

    const createRoute = await runCli([
      "webhooks",
      "create",
      "webhook.github-main",
      "--id",
      "github-main",
      "--path",
      "/webhooks/github/main",
      "--source",
      "github",
      "--type",
      "push",
      "--data-path",
      "payload",
      "--dedupe-key-header",
      "X-GitHub-Delivery",
      "--secret-ref",
      "secret://automations/webhooks/github-main",
      "--signature-header",
      "X-Hub-Signature-256",
      "--signature-prefix",
      "sha256=",
    ]);
    expect(createRoute.exitCode).toBe(0);
    expect(JSON.parse(createRoute.stdout)).toMatchObject({
      id: "github-main",
      path: "/webhooks/github/main",
      signature: { secretRef: "secret://automations/webhooks/github-main" },
    });
    expect(createRoute.stdout).not.toContain("shared-secret");

    const listRoutes = await runCli(["webhooks", "list"]);
    expect(listRoutes.exitCode).toBe(0);
    expect(JSON.parse(listRoutes.stdout)).toHaveLength(1);

    const eventEnvelope = await runCli([
      "webhooks",
      "event",
      "github-main",
      "--body-json",
      JSON.stringify({ payload: { branch: "main", repository: "open-automations" } }),
      "--header",
      "X-GitHub-Delivery:delivery-envelope",
    ]);
    expect(eventEnvelope.exitCode).toBe(0);
    expect(JSON.parse(eventEnvelope.stdout)).toMatchObject({
      source: "github",
      type: "push",
      dedupeKey: "delivery-envelope",
      metadata: { webhook: { routeId: "github-main" } },
    });
    expect(JSON.parse(eventEnvelope.stdout).materialized).toBeUndefined();

    const testDelivery = await runCli([
      "webhooks",
      "test",
      "github-main",
      "--body-json",
      JSON.stringify({ payload: { branch: "main", repository: "open-automations" } }),
      "--header",
      "X-GitHub-Delivery:delivery-cli",
    ]);
    expect(testDelivery.exitCode).toBe(0);
    expect(JSON.parse(testDelivery.stdout)).toMatchObject({
      event: { source: "github", type: "push", dedupeKey: "delivery-cli" },
      materialized: [{ automation: { id: "webhook.github-main" } }],
    });

    const disable = await runCli(["webhooks", "disable", "github-main"]);
    expect(disable.exitCode).toBe(0);
    expect(JSON.parse(disable.stdout).status).toBe("disabled");

    const enable = await runCli(["webhooks", "enable", "github-main"]);
    expect(enable.exitCode).toBe(0);
    expect(JSON.parse(enable.stdout).status).toBe("active");

    const rotate = await runCli(["webhooks", "rotate-secret", "github-main", "--secret-ref", "secret://automations/webhooks/github-main-v2"]);
    expect(rotate.exitCode).toBe(0);
    expect(JSON.parse(rotate.stdout)).toMatchObject({
      signature: { secretRef: "secret://automations/webhooks/github-main-v2" },
    });
  });

  test("daemon webhook server verifies raw-body signatures and returns deterministic failures", async () => {
    process.env.HASNA_AUTOMATIONS_DIR = dataDir;
    const store = new AutomationsStore();
    const server = startWebhookServer({
      store,
      port: 0,
      maxBodyBytes: 128,
      resolveSecret: () => "shared-secret",
    });
    try {
      store.createAutomation({
        schemaVersion: "1.0",
        id: "webhook.daemon",
        name: "Daemon webhook",
        version: "1.0.0",
        triggers: [{ kind: "webhook", source: "github", type: "push", filter: { branch: "main" } }],
        actions: [{ id: "record", actionId: "actions.record" }],
      });
      store.createWebhookRoute({
        id: "github-daemon",
        automationId: "webhook.daemon",
        path: "/webhooks/github/daemon",
        mapping: {
          source: "github",
          type: "push",
          dataPath: "payload",
          dedupeKeyHeader: "X-GitHub-Delivery",
        },
        signature: {
          algorithm: "hmac-sha256",
          secretRef: "secret://automations/webhooks/github-daemon",
          header: "X-Hub-Signature-256",
          prefix: "sha256=",
        },
      });
      store.createWebhookRoute({
        id: "github-daemon-base64",
        automationId: "webhook.daemon",
        path: "/webhooks/github/daemon-base64",
        mapping: {
          source: "github",
          type: "push",
          dataPath: "payload",
          dedupeKeyHeader: "X-GitHub-Delivery",
        },
        signature: {
          algorithm: "hmac-sha256",
          secretRef: "secret://automations/webhooks/github-daemon-base64",
          header: "X-Hub-Signature-256",
          prefix: "sha256=",
          encoding: "base64",
        },
      });

      const origin = `http://${server.hostname}:${server.port}`;
      const health = await fetch(`${origin}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true, service: "automations", mode: "webhooks" });

      const url = `${origin}/webhooks/github/daemon`;
      const body = JSON.stringify({ payload: { branch: "main", repository: "open-automations" } });
      const signature = createHmac("sha256", "shared-secret").update(body).digest("hex");
      const malformedHexSuffix = await fetch(url, {
        method: "POST",
        headers: {
          "X-Hub-Signature-256": `sha256=${signature}zz`,
          "X-GitHub-Delivery": "delivery-hex-suffix",
        },
        body,
      });
      expect(malformedHexSuffix.status).toBe(401);
      expect(store.listRuns()).toHaveLength(0);

      const base64Url = `${origin}/webhooks/github/daemon-base64`;
      const base64Signature = createHmac("sha256", "shared-secret").update(body).digest("base64");
      const malformedBase64Suffix = await fetch(base64Url, {
        method: "POST",
        headers: {
          "X-Hub-Signature-256": `sha256=${base64Signature}!`,
          "X-GitHub-Delivery": "delivery-base64-suffix",
        },
        body,
      });
      expect(malformedBase64Suffix.status).toBe(401);
      expect(store.listRuns()).toHaveLength(0);

      const badSignature = await fetch(url, {
        method: "POST",
        headers: {
          "X-Hub-Signature-256": "sha256=bad",
          "X-GitHub-Delivery": "delivery-http",
        },
        body,
      });
      expect(badSignature.status).toBe(401);
      expect(store.listRuns()).toHaveLength(0);

      const accepted = await fetch(url, {
        method: "POST",
        headers: {
          "X-Hub-Signature-256": `sha256=${signature}`,
          "X-GitHub-Delivery": "delivery-http",
        },
        body,
      });
      expect(accepted.status).toBe(202);
      expect(await accepted.json()).toMatchObject({
        ok: true,
        routeId: "github-daemon",
        automationId: "webhook.daemon",
        dedupeKey: "delivery-http",
      });
      expect(store.listRuns()).toHaveLength(1);

      const malformed = "not-json";
      const malformedSignature = createHmac("sha256", "shared-secret").update(malformed).digest("hex");
      const malformedResponse = await fetch(url, {
        method: "POST",
        headers: {
          "X-Hub-Signature-256": `sha256=${malformedSignature}`,
          "X-GitHub-Delivery": "delivery-malformed",
        },
        body: malformed,
      });
      expect(malformedResponse.status).toBe(400);

      const tooLarge = await fetch(url, {
        method: "POST",
        headers: {
          "X-Hub-Signature-256": `sha256=${signature}`,
          "X-GitHub-Delivery": "delivery-large",
        },
        body: JSON.stringify({ payload: { branch: "main", value: "x".repeat(200) } }),
      });
      expect(tooLarge.status).toBe(413);
      // Asserted over the wire so the daemon's deterministic body wins over any
      // limit Bun.serve might apply before the fetch handler runs.
      expect(await tooLarge.json()).toEqual({
        ok: false,
        error: "webhook_payload_too_large",
        maxBodyBytes: 128,
      });
      // A streaming body without Content-Length cannot be expressed through fetch(),
      // so this one case exercises the handler in-process.
      const streamedTooLarge = await handleWebhookRequest(new Request(url, {
        method: "POST",
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{\"payload\":{\"branch\":\"main\",\"value\":\""));
            controller.enqueue(new TextEncoder().encode("x".repeat(200)));
            controller.enqueue(new TextEncoder().encode("\"}}"));
            controller.close();
          },
        }),
      }), {
        store,
        maxBodyBytes: 128,
        resolveSecret: () => "shared-secret",
      });
      expect(streamedTooLarge.status).toBe(413);
      expect(store.listRuns()).toHaveLength(1);

      store.setWebhookRouteStatus("github-daemon", "disabled");
      const inactive = await fetch(url, {
        method: "POST",
        headers: {
          "X-Hub-Signature-256": `sha256=${signature}`,
          "X-GitHub-Delivery": "delivery-disabled",
        },
        body,
      });
      expect(inactive.status).toBe(403);
    } finally {
      server.stop(true);
      store.close();
      delete process.env.HASNA_AUTOMATIONS_DIR;
    }
  });

  test("lists, renders, validates, and registers the launch follow-up recipe pack", async () => {
    const list = await runCli(["recipes", "list"]);
    expect(list.exitCode).toBe(0);
    const recipes = JSON.parse(list.stdout) as Array<{ pack: string; name: string }>;
    expect(recipes).toHaveLength(5);
    expect(recipes.map((recipe) => recipe.name)).toContain("uptime-watch");

    const outDir = join(dataDir, "recipes-out");
    const render = await runCli([
      "recipes",
      "render",
      "launch-followup",
      "--app-id",
      "open-todos",
      "--package",
      "@hasna/todos",
      "--app-version",
      "1.2.3",
      "--out",
      outDir,
      "--create",
    ]);
    expect(render.exitCode).toBe(0);
    const rendered = JSON.parse(render.stdout) as { specs: string[]; files: string[]; created: string[] };
    expect(rendered.specs).toHaveLength(5);
    expect(rendered.files).toHaveLength(5);
    expect(rendered.created).toEqual(rendered.specs);

    // Rendered files pass the existing `validate` command (loader path).
    for (const file of rendered.files) {
      const validated = await runCli(["validate", file]);
      expect(validated.exitCode).toBe(0);
      expect(JSON.parse(validated.stdout).valid).toBe(true);
    }

    // Registered automations are listed by the store-backed `list` command.
    const listed = await runCli(["list"]);
    const automations = JSON.parse(listed.stdout) as Array<{ id: string }>;
    expect(automations.map((automation) => automation.id).sort()).toEqual([...rendered.specs].sort());

    const missing = await runCli(["recipes", "render", "launch-followup", "--app-id", "open-todos"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("--package");

    const unknown = await runCli(["recipes", "render", "unknown-pack", "--app-id", "a", "--package", "b", "--app-version", "1.0.0"]);
    expect(unknown.exitCode).toBe(1);
  });
});
