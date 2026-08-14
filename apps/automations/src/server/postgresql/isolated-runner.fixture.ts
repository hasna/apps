import { PostgreSqlServerAutomationsStore } from "./store.js";

type WorkerConfig =
  | { operation: "claim"; runnerId: string; now?: string; leaseMs?: number; startAtEpochMs?: number }
  | { operation: "claim-and-complete"; runnerId: string; now?: string; leaseMs?: number; startAtEpochMs?: number }
  | { operation: "renew"; actionId: string; runnerId: string; fenceToken: number; now?: string; leaseMs?: number }
  | { operation: "complete"; actionId: string; runnerId: string; fenceToken: number; now?: string }
  | {
      operation: "fail";
      actionId: string;
      runnerId: string;
      fenceToken: number;
      now?: string;
      retryBackoffMs?: number;
      retryable?: boolean;
    }
  | {
      operation: "create-replay";
      sourceRunId: string;
      mode: "failed-actions" | "dead-actions" | "entire-run";
      requestedAt?: string;
      actionId?: string;
    }
  | { operation: "requeue-dead"; actionId: string; now?: string };

const databaseUrl =
  process.env.HASNA_AUTOMATIONS_DATABASE_URL ??
  process.env.AUTOMATIONS_DATABASE_URL;
const configJson = process.env.HASNA_AUTOMATIONS_ISOLATED_RUNNER_CONFIG;

if (!databaseUrl || !configJson) {
  writeResult({ ok: false, error: "isolated PostgreSQL runner configuration is missing" });
  process.exit(2);
}

let store: PostgreSqlServerAutomationsStore | undefined;
try {
  const config = JSON.parse(configJson) as WorkerConfig;
  if ("startAtEpochMs" in config && config.startAtEpochMs) {
    await Bun.sleep(Math.max(0, config.startAtEpochMs - Date.now()));
  }
  store = await PostgreSqlServerAutomationsStore.connect(databaseUrl);
  writeResult({ ok: true, value: await execute(store, config) });
} catch (error) {
  writeResult({ ok: false, error: sanitizeError(error) });
} finally {
  await store?.close();
}

async function execute(store: PostgreSqlServerAutomationsStore, config: WorkerConfig): Promise<unknown> {
  switch (config.operation) {
    case "claim":
      return store.claimNextAction({
        runnerId: config.runnerId,
        now: config.now,
        leaseMs: config.leaseMs,
      });
    case "claim-and-complete": {
      const claim = await store.claimNextAction({
        runnerId: config.runnerId,
        now: config.now,
        leaseMs: config.leaseMs,
      });
      if (!claim) return undefined;
      const action = await store.completeActionFenced({
        actionId: claim.id,
        runnerId: config.runnerId,
        fenceToken: claim.fenceToken,
        now: config.now,
        result: { summary: `completed by ${config.runnerId}` },
      });
      return { actionId: action.id, fenceToken: claim.fenceToken, status: action.status };
    }
    case "renew":
      return store.renewActionLease({
        actionId: config.actionId,
        runnerId: config.runnerId,
        fenceToken: config.fenceToken,
        now: config.now,
        leaseMs: config.leaseMs,
      });
    case "complete":
      return store.completeActionFenced({
        actionId: config.actionId,
        runnerId: config.runnerId,
        fenceToken: config.fenceToken,
        now: config.now,
        result: { summary: `completed by ${config.runnerId}` },
      });
    case "fail":
      return store.failActionFenced({
        actionId: config.actionId,
        runnerId: config.runnerId,
        fenceToken: config.fenceToken,
        now: config.now,
        retryBackoffMs: config.retryBackoffMs,
        error: {
          code: "ISOLATED_RETRY",
          message: "isolated runner failure",
          retryable: config.retryable,
        },
      });
    case "create-replay":
      return store.createReplayRequest({
        sourceRunId: config.sourceRunId,
        mode: config.mode,
        requestedAt: config.requestedAt,
        metadata: config.actionId ? { actionId: config.actionId } : undefined,
      });
    case "requeue-dead":
      return store.requeueDeadAction(config.actionId, { now: config.now });
  }
}

function writeResult(result: unknown): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]");
}
