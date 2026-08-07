import { describe, expect, test } from "bun:test";
import type { GuardedProjectMutationResult, Workspace } from "./client.js";

const workspaceFixture: Workspace = {
  id: "wks_sdkparity0001",
  slug: "sdk-parity",
  name: "SDK Parity",
  kind: "generic",
  status: "active",
  s3_bucket: null,
  s3_prefix: null,
  last_opened_at: null,
  synced_at: null,
};

const terminalFixture: GuardedProjectMutationResult = {
  ok: false,
  dry_run: false,
  outcome: "terminal_nonacceptance",
  idempotency_key: "gpm_sdk_parity",
  request_digest: "request",
  precondition_digest: "precondition",
  project_id: workspaceFixture.id,
  expected_revision: "2026-08-07 00:00:00",
  current_revision: "2026-08-07 00:00:00",
  before: workspaceFixture,
  after: null,
  receipt: null,
  response_control: {
    response_byte_limit: 65536,
    time_budget_ms: 10000,
    response_bytes: 1024,
    elapsed_ms: 1,
    complete: true,
    truncated: false,
  },
};

describe("generated Projects SDK server parity", () => {
  test("accepts full workspace storage timestamps and terminal nullable fields", () => {
    expect(workspaceFixture).toMatchObject({
      s3_bucket: null,
      s3_prefix: null,
      last_opened_at: null,
      synced_at: null,
    });
    expect(terminalFixture).toMatchObject({ after: null, receipt: null });
  });
});
