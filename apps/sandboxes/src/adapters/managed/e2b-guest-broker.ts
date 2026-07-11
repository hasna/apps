import { createHash, createHmac, timingSafeEqual } from "node:crypto"

export type E2bGuestBrokerDigestV1 = `sha256:${string}`

export const E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1 =
  "/opt/hasna/bin/sandboxes-broker-v1" as const

/** Updated only after byte-for-byte review of scripts/e2b-guest-broker-v1.py. */
export const E2B_GUEST_BROKER_ARTIFACT_SHA256_V1 =
  "sha256:0726f74c5cdad2158b7e626b81c94d74c2d80ec764bf7dabb98dcedfc59fe041" as E2bGuestBrokerDigestV1
export const E2B_GUEST_BROKER_ARTIFACT_SIZE_V1 = 64_951

export const E2B_GUEST_BROKER_MAX_FRAME_BYTES_V1 = 1024 * 1024
export const E2B_GUEST_BROKER_PRODUCTION_ADMISSION_V1 = false as const
export const E2B_GUEST_BROKER_KEY_INIT_BYTES_V1 = 72

const KEY_INIT_MAGIC = new TextEncoder().encode("E2BGBK1\0")

export const E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_V1 =
  "import hashlib,os,stat,sys;p=sys.argv[1];e=sys.argv[2];fl=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC;q=[os.open('/',fl)];[(q.append(os.open(c,fl,dir_fd=q[-1]))) for c in ('opt','hasna','bin')];ok=p=='/opt/hasna/bin/sandboxes-broker-v1' and all(os.fstat(x).st_uid==0 and os.fstat(x).st_gid==0 and stat.S_IMODE(os.fstat(x).st_mode)&0o022==0 for x in q);ok or sys.exit(70);f=os.open('sandboxes-broker-v1',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=q[-1]);s=os.fstat(f);ok=stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o500 and s.st_nlink==1 and 0<s.st_size<=262144;ok or sys.exit(70);d=b''.join(iter(lambda:os.read(f,65536),b''));t=os.fstat(f);ok=len(d)==s.st_size and (t.st_dev,t.st_ino,t.st_size,t.st_mode,t.st_uid,t.st_gid,t.st_mtime_ns,t.st_ctime_ns)==(s.st_dev,s.st_ino,s.st_size,s.st_mode,s.st_uid,s.st_gid,s.st_mtime_ns,s.st_ctime_ns) and 'sha256:'+hashlib.sha256(d).hexdigest()==e;ok or sys.exit(70);r=os.open('run',fl,dir_fd=q[0]);u=os.fstat(r);(u.st_uid==0 and u.st_gid==0 and stat.S_IMODE(u.st_mode)&0o022==0) or sys.exit(70);m=os.open('sandboxes-broker-v1.used',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=r);os.fchmod(m,0o600);v=os.fstat(m);(stat.S_ISREG(v.st_mode) and v.st_uid==0 and v.st_gid==0 and stat.S_IMODE(v.st_mode)==0o600 and v.st_nlink==1) or sys.exit(70);os.write(m,e.encode());os.fsync(m);os.lseek(f,0,0);os.set_inheritable(f,True);os.execve('/proc/self/fd/%d'%f,[p,'--stdio','--executed-fd',str(f),'--expected-artifact-sha256',e],{'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8'})" as const

export const E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_SHA256_V1 = digestBytes(
  new TextEncoder().encode(E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_V1),
)

function shellQuoteFixed(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

const PROTOCOL_DESCRIPTION =
  `sandboxes.e2b-guest-broker/v1|bootstrap=python3-I-c-verified-fd;launcher=${E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_SHA256_V1};path=/opt/hasna/bin/sandboxes-broker-v1|init=E2BGBK1\\0+session32+key32|frame=canonical-rfc8259-sorted-utf8-lf;max=1048576;hmac=sha256;strict-sequence-session-nonce;closed-fields|ops=exec,file_stat,file_read,file_write,file_list,checkpoint;exec_limit=1;cancel=false;resume=false|exec=absolute-argv,no-shell,fixed-env,no-new-privs,uid-drop,wall+idle+combined-output+pids-rlimit;abnormal=sticky-destroy-required|paths=relative,max4096,maxdepth64,no-empty-dot-dotdot-git,no-follow|write=broker-serialized,atomic-temp-commit,if-absent-hardlink,expected-prior-digest|checkpoint=post-clean-exec,utf8-byte-order,double-pass-quiescence,maxfiles10000,maxbytes524288,maxduration60000,blobs+manifest,provider-snapshot-false|process=exact-startup-pre-post-baseline,subreaper,leftover-destroy-required|errors=authenticated,replay-safe,protocol-ambiguity-destroy-required|production-admission=false`

export const E2B_GUEST_BROKER_PROTOCOL_SHA256_V1 = digestBytes(
  new TextEncoder().encode(PROTOCOL_DESCRIPTION),
)

export type E2bGuestBrokerOperationV1 =
  | "exec"
  | "file_stat"
  | "file_read"
  | "file_write"
  | "file_list"
  | "checkpoint"

export interface E2bGuestBrokerRequestInputV1 {
  session_binding_sha256: E2bGuestBrokerDigestV1
  request_id: string
  sequence: number
  nonce_sha256: E2bGuestBrokerDigestV1
  operation: E2bGuestBrokerOperationV1
  payload: Record<string, unknown>
}

export interface E2bGuestBrokerRequestFrameV1 extends E2bGuestBrokerRequestInputV1 {
  schema_version: "sandboxes.e2b-guest-broker-request/v1"
  protocol_sha256: E2bGuestBrokerDigestV1
  mac_sha256: E2bGuestBrokerDigestV1
}

export interface E2bGuestBrokerErrorV1 {
  code: string
  message: string
}

export interface E2bGuestBrokerResponseFrameV1 {
  schema_version: "sandboxes.e2b-guest-broker-response/v1"
  protocol_sha256: E2bGuestBrokerDigestV1
  session_binding_sha256: E2bGuestBrokerDigestV1
  request_id: string
  sequence: number
  nonce_sha256: E2bGuestBrokerDigestV1
  operation: E2bGuestBrokerOperationV1 | "protocol_error" | "startup"
  ok: boolean
  result?: Record<string, unknown>
  error?: E2bGuestBrokerErrorV1
  mac_sha256: E2bGuestBrokerDigestV1
}

export interface E2bGuestBrokerExpectedResponseV1 {
  session_binding_sha256: E2bGuestBrokerDigestV1
  request_id: string
  sequence: number
  nonce_sha256: E2bGuestBrokerDigestV1
  operation: E2bGuestBrokerOperationV1
}

export interface E2bGuestBrokerStartupExpectationV1 {
  session_binding_sha256: E2bGuestBrokerDigestV1
  artifact_sha256: E2bGuestBrokerDigestV1
  path: string
  uid: number
  gid: number
  mode: number
  size: number
  verified_fd: boolean
}

/** Raw-line port: implementations must not parse, wrap, or re-encode either side. */
export interface E2bGuestBrokerAuthenticatedLineExchangePortV1 {
  exchangeAuthenticatedLine(
    requestLine: Uint8Array,
    expected: E2bGuestBrokerExpectedResponseV1,
    signal?: AbortSignal,
  ): Promise<Uint8Array>
}

const DIGEST = /^sha256:[0-9a-f]{64}$/u
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const UNPAIRED_SURROGATE = /[\ud800-\udfff]/u
const RESPONSE_SUCCESS_KEYS = [
  "mac_sha256",
  "nonce_sha256",
  "ok",
  "operation",
  "protocol_sha256",
  "request_id",
  "result",
  "schema_version",
  "sequence",
  "session_binding_sha256",
] as const
const RESPONSE_ERROR_KEYS = [
  "error",
  "mac_sha256",
  "nonce_sha256",
  "ok",
  "operation",
  "protocol_sha256",
  "request_id",
  "schema_version",
  "sequence",
  "session_binding_sha256",
] as const
const OPERATIONS = new Set<E2bGuestBrokerOperationV1>([
  "exec",
  "file_stat",
  "file_read",
  "file_write",
  "file_list",
  "checkpoint",
])

function fail(code: string): never {
  throw new TypeError(code)
}

function digestBytes(bytes: Uint8Array): E2bGuestBrokerDigestV1 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function isDigest(value: unknown): value is E2bGuestBrokerDigestV1 {
  return typeof value === "string" && DIGEST.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

function stringBytes(value: unknown, maximum: number): value is string {
  return typeof value === "string" && !UNPAIRED_SURROGATE.test(value) &&
    new TextEncoder().encode(value).byteLength <= maximum
}

function pathString(value: unknown): value is string {
  return stringBytes(value, 4_096) && value.length > 0 && !value.includes("\0")
}

function workspacePath(value: unknown, allowRoot: boolean): value is string {
  if (!pathString(value) || value.startsWith("/")) return false
  if (value === ".") return allowRoot
  const segments = value.split("/")
  return segments.length <= 64 && segments.every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".." && segment !== ".git")
}

function base64(value: unknown, maximumBytes: number): value is string {
  if (typeof value !== "string" || value.length > Math.ceil(maximumBytes / 3) * 4 || !BASE64.test(value)) {
    return false
  }
  return Buffer.from(value, "base64").byteLength <= maximumBytes
}

function utf8PathBefore(left: string, right: string): boolean {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")) < 0
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail("non_canonical_value")
    return value
  }
  if (typeof value === "string") {
    if (UNPAIRED_SURROGATE.test(value)) fail("non_canonical_value")
    return value
  }
  if (Array.isArray(value)) {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length")
    const keys = Reflect.ownKeys(value)
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
      keys.length !== lengthDescriptor.value + 1) fail("non_canonical_value")
    const output: unknown[] = []
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        fail("non_canonical_value")
      }
      output.push(canonicalValue(descriptor.value))
    }
    return output
  }
  if (!isRecord(value)) fail("non_canonical_value")
  const output: Record<string, unknown> = Object.create(null)
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== "string")) fail("non_canonical_value")
  for (const key of (keys as string[]).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      fail("non_canonical_value")
    }
    output[key] = canonicalValue(descriptor.value)
  }
  return output
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

function mac(frameWithoutMac: Record<string, unknown>, key: Uint8Array): E2bGuestBrokerDigestV1 {
  if (key.byteLength !== 32) fail("invalid_mac_key")
  return `sha256:${createHmac("sha256", key).update(canonicalJson(frameWithoutMac), "utf8").digest("hex")}`
}

function equalDigest(left: string, right: string): boolean {
  if (!isDigest(left) || !isDigest(right)) return false
  return timingSafeEqual(Buffer.from(left.slice(7), "hex"), Buffer.from(right.slice(7), "hex"))
}

function validatePathOnly(payload: Record<string, unknown>): boolean {
  return exactKeys(payload, ["path"]) && workspacePath(payload.path, true)
}

function validatePayload(operation: E2bGuestBrokerOperationV1, payload: unknown): payload is Record<string, unknown> {
  if (!isRecord(payload)) return false
  switch (operation) {
    case "exec": {
      if (!exactKeys(payload, ["argv", "cwd", "exec_id", "idle_timeout_ms", "output_limit_bytes", "pids_limit", "wall_timeout_ms"])) return false
      if (!ID.test(String(payload.exec_id)) || !workspacePath(payload.cwd, true) ||
        !integer(payload.wall_timeout_ms, 1, 3_600_000) ||
        !integer(payload.idle_timeout_ms, 1, 3_600_000) ||
        !integer(payload.output_limit_bytes, 1, 512 * 1024) ||
        !integer(payload.pids_limit, 1, 256) || !Array.isArray(payload.argv) ||
        payload.argv.length < 1 || payload.argv.length > 256) return false
      let argumentBytes = 0
      for (const argument of payload.argv) {
        if (!stringBytes(argument, 16_384) || argument.includes("\0")) return false
        argumentBytes += new TextEncoder().encode(argument).byteLength
      }
      const executable = payload.argv[0]
      return typeof executable === "string" && executable.startsWith("/") && argumentBytes <= 65_536
    }
    case "file_stat":
      return validatePathOnly(payload)
    case "file_read":
      return exactKeys(payload, ["length", "max_bytes", "offset", "path"]) && workspacePath(payload.path, false) &&
        integer(payload.offset, 0, 1_073_741_824) && integer(payload.length, 0, 512 * 1024) &&
        integer(payload.max_bytes, 0, 512 * 1024) && payload.length <= payload.max_bytes
    case "file_write":
      return ((exactKeys(payload, ["content_base64", "if_absent", "max_bytes", "mode", "path"]) && payload.if_absent === true) ||
        (exactKeys(payload, ["content_base64", "expected_prior_sha256", "max_bytes", "mode", "path"]) && isDigest(payload.expected_prior_sha256))) &&
        workspacePath(payload.path, false) && integer(payload.max_bytes, 0, 512 * 1024) && base64(payload.content_base64, payload.max_bytes) &&
        integer(payload.mode, 0, 0o777) && [0o600, 0o644, 0o700, 0o755].includes(payload.mode)
    case "file_list":
      return exactKeys(payload, ["depth", "limit", "path"]) && workspacePath(payload.path, true) &&
        integer(payload.depth, 0, 64) && integer(payload.limit, 1, 10_000)
    case "checkpoint":
      return exactKeys(payload, ["max_depth", "max_duration_ms", "max_file_bytes", "max_files", "max_total_bytes"]) &&
        integer(payload.max_depth, 0, 64) && integer(payload.max_duration_ms, 1, 60_000) &&
        integer(payload.max_file_bytes, 0, 512 * 1024) && integer(payload.max_files, 1, 10_000) &&
        integer(payload.max_total_bytes, 0, 512 * 1024)
  }
}

function validateError(value: unknown): value is E2bGuestBrokerErrorV1 {
  return isRecord(value) && exactKeys(value, ["code", "message"]) &&
    stringBytes(value.code, 64) && value.code.length > 0 && stringBytes(value.message, 256)
}

function validateResult(operation: E2bGuestBrokerOperationV1 | "protocol_error" | "startup", value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || operation === "protocol_error") return false
  switch (operation) {
    case "startup":
      return exactKeys(value, ["artifact_sha256", "checkpoint_eligible", "destroy_required", "device", "exec_cancel", "exec_limit", "gid", "inode", "mode", "path", "process_baseline_sha256", "production_admission", "resume", "size", "uid", "unexpected_process_count", "verified_fd"]) &&
        isDigest(value.artifact_sha256) && value.checkpoint_eligible === false && value.exec_cancel === false && value.exec_limit === 1 &&
        integer(value.device, 0, Number.MAX_SAFE_INTEGER) && integer(value.inode, 1, Number.MAX_SAFE_INTEGER) &&
        integer(value.gid, 0, 0xffff_ffff) && integer(value.uid, 0, 0xffff_ffff) && integer(value.mode, 0, 0o777) &&
        pathString(value.path) && isDigest(value.process_baseline_sha256) && value.production_admission === false && value.resume === false &&
        value.destroy_required === false && integer(value.size, 1, 262_144) && value.unexpected_process_count === 0 &&
        typeof value.verified_fd === "boolean"
    case "exec":
      if (!exactKeys(value, ["checkpoint_eligible", "destroy_required", "duration_ms", "exit_code", "output_truncated", "process_baseline_sha256", "process_quiescence_sha256", "status", "stderr_base64", "stdout_base64", "unexpected_process_count"]) ||
        !integer(value.duration_ms, 0, 3_600_000) ||
        !(value.exit_code === null || integer(value.exit_code, -255, 255)) ||
        typeof value.output_truncated !== "boolean" ||
        !["exited", "wall_timeout", "idle_timeout", "output_limit", "spawn_failed"].includes(String(value.status)) ||
        !isDigest(value.process_baseline_sha256) || value.process_quiescence_sha256 !== value.process_baseline_sha256 ||
        value.unexpected_process_count !== 0 || typeof value.destroy_required !== "boolean" ||
        typeof value.checkpoint_eligible !== "boolean" ||
        !base64(value.stdout_base64, 512 * 1024) || !base64(value.stderr_base64, 512 * 1024)) return false
      if (Buffer.from(value.stdout_base64, "base64").byteLength +
        Buffer.from(value.stderr_base64, "base64").byteLength > 512 * 1024) return false
      return value.status === "exited" && value.exit_code === 0 && value.output_truncated === false
        ? value.destroy_required === false && value.checkpoint_eligible === true
        : value.destroy_required === true && value.checkpoint_eligible === false
    case "file_stat":
      return exactKeys(value, ["mode", "path", "sha256", "size", "type"]) && pathString(value.path) &&
        integer(value.mode, 0, 0o777) && isDigest(value.sha256) && integer(value.size, 0, 512 * 1024) &&
        (value.type === "file" || value.type === "directory")
    case "file_read":
      if (!(exactKeys(value, ["content_base64", "offset", "path", "sha256", "size", "total_size"]) &&
        pathString(value.path) && integer(value.offset, 0, 1_073_741_824) && integer(value.size, 0, 512 * 1024) &&
        integer(value.total_size, 0, 1_073_741_824) && isDigest(value.sha256) && base64(value.content_base64, value.size) &&
        Buffer.from(value.content_base64, "base64").byteLength === value.size)) return false
      return value.offset !== 0 || value.size !== value.total_size ||
        digestBytes(Buffer.from(value.content_base64, "base64")) === value.sha256
    case "file_write":
      return exactKeys(value, ["mode", "path", "sha256", "size"]) && pathString(value.path) &&
        integer(value.mode, 0, 0o777) && isDigest(value.sha256) && integer(value.size, 0, 512 * 1024)
    case "file_list":
      if (!exactKeys(value, ["entries"]) || !Array.isArray(value.entries) || value.entries.length > 10_000) return false
      return value.entries.every((entry, index) => isRecord(entry) && exactKeys(entry, ["mode", "path", "size", "type"]) &&
        pathString(entry.path) && integer(entry.mode, 0, 0o777) && integer(entry.size, 0, 1_073_741_824) &&
        (entry.type === "file" || entry.type === "directory") &&
        (index === 0 || utf8PathBefore(String((value.entries as Array<Record<string, unknown>>)[index - 1]?.path), entry.path)))
    case "checkpoint":
      if (!exactKeys(value, ["checkpoint_sha256", "file_count", "files", "manifest", "manifest_sha256", "process_baseline_sha256", "process_quiescence_sha256", "provider_snapshot_is_canonical", "total_bytes", "unexpected_process_count"]) ||
        !isDigest(value.checkpoint_sha256) || !isDigest(value.manifest_sha256) || value.provider_snapshot_is_canonical !== false ||
        !isDigest(value.process_baseline_sha256) || value.process_quiescence_sha256 !== value.process_baseline_sha256 || value.unexpected_process_count !== 0 ||
        !integer(value.file_count, 0, 10_000) || !integer(value.total_bytes, 0, 512 * 1024) ||
        !Array.isArray(value.files) || !Array.isArray(value.manifest) || value.files.length !== value.file_count ||
        value.manifest.length !== value.file_count) return false
      let total = 0
      for (let index = 0; index < value.files.length; index += 1) {
        const file = value.files[index]
        const entry = value.manifest[index]
        if (!isRecord(file) || !exactKeys(file, ["content_base64", "path", "sha256", "size"]) ||
          !pathString(file.path) || !isDigest(file.sha256) || !integer(file.size, 0, 512 * 1024) ||
          !base64(file.content_base64, file.size) || Buffer.from(file.content_base64, "base64").byteLength !== file.size ||
          digestBytes(Buffer.from(file.content_base64, "base64")) !== file.sha256 ||
          !isRecord(entry) || !exactKeys(entry, ["mode", "path", "sha256", "size"]) ||
          entry.path !== file.path || entry.sha256 !== file.sha256 || entry.size !== file.size ||
          !integer(entry.mode, 0, 0o777) ||
          (index > 0 && !utf8PathBefore(String((value.files[index - 1] as Record<string, unknown>).path), file.path))) return false
        total += file.size
      }
      if (total !== value.total_bytes) return false
      const manifestSha256 = digestBytes(new TextEncoder().encode(canonicalJson(value.manifest)))
      if (manifestSha256 !== value.manifest_sha256) return false
      const fileBasis = value.files.map((file) => {
        const item = file as Record<string, unknown>
        return { path: item.path, sha256: item.sha256, size: item.size }
      })
      return value.checkpoint_sha256 === digestBytes(new TextEncoder().encode(canonicalJson({
        files: fileBasis,
        manifest_sha256: manifestSha256,
      })))
  }
}

export function e2bGuestBrokerBootstrapArgvV1(
): readonly string[] {
  return Object.freeze([
    "/usr/bin/python3",
    "-I",
    "-c",
    E2B_GUEST_BROKER_VERIFIED_FD_LAUNCHER_V1,
    E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
    E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  ])
}

export function e2bGuestBrokerBootstrapCommandV1(): string {
  if (!isDigest(E2B_GUEST_BROKER_ARTIFACT_SHA256_V1)) fail("artifact_not_pinned")
  return e2bGuestBrokerBootstrapArgvV1().map(shellQuoteFixed).join(" ")
}

/**
 * The live E2B transport writes this fixed-size secret initialization record
 * exactly once before any LF-delimited request. It must never be logged,
 * persisted, placed in argv/environment, or replayed.
 */
export function encodeE2bGuestBrokerSessionKeyInitV1(
  sessionBindingSha256: E2bGuestBrokerDigestV1,
  macKey: Uint8Array,
): Uint8Array {
  if (!isDigest(sessionBindingSha256) || macKey.byteLength !== 32) fail("invalid_key_init")
  const result = new Uint8Array(E2B_GUEST_BROKER_KEY_INIT_BYTES_V1)
  result.set(KEY_INIT_MAGIC, 0)
  result.set(Buffer.from(sessionBindingSha256.slice(7), "hex"), KEY_INIT_MAGIC.byteLength)
  result.set(macKey, KEY_INIT_MAGIC.byteLength + 32)
  return result
}

export function verifyE2bGuestBrokerArtifactV1(bytes: Uint8Array): boolean {
  return equalDigest(digestBytes(bytes), E2B_GUEST_BROKER_ARTIFACT_SHA256_V1)
}

export function encodeE2bGuestBrokerRequestLineV1(
  input: E2bGuestBrokerRequestInputV1,
  macKey: Uint8Array,
): Uint8Array {
  const snapshot = canonicalValue(input)
  if (!isRecord(snapshot) || !exactKeys(snapshot, ["nonce_sha256", "operation", "payload", "request_id", "sequence", "session_binding_sha256"]) ||
    !isDigest(snapshot.session_binding_sha256) || !isDigest(snapshot.nonce_sha256) || !ID.test(String(snapshot.request_id)) ||
    !integer(snapshot.sequence, 0, Number.MAX_SAFE_INTEGER) || !OPERATIONS.has(snapshot.operation as E2bGuestBrokerOperationV1) ||
    !validatePayload(snapshot.operation as E2bGuestBrokerOperationV1, snapshot.payload)) fail("invalid_payload")
  const basis: Record<string, unknown> = {
    nonce_sha256: snapshot.nonce_sha256,
    operation: snapshot.operation,
    payload: snapshot.payload,
    protocol_sha256: E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
    request_id: snapshot.request_id,
    schema_version: "sandboxes.e2b-guest-broker-request/v1",
    sequence: snapshot.sequence,
    session_binding_sha256: snapshot.session_binding_sha256,
  }
  const frame = { ...basis, mac_sha256: mac(basis, macKey) }
  const encoded = new TextEncoder().encode(`${canonicalJson(frame)}\n`)
  if (encoded.byteLength > E2B_GUEST_BROKER_MAX_FRAME_BYTES_V1) fail("frame_too_large")
  return encoded
}

function decodeAuthenticatedResponseLineV1(
  line: Uint8Array,
  macKey: Uint8Array,
): E2bGuestBrokerResponseFrameV1 {
  if (line.byteLength < 2 || line.byteLength > E2B_GUEST_BROKER_MAX_FRAME_BYTES_V1 ||
    line[line.byteLength - 1] !== 0x0a || line.subarray(0, line.byteLength - 1).includes(0x0a) ||
    line.subarray(0, line.byteLength - 1).includes(0x0d)) fail("invalid_framing")
  let text: string
  let parsed: unknown
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(line.subarray(0, line.byteLength - 1))
    parsed = JSON.parse(text)
  } catch {
    return fail("invalid_encoding")
  }
  if (!isRecord(parsed) || canonicalJson(parsed) !== text ||
    !(exactKeys(parsed, RESPONSE_SUCCESS_KEYS) || exactKeys(parsed, RESPONSE_ERROR_KEYS))) fail("invalid_response")
  const operation = parsed.operation
  if (parsed.schema_version !== "sandboxes.e2b-guest-broker-response/v1" ||
    parsed.protocol_sha256 !== E2B_GUEST_BROKER_PROTOCOL_SHA256_V1 || !isDigest(parsed.session_binding_sha256) ||
    !ID.test(String(parsed.request_id)) || !integer(parsed.sequence, 0, Number.MAX_SAFE_INTEGER) || !isDigest(parsed.nonce_sha256) ||
    !(operation === "protocol_error" || operation === "startup" || OPERATIONS.has(operation as E2bGuestBrokerOperationV1)) ||
    typeof parsed.ok !== "boolean" || !isDigest(parsed.mac_sha256)) fail("invalid_response")
  if (parsed.ok) {
    if (!exactKeys(parsed, RESPONSE_SUCCESS_KEYS) || !validateResult(operation as E2bGuestBrokerOperationV1, parsed.result)) fail("invalid_response")
  } else if (!exactKeys(parsed, RESPONSE_ERROR_KEYS) || !validateError(parsed.error)) {
    fail("invalid_response")
  }
  const { mac_sha256: receivedMac, ...basis } = parsed
  if (!equalDigest(receivedMac as string, mac(basis, macKey))) fail("authentication_failed")
  return parsed as unknown as E2bGuestBrokerResponseFrameV1
}

export function decodeE2bGuestBrokerResponseLineV1(
  line: Uint8Array,
  expected: E2bGuestBrokerExpectedResponseV1,
  macKey: Uint8Array,
): E2bGuestBrokerResponseFrameV1 {
  const parsed = decodeAuthenticatedResponseLineV1(line, macKey)
  if (parsed.session_binding_sha256 !== expected.session_binding_sha256 || parsed.request_id !== expected.request_id ||
    parsed.sequence !== expected.sequence || parsed.nonce_sha256 !== expected.nonce_sha256 ||
    parsed.operation !== expected.operation) fail("response_binding_mismatch")
  return parsed as unknown as E2bGuestBrokerResponseFrameV1
}

export function decodeE2bGuestBrokerProtocolErrorLineV1(
  line: Uint8Array,
  sessionBindingSha256: E2bGuestBrokerDigestV1,
  macKey: Uint8Array,
): E2bGuestBrokerResponseFrameV1 {
  const parsed = decodeAuthenticatedResponseLineV1(line, macKey)
  if (parsed.operation !== "protocol_error" || parsed.ok !== false ||
    parsed.session_binding_sha256 !== sessionBindingSha256 || !parsed.request_id.startsWith("protocol-error-")) {
    fail("response_binding_mismatch")
  }
  return parsed
}

export function decodeE2bGuestBrokerStartupLineV1(
  line: Uint8Array,
  expected: E2bGuestBrokerStartupExpectationV1,
  macKey: Uint8Array,
): E2bGuestBrokerResponseFrameV1 {
  const parsed = decodeAuthenticatedResponseLineV1(line, macKey)
  const result = parsed.result
  const startupNonce = digestBytes(new TextEncoder().encode(`startup:${expected.session_binding_sha256}`))
  if (parsed.operation !== "startup" || parsed.ok !== true || parsed.request_id !== "startup" || parsed.sequence !== 0 ||
    parsed.nonce_sha256 !== startupNonce || parsed.session_binding_sha256 !== expected.session_binding_sha256 || !isRecord(result) ||
    result.artifact_sha256 !== expected.artifact_sha256 || result.path !== expected.path || result.uid !== expected.uid ||
    result.gid !== expected.gid || result.mode !== expected.mode || result.size !== expected.size ||
    result.verified_fd !== expected.verified_fd) {
    fail("startup_attestation_mismatch")
  }
  return parsed
}

export async function exchangeE2bGuestBrokerRequestV1(
  transport: E2bGuestBrokerAuthenticatedLineExchangePortV1,
  input: E2bGuestBrokerRequestInputV1,
  macKey: Uint8Array,
  signal?: AbortSignal,
): Promise<E2bGuestBrokerResponseFrameV1> {
  const expected: E2bGuestBrokerExpectedResponseV1 = {
    session_binding_sha256: input.session_binding_sha256,
    request_id: input.request_id,
    sequence: input.sequence,
    nonce_sha256: input.nonce_sha256,
    operation: input.operation,
  }
  const requestLine = encodeE2bGuestBrokerRequestLineV1(input, macKey)
  const responseLine = await transport.exchangeAuthenticatedLine(requestLine, expected, signal)
  return decodeE2bGuestBrokerResponseLineV1(responseLine, expected, macKey)
}
