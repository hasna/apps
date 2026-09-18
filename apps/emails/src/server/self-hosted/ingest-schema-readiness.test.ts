import { describe, expect, test } from "bun:test";

// Child processes isolate module mocks from the suite's real store/SDK tests.
function runWorker(scenario: string) {
  const modulePath = (name: string) => new URL(`./${name}.ts`, import.meta.url).pathname;
  const script = `
    import { mock } from "bun:test";
    const scenario = ${JSON.stringify(scenario)};
    const { emailsSelfHostedMigrations } = await import(${JSON.stringify(modulePath("migrations"))});
    const migrations = emailsSelfHostedMigrations();
    const effects = { receive: 0, attributes: 0, object: 0, delete: 0, closed: 0, ledger: 0, route: 0, quarantine: 0, attributesAfterDrift: 0, healthStops: 0 };
    let changed = false;
    let releaseSampler;
    const samplerRelease = new Promise(resolve => { releaseSampler = resolve; });
    const rows = () => {
      const rows = migrations.map(({ id, checksum }) => ({ id, checksum }));
      const mode = changed ? "unknown" : scenario;
      if (mode === "pending") rows.pop();
      if (mode === "checksum" || mode === "dependency") rows[mode === "dependency" ? 0 : rows.length - 1].checksum = "sha256:fixture-drift";
      if (mode === "unknown") rows.push({ id: "9999_fixture_future", checksum: "sha256:fixture" });
      if (mode === "compatible") {
        const migration = migrations.find(item => item.acceptedChecksums?.length);
        if (!migration) throw new Error("missing historical compatibility fixture");
        rows.find(row => row.id === migration.id).checksum = migration.acceptedChecksums[0];
      }
      return rows;
    };
    const realEnv = await import(${JSON.stringify(modulePath("env"))});
    mock.module(${JSON.stringify(modulePath("env"))}, () => ({ ...realEnv,
      getSelfHostedPool: () => ({ client: {
        get: async () => ({ rolname: "fixture_app", rolsuper: scenario === "unsafe-role", rolbypassrls: false }),
        many: async (sql) => {
          if (sql !== "SELECT id, checksum FROM schema_migrations") throw new Error("unexpected SQL");
          effects.ledger++;
          if (scenario === "unavailable") throw new Error("private database diagnostic");
          if ((scenario === "late-sampler" || scenario === "drift-ack") && effects.ledger === 2) {
            await samplerRelease;
            changed = true;
          }
          if (scenario === "sampling-drift" && effects.ledger === 2) changed = true;
          if (scenario === "sampling-import-drift" && effects.ledger === 3) {
            await Promise.resolve();
            changed = true;
          }
          return rows();
        },
      }}),
      closeSelfHostedPool: async () => { effects.closed++; },
    }));
    const realStore = await import(${JSON.stringify(modulePath("store"))});
    mock.module(${JSON.stringify(modulePath("store"))}, () => ({ ...realStore, EmailsSelfHostedStore: class {
      async resolveInboundRecipients() { effects.route++; return { groups: [], unresolved: ["fixture@example.test"] }; }
      async quarantineInbound() {
        effects.quarantine++;
        if (scenario === "shutdown-ack") process.emit("SIGTERM");
        if (scenario === "drift-ack") {
          releaseSampler();
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }}));
    const sqs = await import("@aws-sdk/client-sqs");
    mock.module("@aws-sdk/client-sqs", () => ({ ...sqs, SQSClient: class {
      async send(command) {
        if (command instanceof sqs.GetQueueAttributesCommand) {
          effects.attributes++;
          if (effects.healthStops) effects.attributesAfterDrift++;
          return { Attributes: { ApproximateNumberOfMessages: "0" } };
        }
        if (command instanceof sqs.DeleteMessageCommand) { effects.delete++; return {}; }
        effects.receive++;
        if (scenario === "receive-retry" && effects.receive === 1) throw new Error("fixture transient receive");
        if (scenario === "after-receive" || scenario === "next-poll" || scenario === "shutdown-ack" || scenario === "drift-ack") {
          changed = scenario === "after-receive" || scenario === "next-poll";
          if (effects.receive > 1) process.emit("SIGTERM");
          return { Messages: scenario !== "next-poll" ? [{
            Body: JSON.stringify({ notificationType: "Received", mail: { messageId: "fixture" },
              receipt: { recipients: ["fixture@example.test"], action: { type: "S3", bucketName: "fixture-inbound", objectKey: "fixture" } } }),
            ReceiptHandle: "fixture-receipt",
          }] : [] };
        }
        process.emit("SIGTERM");
        if (scenario === "late-sampler") setTimeout(() => releaseSampler(), 0);
        return { Messages: [] };
      }
      destroy() {}
    }}));
    const s3 = await import("@aws-sdk/client-s3");
    mock.module("@aws-sdk/client-s3", () => ({ ...s3, S3Client: class {
      async send() { effects.object++; throw new Error("fixture object access"); }
      destroy() {}
    }}));
    // The pool is mocked; this non-credential sentinel only satisfies config validation.
    process.env.EMAILS_DATABASE_URL = "test";
    process.env.EMAILS_INGEST_QUEUE_URL = "https://queue.example.test/fixture";
    process.env.EMAILS_INGEST_S3_BUCKET = "fixture-inbound";
    Bun.serve = () => ({ port: 9487, stop() { effects.healthStops++; } });
    process.env.EMAILS_WORKER_HEALTH_PORT = "9487";
    const initialTerm = process.listenerCount("SIGTERM");
    const initialInt = process.listenerCount("SIGINT");
    let error = null;
    try {
      const { runIngestWorker } = await import(${JSON.stringify(modulePath("ingest-worker"))});
      await runIngestWorker({ waitTimeSeconds: 0 });
    } catch (caught) { error = caught.message; }
    console.log("FIXTURE_RESULT=" + JSON.stringify({ effects, error,
      leakedSignals: process.listenerCount("SIGTERM") - initialTerm + process.listenerCount("SIGINT") - initialInt }));
  `;
  const child = Bun.spawnSync([process.execPath, "--no-env-file", "--no-install", "-e", script], {
    cwd: new URL("../../../", import.meta.url).pathname,
    env: process.env, stdout: "pipe", stderr: "pipe", timeout: 10_000,
  });
  expect(child.exitCode).toBe(0);
  const output = child.stdout.toString();
  const result = output.split("\n").find(line => line.startsWith("FIXTURE_RESULT="));
  if (!result) throw new Error(`Missing fixture result: ${child.stderr.toString()}`);
  expect(output + child.stderr.toString()).not.toContain("private database diagnostic");
  return JSON.parse(result.slice("FIXTURE_RESULT=".length));
}

describe("ingest worker schema fence", () => {
  for (const scenario of ["pending", "checksum", "dependency", "unknown", "unavailable"]) {
    test(`${scenario} refuses before any queue or object request`, () => {
      const { effects, error, leakedSignals } = runWorker(scenario);
      expect(error).toContain("schema readiness");
      expect(effects).toMatchObject({ receive: 0, attributes: 0, object: 0, delete: 0, closed: 1 });
      expect(leakedSignals).toBe(0);
    });
  }
  for (const scenario of ["exact", "compatible"]) {
    test(`${scenario} inventory polls and shuts down cleanly`, () => {
      const { effects, error, leakedSignals } = runWorker(scenario);
      expect(error).toBeNull();
      expect(effects.receive).toBe(1);
      expect(effects.ledger).toBeGreaterThan(0);
      expect(effects.closed).toBe(1);
      expect(leakedSignals).toBe(0);
    });
  }
  for (const scenario of ["after-receive", "next-poll", "sampling-drift", "sampling-import-drift"]) {
    test(`${scenario} stops further work on observed schema drift`, () => {
      const { effects, error, leakedSignals } = runWorker(scenario);
      expect(error).toContain("schema readiness");
      expect(effects.receive).toBe(scenario.startsWith("sampling-") ? 0 : 1);
      expect(effects.attributesAfterDrift).toBe(0);
      expect(effects.healthStops).toBe(1);
      expect(effects.route).toBe(0);
      expect(effects.object).toBe(0);
      expect(effects.delete).toBe(0);
      expect(effects.closed).toBe(1);
      expect(leakedSignals).toBe(0);
    });
  }
  test("a schema failure during sampler shutdown still exits with failure", () => {
    const { effects, error, leakedSignals } = runWorker("late-sampler");
    expect(error).toContain("schema readiness");
    expect(effects).toMatchObject({ receive: 1, attributes: 0, object: 0, delete: 0, closed: 1, healthStops: 1 });
    expect(leakedSignals).toBe(0);
  });
  test("shutdown during message processing preserves its successful acknowledgment", () => {
    const { effects, error, leakedSignals } = runWorker("shutdown-ack");
    expect(error).toBeNull();
    expect(effects).toMatchObject({ receive: 1, route: 1, quarantine: 1, delete: 1, closed: 1 });
    expect(leakedSignals).toBe(0);
  });
  test("observed schema drift finishes one in-flight acknowledgment before failing", () => {
    const { effects, error, leakedSignals } = runWorker("drift-ack");
    expect(error).toContain("schema readiness");
    expect(effects).toMatchObject({ receive: 1, route: 1, quarantine: 1, delete: 1, closed: 1, healthStops: 1 });
    expect(effects.attributesAfterDrift).toBe(0);
    expect(leakedSignals).toBe(0);
  });
  test("ordinary receive failures retain their retry behavior", () => {
    const { effects, error } = runWorker("receive-retry");
    expect(error).toBeNull();
    expect(effects.receive).toBe(2);
    expect(effects.closed).toBe(1);
  }, 15_000);
  test("the existing RLS role guard still refuses and closes the pool", () => {
    const { effects, error } = runWorker("unsafe-role");
    expect(error).toContain("RLS boot assertion FAILED");
    expect(effects).toMatchObject({ receive: 0, attributes: 0, object: 0, closed: 1 });
  });
});
