import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrGroupHttpClient } from "./http-client.js";

const tempDirs: string[] = [];
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const T0 = "2026-07-23T10:00:00.000Z";

function completeRemoteView(groupId = "prg_test"): Record<string, any> {
  const attemptId = "pra_test";
  const event = {
    schema_version: 1,
    id: "pre_test",
    group_id: groupId,
    attempt_id: attemptId,
    writer_generation: "generation-1",
    sequence: 1,
    idempotency_key: `admission:${attemptId}`,
    event_type: "admission",
    state: "admitted",
    message: null,
    head_sha: null,
    receipt_key: null,
    review_receipt_key: null,
    conditional_merge_receipt_key: null,
    outcome: null,
    repository: "hasna/todos",
    pr_number: 78,
    base_sha: BASE,
    actor_id: null,
    actor_run_id: null,
    expected_reviewer_id: null,
    expected_reviewer_run_id: null,
    repair_cycle: null,
    ci_proof: null,
    cleanup_proof: null,
    metadata: {},
    payload_hash: "c".repeat(64),
    created_at: T0,
  };
  const group = {
    schema_version: 1,
    id: groupId,
    identity_key: "d".repeat(64),
    root_request_id: "root-request",
    repository: "hasna/todos",
    leaf_task_id: "leaf-task",
    branch: "feat/pr-group",
    pr_number: 78,
    base_sha: BASE,
    state: "admitted",
    active_attempt_id: attemptId,
    active_generation: "generation-1",
    repair_cycle_count: 0,
    repair_cycle_limit: 2,
    terminal_attempt_id: null,
    terminal_generation: null,
    terminal_outcome: null,
    terminal_head_sha: null,
    terminal_at: null,
    cleanup_eligible_at: null,
    revision: 1,
    created_at: T0,
    updated_at: T0,
  };
  const attempt = {
    schema_version: 1,
    id: attemptId,
    group_id: groupId,
    leaf_task_id: "leaf-task",
    dispatch_attempt: "dispatch-1",
    writer_generation: "generation-1",
    previous_attempt_id: null,
    worktree: "/tmp/pr-group",
    branch: "feat/pr-group",
    repository: "hasna/todos",
    pr_number: 78,
    base_sha: BASE,
    provider: "codewith",
    provider_run_id: "run-1",
    profile_alias: "account012",
    status: "admitted",
    admitted_at: T0,
    started_at: null,
    last_heartbeat_at: null,
    handed_off_at: null,
    fenced_at: null,
    terminal_at: null,
    created_at: T0,
    updated_at: T0,
  };
  return {
    schema_version: 1,
    authoritative: true,
    authority: "remote",
    group,
    attempts: [attempt],
    latest_event: event,
    review_receipts: [],
    conditional_merge_receipts: [],
    merge_receipts: [],
    cleanup_receipts: [],
    cleanup_eligible: false,
    adapters: {
      work_runs: [{
        kind: "WorkRun",
        id: attemptId,
        group_id: groupId,
        task_id: "leaf-task",
        dispatch_attempt: "dispatch-1",
        writer_generation: "generation-1",
        previous_run_id: null,
        worktree: "/tmp/pr-group",
        branch: "feat/pr-group",
        repository: "hasna/todos",
        pr_number: 78,
        base_sha: BASE,
        provider: "codewith",
        provider_run_id: "run-1",
        profile_alias: "account012",
        status: "admitted",
        admitted_at: T0,
        terminal_at: null,
      }],
      evidence_refs: [{
        kind: "EvidenceRef",
        id: event.id,
        group_id: groupId,
        work_run_id: attemptId,
        sequence: 1,
        evidence_type: "admission",
        repository: "hasna/todos",
        pr_number: 78,
        base_sha: BASE,
        head_sha: null,
        receipt_key: null,
        outcome: null,
        actor_id: null,
        actor_run_id: null,
        payload_hash: event.payload_hash,
        created_at: T0,
      }],
      proof_bundle: {
        kind: "ProofBundle",
        id: `proof_${groupId}`,
        group_id: groupId,
        revision: 1,
        evidence_ref_ids: [event.id],
        exact_head: null,
        complete: true,
      },
      decision_envelope: {
        kind: "DecisionEnvelope",
        id: `decision_${groupId}_1`,
        group_id: groupId,
        state: "admitted",
        active_work_run_id: attemptId,
        active_writer_generation: "generation-1",
        repair_cycle_count: 0,
        repair_cycle_limit: 2,
        terminal_outcome: null,
        terminal_head_sha: null,
        cleanup_eligible: false,
        revision: 1,
      },
    },
    diagnostics: {
      event_count: 1,
      attempts_omitted: false,
      receipt_history_complete: true,
      projection_limits: { attempts: 100, receipts: 500 },
    },
  };
}

afterEach(() => {
  delete process.env["HASNA_TODOS_DB_PATH"];
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("PR-group fail-closed HTTP client", () => {
  test("accepts complete authoritative remote state and event envelopes", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/events")) {
        return Response.json({
          history: {
            schema_version: 1,
            authoritative: true,
            authority: "remote",
            group_id: "prg_test",
            events: [],
            count: 0,
            has_more: false,
            next_sequence: null,
          },
        });
      }
      return Response.json({
        view: completeRemoteView(),
      });
    }) as typeof fetch;
    const client = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl,
    });
    expect((await client.get("prg_test")).authority).toBe("remote");
    expect((await client.events("prg_test")).events).toEqual([]);
  });

  test("remote failure and malformed empty responses never become authoritative success or shadow SQLite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-group-http-"));
    tempDirs.push(dir);
    const shadowPath = join(dir, "shadow.db");
    process.env["HASNA_TODOS_DB_PATH"] = shadowPath;

    const unavailable = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl: (async () => { throw new Error("network down"); }) as typeof fetch,
    });
    await expect(unavailable.get("prg_test")).rejects.toMatchObject({
      code: "PR_GROUP_REMOTE_UNAVAILABLE",
    });
    expect(existsSync(shadowPath)).toBe(false);

    const malformed = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl: (async () => Response.json([])) as typeof fetch,
    });
    await expect(malformed.get("prg_test")).rejects.toMatchObject({
      code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
    });
    await expect(malformed.events("prg_test")).rejects.toMatchObject({
      code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
    });
    expect(existsSync(shadowPath)).toBe(false);
  });

  test("rejects authoritative envelopes bound to a different PR-group identity", async () => {
    const client = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl: (async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/events")) {
          return Response.json({
            history: {
              schema_version: 1,
              authoritative: true,
              authority: "remote",
              group_id: "prg_other",
              events: [],
              count: 0,
              has_more: false,
              next_sequence: null,
            },
          });
        }
        return Response.json({
          view: {
            schema_version: 1,
            authoritative: true,
            authority: "remote",
            group: { id: "prg_other" },
            attempts: [],
            latest_event: null,
            review_receipts: [],
            conditional_merge_receipts: [],
            cleanup_eligible: false,
            adapters: {},
            diagnostics: {},
          },
        });
      }) as typeof fetch,
    });
    await expect(client.get("prg_test")).rejects.toMatchObject({
      code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
    });
    await expect(client.events("prg_test")).rejects.toMatchObject({
      code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
    });
  });

  test("preserves stable authoritative error codes without returning partial data", async () => {
    const client = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl: (async () => Response.json({
        error: "writer fenced",
        code: "PR_GROUP_WRITER_FENCED",
        details: { group_id: "prg_test" },
      }, { status: 409 })) as typeof fetch,
    });
    await expect(client.get("prg_test")).rejects.toMatchObject({
      code: "PR_GROUP_WRITER_FENCED",
      details: { status: 409 },
    });
  });

  test("rejects missing, unknown, malformed, and contradictory authoritative state fields", async () => {
    const invalidViews: Record<string, any>[] = [];

    const missingSchema = completeRemoteView();
    delete missingSchema.schema_version;
    invalidViews.push(missingSchema);

    invalidViews.push({ ...completeRemoteView(), unknown_field: true });

    const unknownGroupField = completeRemoteView();
    unknownGroupField.group.unknown_field = true;
    invalidViews.push(unknownGroupField);

    const incompleteAdapters = completeRemoteView();
    delete incompleteAdapters.adapters.proof_bundle;
    invalidViews.push(incompleteAdapters);

    const malformedDiagnostics = completeRemoteView();
    malformedDiagnostics.diagnostics.event_count = -1;
    invalidViews.push(malformedDiagnostics);

    const driftedAttempt = completeRemoteView();
    driftedAttempt.attempts[0].group_id = "prg_other";
    invalidViews.push(driftedAttempt);

    const contradictoryCleanup = completeRemoteView();
    contradictoryCleanup.cleanup_eligible = true;
    invalidViews.push(contradictoryCleanup);

    const malformedReceipt = completeRemoteView();
    malformedReceipt.review_receipts = [{
      ...malformedReceipt.latest_event,
      event_type: "progress",
      receipt_key: "not-a-review",
      outcome: "approved",
    }];
    invalidViews.push(malformedReceipt);

    for (const view of invalidViews) {
      const client = new PrGroupHttpClient({
        baseUrl: "https://todos.example.test",
        apiPrefix: "/v1/pr-groups",
        expectedAuthority: "remote",
        fetchImpl: (async () => Response.json({ view })) as typeof fetch,
      });
      await expect(client.get("prg_test")).rejects.toMatchObject({
        code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
      });
    }
  });

  test("rejects incomplete, unknown, malformed, and contradictory event pages", async () => {
    const valid = {
      schema_version: 1,
      authoritative: true,
      authority: "remote",
      group_id: "prg_test",
      events: [],
      count: 0,
      has_more: false,
      next_sequence: null,
    };
    const invalidPages = [
      { ...valid, schema_version: undefined },
      { ...valid, unknown_field: true },
      { ...valid, count: 1 },
      { ...valid, has_more: false, next_sequence: 1 },
      { ...valid, authority: "local" },
    ];
    for (const history of invalidPages) {
      const client = new PrGroupHttpClient({
        baseUrl: "https://todos.example.test",
        apiPrefix: "/v1/pr-groups",
        expectedAuthority: "remote",
        fetchImpl: (async () => Response.json({ history })) as typeof fetch,
      });
      await expect(client.events("prg_test")).rejects.toMatchObject({
        code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
      });
    }
  });

  test("rejects malformed WorkRun status, fields, and attempt projection drift", async () => {
    const invalidViews: Record<string, any>[] = [];
    for (const mutate of [
      (view: Record<string, any>) => { view.adapters.work_runs[0].status = "unknown"; },
      (view: Record<string, any>) => { view.adapters.work_runs[0].dispatch_attempt = 42; },
      (view: Record<string, any>) => { view.adapters.work_runs[0].id = "pra_other"; },
    ]) {
      const view = completeRemoteView();
      mutate(view);
      invalidViews.push(view);
    }
    for (const view of invalidViews) {
      const client = new PrGroupHttpClient({
        baseUrl: "https://todos.example.test",
        apiPrefix: "/v1/pr-groups",
        expectedAuthority: "remote",
        fetchImpl: (async () => Response.json({ view })) as typeof fetch,
      });
      await expect(client.get("prg_test")).rejects.toMatchObject({
        code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
      });
    }
  });

  test("rejects malformed evidence identities and proof bundles that do not equal their evidence projection", async () => {
    const invalidViews: Record<string, any>[] = [];
    for (const mutate of [
      (view: Record<string, any>) => { view.adapters.evidence_refs[0].id = 42; },
      (view: Record<string, any>) => { view.adapters.evidence_refs[0].work_run_id = "pra_other"; },
      (view: Record<string, any>) => { view.adapters.proof_bundle.evidence_ref_ids = []; },
      (view: Record<string, any>) => { view.adapters.proof_bundle.complete = false; },
      (view: Record<string, any>) => { view.adapters.proof_bundle.exact_head = HEAD; },
    ]) {
      const view = completeRemoteView();
      mutate(view);
      invalidViews.push(view);
    }
    for (const view of invalidViews) {
      const client = new PrGroupHttpClient({
        baseUrl: "https://todos.example.test",
        apiPrefix: "/v1/pr-groups",
        expectedAuthority: "remote",
        fetchImpl: (async () => Response.json({ view })) as typeof fetch,
      });
      await expect(client.get("prg_test")).rejects.toMatchObject({
        code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
      });
    }
  });

  test("rejects reversed and duplicate event-page sequences", async () => {
    const first = completeRemoteView().latest_event;
    const second = { ...first, id: "pre_second", idempotency_key: "second", sequence: 2 };
    for (const events of [
      [second, first],
      [first, { ...second, sequence: 1 }],
    ]) {
      const history = {
        schema_version: 1,
        authoritative: true,
        authority: "remote",
        group_id: "prg_test",
        events,
        count: 2,
        has_more: false,
        next_sequence: null,
      };
      const client = new PrGroupHttpClient({
        baseUrl: "https://todos.example.test",
        apiPrefix: "/v1/pr-groups",
        expectedAuthority: "remote",
        fetchImpl: (async () => Response.json({ history })) as typeof fetch,
      });
      await expect(client.events("prg_test")).rejects.toMatchObject({
        code: "PR_GROUP_REMOTE_INVALID_RESPONSE",
      });
    }
  });

  test("rejects mutation envelopes with inconsistent event lineage", async () => {
    const client = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl: (async () => Response.json({
        created: true,
        adopted: false,
        appended: true,
        event: { group_id: "prg_other", attempt_id: "pra_other" },
        view: {
          schema_version: 1,
          authoritative: true,
          authority: "remote",
          group: { id: "prg_test" },
          attempts: [{ id: "pra_test" }],
          latest_event: null,
          review_receipts: [],
          conditional_merge_receipts: [],
          cleanup_eligible: false,
          adapters: {},
          diagnostics: {},
        },
      })) as typeof fetch,
    });
    await expect(client.append({
      group_id: "prg_test",
      attempt_id: "pra_test",
      writer_generation: "generation-1",
      idempotency_key: "event-1",
      event_type: "progress",
    })).rejects.toMatchObject({ code: "PR_GROUP_REMOTE_INVALID_RESPONSE" });
  });

  test("rejects mutation envelopes whose returned IDs are not deterministic for the request", async () => {
    const forgedAdmission = completeRemoteView("prg_forged");
    const admitClient = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl: (async () => Response.json({
        created: true,
        adopted: false,
        appended: true,
        event: forgedAdmission.latest_event,
        view: forgedAdmission,
      })) as typeof fetch,
    });
    await expect(admitClient.admit({
      root_request_id: "root-request",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task",
      dispatch_attempt: "dispatch-1",
      writer_generation: "generation-1",
      worktree: "/tmp/pr-group",
      branch: "feat/pr-group",
      pr_number: 78,
      base_sha: BASE,
      provider: "codewith",
      provider_run_id: "run-1",
      profile_alias: "account012",
      admitted_at: T0,
    })).rejects.toMatchObject({ code: "PR_GROUP_REMOTE_INVALID_RESPONSE" });

    const forgedRecovery = completeRemoteView("prg_expected");
    forgedRecovery.attempts[0].dispatch_attempt = "dispatch-2";
    forgedRecovery.attempts[0].writer_generation = "generation-2";
    forgedRecovery.attempts[0].previous_attempt_id = "pra_previous";
    forgedRecovery.latest_event.idempotency_key = "recovery-1";
    const recoverClient = new PrGroupHttpClient({
      baseUrl: "https://todos.example.test",
      apiPrefix: "/v1/pr-groups",
      expectedAuthority: "remote",
      fetchImpl: (async () => Response.json({
        created: false,
        adopted: false,
        appended: true,
        event: forgedRecovery.latest_event,
        view: forgedRecovery,
      })) as typeof fetch,
    });
    await expect(recoverClient.recover({
      group_id: "prg_expected",
      root_request_id: "root-request",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task",
      expected_attempt_id: "pra_previous",
      dispatch_attempt: "dispatch-2",
      expected_generation: "generation-1",
      writer_generation: "generation-2",
      worktree: "/tmp/pr-group",
      branch: "feat/pr-group",
      pr_number: 78,
      base_sha: BASE,
      provider: "codewith",
      provider_run_id: "run-2",
      profile_alias: "account012",
      idempotency_key: "recovery-1",
      recovered_at: T0,
    })).rejects.toMatchObject({ code: "PR_GROUP_REMOTE_INVALID_RESPONSE" });
  });
});
