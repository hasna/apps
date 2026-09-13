import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySkillsStore } from "./store.js";
import { publicPrincipal } from "./auth.js";
import { packSkillBundle } from "../lib/skill-bundle.js";
import { RuntimeExecutionStore } from "./runtime-store.js";
import {
  createRuntimeService,
  handleRuntimeApiRequest,
  handleRuntimeWorkerRequest,
  reconcileRuntimeJobs,
} from "./runtime-api.js";
import { executeRuntimeWork, type RuntimeWork } from "./runtime-worker.js";
import { runtimeToken } from "./runtime-policy.js";
import type {
  EcsRunTaskClient,
  EcsRunTaskInput,
} from "../sdk/execution/dispatchers/ecs.js";
const paths: string[] = [];
const stores: RuntimeExecutionStore[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
  for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true });
});
class Cloud implements EcsRunTaskClient {
  calls: EcsRunTaskInput[] = [];
  stopped = false;
  async runTask(input: EcsRunTaskInput) {
    this.calls.push(input);
    return { taskArn: "task-test-one" };
  }
  async listTasksByStartedBy() {
    return ["task-test-one"];
  }
  async describeTasks() {
    return [
      {
        taskArn: "task-test-one",
        lastStatus: this.stopped ? "STOPPED" : "RUNNING",
      },
    ];
  }
  async stopTask() {
    this.stopped = true;
  }
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skills-runtime-test-"));
  paths.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "src/index.ts"),
    `import {writeFileSync} from 'node:fs';\nwriteFileSync(process.env.SKILLS_EXPORTS_DIR+'/document.pdf','%PDF-1.4\\n'+JSON.stringify({secret:process.env.RUNTIME_TEST_CANARY??null,token:process.env.SKILLS_RUNTIME_TOKEN??null,uid:process.getuid?.()}));\nconsole.log('generated');`,
  );
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "pdf-generate",
      version: "1.0.0",
      bin: { "pdf-generate": "src/index.ts" },
    }),
  );
  const bundle = packSkillBundle(root),
    product = new MemorySkillsStore();
  const principal = publicPrincipal({
    orgId: "runtime-test-org",
    scopes: ["skills:read", "skills:write", "runs:write", "runs:read"],
  });
  await product.publishSkill({
    principal,
    slug: "pdf-generate",
    displayName: "PDF",
    description: "Test",
    category: "Documents",
    tags: [],
    source: "custom",
    kind: "executable",
    version: "1.0.0",
    bundle: {
      sha256: bundle.sha256,
      byteSize: bundle.bytes.length,
      contentType: "application/gzip",
      storageKind: "db",
      bytes: bundle.bytes,
    },
  });
  const store = await RuntimeExecutionStore.open(join(root, "execution.db"));
  stores.push(store);
  const cloud = new Cloud();
  const service = (await createRuntimeService({
    productStore: product,
    executionStore: store,
    ecsClient: cloud,
    env: {
      HASNA_SKILLS_RUNTIME_SIGNING_KEY: "test-runtime-signing-key-".repeat(3),
      HASNA_SKILLS_RUNTIME_CONFIG: JSON.stringify({
        cluster: "test-cluster",
        taskDefinition: "test-definition",
        containerName: "test-supervisor",
        region: "test-region",
        subnets: ["test-subnet"],
        securityGroups: ["test-group"],
        apiOrigin: "http://127.0.0.1/api/v1",
        imageDigest: "sha256:" + "a".repeat(64),
        reviewedBundles: [
          { slug: "pdf-generate", version: "1.0.0", sha256: bundle.sha256 },
        ],
      }),
    },
  }))!;
  return { root, service, principal, cloud, bundle };
}
const post = (
  url: string,
  value: unknown,
  headers: Record<string, string> = {},
) =>
  new Request("http://127.0.0.1/api/v1/" + url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(value),
  });
const submit = {
  version: "1.0.0",
  input: { content: "A real test invocation" },
  idempotencyKey: "test-run-one",
};
describe("versioned cloud execution bridge", () => {
  test("admission dispatches once; supervisor receives exact bytes; result is immutable and tenant scoped", async () => {
    const f = await fixture();
    const response = (await handleRuntimeApiRequest(
      post("executions/pdf-generate", submit),
      f.principal,
      f.service,
    ))!;
    expect(response.status).toBe(202);
    const admitted = (await response.json()) as {
      id: string;
      bundleDigest: string;
    };
    expect(admitted.bundleDigest).toBe(f.bundle.sha256);
    const replay = (await handleRuntimeApiRequest(
      post("executions/pdf-generate", submit),
      f.principal,
      f.service,
    ))!;
    expect(((await replay.json()) as { id: string }).id).toBe(admitted.id);
    expect(f.cloud.calls).toHaveLength(1);
    const job = (await f.service.store.job(admitted.id))!,
      attempt = job.attempts[0]!;
    const token = runtimeToken(
      f.service.signingKey,
      job.execution.admission,
      attempt,
    );
    const workResponse = (await handleRuntimeWorkerRequest(
      new Request(`http://127.0.0.1/api/v1/runtime/${admitted.id}/work`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      f.service,
    ))!;
    expect(workResponse.status).toBe(200);
    const work = (await workResponse.json()) as RuntimeWork;
    const previous = process.env.RUNTIME_TEST_CANARY;
    process.env.RUNTIME_TEST_CANARY = "host-only-synthetic-value";
    let result;
    try {
      result = await executeRuntimeWork(work, {
        dependenciesPath: f.root,
        unprivileged: false,
      });
    } finally {
      if (previous === undefined) delete process.env.RUNTIME_TEST_CANARY;
      else process.env.RUNTIME_TEST_CANARY = previous;
    }
    expect(result.exitCode).toBe(0);
    expect(
      Buffer.from(result.artifacts[0]!.base64, "base64").toString(),
    ).toContain('"secret":null');
    expect(
      Buffer.from(result.artifacts[0]!.base64, "base64").toString(),
    ).toContain('"token":null');
    const completion = () =>
      handleRuntimeWorkerRequest(
        post(`runtime/${admitted.id}/complete`, result, {
          authorization: `Bearer ${token}`,
        }),
        f.service,
      );
    expect((await completion())!.status).toBe(200);
    expect((await completion())!.status).toBe(200);
    const changed = await handleRuntimeWorkerRequest(
      post(
        `runtime/${admitted.id}/complete`,
        { ...result, stdout: "changed" },
        { authorization: `Bearer ${token}` },
      ),
      f.service,
    );
    expect(changed!.status).toBe(409);
    const foreign = (await handleRuntimeApiRequest(
      new Request(`http://127.0.0.1/api/v1/executions/${admitted.id}`),
      { ...f.principal, orgId: "different-org" },
      f.service,
    ))!;
    expect(foreign.status).toBe(404);
    expect((await f.service.store.job(admitted.id))!.execution.status).toBe(
      "succeeded",
    );
    const reopened = await RuntimeExecutionStore.open(
      join(f.root, "execution.db"),
    );
    stores.push(reopened);
    expect((await reopened.job(admitted.id))!.result!.artifacts).toHaveLength(
      1,
    );
  });
  test("concurrent different inputs sharing a key cannot poison the winning snapshot", async () => {
    const f = await fixture();
    // Force both requests past the optimistic checks and into store admission.
    const original = f.service.store.admit.bind(f.service.store);
    let pending = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.service.store.admit = async (admission) => {
      pending++;
      if (pending === 2) release();
      await both;
      return original(admission);
    };
    const responses = await Promise.all([
      handleRuntimeApiRequest(
        post("executions/pdf-generate", {
          ...submit,
          input: { content: "winner one" },
        }),
        f.principal,
        f.service,
      ),
      handleRuntimeApiRequest(
        post("executions/pdf-generate", {
          ...submit,
          input: { content: "winner two" },
        }),
        f.principal,
        f.service,
      ),
    ]);
    expect(responses.map((r) => r!.status).sort()).toEqual([202, 409]);
    expect(f.cloud.calls).toHaveLength(1);
    const accepted = (await responses
      .find((r) => r!.status === 202)!
      .json()) as { id: string };
    const job = (await f.service.store.job(accepted.id))!;
    const { digestInput } = await import("../sdk/execution/admission.js");
    expect(digestInput(job.input)).toBe(job.execution.admission.inputDigest);
  });
  test("read-only principals, unreviewed versions, parameter injection and reused keys fail before dispatch", async () => {
    const f = await fixture();
    expect(
      (await handleRuntimeApiRequest(
        post("executions/pdf-generate", {
          ...submit,
          workspaceId: "different-workspace",
        }),
        f.principal,
        f.service,
      ))!.status,
    ).toBe(409);
    expect(
      (await handleRuntimeApiRequest(
        post("executions/pdf-generate", {
          ...submit,
          bundleDigest: "0".repeat(64),
        }),
        f.principal,
        f.service,
      ))!.status,
    ).toBe(409);
    expect(f.cloud.calls).toHaveLength(0);
    const readOnly = { ...f.principal, role: "owner", scopes: ["skills:read"] };
    expect(
      (await handleRuntimeApiRequest(
        post("executions/pdf-generate", submit),
        readOnly,
        f.service,
      ))!.status,
    ).toBe(403);
    expect(
      (await handleRuntimeApiRequest(
        post("executions/pdf-generate", {
          ...submit,
          args: ["--url", "https://example.com"],
        }),
        f.principal,
        f.service,
      ))!.status,
    ).toBe(400);
    expect(
      (await handleRuntimeApiRequest(
        post("executions/pdf-generate", {
          ...submit,
          input: { content: "x", url: "https://example.com" },
        }),
        f.principal,
        f.service,
      ))!.status,
    ).toBe(400);
    f.service.config.reviewedBundles = [];
    expect(
      (await handleRuntimeApiRequest(
        post("executions/pdf-generate", submit),
        f.principal,
        f.service,
      ))!.status,
    ).toBe(403);
    expect(f.cloud.calls).toHaveLength(0);
    f.service.config.reviewedBundles = [
      { slug: "pdf-generate", version: "1.0.0", sha256: f.bundle.sha256 },
    ];
    await handleRuntimeApiRequest(
      post("executions/pdf-generate", submit),
      f.principal,
      f.service,
    );
    expect(
      (await handleRuntimeApiRequest(
        post("executions/pdf-generate", {
          ...submit,
          input: { content: "different" },
        }),
        f.principal,
        f.service,
      ))!.status,
    ).toBe(409);
    expect(f.cloud.calls).toHaveLength(1);
  });
  test("forged worker token and late cancelled worker cannot read or complete a run", async () => {
    const f = await fixture();
    const admitted = (await (await handleRuntimeApiRequest(
      post("executions/pdf-generate", submit),
      f.principal,
      f.service,
    ))!.json()) as { id: string };
    expect(
      (await handleRuntimeWorkerRequest(
        new Request(`http://127.0.0.1/api/v1/runtime/${admitted.id}/work`, {
          headers: { authorization: "Bearer forged" },
        }),
        f.service,
      ))!.status,
    ).toBe(401);
    const job = (await f.service.store.job(admitted.id))!,
      token = runtimeToken(
        f.service.signingKey,
        job.execution.admission,
        job.attempts[0]!,
      );
    expect(
      (await handleRuntimeApiRequest(
        post(`executions/${admitted.id}/cancel`, {}),
        f.principal,
        f.service,
      ))!.status,
    ).toBe(200);
    expect(
      (await handleRuntimeWorkerRequest(
        new Request(`http://127.0.0.1/api/v1/runtime/${admitted.id}/work`, {
          headers: { authorization: `Bearer ${token}` },
        }),
        f.service,
      ))!.status,
    ).toBe(409);
  });
  test("concurrency limit is enforced and a stopped task without a callback settles durably", async () => {
    const f = await fixture();
    const admitted = (await (await handleRuntimeApiRequest(
      post("executions/pdf-generate", submit),
      f.principal,
      f.service,
    ))!.json()) as { id: string };
    const denied = await handleRuntimeApiRequest(
      post("executions/pdf-generate", {
        ...submit,
        idempotencyKey: "second-run",
        input: { content: "Second distinct input" },
      }),
      f.principal,
      f.service,
    );
    expect(denied!.status).toBe(429);
    expect(f.cloud.calls).toHaveLength(1);
    f.cloud.stopped = true;
    await reconcileRuntimeJobs(f.service);
    expect((await f.service.store.job(admitted.id))!.execution.status).toBe(
      "failed",
    );
    expect((await f.service.store.job(admitted.id))!.result!.error).toContain(
      "without a completion",
    );
  });
  test("bundle tampering is refused before a subprocess can run", async () => {
    const f = await fixture();
    const admitted = (await (await handleRuntimeApiRequest(
      post("executions/pdf-generate", submit),
      f.principal,
      f.service,
    ))!.json()) as { id: string };
    const job = (await f.service.store.job(admitted.id))!;
    await expect(
      executeRuntimeWork(
        {
          admission: job.execution.admission,
          input: job.input!,
          bundleBase64: Buffer.from("tampered").toString("base64"),
        },
        { dependenciesPath: f.root, unprivileged: false },
      ),
    ).rejects.toThrow("digest mismatch");
  });
  test("two database connections cannot claim the same attempt generation", async () => {
    const f = await fixture();
    const response = (await (await handleRuntimeApiRequest(
      post("executions/pdf-generate", submit),
      f.principal,
      f.service,
    ))!.json()) as { id: string };
    const another = await RuntimeExecutionStore.open(
      join(f.root, "execution.db"),
    );
    stores.push(another);
    const job = (await another.job(response.id))!,
      a = job.attempts[0]!;
    await f.service.dispatcher.cancel(response.id);
    const admitted = await f.service.store.admit({
      ...job.execution.admission,
      runId: "run_fresh_claim",
      idempotencyKey: "fresh-claim",
    });
    const pending = await f.service.store.createAttempt({
      runId: admitted.admission.runId,
      attemptNumber: 1,
    });
    const results = await Promise.all(
      [f.service.store, another].map((store) =>
        store.claimAttempt({
          runId: admitted.admission.runId,
          attemptId: pending.attemptId,
          workerId: "different-worker",
          expectedLeaseGeneration: 0,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });
});
