import {
  constants as fsConstants,
  type Stats,
} from "node:fs"
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises"
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"
import { dirname, isAbsolute, parse, resolve, sep } from "node:path"
import { canonicalJson, canonicalSha256, isDigest, parseCanonicalJson } from "./canonical"
import { validateWorkspacePath } from "./adapter"
import { AdapterContractError, adapterError } from "./errors"
import type {
  CheckpointHandoffDescriptionV1,
  CheckpointHandoffInputV1,
  CheckpointHandoffPortV1,
  CheckpointHandoffReceiptV1,
} from "./disposable-task"
import type { Digest } from "./types"

const ENVELOPE_SCHEMA = "sandboxes.checkpoint-handoff-encrypted-local-envelope/v1" as const
const BUNDLE_SCHEMA = "sandboxes.checkpoint-handoff-encrypted-local-bundle/v1" as const
const SIGNATURE_SCHEMA = "sandboxes.checkpoint-handoff-encrypted-local-signature/v1" as const
const DISPATCH_KEY_SCHEMA = "sandboxes.encrypted-local-checkpoint-dispatch-key/v1" as const
const INPUT_SCHEMA = "sandboxes.checkpoint-handoff-encrypted-local-input/v1" as const
const CHECKPOINT_SCHEMA = "sandboxes.disposable-task-checkpoint-bundle/v1" as const
const OUTPUT_MANIFEST_SCHEMA = "sandboxes.disposable-task-output-manifest/v1" as const
const OUTPUT_DIFF_SCHEMA = "sandboxes.disposable-task-output-diff/v1" as const
const INPUT_MANIFEST_SCHEMA = "sandboxes.disposable-task-input-manifest/v1" as const
const CIPHER = "AES-256-GCM" as const
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024
const MAX_RECORD_BYTES = 8 * 1024 * 1024
const MAX_CHECKPOINT_FILES = 10_000
const MAX_OUTPUT_DIFF_ENTRIES = 10_032
const RECEIPT_KEYS = [
  "schema_version", "dispatch_id", "request_sha256", "input_manifest_sha256", "effect_claim_sha256",
  "dispatch_intent_anchor_sha256",
  "authorization_consumption_receipt_sha256", "journal_claim_fence_sha256",
  "journal_lease_epoch", "provider_effect_ownership_nonce_sha256",
  "provider_ownership_binding_sha256", "checkpoint_sha256", "checkpoint_readback_sha256",
  "checkpoint_manifest_sha256", "file_count", "total_bytes", "handoff_receipt_sha256",
  "result_bundle_sha256", "result_signature_sha256", "provider_fingerprint_sha256",
  "broker_artifact_sha256", "broker_protocol_sha256", "authenticated_session_sha256",
  "execution_receipt_sha256", "workspace_readback_sha256", "output_manifest_sha256",
  "output_diff_sha256",
] as const
const INPUT_KEYS = [
  "dispatch_id", "request_sha256", "input_manifest_sha256", "effect_claim_sha256", "dispatch_intent_anchor_sha256",
  "journal_claim_fence_sha256", "journal_lease_epoch",
  "provider_effect_ownership_nonce_sha256", "provider_ownership_binding_sha256",
  "authorization_consumption_receipt_sha256", "provider_fingerprint_sha256",
  "broker_artifact_sha256", "broker_protocol_sha256", "authenticated_session_sha256",
  "execution_receipt_sha256", "workspace_readback_sha256", "output_manifest_sha256",
  "output_diff_sha256", "checkpoint_sha256",
  "checkpoint_manifest_sha256", "file_count", "total_bytes", "checkpoint_bytes",
] as const
const BUNDLE_KEYS = [
  "schema_version", "input_sha256", "dispatch_id", "request_sha256", "input_manifest_sha256", "effect_claim_sha256",
  "dispatch_intent_anchor_sha256",
  "journal_claim_fence_sha256", "journal_lease_epoch",
  "provider_effect_ownership_nonce_sha256", "provider_ownership_binding_sha256",
  "authorization_consumption_receipt_sha256", "provider_fingerprint_sha256",
  "broker_artifact_sha256", "broker_protocol_sha256", "authenticated_session_sha256",
  "execution_receipt_sha256", "workspace_readback_sha256", "output_manifest_sha256",
  "output_diff_sha256", "checkpoint_sha256",
  "checkpoint_manifest_sha256", "file_count", "total_bytes", "checkpoint_bytes_sha256",
  "checkpoint_bytes_base64",
] as const
const RECORD_KEYS = ["schema_version", "bundle", "receipt", "signer", "signature_base64"] as const
const SIGNER_KEYS = ["signer_principal", "signing_key_id", "verification_key_sha256"] as const
const ENVELOPE_KEYS = [
  "schema_version", "cipher", "encryption_key_sha256", "record_key_sha256",
  "nonce_base64", "ciphertext_base64", "auth_tag_base64",
] as const
const CHECKPOINT_KEYS = [
  "schema_version", "output_mode", "input_manifest_sha256", "input_manifest", "checkpoint_sha256",
  "manifest_sha256", "output_manifest_sha256", "output_diff_sha256", "output_diff", "files", "manifest",
  "file_count", "total_bytes",
] as const
const CHECKPOINT_FILE_KEYS = ["path", "size", "sha256", "content_base64"] as const
const CHECKPOINT_MANIFEST_KEYS = ["path", "size", "mode", "sha256"] as const
const INPUT_MANIFEST_KEYS = ["path", "content_sha256", "size_bytes", "mode"] as const
const CHECKPOINT_DIFF_KEYS = [
  "kind", "path", "before_sha256", "after_sha256", "before_mode", "after_mode",
] as const

export interface CheckpointHandoffReceiptSignerV1 {
  readonly signer_principal: string
  readonly signing_key_id: string
  readonly verification_key_sha256: Digest
  sign(bytes: Uint8Array): Uint8Array
}

export interface CheckpointHandoffReceiptVerifierV1 {
  readonly signer_principal: string
  readonly signing_key_id: string
  readonly verification_key_sha256: Digest
  verify(bytes: Uint8Array, signature: Uint8Array): boolean
}

export interface EncryptedLocalCheckpointHandoffOptionsV1 {
  readonly root_directory: string
  readonly encryption_key: Uint8Array
  readonly signer: CheckpointHandoffReceiptSignerV1
  readonly verifier: CheckpointHandoffReceiptVerifierV1
  /** Optional crash-consistency certification hook. It receives phase names only, never paths or data. */
  readonly durability_probe?: (phase: EncryptedLocalCheckpointHandoffDurabilityPhaseV1) => void
}

export type EncryptedLocalCheckpointHandoffDurabilityPhaseV1 =
  | "after_temp_fsync"
  | "after_publish_link"
  | "after_temp_unlink_before_parent_fsync"
  | "before_dead_temp_initial_lstat"
  | "before_dead_temp_unlink"
  | "before_internal_temp_lstat"

interface NormalizedInput {
  readonly dispatch_id: string
  readonly request_sha256: Digest
  readonly input_manifest_sha256: Digest
  readonly effect_claim_sha256: Digest
  readonly dispatch_intent_anchor_sha256: Digest
  readonly journal_claim_fence_sha256: Digest
  readonly journal_lease_epoch: string
  readonly provider_effect_ownership_nonce_sha256: Digest
  readonly provider_ownership_binding_sha256: Digest
  readonly authorization_consumption_receipt_sha256: Digest
  readonly provider_fingerprint_sha256: Digest
  readonly broker_artifact_sha256: Digest
  readonly broker_protocol_sha256: Digest
  readonly authenticated_session_sha256: Digest
  readonly execution_receipt_sha256: Digest
  readonly workspace_readback_sha256: Digest
  readonly output_manifest_sha256: Digest
  readonly output_diff_sha256: Digest
  readonly checkpoint_sha256: Digest
  readonly checkpoint_manifest_sha256: Digest
  readonly file_count: number
  readonly total_bytes: number
  readonly checkpoint_bytes_sha256: Digest
  readonly checkpoint_bytes_base64: string
}

interface StoredBundle extends NormalizedInput {
  readonly schema_version: typeof BUNDLE_SCHEMA
  readonly input_sha256: Digest
}

interface StoredSigner {
  readonly signer_principal: string
  readonly signing_key_id: string
  readonly verification_key_sha256: Digest
}

interface StoredRecord {
  readonly schema_version: "sandboxes.checkpoint-handoff-encrypted-local-record/v1"
  readonly bundle: StoredBundle
  readonly receipt: CheckpointHandoffReceiptV1
  readonly signer: StoredSigner
  readonly signature_base64: string
}

interface StoredEnvelope {
  readonly schema_version: typeof ENVELOPE_SCHEMA
  readonly cipher: typeof CIPHER
  readonly encryption_key_sha256: Digest
  readonly record_key_sha256: Digest
  readonly nonce_base64: string
  readonly ciphertext_base64: string
  readonly auth_tag_base64: string
}

interface RootIdentity {
  readonly device: bigint
  readonly inode: bigint
}

interface RootAnchor {
  readonly handle: FileHandle
  readonly path: string
}

class EncryptedLocalCheckpointHandoffPort implements CheckpointHandoffPortV1 {
  readonly #root: string
  readonly #rootIdentity: RootIdentity
  readonly #key: Uint8Array
  readonly #keySha256: Digest
  readonly #signer: CheckpointHandoffReceiptSignerV1
  readonly #verifier: CheckpointHandoffReceiptVerifierV1
  readonly #processStartTicks: string
  readonly #durabilityProbe: ((phase: EncryptedLocalCheckpointHandoffDurabilityPhaseV1) => void) | undefined
  readonly #description: Readonly<CheckpointHandoffDescriptionV1>

  private constructor(input: {
    root: string
    rootIdentity: RootIdentity
    key: Uint8Array
    keySha256: Digest
    signer: CheckpointHandoffReceiptSignerV1
    verifier: CheckpointHandoffReceiptVerifierV1
    processStartTicks: string
    durabilityProbe: ((phase: EncryptedLocalCheckpointHandoffDurabilityPhaseV1) => void) | undefined
    description: Readonly<CheckpointHandoffDescriptionV1>
  }) {
    this.#root = input.root
    this.#rootIdentity = input.rootIdentity
    this.#key = input.key
    this.#keySha256 = input.keySha256
    this.#signer = input.signer
    this.#verifier = input.verifier
    this.#processStartTicks = input.processStartTicks
    this.#durabilityProbe = input.durabilityProbe
    this.#description = input.description
  }

  static async open(options: EncryptedLocalCheckpointHandoffOptionsV1): Promise<EncryptedLocalCheckpointHandoffPort> {
    if (!isPlainDataRecord(options, [
      "root_directory", "encryption_key", "signer", "verifier", "durability_probe",
    ], true)) {
      throw adapterError("validation_failed")
    }
    if (typeof options.root_directory !== "string" || options.root_directory.length === 0 || options.root_directory.includes("\0")) {
      throw adapterError("validation_failed")
    }
    if (!(options.encryption_key instanceof Uint8Array) || options.encryption_key.byteLength !== 32) {
      throw adapterError("validation_failed")
    }
    if (options.durability_probe !== undefined && typeof options.durability_probe !== "function") {
      throw adapterError("validation_failed")
    }
    if (process.platform !== "linux") throw adapterError("unsupported_runtime_feature")
    const key = new Uint8Array(options.encryption_key)
    const keySha256 = directDigest(key)
    assertSigningPair(options.signer, options.verifier)
    const processStartTicks = await readProcessStartTicks(process.pid)
    if (processStartTicks === null) throw adapterError("unsupported_runtime_feature")
    const root = resolve(options.root_directory)
    await prepareRoot(root)
    const rootStat = await safeDirectoryStat(root)
    if ((rootStat.mode & 0o077) !== 0) throw adapterError("integrity_failed")
    const rootIdentity = { device: BigInt(rootStat.dev), inode: BigInt(rootStat.ino) }
    const rootPathSha256 = directDigest(new TextEncoder().encode(root))
    const description = Object.freeze({
      durability: "volatile" as const,
      encrypted_at_rest: true,
      readback_verified: true,
      store_identity_sha256: canonicalSha256({
        schema_version: "sandboxes.checkpoint-handoff-encrypted-local-store/v1",
        root_path_sha256: rootPathSha256,
        encryption_key_sha256: keySha256,
        signer_principal: options.signer.signer_principal,
        signing_key_id: options.signer.signing_key_id,
        verification_key_sha256: options.signer.verification_key_sha256,
      }),
    })
    const challenge = new TextEncoder().encode(canonicalJson({
      schema_version: "sandboxes.checkpoint-handoff-encrypted-local-key-possession/v1",
      store_identity_sha256: description.store_identity_sha256,
    }))
    let proof: Uint8Array
    try {
      proof = options.signer.sign(challenge)
    } catch {
      throw adapterError("integrity_failed")
    }
    let proofVerified = false
    try {
      proofVerified = options.verifier.verify(challenge, proof)
    } catch {
      throw adapterError("integrity_failed")
    }
    if (!(proof instanceof Uint8Array) || proof.byteLength !== 64 || !proofVerified) {
      throw adapterError("integrity_failed")
    }
    return new EncryptedLocalCheckpointHandoffPort({
      root,
      rootIdentity,
      key,
      keySha256,
      signer: options.signer,
      verifier: options.verifier,
      processStartTicks,
      durabilityProbe: options.durability_probe,
      description,
    })
  }

  describe(): CheckpointHandoffDescriptionV1 {
    return this.#description
  }

  async putAndReadback(input: Readonly<CheckpointHandoffInputV1>): Promise<Readonly<CheckpointHandoffReceiptV1>> {
    const normalized = normalizeInput(input)
    const inputSha256 = inputDigest(normalized)
    const key = recordKey(normalized.dispatch_id)
    return this.#withRoot(async (root) => {
      await this.#collectDeadWriterTemps(root)
      const existing = await this.#readRecordIfPresent(key, root)
      if (existing !== null) {
        await this.#syncRoot(root)
        return this.#assertExactReplay(existing, normalized, inputSha256)
      }

      const record = this.#createRecord(normalized, inputSha256)
      const envelopeBytes = this.#encryptRecord(key, record)
      await this.#atomicWrite(key, envelopeBytes, root)
      const readback = await this.#readRecord(key, root)
      return this.#assertExactReplay(readback, normalized, inputSha256)
    })
  }

  async lookupVerified(input: Readonly<{
    dispatch_id: string
    request_sha256: Digest
    expected_result_bundle_sha256: Digest | null
    expected_checkpoint_handoff_sha256: Digest | null
  }>): Promise<Readonly<CheckpointHandoffReceiptV1> | "absent"> {
    if (!isPlainDataRecord(input, [
      "dispatch_id", "request_sha256", "expected_result_bundle_sha256",
      "expected_checkpoint_handoff_sha256",
    ]) || !SAFE_ID.test(input.dispatch_id) || !isDigest(input.request_sha256) ||
      (input.expected_result_bundle_sha256 !== null && !isDigest(input.expected_result_bundle_sha256)) ||
      (input.expected_checkpoint_handoff_sha256 !== null && !isDigest(input.expected_checkpoint_handoff_sha256))) {
      throw adapterError("validation_failed")
    }
    return this.#withRoot(async (root) => {
      const record = await this.#readRecordIfPresent(recordKey(input.dispatch_id), root)
      if (record === null || record.bundle.dispatch_id !== input.dispatch_id ||
        record.bundle.request_sha256 !== input.request_sha256 ||
        (input.expected_result_bundle_sha256 !== null &&
          record.receipt.result_bundle_sha256 !== input.expected_result_bundle_sha256) ||
        (input.expected_checkpoint_handoff_sha256 !== null &&
          record.receipt.handoff_receipt_sha256 !== input.expected_checkpoint_handoff_sha256)) {
        return "absent" as const
      }
      await this.#syncRoot(root)
      return Object.freeze(structuredClone(record.receipt))
    })
  }

  #createRecord(normalized: NormalizedInput, inputSha256: Digest): StoredRecord {
    const bundle: StoredBundle = Object.freeze({
      schema_version: BUNDLE_SCHEMA,
      input_sha256: inputSha256,
      ...normalized,
    })
    const resultBundleSha256 = canonicalSha256(bundle)
    const signatureBasis = {
      schema_version: SIGNATURE_SCHEMA,
      store_identity_sha256: this.#description.store_identity_sha256,
      result_bundle_sha256: resultBundleSha256,
      input_sha256: inputSha256,
    }
    const signatureBytes = new TextEncoder().encode(canonicalJson(signatureBasis))
    let signature: Uint8Array
    let verified = false
    try {
      signature = this.#signer.sign(signatureBytes)
      verified = this.#verifier.verify(signatureBytes, signature)
    } catch {
      throw adapterError("integrity_failed")
    }
    if (!(signature instanceof Uint8Array) || signature.byteLength !== 64 || !verified) {
      throw adapterError("integrity_failed")
    }
    const resultSignatureSha256 = directDigest(signature)
    const receiptBasis = receiptFromBundle(bundle, resultBundleSha256, resultSignatureSha256)
    const receipt: CheckpointHandoffReceiptV1 = Object.freeze({
      ...receiptBasis,
      handoff_receipt_sha256: canonicalSha256(receiptBasis),
    })
    return Object.freeze({
      schema_version: "sandboxes.checkpoint-handoff-encrypted-local-record/v1" as const,
      bundle,
      receipt,
      signer: Object.freeze({
        signer_principal: this.#signer.signer_principal,
        signing_key_id: this.#signer.signing_key_id,
        verification_key_sha256: this.#signer.verification_key_sha256,
      }),
      signature_base64: Buffer.from(signature).toString("base64"),
    })
  }

  #encryptRecord(key: string, record: StoredRecord): Uint8Array {
    const nonce = randomBytes(12)
    const nonceBase64 = nonce.toString("base64")
    const aadBasis = {
      schema_version: ENVELOPE_SCHEMA,
      cipher: CIPHER,
      encryption_key_sha256: this.#keySha256,
      record_key_sha256: digestFromHex(key),
      nonce_base64: nonceBase64,
    }
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce, { authTagLength: 16 })
    cipher.setAAD(new TextEncoder().encode(canonicalJson(aadBasis)))
    const plaintext = Buffer.from(canonicalJson(record))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const envelope: StoredEnvelope = {
      ...aadBasis,
      ciphertext_base64: ciphertext.toString("base64"),
      auth_tag_base64: cipher.getAuthTag().toString("base64"),
    }
    return new TextEncoder().encode(canonicalJson(envelope))
  }

  async #readRecordIfPresent(key: string, root: RootAnchor): Promise<StoredRecord | null> {
    try {
      return await this.#readRecord(key, root)
    } catch (error) {
      if (isErrno(error, "ENOENT")) return null
      throw error
    }
  }

  async #readRecord(key: string, root: RootAnchor): Promise<StoredRecord> {
    await this.#assertRootStable(root)
    const handle = await open(this.#recordPath(key, root), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
      .catch((error: unknown) => {
        if (isErrno(error, "ENOENT")) throw error
        throw safeFilesystemError(error)
      })
    try {
      const stat = await handle.stat({ bigint: true })
      if (!stat.isFile() || (stat.nlink !== 1n && stat.nlink !== 2n) || stat.size < 1n || stat.size > BigInt(MAX_RECORD_BYTES) ||
        (Number(stat.mode) & 0o077) !== 0) throw adapterError("integrity_failed")
      if (stat.nlink === 2n) await this.#assertInternalPublishLink(key, stat.dev, stat.ino, handle, root)
      const bytes = await handle.readFile()
      return this.#decryptAndVerify(key, bytes)
    } finally {
      await handle.close()
    }
  }

  #decryptAndVerify(key: string, bytes: Uint8Array): StoredRecord {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_RECORD_BYTES) throw adapterError("integrity_failed")
    let decoded: unknown
    try {
      decoded = parseCanonicalJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    } catch {
      throw adapterError("integrity_failed")
    }
    if (!isPlainDataRecord(decoded, ENVELOPE_KEYS) || decoded.schema_version !== ENVELOPE_SCHEMA ||
      decoded.cipher !== CIPHER || decoded.encryption_key_sha256 !== this.#keySha256 ||
      decoded.record_key_sha256 !== digestFromHex(key) ||
      !validBase64(decoded.nonce_base64, 12) || !validBase64(decoded.auth_tag_base64, 16) ||
      typeof decoded.ciphertext_base64 !== "string" || !BASE64.test(decoded.ciphertext_base64)) {
      throw adapterError("integrity_failed")
    }
    const aadBasis = {
      schema_version: decoded.schema_version,
      cipher: decoded.cipher,
      encryption_key_sha256: decoded.encryption_key_sha256,
      record_key_sha256: decoded.record_key_sha256,
      nonce_base64: decoded.nonce_base64,
    }
    let plaintext: Buffer
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#key,
        Buffer.from(decoded.nonce_base64, "base64"),
        { authTagLength: 16 },
      )
      decipher.setAAD(new TextEncoder().encode(canonicalJson(aadBasis)))
      decipher.setAuthTag(Buffer.from(decoded.auth_tag_base64, "base64"))
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(decoded.ciphertext_base64, "base64")),
        decipher.final(),
      ])
    } catch {
      throw adapterError("integrity_failed")
    }
    let record: unknown
    try {
      record = parseCanonicalJson(new TextDecoder("utf-8", { fatal: true }).decode(plaintext))
    } catch {
      throw adapterError("integrity_failed")
    }
    return this.#verifyRecord(key, record)
  }

  #verifyRecord(key: string, value: unknown): StoredRecord {
    if (!isPlainDataRecord(value, RECORD_KEYS) ||
      value.schema_version !== "sandboxes.checkpoint-handoff-encrypted-local-record/v1" ||
      !isPlainDataRecord(value.bundle, BUNDLE_KEYS) || !isPlainDataRecord(value.receipt, RECEIPT_KEYS) ||
      !isPlainDataRecord(value.signer, SIGNER_KEYS) || !validBase64(value.signature_base64, 64)) {
      throw adapterError("integrity_failed")
    }
    const bundle = value.bundle as unknown as StoredBundle
    const receipt = value.receipt as unknown as CheckpointHandoffReceiptV1
    const signer = value.signer as unknown as StoredSigner
    if (bundle.schema_version !== BUNDLE_SCHEMA || bundle.dispatch_id.length === 0 ||
      recordKey(bundle.dispatch_id) !== key || bundle.input_sha256 !== inputDigest(bundle) ||
      signer.signer_principal !== this.#signer.signer_principal ||
      signer.signing_key_id !== this.#signer.signing_key_id ||
      signer.verification_key_sha256 !== this.#signer.verification_key_sha256 ||
      signer.signer_principal !== this.#verifier.signer_principal ||
      signer.signing_key_id !== this.#verifier.signing_key_id ||
      signer.verification_key_sha256 !== this.#verifier.verification_key_sha256) {
      throw adapterError("integrity_failed")
    }
    assertNormalizedBundle(bundle)
    const resultBundleSha256 = canonicalSha256(bundle)
    const signature = Buffer.from(value.signature_base64, "base64")
    const signatureBasis = {
      schema_version: SIGNATURE_SCHEMA,
      store_identity_sha256: this.#description.store_identity_sha256,
      result_bundle_sha256: resultBundleSha256,
      input_sha256: bundle.input_sha256,
    }
    if (signature.byteLength !== 64 || !this.#verifier.verify(
      new TextEncoder().encode(canonicalJson(signatureBasis)),
      signature,
    )) throw adapterError("integrity_failed")
    const resultSignatureSha256 = directDigest(signature)
    const expectedBasis = receiptFromBundle(bundle, resultBundleSha256, resultSignatureSha256)
    const expected = {
      ...expectedBasis,
      handoff_receipt_sha256: canonicalSha256(expectedBasis),
    }
    if (!safeCanonicalEqual(receipt, expected)) throw adapterError("integrity_failed")
    return Object.freeze({
      schema_version: value.schema_version,
      bundle: Object.freeze(structuredClone(bundle)),
      receipt: Object.freeze(structuredClone(receipt)),
      signer: Object.freeze(structuredClone(signer)),
      signature_base64: value.signature_base64,
    })
  }

  #assertExactReplay(record: StoredRecord, normalized: NormalizedInput, inputSha256: Digest): Readonly<CheckpointHandoffReceiptV1> {
    if (record.bundle.input_sha256 !== inputSha256 || !safeCanonicalEqual(
      normalized,
      stripBundleIdentity(record.bundle),
    )) throw adapterError("integrity_failed")
    return Object.freeze(structuredClone(record.receipt))
  }

  async #atomicWrite(key: string, bytes: Uint8Array, root: RootAnchor): Promise<void> {
    const temp = `${key}.${process.pid}.${this.#processStartTicks}.${randomBytes(16).toString("hex")}.tmp`
    const tempPath = this.#path(temp, root)
    try {
      const handle = await open(
        tempPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600,
      ).catch((error: unknown) => { throw safeFilesystemError(error) })
      try {
        await handle.writeFile(bytes)
        await handle.sync()
        this.#notifyDurabilityPhase("after_temp_fsync")
      } finally {
        await handle.close()
      }
      await this.#assertRootStable(root)
      try {
        await link(tempPath, this.#recordPath(key, root))
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw safeFilesystemError(error)
        await unlink(tempPath).catch((unlinkError: unknown) => { throw safeFilesystemError(unlinkError) })
        await this.#syncRoot(root)
        return
      }
      this.#notifyDurabilityPhase("after_publish_link")
      await this.#syncRoot(root)
      await unlink(tempPath).catch((error: unknown) => { throw safeFilesystemError(error) })
      this.#notifyDurabilityPhase("after_temp_unlink_before_parent_fsync")
      await this.#syncRoot(root)
    } catch (error) {
      await unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  #notifyDurabilityPhase(phase: EncryptedLocalCheckpointHandoffDurabilityPhaseV1): void {
    if (this.#durabilityProbe === undefined) return
    try {
      this.#durabilityProbe(phase)
    } catch {
      throw adapterError("integrity_failed")
    }
  }

  async #assertInternalPublishLink(
    key: string,
    device: bigint,
    inode: bigint,
    handle: FileHandle,
    root: RootAnchor,
  ): Promise<void> {
    let matches = 0
    for (const name of await readdir(root.path)) {
      const owned = parseOwnedTempName(name)
      if (owned === null || owned.key !== key) continue
      this.#notifyDurabilityPhase("before_internal_temp_lstat")
      const stat = await lstat(this.#path(name, root), { bigint: true }).catch((error: unknown) => {
        if (isErrno(error, "ENOENT")) return null
        throw safeFilesystemError(error)
      })
      if (stat !== null && stat.isFile() && stat.dev === device && stat.ino === inode) matches += 1
    }
    if (matches === 1) return
    if ((await handle.stat({ bigint: true })).nlink === 1n) return
    throw adapterError("integrity_failed")
  }

  async #collectDeadWriterTemps(root: RootAnchor): Promise<void> {
    let changed = false
    for (const name of await readdir(root.path)) {
      const owned = parseOwnedTempName(name)
      if (owned === null) {
        if (!/^[a-f0-9]{64}\.handoff$/u.test(name)) throw adapterError("integrity_failed")
        continue
      }
      const path = this.#path(name, root)
      this.#notifyDurabilityPhase("before_dead_temp_initial_lstat")
      const stat = await lstat(path, { bigint: true }).catch((error: unknown) => {
        if (isErrno(error, "ENOENT")) return null
        throw safeFilesystemError(error)
      })
      if (stat === null) {
        changed = true
        continue
      }
      if (!stat.isFile() || (stat.nlink !== 1n && stat.nlink !== 2n) || (Number(stat.mode) & 0o077) !== 0) {
        throw adapterError("integrity_failed")
      }
      if (await processOwnerIsAlive(owned.pid, owned.processStartTicks)) continue
      if (stat.nlink === 2n) {
        const final = await lstat(this.#recordPath(owned.key, root), { bigint: true }).catch((error: unknown) => {
          if (isErrno(error, "ENOENT")) return null
          throw safeFilesystemError(error)
        })
        if (final === null || !final.isFile() || final.dev !== stat.dev || final.ino !== stat.ino) {
          throw adapterError("integrity_failed")
        }
      }
      const current = await lstat(path, { bigint: true }).catch((error: unknown) => {
        if (isErrno(error, "ENOENT")) return null
        throw safeFilesystemError(error)
      })
      if (current === null) {
        changed = true
        continue
      }
      if (current.dev !== stat.dev || current.ino !== stat.ino || current.nlink !== stat.nlink) {
        throw adapterError("integrity_failed")
      }
      if (current.nlink === 2n) {
        const final = await lstat(this.#recordPath(owned.key, root), { bigint: true }).catch((error: unknown) => {
          if (isErrno(error, "ENOENT")) return null
          throw safeFilesystemError(error)
        })
        if (final === null || final.dev !== current.dev || final.ino !== current.ino) {
          throw adapterError("integrity_failed")
        }
      }
      this.#notifyDurabilityPhase("before_dead_temp_unlink")
      await unlink(path).catch((error: unknown) => {
        if (!isErrno(error, "ENOENT")) throw safeFilesystemError(error)
      })
      changed = true
    }
    if (changed) await this.#syncRoot(root)
  }

  async #withRoot<T>(operation: (root: RootAnchor) => Promise<T>): Promise<T> {
    const handle = await open(
      this.#root,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    ).catch((error: unknown) => { throw safeFilesystemError(error) })
    const root = { handle, path: `/proc/self/fd/${handle.fd}` }
    try {
      await this.#assertRootStable(root)
      const procStat = await lstat(root.path).catch((error: unknown) => { throw safeFilesystemError(error) })
      if (!procStat.isSymbolicLink()) throw adapterError("integrity_failed")
      return await operation(root)
    } catch (error) {
      if (error instanceof AdapterContractError) throw error
      throw safeFilesystemError(error)
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  async #assertRootStable(root: RootAnchor): Promise<void> {
    const stat = await root.handle.stat({ bigint: true })
    if (!stat.isDirectory() || stat.dev !== this.#rootIdentity.device || stat.ino !== this.#rootIdentity.inode ||
      (Number(stat.mode) & 0o077) !== 0) throw adapterError("integrity_failed")
  }

  async #syncRoot(root: RootAnchor): Promise<void> {
    await root.handle.sync().catch((error: unknown) => { throw safeFilesystemError(error) })
  }

  #path(name: string, root: RootAnchor): string {
    if (parseOwnedTempName(name) === null && !/^[a-f0-9]{64}\.handoff$/u.test(name)) {
      throw adapterError("integrity_failed")
    }
    return `${root.path}${sep}${name}`
  }

  #recordPath(key: string, root: RootAnchor): string { return this.#path(`${key}.handoff`, root) }
}

export async function createEncryptedLocalCheckpointHandoffPortV1(
  options: EncryptedLocalCheckpointHandoffOptionsV1,
): Promise<CheckpointHandoffPortV1> {
  return EncryptedLocalCheckpointHandoffPort.open(options)
}

function normalizeInput(input: Readonly<CheckpointHandoffInputV1>): NormalizedInput {
  if (!isPlainDataRecord(input, INPUT_KEYS) || !SAFE_ID.test(input.dispatch_id) ||
    typeof input.journal_lease_epoch !== "bigint" || input.journal_lease_epoch < 1n ||
    !Number.isSafeInteger(input.file_count) || input.file_count < 0 || input.file_count > MAX_CHECKPOINT_FILES ||
    !Number.isSafeInteger(input.total_bytes) || input.total_bytes < 0 || input.total_bytes > MAX_CHECKPOINT_BYTES ||
    !(input.checkpoint_bytes instanceof Uint8Array) || input.checkpoint_bytes.byteLength < 1 ||
    input.checkpoint_bytes.byteLength > MAX_CHECKPOINT_BYTES) throw adapterError("validation_failed")
  const digests = [
    input.request_sha256, input.input_manifest_sha256, input.effect_claim_sha256, input.dispatch_intent_anchor_sha256,
    input.journal_claim_fence_sha256,
    input.provider_effect_ownership_nonce_sha256, input.provider_ownership_binding_sha256,
    input.authorization_consumption_receipt_sha256, input.provider_fingerprint_sha256,
    input.broker_artifact_sha256, input.broker_protocol_sha256, input.authenticated_session_sha256,
    input.execution_receipt_sha256, input.workspace_readback_sha256, input.output_manifest_sha256,
    input.output_diff_sha256, input.checkpoint_sha256,
    input.checkpoint_manifest_sha256,
  ]
  if (!digests.every(isDigest)) throw adapterError("validation_failed")
  const bytes = new Uint8Array(input.checkpoint_bytes)
  const checkpoint = parseCheckpointBundle(bytes)
  if (input.checkpoint_sha256 !== checkpoint.checkpoint_sha256 ||
    input.input_manifest_sha256 !== checkpoint.input_manifest_sha256 ||
    input.checkpoint_manifest_sha256 !== checkpoint.manifest_sha256 ||
    input.output_manifest_sha256 !== checkpoint.output_manifest_sha256 ||
    input.output_diff_sha256 !== checkpoint.output_diff_sha256 ||
    input.file_count !== checkpoint.file_count || input.total_bytes !== checkpoint.total_bytes) {
    throw adapterError("integrity_failed")
  }
  return Object.freeze({
    dispatch_id: input.dispatch_id,
    request_sha256: input.request_sha256,
    input_manifest_sha256: input.input_manifest_sha256,
    effect_claim_sha256: input.effect_claim_sha256,
    dispatch_intent_anchor_sha256: input.dispatch_intent_anchor_sha256,
    journal_claim_fence_sha256: input.journal_claim_fence_sha256,
    journal_lease_epoch: input.journal_lease_epoch.toString(10),
    provider_effect_ownership_nonce_sha256: input.provider_effect_ownership_nonce_sha256,
    provider_ownership_binding_sha256: input.provider_ownership_binding_sha256,
    authorization_consumption_receipt_sha256: input.authorization_consumption_receipt_sha256,
    provider_fingerprint_sha256: input.provider_fingerprint_sha256,
    broker_artifact_sha256: input.broker_artifact_sha256,
    broker_protocol_sha256: input.broker_protocol_sha256,
    authenticated_session_sha256: input.authenticated_session_sha256,
    execution_receipt_sha256: input.execution_receipt_sha256,
    workspace_readback_sha256: input.workspace_readback_sha256,
    output_manifest_sha256: input.output_manifest_sha256,
    output_diff_sha256: input.output_diff_sha256,
    checkpoint_sha256: input.checkpoint_sha256,
    checkpoint_manifest_sha256: input.checkpoint_manifest_sha256,
    file_count: input.file_count,
    total_bytes: input.total_bytes,
    checkpoint_bytes_sha256: directDigest(bytes),
    checkpoint_bytes_base64: Buffer.from(bytes).toString("base64"),
  })
}

interface ParsedCheckpointBundle {
  readonly input_manifest_sha256: Digest
  readonly checkpoint_sha256: Digest
  readonly manifest_sha256: Digest
  readonly output_manifest_sha256: Digest
  readonly output_diff_sha256: Digest
  readonly file_count: number
  readonly total_bytes: number
}

function parseCheckpointBundle(bytes: Uint8Array): ParsedCheckpointBundle {
  let value: unknown
  try {
    value = parseCanonicalJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw adapterError("integrity_failed")
  }
  if (!isPlainDataRecord(value, CHECKPOINT_KEYS) || value.schema_version !== CHECKPOINT_SCHEMA ||
    value.output_mode !== "delta_from_input" || !isDigest(value.input_manifest_sha256) ||
    !isDigest(value.checkpoint_sha256) || !isDigest(value.manifest_sha256) ||
    !isDigest(value.output_manifest_sha256) || !isDigest(value.output_diff_sha256) ||
    !Array.isArray(value.input_manifest) || value.input_manifest.length < 1 || value.input_manifest.length > 32 ||
    !Array.isArray(value.files) || !Array.isArray(value.manifest) || !Array.isArray(value.output_diff) ||
    !Number.isSafeInteger(value.file_count) || (value.file_count as number) < 0 ||
    (value.file_count as number) > MAX_CHECKPOINT_FILES || value.files.length !== value.file_count ||
    value.manifest.length !== value.file_count || !Number.isSafeInteger(value.total_bytes) ||
    (value.total_bytes as number) < 0 || (value.total_bytes as number) > MAX_CHECKPOINT_BYTES ||
    value.output_diff.length > MAX_OUTPUT_DIFF_ENTRIES) throw adapterError("integrity_failed")

  const inputManifest: Array<{ path: string; content_sha256: Digest; size_bytes: number; mode: number }> = []
  let previousPath: string | undefined
  for (const item of value.input_manifest) {
    if (!isPlainDataRecord(item, INPUT_MANIFEST_KEYS) || !validCheckpointPath(item.path) ||
      !isDigest(item.content_sha256) || !Number.isSafeInteger(item.size_bytes) || (item.size_bytes as number) < 0 ||
      (item.size_bytes as number) > MAX_CHECKPOINT_BYTES || !Number.isSafeInteger(item.mode) ||
      ![0o600, 0o644, 0o700, 0o755].includes(item.mode as number) ||
      (previousPath !== undefined && comparePathBytes(previousPath, item.path) >= 0)) {
      throw adapterError("integrity_failed")
    }
    previousPath = item.path
    inputManifest.push({
      path: item.path,
      content_sha256: item.content_sha256,
      size_bytes: item.size_bytes as number,
      mode: item.mode as number,
    })
  }
  const inputManifestSha256 = canonicalSha256({ schema_version: INPUT_MANIFEST_SCHEMA, files: inputManifest })
  if (value.input_manifest_sha256 !== inputManifestSha256) throw adapterError("integrity_failed")

  const files: Array<{ path: string; size: number; sha256: Digest; content_base64: string }> = []
  const manifest: Array<{ path: string; size: number; mode: number; sha256: Digest }> = []
  let totalBytes = 0
  previousPath = undefined
  for (let index = 0; index < value.files.length; index += 1) {
    const file = value.files[index]
    const entry = value.manifest[index]
    if (!isPlainDataRecord(file, CHECKPOINT_FILE_KEYS) ||
      !isPlainDataRecord(entry, CHECKPOINT_MANIFEST_KEYS) ||
      !validCheckpointPath(file.path) || entry.path !== file.path || !isDigest(file.sha256) ||
      entry.sha256 !== file.sha256 || !Number.isSafeInteger(file.size) || (file.size as number) < 0 ||
      (file.size as number) > MAX_CHECKPOINT_BYTES || entry.size !== file.size ||
      !Number.isSafeInteger(entry.mode) || ![0o600, 0o644, 0o700, 0o755].includes(entry.mode as number) ||
      typeof file.content_base64 !== "string" || !BASE64.test(file.content_base64) ||
      (previousPath !== undefined && comparePathBytes(previousPath, file.path) >= 0)) {
      throw adapterError("integrity_failed")
    }
    const content = Buffer.from(file.content_base64, "base64")
    if (content.toString("base64") !== file.content_base64 || content.byteLength !== file.size ||
      directDigest(content) !== file.sha256) throw adapterError("integrity_failed")
    totalBytes += content.byteLength
    if (totalBytes > MAX_CHECKPOINT_BYTES) throw adapterError("integrity_failed")
    previousPath = file.path
    files.push({
      path: file.path,
      size: file.size as number,
      sha256: file.sha256,
      content_base64: file.content_base64,
    })
    manifest.push({
      path: file.path,
      size: entry.size as number,
      mode: entry.mode as number,
      sha256: entry.sha256 as Digest,
    })
  }
  if (totalBytes !== value.total_bytes) throw adapterError("integrity_failed")

  const changes: Array<{
    kind: "added" | "modified" | "deleted"
    path: string
    before_sha256: Digest | null
    after_sha256: Digest | null
    before_mode: number | null
    after_mode: number | null
  }> = []
  const initial = new Map(inputManifest.map((entry) => [entry.path, entry] as const))
  for (const entry of manifest) {
    const before = initial.get(entry.path)
    if (before === undefined) {
      changes.push({
        kind: "added", path: entry.path,
        before_sha256: null, after_sha256: entry.sha256,
        before_mode: null, after_mode: entry.mode,
      })
      continue
    }
    initial.delete(entry.path)
    if (before.content_sha256 === entry.sha256 && before.size_bytes !== entry.size) {
      throw adapterError("integrity_failed")
    }
    if (before.content_sha256 !== entry.sha256 || before.mode !== entry.mode) {
      changes.push({
        kind: "modified", path: entry.path,
        before_sha256: before.content_sha256, after_sha256: entry.sha256,
        before_mode: before.mode, after_mode: entry.mode,
      })
    }
  }
  for (const before of initial.values()) {
    changes.push({
      kind: "deleted", path: before.path,
      before_sha256: before.content_sha256, after_sha256: null,
      before_mode: before.mode, after_mode: null,
    })
  }
  changes.sort((left, right) => comparePathBytes(left.path, right.path))
  if (changes.length > MAX_OUTPUT_DIFF_ENTRIES || !safeCanonicalEqual(value.output_diff, changes) ||
    value.output_diff.some((item) => !isPlainDataRecord(item, CHECKPOINT_DIFF_KEYS))) {
    throw adapterError("integrity_failed")
  }

  const manifestSha256 = canonicalSha256(manifest)
  const checkpointSha256 = canonicalSha256({
    manifest_sha256: manifestSha256,
    files: files.map(({ path, size, sha256 }) => ({ path, sha256, size })),
  })
  const outputManifestSha256 = canonicalSha256({ schema_version: OUTPUT_MANIFEST_SCHEMA, files: manifest })
  const outputDiffSha256 = canonicalSha256({ schema_version: OUTPUT_DIFF_SCHEMA, changes })
  if (value.manifest_sha256 !== manifestSha256 || value.checkpoint_sha256 !== checkpointSha256 ||
    value.output_manifest_sha256 !== outputManifestSha256 || value.output_diff_sha256 !== outputDiffSha256) {
    throw adapterError("integrity_failed")
  }
  return Object.freeze({
    input_manifest_sha256: inputManifestSha256,
    checkpoint_sha256: checkpointSha256,
    manifest_sha256: manifestSha256,
    output_manifest_sha256: outputManifestSha256,
    output_diff_sha256: outputDiffSha256,
    file_count: files.length,
    total_bytes: totalBytes,
  })
}

function validCheckpointPath(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    validateWorkspacePath(value)
    return true
  } catch {
    return false
  }
}

function comparePathBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function assertNormalizedBundle(value: StoredBundle): void {
  if (!SAFE_ID.test(value.dispatch_id) || !/^\d+$/u.test(value.journal_lease_epoch) ||
    BigInt(value.journal_lease_epoch) < 1n || !Number.isSafeInteger(value.file_count) || value.file_count < 0 ||
    value.file_count > MAX_CHECKPOINT_FILES || !Number.isSafeInteger(value.total_bytes) || value.total_bytes < 0 ||
    value.total_bytes > MAX_CHECKPOINT_BYTES || typeof value.checkpoint_bytes_base64 !== "string" ||
    !BASE64.test(value.checkpoint_bytes_base64)) throw adapterError("integrity_failed")
  const bytes = Buffer.from(value.checkpoint_bytes_base64, "base64")
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_CHECKPOINT_BYTES ||
    directDigest(bytes) !== value.checkpoint_bytes_sha256 || !isDigest(value.input_sha256)) {
    throw adapterError("integrity_failed")
  }
  const checkpoint = parseCheckpointBundle(bytes)
  if (checkpoint.input_manifest_sha256 !== value.input_manifest_sha256 ||
    checkpoint.checkpoint_sha256 !== value.checkpoint_sha256 ||
    checkpoint.manifest_sha256 !== value.checkpoint_manifest_sha256 ||
    checkpoint.output_manifest_sha256 !== value.output_manifest_sha256 ||
    checkpoint.output_diff_sha256 !== value.output_diff_sha256 ||
    checkpoint.file_count !== value.file_count || checkpoint.total_bytes !== value.total_bytes) {
    throw adapterError("integrity_failed")
  }
  const digests = BUNDLE_KEYS.filter((key) => key.endsWith("_sha256"))
    .map((key) => value[key as keyof StoredBundle])
  if (!digests.every(isDigest)) throw adapterError("integrity_failed")
}

function inputDigest(value: NormalizedInput | StoredBundle): Digest {
  const normalized = stripBundleIdentity(value)
  return canonicalSha256({ schema_version: INPUT_SCHEMA, ...normalized })
}

function stripBundleIdentity(value: NormalizedInput | StoredBundle): NormalizedInput {
  return {
    dispatch_id: value.dispatch_id,
    request_sha256: value.request_sha256,
    input_manifest_sha256: value.input_manifest_sha256,
    effect_claim_sha256: value.effect_claim_sha256,
    dispatch_intent_anchor_sha256: value.dispatch_intent_anchor_sha256,
    journal_claim_fence_sha256: value.journal_claim_fence_sha256,
    journal_lease_epoch: value.journal_lease_epoch,
    provider_effect_ownership_nonce_sha256: value.provider_effect_ownership_nonce_sha256,
    provider_ownership_binding_sha256: value.provider_ownership_binding_sha256,
    authorization_consumption_receipt_sha256: value.authorization_consumption_receipt_sha256,
    provider_fingerprint_sha256: value.provider_fingerprint_sha256,
    broker_artifact_sha256: value.broker_artifact_sha256,
    broker_protocol_sha256: value.broker_protocol_sha256,
    authenticated_session_sha256: value.authenticated_session_sha256,
    execution_receipt_sha256: value.execution_receipt_sha256,
    workspace_readback_sha256: value.workspace_readback_sha256,
    output_manifest_sha256: value.output_manifest_sha256,
    output_diff_sha256: value.output_diff_sha256,
    checkpoint_sha256: value.checkpoint_sha256,
    checkpoint_manifest_sha256: value.checkpoint_manifest_sha256,
    file_count: value.file_count,
    total_bytes: value.total_bytes,
    checkpoint_bytes_sha256: value.checkpoint_bytes_sha256,
    checkpoint_bytes_base64: value.checkpoint_bytes_base64,
  }
}

function receiptFromBundle(
  bundle: StoredBundle,
  resultBundleSha256: Digest,
  resultSignatureSha256: Digest,
): Omit<CheckpointHandoffReceiptV1, "handoff_receipt_sha256"> {
  return {
    schema_version: "sandboxes.checkpoint-handoff-receipt/v1",
    dispatch_id: bundle.dispatch_id,
    request_sha256: bundle.request_sha256,
    input_manifest_sha256: bundle.input_manifest_sha256,
    effect_claim_sha256: bundle.effect_claim_sha256,
    dispatch_intent_anchor_sha256: bundle.dispatch_intent_anchor_sha256,
    authorization_consumption_receipt_sha256: bundle.authorization_consumption_receipt_sha256,
    journal_claim_fence_sha256: bundle.journal_claim_fence_sha256,
    journal_lease_epoch: bundle.journal_lease_epoch,
    provider_effect_ownership_nonce_sha256: bundle.provider_effect_ownership_nonce_sha256,
    provider_ownership_binding_sha256: bundle.provider_ownership_binding_sha256,
    checkpoint_sha256: bundle.checkpoint_sha256,
    checkpoint_readback_sha256: bundle.checkpoint_sha256,
    checkpoint_manifest_sha256: bundle.checkpoint_manifest_sha256,
    file_count: bundle.file_count,
    total_bytes: bundle.total_bytes,
    result_bundle_sha256: resultBundleSha256,
    result_signature_sha256: resultSignatureSha256,
    provider_fingerprint_sha256: bundle.provider_fingerprint_sha256,
    broker_artifact_sha256: bundle.broker_artifact_sha256,
    broker_protocol_sha256: bundle.broker_protocol_sha256,
    authenticated_session_sha256: bundle.authenticated_session_sha256,
    execution_receipt_sha256: bundle.execution_receipt_sha256,
    workspace_readback_sha256: bundle.workspace_readback_sha256,
    output_manifest_sha256: bundle.output_manifest_sha256,
    output_diff_sha256: bundle.output_diff_sha256,
  }
}

function assertSigningPair(
  signer: CheckpointHandoffReceiptSignerV1,
  verifier: CheckpointHandoffReceiptVerifierV1,
): void {
  for (const value of [signer, verifier]) {
    if (!isPlainOrClassObject(value) || !SAFE_ID.test(value.signer_principal) ||
      !SAFE_ID.test(value.signing_key_id) || !isDigest(value.verification_key_sha256)) {
      throw adapterError("validation_failed")
    }
  }
  if (signer.signer_principal !== verifier.signer_principal ||
    signer.signing_key_id !== verifier.signing_key_id ||
    signer.verification_key_sha256 !== verifier.verification_key_sha256 ||
    typeof signer.sign !== "function" || typeof verifier.verify !== "function") {
    throw adapterError("integrity_failed")
  }
}

async function prepareRoot(root: string): Promise<void> {
  if (!isAbsolute(root)) throw adapterError("validation_failed")
  await assertNoSymlinkComponents(dirname(root))
  await mkdir(root, { recursive: true, mode: 0o700 }).catch((error: unknown) => { throw safeFilesystemError(error) })
  await assertNoSymlinkComponents(root)
  const canonical = await realpath(root).catch((error: unknown) => { throw safeFilesystemError(error) })
  if (canonical !== root) throw adapterError("integrity_failed")
  await safeDirectoryStat(root)
}

async function assertNoSymlinkComponents(path: string): Promise<void> {
  const absolute = resolve(path)
  const root = parse(absolute).root
  const relative = absolute.slice(root.length)
  const segments = relative.split(sep).filter(Boolean)
  let current = root
  for (const segment of segments) {
    current = resolve(current, segment)
    const stat = await lstat(current).catch((error: unknown) => {
      if (isErrno(error, "ENOENT")) return null
      throw safeFilesystemError(error)
    })
    if (stat === null) return
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw adapterError("integrity_failed")
  }
}

async function safeDirectoryStat(path: string): Promise<Stats> {
  const handle = await open(
    path,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  ).catch((error: unknown) => { throw safeFilesystemError(error) })
  try {
    const stat = await handle.stat()
    if (!stat.isDirectory()) throw adapterError("integrity_failed")
    return stat
  } finally {
    await handle.close()
  }
}

function recordKey(dispatchId: string): string {
  if (!SAFE_ID.test(dispatchId)) throw adapterError("validation_failed")
  return canonicalSha256({ schema_version: DISPATCH_KEY_SCHEMA, dispatch_id: dispatchId }).slice("sha256:".length)
}

function digestFromHex(hex: string): Digest {
  if (!/^[a-f0-9]{64}$/u.test(hex)) throw adapterError("integrity_failed")
  return `sha256:${hex}`
}

function directDigest(bytes: Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function validBase64(value: unknown, exactBytes: number): value is string {
  if (typeof value !== "string" || !BASE64.test(value)) return false
  const decoded = Buffer.from(value, "base64")
  return decoded.byteLength === exactBytes && decoded.toString("base64") === value
}

function isPlainDataRecord(
  value: unknown,
  keys: readonly string[],
  allowOptional = false,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const actual = Reflect.ownKeys(value)
  if (actual.some((key) => typeof key !== "string" || !keys.includes(key))) return false
  if (!allowOptional && actual.length !== keys.length) return false
  for (const key of actual) {
    if (typeof key !== "string") return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !("value" in descriptor)) return false
  }
  return true
}

function isPlainOrClassObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function safeCanonicalEqual(left: unknown, right: unknown): boolean {
  const a = Buffer.from(canonicalJson(left))
  const b = Buffer.from(canonicalJson(right))
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

function safeFilesystemError(_error: unknown): Error {
  return adapterError("integrity_failed")
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code
}

function parseOwnedTempName(value: string): {
  key: string
  pid: number
  processStartTicks: string
} | null {
  const match = /^([a-f0-9]{64})\.([1-9][0-9]*)\.([1-9][0-9]*)\.[a-f0-9]{32}\.tmp$/u.exec(value)
  if (match === null) return null
  const pid = Number(match[2])
  if (!Number.isSafeInteger(pid) || pid < 1) return null
  return { key: match[1]!, pid, processStartTicks: match[3]! }
}

async function readProcessStartTicks(pid: number): Promise<string | null> {
  let text: string
  try {
    text = await readFile(`/proc/${pid}/stat`, "utf8")
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null
    throw safeFilesystemError(error)
  }
  const close = text.lastIndexOf(")")
  const fields = close < 0 ? [] : text.slice(close + 2).trim().split(/\s+/u)
  const startTicks = fields[19]
  if (startTicks === undefined || !/^[1-9][0-9]*$/u.test(startTicks)) throw adapterError("integrity_failed")
  return startTicks
}

async function processOwnerIsAlive(pid: number, expectedStartTicks: string): Promise<boolean> {
  const target = await readProcessStartTicks(pid)
  if (target !== null) return target === expectedStartTicks
  if (await readProcessStartTicks(process.pid) === null) {
    throw adapterError("dependency_unavailable", { retryable: true })
  }
  return false
}
