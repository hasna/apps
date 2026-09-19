import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packSkillBundle } from "../lib/skill-bundle.js";
import { digestInput } from "../sdk/execution/admission.js";
import type { EcsRunTaskClient, EcsRunTaskInput } from "../sdk/execution/dispatchers/ecs.js";
import type { PureExecutionContract } from "../sdk/execution/types.js";
import { publicPrincipal } from "./auth.js";
import { createRuntimeService, handleRuntimeApiRequest, handleRuntimeWorkerRequest } from "./runtime-api.js";
import { readRuntimeConfig, runtimeToken, type RuntimeConfig } from "./runtime-policy.js";
import { PURE_DESCRIPTOR_DIGEST, PURE_LIMITS, type PureReviewedBundle } from "./runtime-pure-contract.js";
import { RuntimeExecutionStore } from "./runtime-store.js";
import { MemorySkillsStore } from "./store.js";
import type { ApiPrincipal } from "./types.js";

// These are public synthetic fixtures, not operational skill payloads. Requests
// are passed directly to handlers; dispatch is recorded without executing code.
const SLUG = "synthetic-pure-test";
const VERSION = "1.0.0";
const IMAGE = "sha256:" + "a".repeat(64);
const ENTRYPOINT = "// Synthetic entrypoint: never executed by these tests.\n";
const INPUT = { pattern: "(?<letter>a+)(b)?", text: "😀aaa", flags: "gi" };
const OUTPUT = {
  pattern: INPUT.pattern,
  flags: INPUT.flags,
  matches: [{ match: "aaa", index: 2, groups: ["aaa", null], namedGroups: { letter: "aaa" } }],
};
const paths: string[] = [];
const stores: RuntimeExecutionStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

class RecordingCloud implements EcsRunTaskClient {
  calls: EcsRunTaskInput[] = [];
  observations = 0;
  async runTask(input: EcsRunTaskInput) {
    this.calls.push(input);
    return { taskArn: "synthetic-pure-task" };
  }
  async listTasksByStartedBy() {
    this.observations++;
    return ["synthetic-pure-task"];
  }
  async describeTasks() {
    this.observations++;
    return [{ taskArn: "synthetic-pure-task", lastStatus: "RUNNING" }];
  }
  async stopTask() {
    throw Error("Unexpected stop in a synthetic admission test");
  }
}

type FixtureOptions = {
  runtime?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  package?: Record<string, unknown>;
};
async function fixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "skills-pure-api-test-"));
  paths.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/index.ts"), ENTRYPOINT);
  writeFileSync(join(root, "skill.json"), JSON.stringify({
    kind: "executable",
    runtime: { runtime: "bun", entrypoint: "src/index.ts", env: [], system_deps: [], ...options.runtime },
    ...options.manifest,
  }));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: SLUG, version: VERSION, type: "module", private: true,
    bin: { [SLUG]: "src/index.ts" }, ...options.package,
  }));
  const bundle = packSkillBundle(root);
  const product = new MemorySkillsStore();
  const principal = publicPrincipal({
    orgId: "synthetic-pure-tenant",
    scopes: ["skills:read", "skills:write", "runs:read", "runs:write"],
  });
  const contract: PureExecutionContract = {
    id: "regex-test.v1", descriptorDigest: PURE_DESCRIPTOR_DIGEST,
    entrypoint: "src/index.ts", entrypointDigest: createHash("sha256").update(ENTRYPOINT).digest("hex"),
  };
  const review: PureReviewedBundle = {
    slug: SLUG, version: VERSION, sha256: bundle.sha256,
    tenantId: principal.orgId, imageDigest: IMAGE, executionContract: contract,
  };
  const config: RuntimeConfig = {
    cluster: "synthetic-cluster", taskDefinition: "synthetic-definition",
    containerName: "synthetic-supervisor", region: "synthetic-region",
    subnets: ["synthetic-subnet"], securityGroups: ["synthetic-group"],
    apiOrigin: "https://runtime.example.test/api/v1", imageDigest: IMAGE,
    reviewedBundles: [review],
  };
  const publish = async (owner: ApiPrincipal, version = VERSION) => {
    const previous = await product.getSkill(owner, SLUG);
    await product.publishSkill({
      principal: owner, slug: SLUG, displayName: "Synthetic pure API fixture",
      description: "Temporary test fixture", category: "Testing", tags: [],
      source: "custom", kind: "executable", version,
      ...(previous ? { expectedRevisionId: previous.revisionId } : {}),
      bundle: { sha256: bundle.sha256, byteSize: bundle.bytes.length,
        contentType: "application/gzip", storageKind: "db", bytes: bundle.bytes },
    });
  };
  await publish(principal);
  // Open the database after packing so it cannot become part of the bundle.
  const store = await RuntimeExecutionStore.open(join(root, "execution.db"));
  stores.push(store);
  const cloud = new RecordingCloud();
  const service = (await createRuntimeService({
    productStore: product, executionStore: store, ecsClient: cloud,
    env: {
      HASNA_SKILLS_RUNTIME_CONFIG: JSON.stringify(config),
      HASNA_SKILLS_RUNTIME_SIGNING_KEY: "synthetic-runtime-signing-material-".repeat(2),
    },
  }))!;
  const request = {
    version: VERSION, workspaceId: principal.orgId, bundleDigest: bundle.sha256,
    input: INPUT, idempotencyKey: "synthetic-pure-run",
  };
  return { root, bundle, product, principal, contract, config, store, cloud, service, request, publish };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const get = (path: string) => new Request("https://runtime.example.test/api/v1/" + path);
const rawPost = (path: string, body: string, headers: Record<string, string> = {}) =>
  new Request("https://runtime.example.test/api/v1/" + path, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body,
  });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  rawPost(path, JSON.stringify(body), headers);
async function api(f: Fixture, request: Request, principal = f.principal) {
  const response = await handleRuntimeApiRequest(request, principal, f.service);
  expect(response).not.toBeNull();
  return response!;
}
async function submit(f: Fixture, value: unknown = f.request, principal = f.principal) {
  return api(f, post(`executions/${SLUG}`, value), principal);
}
async function assertNoAdmission(f: Fixture) {
  expect(f.cloud.calls).toHaveLength(0);
  expect(f.cloud.observations).toBe(0);
  expect(await f.store.activeJobs()).toEqual([]);
  expect(await f.store.getRunByKey(f.principal.orgId, f.request.idempotencyKey)).toBeNull();
}
async function admitted(f: Fixture) {
  const response = await submit(f);
  expect(response.status).toBe(202);
  const view = await response.json() as { id: string; executionContract: PureExecutionContract };
  const job = (await f.store.job(view.id))!;
  expect(job).not.toBeNull();
  const token = runtimeToken(f.service.signingKey, job.execution.admission, job.attempts[0]!);
  const complete = async (value: unknown) => (await handleRuntimeWorkerRequest(
    post(`runtime/${view.id}/complete`, value, { authorization: `Bearer ${token}` }), f.service,
  ))!;
  return { view, job, token, complete };
}
const result = (output: unknown = OUTPUT) => ({
  exitCode: 0, stdout: JSON.stringify(output), stderr: "", artifacts: [],
});

describe("reviewed pure cloud API admission", () => {
  test("eligibility is tenant-scoped, pins exact review metadata, and never creates or dispatches a run", async () => {
    const f = await fixture();
    const response = await api(f, get(`executions/${SLUG}/eligibility?version=${VERSION}`),
      { ...f.principal, scopes: ["skills:read"] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      contractVersion: 1, eligible: true, skill: SLUG, version: VERSION,
      bundleDigest: f.bundle.sha256, runtimeImageDigest: IMAGE, executionContract: f.contract,
      secrets: "none", egress: "deny", limits: PURE_LIMITS,
      descriptor: { id: "regex-test.v1", adapter: "skills-input-json.v1", artifactsBytes: 0 },
    });
    expect((await api(f, get(`executions/${SLUG}/eligibility`))).status).toBe(400);
    expect((await api(f, get(`executions/${SLUG}/eligibility?version=${VERSION}&bundleDigest=${"0".repeat(64)}`))).status).toBe(409);
    const foreign = { ...f.principal, orgId: "synthetic-foreign-tenant" };
    expect((await api(f, get(`executions/${SLUG}/eligibility?version=${VERSION}`), foreign)).status).toBe(404);
    expect((await submit(f, { ...f.request, workspaceId: foreign.orgId }, foreign)).status).toBe(404);
    await assertNoAdmission(f);
  });

  test("published identical bytes in another tenant do not inherit a runtime review", async () => {
    const f = await fixture();
    const foreign = { ...f.principal, orgId: "synthetic-foreign-tenant" };
    await f.publish(foreign);
    expect((await f.product.getSkillVersion(foreign, SLUG, VERSION))!.bundleSha256).toBe(f.bundle.sha256);
    const eligible = await api(f, get(`executions/${SLUG}/eligibility?version=${VERSION}`), foreign);
    expect(eligible.status).toBe(200);
    expect(await eligible.json()).toMatchObject({ eligible: false, reason: "BUNDLE_NOT_REVIEWED_FOR_CLOUD" });
    const response = await submit(f, { ...f.request, workspaceId: foreign.orgId }, foreign);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "BUNDLE_NOT_REVIEWED_FOR_CLOUD" });
    expect(await f.store.getRunByKey(foreign.orgId, f.request.idempotencyKey)).toBeNull();
    await assertNoAdmission(f);
  });

  test("pure admission requires selected workspace and bundle; mismatches cannot fall back to defaults", async () => {
    const f = await fixture();
    for (const key of ["workspaceId", "bundleDigest"] as const) {
      const value: Record<string, unknown> = { ...f.request };
      delete value[key];
      const response = await submit(f, value);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "PURE_SELECTION_REQUIRED" });
    }
    for (const [patch, code] of [
      [{ workspaceId: "synthetic-other-workspace" }, "SELECTION_WORKSPACE_MISMATCH"],
      [{ bundleDigest: "0".repeat(64) }, "SELECTION_DIGEST_MISMATCH"],
    ] as const) {
      const response = await submit(f, { ...f.request, ...patch });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code });
    }
    await assertNoAdmission(f);
  });

  test("version and reviewed bundle digest must match, even when the bytes remain published", async () => {
    const f = await fixture();
    await f.publish(f.principal, "1.0.1");
    expect((await submit(f, { ...f.request, version: "1.0.1" })).status).toBe(403);
    const review = f.service.config.reviewedBundles[0] as PureReviewedBundle;
    review.sha256 = "0".repeat(64);
    expect((await submit(f)).status).toBe(403);
    expect(await (await api(f, get(`executions/${SLUG}/eligibility?version=${VERSION}`))).json())
      .toMatchObject({ eligible: false });
    await assertNoAdmission(f);
  });

  test("admission freezes exact tenant, bytes, contract and image; a replay returns that admission once", async () => {
    const f = await fixture();
    const first = await admitted(f);
    const snapshot = structuredClone(first.job.execution.admission);
    expect(snapshot).toMatchObject({
      tenantId: f.principal.orgId, skillId: SLUG, skillVersion: VERSION,
      bundleDigest: f.bundle.sha256, runtimeImageDigest: IMAGE, inputDigest: digestInput(INPUT),
      executionContract: f.contract, runtime: "bun", dependencyLayerTag: null,
      policy: { egress: "deny", egressAllowlist: [], networkByteCap: 0 }, limits: PURE_LIMITS,
    });
    const response = await submit(f);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ id: first.view.id, executionContract: f.contract, runtimeImageDigest: IMAGE });
    const stored = (await f.store.job(first.view.id))!;
    expect(stored.execution.admission).toEqual(snapshot);
    expect(stored.input).toEqual(INPUT);
    expect(Buffer.from(stored.bundleBase64!, "base64")).toEqual(Buffer.from(f.bundle.bytes));
    expect(f.cloud.calls).toHaveLength(1);
    const foreign = { ...f.principal, orgId: "synthetic-foreign-tenant" };
    expect((await api(f, get(`executions/${first.view.id}`), foreign)).status).toBe(404);
  });

  for (const change of ["input", "contract", "image"] as const) {
    test(`reusing a key after changing ${change} refuses without altering or dispatching the original admission`, async () => {
      const f = await fixture();
      const first = await admitted(f);
      const snapshot = structuredClone(first.job);
      let request = f.request;
      const review = f.service.config.reviewedBundles[0] as PureReviewedBundle;
      if (change === "input") request = { ...request, input: { ...INPUT, text: "different" } };
      if (change === "contract") review.executionContract = { ...f.contract, entrypointDigest: "b".repeat(64) };
      if (change === "image") {
        // Keep the review internally valid for the new image, so this tests the
        // frozen run conflict rather than a missing-review refusal.
        f.service.config.imageDigest = "sha256:" + "b".repeat(64);
        review.imageDigest = f.service.config.imageDigest;
      }
      const response = await submit(f, request);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      expect(await f.store.job(first.view.id)).toEqual(snapshot);
      expect(f.cloud.calls).toHaveLength(1);
    });
  }

  test("after image upgrade a new key admits a new run while the old key and completed admission remain frozen", async () => {
    const f = await fixture();
    const first = await admitted(f);
    expect((await first.complete(result())).status).toBe(200);
    const completed = structuredClone((await f.store.job(first.view.id))!);
    const nextImage = "sha256:" + "b".repeat(64);
    f.service.config.imageDigest = nextImage;
    (f.service.config.reviewedBundles[0] as PureReviewedBundle).imageDigest = nextImage;

    const conflict = await submit(f);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const response = await submit(f, { ...f.request, idempotencyKey: "synthetic-upgraded-image-run" });
    expect(response.status).toBe(202);
    const next = await response.json() as { id: string; runtimeImageDigest: string };
    expect(next.id).not.toBe(first.view.id);
    expect(next.runtimeImageDigest).toBe(nextImage);
    const nextJob = (await f.store.job(next.id))!;
    expect(nextJob.execution.admission).toMatchObject({
      runtimeImageDigest: nextImage, executionContract: f.contract,
      inputDigest: completed.execution.admission.inputDigest, bundleDigest: f.bundle.sha256,
      idempotencyKey: "synthetic-upgraded-image-run",
    });
    expect(await f.store.job(first.view.id)).toEqual(completed);
    expect(f.cloud.calls).toHaveLength(2);
  });

  test("review requires the exact entrypoint bytes before eligibility or admission", async () => {
    const f = await fixture();
    const review = f.service.config.reviewedBundles[0] as PureReviewedBundle;
    review.executionContract = { ...f.contract, entrypointDigest: "b".repeat(64) };
    expect((await api(f, get(`executions/${SLUG}/eligibility?version=${VERSION}`))).status).toBe(400);
    expect((await submit(f)).status).toBe(400);
    await assertNoAdmission(f);
  });

  test("runtime configuration refuses tenantless, image-mismatched, unknown and ambiguous pure reviews", async () => {
    const f = await fixture();
    const config = (review: unknown) => ({ ...f.config, reviewedBundles: [review] });
    const valid = f.config.reviewedBundles[0] as PureReviewedBundle;
    const invalid = [
      config({ ...valid, tenantId: undefined }),
      config({ ...valid, imageDigest: "sha256:" + "b".repeat(64) }),
      config({ ...valid, executionContract: undefined }),
      config({ ...valid, executionContract: { ...f.contract, descriptorDigest: "b".repeat(64) } }),
      config({ ...valid, executionContract: { ...f.contract, id: "unreviewed.v2" } }),
      config({ ...valid, executionContract: { ...f.contract, entrypoint: "../index.ts" } }),
      { ...f.config, reviewedBundles: [valid, { ...valid }] },
    ];
    expect(readRuntimeConfig({ HASNA_SKILLS_RUNTIME_CONFIG: JSON.stringify(f.config) })).toEqual(f.config);
    for (const value of invalid) {
      expect(() => readRuntimeConfig({ HASNA_SKILLS_RUNTIME_CONFIG: JSON.stringify(value) })).toThrow();
    }
    await assertNoAdmission(f);
  });

  test("escaped duplicate JSON keys are refused at the route before their last value can win", async () => {
    const f = await fixture();
    const raw = JSON.stringify(f.request);
    // Both bodies would be valid admitted requests under JSON.parse's last-key-wins behavior.
    const duplicateRoot = raw.replace('"version":"1.0.0"', '"version":"1.0.0","versi\\u006fn":"1.0.0"');
    const duplicateInput = raw.replace('"pattern":', '"patte\\u0072n":"ignored","pattern":');
    for (const value of [duplicateRoot, duplicateInput]) {
      expect(JSON.parse(value)).toEqual(f.request);
      const response = await api(f, rawPost(`executions/${SLUG}`, value));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "EXECUTION_REQUEST_FAILED" });
    }
    await assertNoAdmission(f);
  });

  test("read-only principals and argument-shaped input cannot invoke undeclared capabilities", async () => {
    const f = await fixture();
    expect((await submit(f, f.request, { ...f.principal, scopes: ["skills:read"] })).status).toBe(403);
    for (const input of [
      { ...INPUT, file: "/tmp/synthetic-input" }, { ...INPUT, format: "text" },
      { ...INPUT, args: ["--file=/tmp/synthetic-input"] }, { ...INPUT, flags: "gg" },
      { ...INPUT, flags: "uv" }, { ...INPUT, pattern: "é".repeat(257) },
    ]) expect((await submit(f, { ...f.request, input })).status).toBe(400);
    await assertNoAdmission(f);
  });

  const unsafeManifests: [string, FixtureOptions][] = [
    ["credential declarations", { runtime: { env: ["SYNTHETIC_PROVIDER_TOKEN"] } }],
    ["missing explicit empty credential list", { runtime: { env: undefined } }],
    ["system dependencies", { runtime: { system_deps: ["synthetic-tool"] } }],
    ["runtime network request", { runtime: { needs_network: true } }],
    ["manifest network request", { manifest: { needs_network: true } }],
    ["non-Bun runtime", { runtime: { runtime: "node" } }],
    ["unreviewed entrypoint", { runtime: { entrypoint: "src/other.ts" } }],
    ...["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].map(
      (key): [string, FixtureOptions] => [key, { package: { [key]: { "synthetic-dependency": "1.0.0" } } }],
    ),
    ["lifecycle scripts", { package: { scripts: { postinstall: "synthetic-never-executed" } } }],
  ];
  for (const [reason, options] of unsafeManifests) {
    test(`a reviewed bundle declaring ${reason} is refused before dispatch`, async () => {
      const f = await fixture(options);
      expect((await api(f, get(`executions/${SLUG}/eligibility?version=${VERSION}`))).status).toBe(400);
      expect((await submit(f)).status).toBe(400);
      await assertNoAdmission(f);
    });
  }
});

describe("pure runtime callback contract", () => {
  test("valid actual output schema succeeds without PDF artifacts, remains immutable and replays without dispatch", async () => {
    const f = await fixture();
    const run = await admitted(f);
    const work = (await handleRuntimeWorkerRequest(new Request(
      `https://runtime.example.test/api/v1/runtime/${run.view.id}/work`,
      { headers: { authorization: `Bearer ${run.token}` } },
    ), f.service))!;
    expect(work.status).toBe(200);
    expect(await work.json()).toMatchObject({
      admission: { executionContract: f.contract, runtimeImageDigest: IMAGE }, input: INPUT,
      bundleBase64: Buffer.from(f.bundle.bytes).toString("base64"),
    });
    expect((await run.complete(result())).status).toBe(200);
    expect((await run.complete(result())).status).toBe(200);
    const stored = (await f.store.job(run.view.id))!;
    expect(stored.execution.status).toBe("succeeded");
    expect(stored.result).toEqual(result());
    expect(stored.receipts[0]!.artifactPointers).toEqual([]);
    expect(await (await api(f, get(`executions/${run.view.id}/artifacts`))).json()).toEqual([]);
    expect((await api(f, get(`executions/${run.view.id}/artifacts/document.pdf`))).status).toBe(404);
    expect((await run.complete(result({ ...OUTPUT, matches: [] }))).status).toBe(409);
    expect((await f.store.job(run.view.id))!.result).toEqual(stored.result);
    const replay = await submit(f);
    expect(replay.status).toBe(202);
    expect(await replay.json()).toMatchObject({ id: run.view.id, status: "succeeded", executionContract: f.contract });
    expect(f.cloud.calls).toHaveLength(1);
  });

  test("artifacts, substituted input, malformed match schema and oversized streams do not produce a completion receipt", async () => {
    const f = await fixture();
    const run = await admitted(f);
    const pdf = Buffer.from("%PDF-1.4\nsynthetic fixture\n");
    const duplicateOutput = JSON.stringify(OUTPUT).replace('"flags":"gi"', '"flags":"other","fla\\u0067s":"gi"');
    const invalid = [
      { ...result(), artifacts: [{ name: "document.pdf", contentType: "application/pdf", byteSize: pdf.length,
        sha256: createHash("sha256").update(pdf).digest("hex"), base64: pdf.toString("base64") }] },
      result({ ...OUTPUT, pattern: "other" }), result({ ...OUTPUT, flags: "ig" }),
      result({ ...OUTPUT, matches: [{ ...OUTPUT.matches[0], index: 1 }] }),
      result({ ...OUTPUT, matches: [{ ...OUTPUT.matches[0], groups: [12] }] }),
      result({ ...OUTPUT, matches: [{ ...OUTPUT.matches[0], namedGroups: { letter: null } }] }),
      result({ ...OUTPUT, matches: [{ ...OUTPUT.matches[0], unexpected: true }] }),
      result({ matches: OUTPUT.matches }), result({ ...OUTPUT, artifacts: [] }),
      { ...result(), stdout: duplicateOutput }, { ...result(), stdout: "a".repeat(16_385) },
      { ...result(), stderr: "a".repeat(8193) },
    ];
    for (const value of invalid) {
      const response = await run.complete(value);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "RUNTIME_COMPLETION_REJECTED" });
      const stored = (await f.store.job(run.view.id))!;
      expect(stored.result).toBeUndefined();
      expect(stored.execution.terminalReceiptId).toBeNull();
      expect(stored.receipts[0]!.completedAt).toBeNull();
    }
    // Refusals preserve the running admission, allowing its valid result later.
    expect((await run.complete(result())).status).toBe(200);
    expect(f.cloud.calls).toHaveLength(1);
  });

  test("nonzero worker errors remain failures without requiring a success-shaped regex result", async () => {
    const f = await fixture();
    const run = await admitted(f);
    const failure = { exitCode: 1, stdout: "", stderr: "Synthetic invalid pattern", artifacts: [] };
    expect((await run.complete(failure)).status).toBe(200);
    const stored = (await f.store.job(run.view.id))!;
    expect(stored.execution.status).toBe("failed");
    expect(stored.result).toEqual(failure);
    expect(stored.receipts[0]!.artifactPointers).toEqual([]);
  });
});
