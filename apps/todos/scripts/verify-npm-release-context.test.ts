import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { deriveNpmReleaseAgentReviewKeyId, issueSignedNpmReleaseAgentReviewReceipt, NPM_RELEASE_AGENT_REVIEW_SCHEMA } from "../src/lib/npm-release-agent-review";

const fixture = mkdtempSync(join(tmpdir(), "todos-release-context-"));
afterAll(() => rmSync(fixture, { recursive: true, force: true }));
const source = resolve(import.meta.dir, "..");
const root = join(fixture, "apps/todos");
mkdirSync(join(root, "scripts"), { recursive: true });
mkdirSync(join(root, "src/lib"), { recursive: true });
for (const file of ["scripts/verify-npm-release-agent-review.ts", "src/lib/npm-release-agent-review.ts", "src/lib/npm-release-package.ts", "src/lib/npm-release-context.ts"]) cpSync(join(source, file), join(root, file));
writeFileSync(join(root, "scripts/verify-public-release.ts"), "// synthetic procedure fixture\n");
writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@hasna/todos", version: "0.17.0", publishConfig: { registry: "https://registry.npmjs.org" }, scripts: { prepublishOnly: "bun run scripts/verify-public-release.ts --mode=publish" } }));
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Synthetic fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "Synthetic fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" };
function git(...args: string[]) {
  const result = spawnSync("git", args, { cwd: fixture, env: gitEnv, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`synthetic git ${args[0]} failed`);
  return result.stdout.trim();
}
git("init", "--quiet"); git("add", "."); git("commit", "--quiet", "--no-gpg-sign", "-m", "Synthetic release");
const commit = git("rev-parse", "HEAD");
git("update-ref", "refs/remotes/origin/main", commit);
const tag = "npm/todos/v0.17.0";
function makeTag(lane: string) { git("tag", "--force", "--annotate", tag, "-m", `Synthetic release\n\nRelease-Lane: ${lane}\nAgent: release-fixture`, commit); }
makeTag("vault-token");
const key = generateKeyPairSync("ed25519");
const publicKey = key.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const privateKey = key.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const keyId = deriveNpmReleaseAgentReviewKeyId(publicKey);
const receipt = issueSignedNpmReleaseAgentReviewReceipt({ schema: NPM_RELEASE_AGENT_REVIEW_SCHEMA, repository: "hasna/apps", commit, package: { name: "@hasna/todos", version: "0.17.0" }, tag, procedure: { path: "apps/todos/scripts/verify-public-release.ts", revision: git("rev-parse", `${commit}:apps/todos/scripts/verify-public-release.ts`) }, registry: "https://registry.npmjs.org", reviewer: { type: "coding-agent", agent: "review-fixture" }, publisher: { type: "coding-agent", agent: "release-fixture" }, verdict: "GO", openReachableInScopeBlockers: { p0: 0, p1: 0 } }, privateKey, publicKey, keyId);
const shared = { PATH: process.env.PATH!, RELEASE_REVIEWER_AGENT: "review-fixture", RELEASE_REVIEW_KEY_ID: keyId, RELEASE_REVIEW_PUBLIC_KEY: publicKey, NPM_RELEASE_AGENT_REVIEW_RECEIPT: JSON.stringify(receipt), HASNA_TODOS_EXPECTED_COMMIT: commit };
const local = { ...shared, HASNA_TODOS_RELEASE_CONTEXT: "vault-token", HASNA_TODOS_RELEASE_TAG: tag, RELEASE_PUBLISH_MODE: "vault-token" };
const actions = { ...shared, GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY: "hasna/apps", GITHUB_SHA: commit, GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: tag };
function verify(env: Record<string, string | undefined>) { return spawnSync(process.execPath, [join(root, "scripts/verify-npm-release-agent-review.ts")], { cwd: root, env, encoding: "utf8" }); }

describe("actual signed npm verifier across delivery contexts", () => {
  test("normal local receipt and Actions validation accept the same vault tag without allowing Actions publication", () => {
    makeTag("vault-token");
    expect(verify(local).status).toBe(0);
    expect(verify({ ...actions, RELEASE_PUBLISH_MODE: "vault-token" }).status).toBe(0);
    expect(verify({ ...actions, RELEASE_PUBLISH_MODE: "vault-token", npm_lifecycle_event: "prepublishOnly" }).status).toBe(1);
  });
  test("oidc tag permits Actions publication and refuses local publication", () => {
    makeTag("oidc");
    expect(verify({ ...actions, RELEASE_PUBLISH_MODE: "oidc", npm_lifecycle_event: "prepublishOnly" }).status).toBe(0);
    expect(verify(local).status).toBe(1);
    expect(verify({ ...actions, RELEASE_PUBLISH_MODE: "vault-token" }).status).toBe(1);
  });
  test("local path still refuses absent receipt, tampering and mixed authority", () => {
    makeTag("vault-token");
    expect(verify({ ...local, NPM_RELEASE_AGENT_REVIEW_RECEIPT: undefined }).status).toBe(1);
    expect(verify({ ...local, NPM_RELEASE_AGENT_REVIEW_RECEIPT: JSON.stringify({ ...receipt, payload: Buffer.from("{}").toString("base64") }) }).status).toBe(1);
    expect(verify({ ...local, GITHUB_ACTIONS: "true" }).status).toBe(1);
    expect(verify({ ...local, HASNA_TODOS_EXPECTED_COMMIT: "b".repeat(40) }).status).toBe(1);
  });
});
