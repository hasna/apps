import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectChannelRegistrationDigest } from "../lib/project-channel-registration.js";
import { isolatedStoreChildEnv } from "../lib/store/isolated-test-env.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "conversations-project-registration-cli-"));
const TEST_DB = join(TEST_DIR, "conversations.db");
const REQUEST_FILE = join(TEST_DIR, "registration.json");
const PROJECT_ID = "wks_ys8tzpsZJMNtx0ORZtLsA";
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: isolatedStoreChildEnv(TEST_DB, {
      CONVERSATIONS_AGENT_ID: "project-registration-cli-test",
      FORCE_COLOR: "0",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("project-registration CLI producer contract", () => {
  test("creates one channel and drains its inherited parent/reply collection", () => {
    const capabilityResult = runCli(["project-registration", "capability", "--json"]);
    expect(capabilityResult.exitCode, capabilityResult.stderr).toBe(0);
    const capability = JSON.parse(capabilityResult.stdout) as {
      route: string;
      package_version: string;
      authority_id: string;
      tenant_id: string;
      corpus_id: string;
    };
    const desired = {
      channel: "cli-project-feed",
      project_id: PROJECT_ID,
      project_slug: "cli-project-feed",
      project_kind: "work",
    };
    writeFileSync(REQUEST_FILE, JSON.stringify({
      operation_id: "cli-operation",
      step_id: "conversations-channel",
      resource_kind: "channel",
      direction: "forward",
      authority_route: capability.route,
      package_version: capability.package_version,
      authority_id: capability.authority_id,
      tenant_id: capability.tenant_id,
      corpus_id: capability.corpus_id,
      target_selector: "cli-project-feed",
      idempotency_key: "cli-operation:conversations-channel:forward",
      request_digest: projectChannelRegistrationDigest(desired),
      precondition_digest: projectChannelRegistrationDigest({
        target_selector: "cli-project-feed",
        expected: "absent",
      }),
      project_id: PROJECT_ID,
      project_slug: "cli-project-feed",
      project_name: "CLI Project Feed",
      desired,
      target_digest: "cli-target-digest",
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    }));

    const createdResult = runCli([
      "project-registration",
      "create",
      "--request",
      REQUEST_FILE,
      "--json",
    ]);
    expect(createdResult.exitCode, createdResult.stderr).toBe(0);
    const created = JSON.parse(createdResult.stdout) as { target_id: string };
    expect(created.target_id).toMatch(/^chn_[0-9a-f]{32}$/);

    const unboundResult = runCli([
      "channel",
      "create",
      "cli-unbound",
      "--from",
      "alice",
      "--json",
    ]);
    expect(unboundResult.exitCode, unboundResult.stderr).toBe(0);

    const parentResult = runCli([
      "channel",
      "send",
      "cli-project-feed",
      "parent",
      "--from",
      "alice",
      "--json",
    ]);
    expect(parentResult.exitCode, parentResult.stderr).toBe(0);
    const parent = JSON.parse(parentResult.stdout) as { id: number; uuid: string };
    const replyResult = runCli([
      "reply",
      "--to",
      parent.uuid,
      "reply",
      "--from",
      "bob",
      "--json",
    ]);
    expect(replyResult.exitCode, replyResult.stderr).toBe(0);
    const reply = JSON.parse(replyResult.stdout) as { id: number; uuid: string };

    const channelsResult = runCli([
      "project-registration",
      "channels",
      "--project",
      PROJECT_ID,
      "--limit",
      "1",
      "--json",
    ]);
    expect(channelsResult.exitCode, channelsResult.stderr).toBe(0);
    const channels = JSON.parse(channelsResult.stdout) as {
      items: Array<Record<string, unknown>>;
      complete: boolean;
      truncated: boolean;
    };
    expect(channels.items).toEqual([{
      target_id: created.target_id,
      channel: "cli-project-feed",
      authority: "conversations",
      resource_kind: "channel",
      scope: "collection",
      project_id: PROJECT_ID,
      revision: expect.any(String),
      digest: expect.any(String),
    }]);
    expect(channels.complete).toBe(true);
    expect(channels.truncated).toBe(false);

    const firstMessagesResult = runCli([
      "project-registration",
      "messages",
      created.target_id,
      "--project",
      PROJECT_ID,
      "--limit",
      "1",
      "--json",
    ]);
    expect(firstMessagesResult.exitCode, firstMessagesResult.stderr).toBe(0);
    const firstMessages = JSON.parse(firstMessagesResult.stdout) as {
      items: Array<{ target_id: string; reply_to_target_id: string | null }>;
      next_cursor: number;
      complete: boolean;
      truncated: boolean;
    };
    expect(firstMessages.items).toEqual([
      expect.objectContaining({
        target_id: parent.uuid,
        reply_to_target_id: null,
      }),
    ]);
    expect(firstMessages.next_cursor).toBe(parent.id);
    expect(firstMessages.complete).toBe(false);
    expect(firstMessages.truncated).toBe(true);

    const secondMessagesResult = runCli([
      "project-registration",
      "messages",
      created.target_id,
      "--project",
      PROJECT_ID,
      "--cursor",
      String(firstMessages.next_cursor),
      "--limit",
      "1",
      "--json",
    ]);
    expect(secondMessagesResult.exitCode, secondMessagesResult.stderr).toBe(0);
    const secondMessages = JSON.parse(secondMessagesResult.stdout) as {
      items: Array<{ target_id: string; reply_to_target_id: string | null }>;
      complete: boolean;
      truncated: boolean;
    };
    expect(secondMessages.items).toEqual([
      expect.objectContaining({
        target_id: reply.uuid,
        reply_to_target_id: parent.uuid,
      }),
    ]);
    expect(secondMessages.complete).toBe(true);
    expect(secondMessages.truncated).toBe(false);
  });
});
