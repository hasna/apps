import { afterEach, describe, expect, test } from "bun:test"
import {
  createCipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as signDetached,
  verify as verifyDetached,
  type KeyObject,
} from "node:crypto"
import {
  link as hardLink,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises"
import { mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { canonicalJson, canonicalSha256, parseCanonicalJson } from "../../src/adapters/managed/canonical"
import { e2bGuestBrokerCheckpointHashesV1 } from "../../src/adapters/managed/e2b-guest-broker"
import {
  createEncryptedLocalCheckpointHandoffPortV1,
  type CheckpointHandoffReceiptSignerV1,
  type CheckpointHandoffReceiptVerifierV1,
} from "../../src/adapters/managed"
import type { CheckpointHandoffInputV1 } from "../../src/adapters/managed/disposable-task"
import type { Digest } from "../../src/adapters/managed/types"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function d(label: string): Digest {
  return canonicalSha256({ label })
}

function byteDigest(bytes: Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function checkpointBundle(
  outputDiff?: ReadonlyArray<Readonly<{
    kind: "added" | "modified" | "deleted"
    path: string
    before_sha256: Digest | null
    after_sha256: Digest | null
    before_mode: number | null
    after_mode: number | null
  }>>,
  inputManifest?: ReadonlyArray<Readonly<{
    path: string
    content_sha256: Digest
    size_bytes: number
    mode: number
  }>>,
) {
  const content = new TextEncoder().encode("TOP-SECRET-CHECKPOINT-PAYLOAD-12345")
  const sha256 = byteDigest(content)
  const initialEntries = inputManifest ?? [{
    path: "result.txt",
    content_sha256: d("default-before-result"),
    size_bytes: 21,
    mode: 0o600,
  }]
  const changes = outputDiff ?? [{
    kind: "modified" as const,
    path: "result.txt",
    before_sha256: d("default-before-result"),
    after_sha256: sha256,
    before_mode: 0o600,
    after_mode: 0o600,
  }]
  const files = [{
    path: "result.txt",
    size: content.byteLength,
    sha256,
    content_base64: Buffer.from(content).toString("base64"),
  }]
  const manifest = [{ path: "result.txt", size: content.byteLength, mode: 0o600, sha256 }]
  const brokerHashes = e2bGuestBrokerCheckpointHashesV1(
    manifest,
    files.map(({ path, size, sha256: digest }) => ({ path, size, sha256: digest })),
  )
  const manifestSha256 = brokerHashes.manifest_sha256
  const checkpointSha256 = brokerHashes.checkpoint_sha256
  const outputManifestSha256 = canonicalSha256({
    schema_version: "sandboxes.disposable-task-output-manifest/v1",
    files: manifest,
  })
  const outputDiffSha256 = canonicalSha256({
    schema_version: "sandboxes.disposable-task-output-diff/v1",
    changes,
  })
  const inputManifestSha256 = canonicalSha256({
    schema_version: "sandboxes.disposable-task-input-manifest/v1",
    files: initialEntries,
  })
  const value = {
    schema_version: "sandboxes.disposable-task-checkpoint-bundle/v1",
    output_mode: "delta_from_input",
    input_manifest_sha256: inputManifestSha256,
    input_manifest: initialEntries,
    checkpoint_sha256: checkpointSha256,
    manifest_sha256: manifestSha256,
    output_manifest_sha256: outputManifestSha256,
    output_diff_sha256: outputDiffSha256,
    output_diff: changes,
    files,
    manifest,
    file_count: files.length,
    total_bytes: content.byteLength,
  }
  return {
    ...value,
    checkpoint_bytes: new TextEncoder().encode(canonicalJson(value)),
  }
}

function input(overrides: Partial<CheckpointHandoffInputV1> = {}): CheckpointHandoffInputV1 {
  const checkpoint = checkpointBundle()
  return {
    dispatch_id: "dispatch-encrypted-local-1",
    request_sha256: d("request"),
    input_manifest_sha256: checkpoint.input_manifest_sha256,
    effect_claim_sha256: d("effect-claim"),
    dispatch_intent_anchor_sha256: d("dispatch-intent-anchor"),
    journal_claim_fence_sha256: d("claim-fence"),
    journal_lease_epoch: 7n,
    provider_effect_ownership_nonce_sha256: d("ownership-nonce"),
    provider_ownership_binding_sha256: d("ownership-binding"),
    authorization_consumption_receipt_sha256: d("authorization"),
    provider_fingerprint_sha256: d("provider-fingerprint"),
    broker_artifact_sha256: d("broker-artifact"),
    broker_protocol_sha256: d("broker-protocol"),
    authenticated_session_sha256: d("session"),
    execution_receipt_sha256: d("execution"),
    workspace_readback_sha256: d("workspace"),
    output_manifest_sha256: checkpoint.output_manifest_sha256,
    output_diff_sha256: checkpoint.output_diff_sha256,
    checkpoint_sha256: checkpoint.checkpoint_sha256,
    checkpoint_manifest_sha256: checkpoint.manifest_sha256,
    file_count: checkpoint.file_count,
    total_bytes: checkpoint.total_bytes,
    checkpoint_bytes: checkpoint.checkpoint_bytes,
    ...overrides,
  }
}

class SigningFixture implements CheckpointHandoffReceiptSignerV1, CheckpointHandoffReceiptVerifierV1 {
  readonly signer_principal = "service:sandboxes-local-handoff"
  readonly signing_key_id = "sandboxes-local-handoff-key-v1"
  readonly verification_key_sha256: Digest
  #signCalls = 0

  constructor(
    readonly privateKey: KeyObject,
    readonly publicKey: KeyObject,
    readonly beforeSign?: (call: number) => void,
  ) {
    this.verification_key_sha256 = canonicalSha256({
      algorithm: "Ed25519",
      public_key_spki: publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    })
  }

  static generate(): SigningFixture {
    const pair = generateKeyPairSync("ed25519")
    return new SigningFixture(pair.privateKey, pair.publicKey)
  }

  sign(bytes: Uint8Array): Uint8Array {
    this.#signCalls += 1
    this.beforeSign?.(this.#signCalls)
    return signDetached(null, bytes, this.privateKey)
  }

  verify(bytes: Uint8Array, signature: Uint8Array): boolean {
    return verifyDetached(null, bytes, this.publicKey, signature)
  }
}

async function freshRoot(name: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), `sandboxes-handoff-${name}-`))
  roots.push(parent)
  return join(parent, "store")
}

async function make(
  name: string,
  options: {
    root?: string
    key?: Uint8Array
    signing?: SigningFixture
    durabilityProbe?: (phase: string) => void
  } = {},
) {
  const root = options.root ?? await freshRoot(name)
  const key = options.key ?? randomBytes(32)
  const signing = options.signing ?? SigningFixture.generate()
  const port = await createEncryptedLocalCheckpointHandoffPortV1({
    root_directory: root,
    encryption_key: key,
    signer: signing,
    verifier: signing,
    ...(options.durabilityProbe === undefined ? {} : { durability_probe: options.durabilityProbe }),
  })
  return { root, key, signing, port }
}

async function handoffFile(root: string): Promise<string> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".handoff"))
  expect(names).toHaveLength(1)
  return join(root, names[0]!)
}

async function expectIntegrityFailure(action: Promise<unknown>): Promise<void> {
  await expect(action).rejects.toMatchObject({ code: "integrity_failed" })
}

describe("encrypted local checkpoint handoff", () => {
  test("encrypts, signs, and exactly replays on the same host after restart and sandbox deletion", async () => {
    const { root, key, signing, port } = await make("restart")
    const sandbox = join(dirname(root), "deleted-sandbox")
    await mkdir(sandbox)
    const submitted = input()
    const receipt = await port.putAndReadback(submitted)
    expect(receipt).toMatchObject({
      schema_version: "sandboxes.checkpoint-handoff-receipt/v1",
      dispatch_id: submitted.dispatch_id,
      request_sha256: submitted.request_sha256,
      input_manifest_sha256: submitted.input_manifest_sha256,
      effect_claim_sha256: submitted.effect_claim_sha256,
      dispatch_intent_anchor_sha256: submitted.dispatch_intent_anchor_sha256,
      checkpoint_sha256: submitted.checkpoint_sha256,
      checkpoint_readback_sha256: submitted.checkpoint_sha256,
      checkpoint_manifest_sha256: submitted.checkpoint_manifest_sha256,
      output_manifest_sha256: submitted.output_manifest_sha256,
      output_diff_sha256: submitted.output_diff_sha256,
      file_count: submitted.file_count,
      total_bytes: submitted.total_bytes,
    })
    expect(receipt.handoff_receipt_sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(receipt.result_bundle_sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(receipt.result_signature_sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(port.describe()).toMatchObject({
      durability: "volatile",
      encrypted_at_rest: true,
      readback_verified: true,
    })

    submitted.checkpoint_bytes.fill(0)
    await rm(sandbox, { recursive: true })
    const restarted = await make("restart-reopen", { root, key, signing })
    expect(await restarted.port.lookupVerified({
      dispatch_id: receipt.dispatch_id,
      request_sha256: receipt.request_sha256,
      expected_result_bundle_sha256: receipt.result_bundle_sha256,
      expected_checkpoint_handoff_sha256: receipt.handoff_receipt_sha256,
    })).toEqual(receipt)
    expect(await restarted.port.putAndReadback(input())).toEqual(receipt)

    const stored = await readFile(await handoffFile(root))
    expect(stored.includes(Buffer.from("TOP-SECRET-CHECKPOINT-PAYLOAD-12345"))).toBeFalse()
    expect(stored.includes(Buffer.from(receipt.dispatch_id))).toBeFalse()
    for (const sensitive of [
      submitted.request_sha256,
      submitted.provider_fingerprint_sha256,
      submitted.authorization_consumption_receipt_sha256,
      submitted.checkpoint_sha256,
      submitted.output_manifest_sha256,
      submitted.output_diff_sha256,
    ]) expect(stored.includes(Buffer.from(sensitive))).toBeFalse()
    expect((await lstat(root)).mode & 0o777).toBe(0o700)
    expect((await lstat(await handoffFile(root))).mode & 0o777).toBe(0o600)
  })

  test("rejects every checkpoint and changed-output claim not recomputed from canonical checkpoint bytes", async () => {
    const { port } = await make("semantic-cross-binding")
    for (const changed of [
      input({ checkpoint_sha256: d("false-checkpoint") }),
      input({ checkpoint_manifest_sha256: d("false-manifest") }),
      input({ output_manifest_sha256: d("false-output-manifest") }),
      input({ output_diff_sha256: d("false-output-diff") }),
      input({ file_count: 2 }),
      input({ total_bytes: 1 }),
    ]) {
      await expectIntegrityFailure(port.putAndReadback(changed))
    }

    const inconsistentOutput = checkpointBundle([
      {
        kind: "added", path: "a.txt", before_sha256: null, after_sha256: d("a"),
        before_mode: null, after_mode: 0o600,
      },
      {
        kind: "modified", path: "m.txt", before_sha256: d("before-m"), after_sha256: d("after-m"),
        before_mode: 0o600, after_mode: 0o644,
      },
      {
        kind: "deleted", path: "z.txt", before_sha256: d("before-z"), after_sha256: null,
        before_mode: 0o600, after_mode: null,
      },
    ])
    await expectIntegrityFailure(port.putAndReadback(input({
      dispatch_id: "dispatch-inconsistent-output-diff",
      output_diff_sha256: inconsistentOutput.output_diff_sha256,
      checkpoint_bytes: inconsistentOutput.checkpoint_bytes,
    })))

    const resultSha256 = byteDigest(new TextEncoder().encode("TOP-SECRET-CHECKPOINT-PAYLOAD-12345"))
    const changedOutput = checkpointBundle([
      {
        kind: "added", path: "result.txt", before_sha256: null, after_sha256: resultSha256,
        before_mode: null, after_mode: 0o600,
      },
      {
        kind: "deleted", path: "z.txt", before_sha256: d("before-z"), after_sha256: null,
        before_mode: 0o600, after_mode: null,
      },
    ], [{ path: "z.txt", content_sha256: d("before-z"), size_bytes: 3, mode: 0o600 }])
    const accepted = input({
      output_manifest_sha256: changedOutput.output_manifest_sha256,
      output_diff_sha256: changedOutput.output_diff_sha256,
      input_manifest_sha256: changedOutput.input_manifest_sha256,
      checkpoint_sha256: changedOutput.checkpoint_sha256,
      checkpoint_manifest_sha256: changedOutput.manifest_sha256,
      file_count: changedOutput.file_count,
      total_bytes: changedOutput.total_bytes,
      checkpoint_bytes: changedOutput.checkpoint_bytes,
    })
    expect((await port.putAndReadback(accepted)).output_diff_sha256).toBe(changedOutput.output_diff_sha256)

    const modeOnly = checkpointBundle([
      {
        kind: "modified",
        path: "result.txt",
        before_sha256: resultSha256,
        after_sha256: resultSha256,
        before_mode: 0o644,
        after_mode: 0o600,
      },
    ], [{
      path: "result.txt",
      content_sha256: resultSha256,
      size_bytes: new TextEncoder().encode("TOP-SECRET-CHECKPOINT-PAYLOAD-12345").byteLength,
      mode: 0o644,
    }])
    expect((await port.putAndReadback(input({
      dispatch_id: "dispatch-mode-only-output-change",
      input_manifest_sha256: modeOnly.input_manifest_sha256,
      output_diff_sha256: modeOnly.output_diff_sha256,
      checkpoint_bytes: modeOnly.checkpoint_bytes,
    }))).output_diff_sha256).toBe(modeOnly.output_diff_sha256)

    const decoded = parseCanonicalJson(new TextDecoder().decode(changedOutput.checkpoint_bytes)) as Record<string, unknown>
    const forged = { ...decoded, output_diff_sha256: d("forged-inside-bundle") }
    await expectIntegrityFailure(port.putAndReadback(input({
      dispatch_id: "dispatch-forged-inside-bundle",
      checkpoint_bytes: new TextEncoder().encode(canonicalJson(forged)),
    })))

    const modeMutation = structuredClone(parseCanonicalJson(
      new TextDecoder().decode(modeOnly.checkpoint_bytes),
    )) as Record<string, unknown>
    const mutatedDiff = structuredClone(modeMutation.output_diff) as Array<Record<string, unknown>>
    mutatedDiff[0]!.before_mode = 0o600
    const mutatedDiffSha256 = canonicalSha256({
      schema_version: "sandboxes.disposable-task-output-diff/v1",
      changes: mutatedDiff,
    })
    modeMutation.output_diff = mutatedDiff
    modeMutation.output_diff_sha256 = mutatedDiffSha256
    await expectIntegrityFailure(port.putAndReadback(input({
      dispatch_id: "dispatch-mutated-output-mode-delta",
      input_manifest_sha256: modeOnly.input_manifest_sha256,
      output_diff_sha256: mutatedDiffSha256,
      checkpoint_bytes: new TextEncoder().encode(canonicalJson(modeMutation)),
    })))

    await expectIntegrityFailure(port.putAndReadback(input({
      dispatch_id: "dispatch-snapshot-output-mode",
      checkpoint_bytes: new TextEncoder().encode(canonicalJson({
        ...parseCanonicalJson(new TextDecoder().decode(input().checkpoint_bytes)) as Record<string, unknown>,
        output_mode: "snapshot",
      })),
    })))
  })

  test("serializes exact dispatch replays and rejects changed bytes without replacing the winner", async () => {
    const { root, port } = await make("idempotency")
    const original = input()
    const [left, right] = await Promise.all([
      port.putAndReadback(original),
      port.putAndReadback(input()),
    ])
    expect(right).toEqual(left)
    await expectIntegrityFailure(port.putAndReadback(input({ request_sha256: d("changed-request") })))
    await expectIntegrityFailure(port.putAndReadback(input({
      checkpoint_bytes: new TextEncoder().encode("different checkpoint bytes"),
    })))
    expect(await port.lookupVerified({
      dispatch_id: original.dispatch_id,
      request_sha256: original.request_sha256,
      expected_result_bundle_sha256: left.result_bundle_sha256,
      expected_checkpoint_handoff_sha256: left.handoff_receipt_sha256,
    })).toEqual(left)
    expect((await readdir(root)).filter((name) => name.endsWith(".handoff"))).toHaveLength(1)
  })

  test("publishes exactly one immutable winner across conflicting adapter instances", async () => {
    const root = await freshRoot("cross-instance-winner")
    const key = randomBytes(32)
    const signing = SigningFixture.generate()
    const left = await make("cross-instance-left", { root, key, signing })
    const right = await make("cross-instance-right", { root, key, signing })
    const original = input({ dispatch_id: "dispatch-cross-instance-winner" })
    const conflict = input({
      dispatch_id: original.dispatch_id,
      request_sha256: d("conflicting-cross-instance-request"),
    })
    const outcomes = await Promise.allSettled([
      left.port.putAndReadback(original),
      right.port.putAndReadback(conflict),
    ])
    const fulfilled = outcomes.filter((result) => result.status === "fulfilled")
    const rejected = outcomes.filter((result) => result.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ reason: { code: "integrity_failed" } })
    const winner = (fulfilled[0] as PromiseFulfilledResult<Readonly<{ request_sha256: Digest }>>).value
    expect([original.request_sha256, conflict.request_sha256]).toContain(winner.request_sha256)
    expect((await readdir(root)).filter((name) => name.endsWith(".handoff"))).toHaveLength(1)
  })

  test("never collects a live writer temp and collects it only after owner death", async () => {
    const root = await freshRoot("live-temp")
    const key = randomBytes(32)
    const signing = SigningFixture.generate()
    const submitted = input({ dispatch_id: "dispatch-live-temp" })
    const childInput = {
      ...submitted,
      journal_lease_epoch: submitted.journal_lease_epoch.toString(10),
      checkpoint_bytes_base64: Buffer.from(submitted.checkpoint_bytes).toString("base64"),
    } as Record<string, unknown>
    delete childInput.checkpoint_bytes
    const child = Bun.spawn([
      process.execPath,
      new URL("./fixtures/checkpoint-handoff-crash-writer.ts", import.meta.url).pathname,
    ], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? tmpdir(),
        HANDOFF_MODE: "hold_phase",
        HANDOFF_CRASH_PHASE: "after_temp_fsync",
        HANDOFF_ROOT: root,
        HANDOFF_AES_KEY_BASE64: Buffer.from(key).toString("base64"),
        HANDOFF_PRIVATE_KEY_BASE64: signing.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
        HANDOFF_PUBLIC_KEY_BASE64: signing.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
        HANDOFF_INPUT_BASE64: Buffer.from(JSON.stringify(childInput)).toString("base64"),
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    try {
      const firstOutput = await child.stdout.getReader().read()
      expect(new TextDecoder().decode(firstOutput.value)).toContain("TEMP_FSYNCED")
      expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toHaveLength(1)
      const contender = await make("live-temp-contender", {
        root,
        key,
        signing,
      })
      expect((await contender.port.putAndReadback(submitted)).dispatch_id).toBe(submitted.dispatch_id)
      expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toHaveLength(1)
    } finally {
      child.kill("SIGKILL")
      await child.exited
    }

    const recovered = await make("live-temp-recovered", { root, key, signing })
    expect((await recovered.port.putAndReadback(submitted)).dispatch_id).toBe(submitted.dispatch_id)
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })

  test("returns absent only for lookup misses and expected digest mismatches", async () => {
    const { port } = await make("lookup")
    expect(await port.lookupVerified({
      dispatch_id: "dispatch-missing",
      request_sha256: d("missing"),
      expected_result_bundle_sha256: null,
      expected_checkpoint_handoff_sha256: null,
    })).toBe("absent")
    const receipt = await port.putAndReadback(input())
    expect(await port.lookupVerified({
      dispatch_id: receipt.dispatch_id,
      request_sha256: receipt.request_sha256,
      expected_result_bundle_sha256: d("wrong-result"),
      expected_checkpoint_handoff_sha256: null,
    })).toBe("absent")
    expect(await port.lookupVerified({
      dispatch_id: receipt.dispatch_id,
      request_sha256: receipt.request_sha256,
      expected_result_bundle_sha256: null,
      expected_checkpoint_handoff_sha256: d("wrong-handoff"),
    })).toBe("absent")
  })

  test("fails closed on ciphertext tamper, truncation, a closed-bundle addition, and the wrong AES key", async () => {
    const { root, key, signing, port } = await make("tamper")
    const receipt = await port.putAndReadback(input())
    const path = await handoffFile(root)
    const original = await readFile(path)
    const envelope = structuredClone(parseCanonicalJson(original.toString("utf8"))) as Record<string, string>
    const ciphertext = Buffer.from(envelope.ciphertext_base64!, "base64")
    ciphertext[0] = ciphertext[0]! ^ 1
    envelope.ciphertext_base64 = ciphertext.toString("base64")
    await writeFile(path, canonicalJson(envelope), { mode: 0o600 })
    await expectIntegrityFailure(port.lookupVerified({
      dispatch_id: receipt.dispatch_id,
      request_sha256: receipt.request_sha256,
      expected_result_bundle_sha256: null,
      expected_checkpoint_handoff_sha256: null,
    }))

    await writeFile(path, original, { mode: 0o600 })
    await truncate(path, Math.max(1, original.byteLength - 17))
    await expectIntegrityFailure(port.lookupVerified({
      dispatch_id: receipt.dispatch_id,
      request_sha256: receipt.request_sha256,
      expected_result_bundle_sha256: null,
      expected_checkpoint_handoff_sha256: null,
    }))

    await writeFile(path, original, { mode: 0o600 })
    const parsed = structuredClone(parseCanonicalJson(original.toString("utf8"))) as Record<string, string>
    const nonce = Buffer.from(parsed.nonce_base64!, "base64")
    const authTagLength = 16
    const decipher = new Bun.CryptoHasher("sha256")
    decipher.update("closed-bundle-test")
    expect(decipher.digest("hex")).toHaveLength(64)
    const aad = new TextEncoder().encode(canonicalJson({
      schema_version: parsed.schema_version,
      cipher: parsed.cipher,
      encryption_key_sha256: parsed.encryption_key_sha256,
      record_key_sha256: parsed.record_key_sha256,
      nonce_base64: parsed.nonce_base64,
    }))
    const nodeCrypto = await import("node:crypto")
    const decryptor = nodeCrypto.createDecipheriv("aes-256-gcm", key, nonce, { authTagLength })
    decryptor.setAAD(aad)
    decryptor.setAuthTag(Buffer.from(parsed.auth_tag_base64!, "base64"))
    const plaintext = Buffer.concat([
      decryptor.update(Buffer.from(parsed.ciphertext_base64!, "base64")),
      decryptor.final(),
    ])
    const opened = structuredClone(parseCanonicalJson(plaintext.toString("utf8"))) as Record<string, unknown>
    opened.unexpected = "must be rejected"
    const replacementPlaintext = Buffer.from(canonicalJson(opened))
    const encryptor = createCipheriv("aes-256-gcm", key, nonce, { authTagLength })
    encryptor.setAAD(aad)
    parsed.ciphertext_base64 = Buffer.concat([
      encryptor.update(replacementPlaintext),
      encryptor.final(),
    ]).toString("base64")
    parsed.auth_tag_base64 = encryptor.getAuthTag().toString("base64")
    await writeFile(path, canonicalJson(parsed), { mode: 0o600 })
    await expectIntegrityFailure(port.lookupVerified({
      dispatch_id: receipt.dispatch_id,
      request_sha256: receipt.request_sha256,
      expected_result_bundle_sha256: null,
      expected_checkpoint_handoff_sha256: null,
    }))

    await writeFile(path, original, { mode: 0o600 })
    const wrong = await make("wrong-key", { root, key: randomBytes(32), signing })
    await expectIntegrityFailure(wrong.port.lookupVerified({
      dispatch_id: receipt.dispatch_id,
      request_sha256: receipt.request_sha256,
      expected_result_bundle_sha256: null,
      expected_checkpoint_handoff_sha256: null,
    }))
  })

  test("rejects root and record symlinks and traversal-shaped dispatch identifiers", async () => {
    const parent = await mkdtemp(join(tmpdir(), "sandboxes-handoff-symlink-"))
    roots.push(parent)
    const real = join(parent, "real")
    const linked = join(parent, "linked")
    await mkdir(real, { mode: 0o700 })
    await symlink(real, linked, "dir")
    const key = randomBytes(32)
    const signing = SigningFixture.generate()
    await expect(createEncryptedLocalCheckpointHandoffPortV1({
      root_directory: linked,
      encryption_key: key,
      signer: signing,
      verifier: signing,
    })).rejects.toMatchObject({ code: "integrity_failed" })

    const safe = await make("record-symlink", { key, signing })
    const receipt = await safe.port.putAndReadback(input())
    const record = await handoffFile(safe.root)
    const moved = join(dirname(safe.root), "moved-record")
    await rename(record, moved)
    await symlink(moved, record, "file")
    await expectIntegrityFailure(safe.port.lookupVerified({
      dispatch_id: receipt.dispatch_id,
      request_sha256: receipt.request_sha256,
      expected_result_bundle_sha256: null,
      expected_checkpoint_handoff_sha256: null,
    }))

    await expect(safe.port.putAndReadback(input({ dispatch_id: "../../escape" })))
      .rejects.toMatchObject({ code: "validation_failed" })
    expect(await readdir(dirname(safe.root))).not.toContain("escape")
  })

  test("rejects an unowned hard link to a completed encrypted handoff", async () => {
    const made = await make("record-hardlink")
    const submitted = input({ dispatch_id: "dispatch-record-hardlink" })
    const receipt = await made.port.putAndReadback(submitted)
    const record = await handoffFile(made.root)
    await hardLink(record, join(dirname(made.root), "unowned-hardlink"))
    await expectIntegrityFailure(made.port.lookupVerified({
      dispatch_id: receipt.dispatch_id,
      request_sha256: receipt.request_sha256,
      expected_result_bundle_sha256: null,
      expected_checkpoint_handoff_sha256: null,
    }))
  })

  test("tolerates exact dead-temp reaper and live-publisher unlink races", async () => {
    const deadRoot = await freshRoot("dead-temp-reaper-race")
    const deadKey = randomBytes(32)
    const deadSigning = SigningFixture.generate()
    let deadReaperProbeCalled = false
    let deadTemp = ""
    const deadPort = await make("dead-temp-reaper-race", {
      root: deadRoot,
      key: deadKey,
      signing: deadSigning,
      durabilityProbe: (phase) => {
        if (phase !== "before_dead_temp_unlink") return
        deadReaperProbeCalled = true
        unlinkSync(deadTemp)
      },
    })
    const deadRecordKey = canonicalSha256({
      schema_version: "sandboxes.encrypted-local-checkpoint-dispatch-key/v1",
      dispatch_id: "dead-writer-dispatch",
    }).slice("sha256:".length)
    deadTemp = join(deadRoot, `${deadRecordKey}.999999999.1.${"a".repeat(32)}.tmp`)
    await writeFile(deadTemp, "encrypted-abandoned-temp", { mode: 0o600 })
    expect((await deadPort.port.putAndReadback(input())).dispatch_id).toBe(input().dispatch_id)
    expect(deadReaperProbeCalled).toBeTrue()

    const initialRoot = await freshRoot("dead-temp-initial-lstat-race")
    let initialTemp = ""
    let initialProbeCalled = false
    const initialPort = await make("dead-temp-initial-lstat-race", {
      root: initialRoot,
      durabilityProbe: (phase) => {
        if (phase !== "before_dead_temp_initial_lstat") return
        initialProbeCalled = true
        unlinkSync(initialTemp)
      },
    })
    initialTemp = join(initialRoot, `${deadRecordKey}.999999999.1.${"c".repeat(32)}.tmp`)
    await writeFile(initialTemp, "encrypted-abandoned-temp", { mode: 0o600 })
    expect((await initialPort.port.putAndReadback(input({
      dispatch_id: "dispatch-initial-lstat-reaper-race",
    }))).dispatch_id).toBe("dispatch-initial-lstat-reaper-race")
    expect(initialProbeCalled).toBeTrue()

    const live = await make("live-publisher-unlink-race")
    const submitted = input({ dispatch_id: "dispatch-live-publisher-unlink-race" })
    const receipt = await live.port.putAndReadback(submitted)
    const record = await handoffFile(live.root)
    const statText = readFileSync(`/proc/${process.pid}/stat`, "utf8")
    const close = statText.lastIndexOf(")")
    const startTicks = statText.slice(close + 2).trim().split(/\s+/u)[19]!
    const key = record.slice(record.lastIndexOf("/") + 1, -".handoff".length)
    const linkedTemp = join(live.root, `${key}.${process.pid}.${startTicks}.${"b".repeat(32)}.tmp`)
    await hardLink(record, linkedTemp)
    let readerProbeCalled = false
    const reader = await make("live-publisher-unlink-reader", {
      root: live.root,
      key: live.key,
      signing: live.signing,
      durabilityProbe: (phase) => {
        if (phase !== "before_internal_temp_lstat") return
        readerProbeCalled = true
        unlinkSync(linkedTemp)
      },
    })
    expect(await reader.port.lookupVerified({
      dispatch_id: submitted.dispatch_id,
      request_sha256: submitted.request_sha256,
      expected_result_bundle_sha256: receipt.result_bundle_sha256,
      expected_checkpoint_handoff_sha256: receipt.handoff_receipt_sha256,
    })).toEqual(receipt)
    expect(readerProbeCalled).toBeTrue()
    expect((await lstat(record)).nlink).toBe(1)
  })

  test("anchors an operation to the opened root inode when an ancestor path is swapped", async () => {
    const parent = await mkdtemp(join(tmpdir(), "sandboxes-handoff-root-swap-"))
    roots.push(parent)
    const root = join(parent, "store")
    const moved = join(parent, "original-store")
    const pair = generateKeyPairSync("ed25519")
    const signing = new SigningFixture(pair.privateKey, pair.publicKey, (call) => {
      if (call !== 2) return
      renameSync(root, moved)
      mkdirSync(root, { mode: 0o700 })
    })
    const made = await make("root-swap", { root, signing })
    expect((await made.port.putAndReadback(input({ dispatch_id: "dispatch-root-swap" }))).dispatch_id)
      .toBe("dispatch-root-swap")
    expect(await readdir(root)).toEqual([])
    expect((await readdir(moved)).some((name) => name.endsWith(".handoff"))).toBeTrue()
    await expect(made.port.lookupVerified({
      dispatch_id: "dispatch-root-swap",
      request_sha256: d("request"),
      expected_result_bundle_sha256: null,
      expected_checkpoint_handoff_sha256: null,
    })).rejects.toMatchObject({ code: "integrity_failed" })
  })

  test("recovers signed readback across every crash-consistency publication boundary", async () => {
    for (const phase of ["after_temp_fsync", "after_publish_link", "after_temp_unlink_before_parent_fsync"] as const) {
      const root = await freshRoot(`crash-${phase}`)
      const key = randomBytes(32)
      const signing = SigningFixture.generate()
      const submitted = input({ dispatch_id: `dispatch-${phase}` })
      const childInput = {
        ...submitted,
        journal_lease_epoch: submitted.journal_lease_epoch.toString(10),
        checkpoint_bytes_base64: Buffer.from(submitted.checkpoint_bytes).toString("base64"),
      } as Record<string, unknown>
      delete childInput.checkpoint_bytes
      const child = Bun.spawn([
        process.execPath,
        new URL("./fixtures/checkpoint-handoff-crash-writer.ts", import.meta.url).pathname,
      ], {
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? tmpdir(),
          HANDOFF_MODE: "phase",
          HANDOFF_CRASH_PHASE: phase,
          HANDOFF_ROOT: root,
          HANDOFF_AES_KEY_BASE64: Buffer.from(key).toString("base64"),
          HANDOFF_PRIVATE_KEY_BASE64: signing.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
          HANDOFF_PUBLIC_KEY_BASE64: signing.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
          HANDOFF_INPUT_BASE64: Buffer.from(JSON.stringify(childInput)).toString("base64"),
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      expect(await child.exited).not.toBe(0)
      const reopened = await make(`crash-reopen-${phase}`, {
        root,
        key,
        signing,
      })
      const receipt = await reopened.port.putAndReadback(submitted)
      expect(receipt.dispatch_id).toBe(submitted.dispatch_id)
      expect(await reopened.port.lookupVerified({
        dispatch_id: submitted.dispatch_id,
        request_sha256: submitted.request_sha256,
        expected_result_bundle_sha256: receipt.result_bundle_sha256,
        expected_checkpoint_handoff_sha256: receipt.handoff_receipt_sha256,
      })).toEqual(receipt)
      expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([])
    }
  })
})
