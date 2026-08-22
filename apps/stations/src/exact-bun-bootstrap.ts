import {
  executeExactBunTargetStatus,
  executeExactBunTargetTransaction,
  type ExactBunTargetTransactionPayload,
} from "./commands/bun-registry-installer.js";

interface ExactBunBootstrapEnvelope {
  schema: "stations.exact_bun_bootstrap.v1";
  mode: "status" | "transaction";
  payload: ExactBunTargetTransactionPayload;
  sourceBase64?: string;
}

const bootstrapInput = (globalThis as typeof globalThis & {
  __STATIONS_EXACT_BUN_BOOTSTRAP_INPUT__?: unknown;
}).__STATIONS_EXACT_BUN_BOOTSTRAP_INPUT__;

try {
  if (typeof bootstrapInput !== "object" || bootstrapInput === null || Array.isArray(bootstrapInput)) {
    throw new Error("bootstrap_input_invalid");
  }
  const envelope = bootstrapInput as Partial<ExactBunBootstrapEnvelope>;
  if (envelope.schema !== "stations.exact_bun_bootstrap.v1"
    || (envelope.mode !== "status" && envelope.mode !== "transaction")
    || typeof envelope.payload !== "object"
    || envelope.payload === null) {
    throw new Error("bootstrap_input_invalid");
  }

  const result = envelope.mode === "status"
    ? executeExactBunTargetStatus(envelope.payload)
    : executeExactBunTargetTransaction(
        envelope.payload,
        Buffer.from(typeof envelope.sourceBase64 === "string" ? envelope.sourceBase64 : "", "base64"),
      );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write("exact_bun_bootstrap_failed\n");
  process.exitCode = 1;
}
