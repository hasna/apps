import {
  createPrivateKey,
  createPublicKey,
  sign as signDetached,
  verify as verifyDetached,
  type KeyObject,
} from "node:crypto"
import { canonicalSha256 } from "../../../src/adapters/managed/canonical"
import {
  createEncryptedLocalCheckpointHandoffPortV1,
  type CheckpointHandoffReceiptSignerV1,
  type CheckpointHandoffReceiptVerifierV1,
} from "../../../src/adapters/managed/checkpoint-handoff-encrypted-local"
import type { CheckpointHandoffInputV1 } from "../../../src/adapters/managed/disposable-task"
import type { Digest } from "../../../src/adapters/managed/types"

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) throw new Error(`missing ${name}`)
  return value
}

class CrashSigner implements CheckpointHandoffReceiptSignerV1, CheckpointHandoffReceiptVerifierV1 {
  readonly signer_principal = "service:sandboxes-local-handoff"
  readonly signing_key_id = "sandboxes-local-handoff-key-v1"
  readonly verification_key_sha256: Digest

  constructor(
    readonly privateKey: KeyObject,
    readonly publicKey: KeyObject,
  ) {
    this.verification_key_sha256 = canonicalSha256({
      algorithm: "Ed25519",
      public_key_spki: publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    })
  }

  sign(bytes: Uint8Array): Uint8Array {
    return signDetached(null, bytes, this.privateKey)
  }

  verify(bytes: Uint8Array, signature: Uint8Array): boolean {
    return verifyDetached(null, bytes, this.publicKey, signature)
  }
}

const encoded = JSON.parse(Buffer.from(required("HANDOFF_INPUT_BASE64"), "base64").toString("utf8")) as
  Record<string, unknown>
const input = {
  ...encoded,
  journal_lease_epoch: BigInt(String(encoded.journal_lease_epoch)),
  checkpoint_bytes: Buffer.from(String(encoded.checkpoint_bytes_base64), "base64"),
} as unknown as CheckpointHandoffInputV1
delete (input as unknown as Record<string, unknown>).checkpoint_bytes_base64

const signer = new CrashSigner(
  createPrivateKey({
    key: Buffer.from(required("HANDOFF_PRIVATE_KEY_BASE64"), "base64"),
    format: "der",
    type: "pkcs8",
  }),
  createPublicKey({
    key: Buffer.from(required("HANDOFF_PUBLIC_KEY_BASE64"), "base64"),
    format: "der",
    type: "spki",
  }),
)
const port = await createEncryptedLocalCheckpointHandoffPortV1({
  root_directory: required("HANDOFF_ROOT"),
  encryption_key: Buffer.from(required("HANDOFF_AES_KEY_BASE64"), "base64"),
  signer,
  verifier: signer,
  durability_probe: (phase: string) => {
    if (process.env.HANDOFF_MODE === "phase" && process.env.HANDOFF_CRASH_PHASE === phase) {
      process.kill(process.pid, "SIGKILL")
    }
    if (process.env.HANDOFF_MODE === "hold_phase" && process.env.HANDOFF_CRASH_PHASE === phase) {
      process.stdout.write("TEMP_FSYNCED\n")
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000)
    }
  },
})
await port.putAndReadback(input)
