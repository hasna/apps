import { spawn, type ChildProcess } from 'node:child_process';
import { fstatSync, readlinkSync, readSync, writeSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import {
  KNOWLEDGE_GUARDED_WRITE_CONTRACT,
  canonicalKnowledgeGuardedJson,
  createKnowledgePrivateInputDescriptor,
  createKnowledgePrivateQueryDescriptor,
  inspectKnowledgePrivateResult,
  knowledgeGuardedDigest,
  materializeKnowledgePrivateInput,
  materializeKnowledgePrivateQuery,
  type KnowledgeGuardedBinding,
  type KnowledgeGuardedManifestBinding,
  type KnowledgeGuardedPayload,
  type KnowledgeGuardedPrecondition,
  type KnowledgePrivateInputDescriptor,
  type KnowledgePrivateQueryArchive,
  type KnowledgePrivateQueryDescriptor,
  type KnowledgePrivateQuerySelector,
  type KnowledgePrivateResultProof,
} from './guarded-write-contract.js';
import { createKnowledgeGuardedWriter } from './guarded-writer.js';

export const KNOWLEDGE_GUARDED_CLI_REQUEST_SCHEMA = 'knowledge.guarded-cli-request.v1' as const;
export const KNOWLEDGE_GUARDED_CLI_RESULT_SCHEMA = 'knowledge.guarded-cli-result.v1' as const;
const PRIVATE_FD_MAX_BYTES = 1_048_576;

type KnowledgeGuardedCliAction = 'write' | 'query' | 'readback';
type KnowledgeGuardedCliTransport = 'process_ipc' | 'anonymous_fd';

interface KnowledgeGuardedCliWriteFrame {
  schema: typeof KNOWLEDGE_GUARDED_CLI_REQUEST_SCHEMA;
  action: 'write';
  operation_id: string;
  step_id: string;
  verb: 'create' | 'update';
  target_id: string;
  precondition: KnowledgeGuardedPrecondition;
  binding: KnowledgeGuardedBinding;
  manifest: KnowledgeGuardedManifestBinding | null;
  payload: KnowledgeGuardedPayload;
  expires_at: string;
}

interface KnowledgeGuardedCliQueryFrame {
  schema: typeof KNOWLEDGE_GUARDED_CLI_REQUEST_SCHEMA;
  action: 'query' | 'readback';
  operation_id: string;
  step_id: string;
  binding: KnowledgeGuardedBinding;
  selector: KnowledgePrivateQuerySelector;
  archive: KnowledgePrivateQueryArchive;
  page: { limit: number; offset: number };
  expires_at: string;
}

type KnowledgeGuardedCliRequestFrame =
  | KnowledgeGuardedCliWriteFrame
  | KnowledgeGuardedCliQueryFrame;

export interface KnowledgeGuardedCliPrivateResult {
  schema: typeof KNOWLEDGE_GUARDED_CLI_RESULT_SCHEMA;
  ok: true;
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  action: KnowledgeGuardedCliAction;
  transport: KnowledgeGuardedCliTransport;
  request_digest: string;
  result_digest: string;
  proof: KnowledgePrivateResultProof;
}

interface KnowledgeGuardedCliPrivateFailure {
  schema: typeof KNOWLEDGE_GUARDED_CLI_RESULT_SCHEMA;
  ok: false;
  contract: typeof KNOWLEDGE_GUARDED_WRITE_CONTRACT;
  transport: KnowledgeGuardedCliTransport;
  code: string;
}

type KnowledgeGuardedCliWorkerResult =
  | KnowledgeGuardedCliPrivateResult
  | KnowledgeGuardedCliPrivateFailure;

export interface KnowledgeGuardedCliDescriptorOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class KnowledgeGuardedCliDescriptorError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'KnowledgeGuardedCliDescriptorError';
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new KnowledgeGuardedCliDescriptorError(`${label}_shape_invalid`);
  }
}

function privateFd(fd: number, label: string): void {
  if (!Number.isInteger(fd) || fd < 3) {
    throw new KnowledgeGuardedCliDescriptorError(`${label}_must_be_inherited_private_fd`);
  }
  let stats: ReturnType<typeof fstatSync>;
  try {
    stats = fstatSync(fd);
  } catch {
    throw new KnowledgeGuardedCliDescriptorError(`${label}_unavailable`);
  }
  if (!stats.isFIFO() && !stats.isSocket()) {
    throw new KnowledgeGuardedCliDescriptorError(`${label}_must_be_anonymous_pipe_or_socket`);
  }
  if (stats.isFIFO()) {
    if (process.platform !== 'linux') {
      throw new KnowledgeGuardedCliDescriptorError(`${label}_must_be_anonymous_pipe_or_socket`);
    }
    let target: string;
    try {
      target = readlinkSync(`/proc/self/fd/${fd}`);
    } catch {
      throw new KnowledgeGuardedCliDescriptorError(`${label}_must_be_anonymous_pipe_or_socket`);
    }
    if (!/^pipe:\[\d+\]$/.test(target)) {
      throw new KnowledgeGuardedCliDescriptorError(`${label}_must_be_anonymous_pipe_or_socket`);
    }
  }
}

function readBoundedPrivateFd(fd: number): string {
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, PRIVATE_FD_MAX_BYTES + 1 - total));
    const count = readSync(fd, chunk, 0, chunk.length, null);
    if (count === 0) break;
    total += count;
    if (total > PRIVATE_FD_MAX_BYTES) {
      throw new KnowledgeGuardedCliDescriptorError('private_request_byte_cap_exceeded');
    }
    chunks.push(chunk.subarray(0, count));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch {
    throw new KnowledgeGuardedCliDescriptorError('private_request_invalid_utf8');
  }
}

function writeBoundedPrivateFd(fd: number, value: unknown): void {
  const encoded = Buffer.from(`${canonicalKnowledgeGuardedJson(value)}\n`, 'utf8');
  if (encoded.byteLength > PRIVATE_FD_MAX_BYTES) {
    throw new KnowledgeGuardedCliDescriptorError('private_result_byte_cap_exceeded');
  }
  let offset = 0;
  while (offset < encoded.byteLength) {
    const written = writeSync(fd, encoded, offset, encoded.byteLength - offset);
    if (written < 1) {
      throw new KnowledgeGuardedCliDescriptorError('private_result_write_failed');
    }
    offset += written;
  }
}

function safeCode(error: unknown): string {
  if (error instanceof KnowledgeGuardedCliDescriptorError) return error.code;
  if (
    error
    && typeof error === 'object'
    && typeof (error as { code?: unknown }).code === 'string'
    && /^[a-z0-9_:-]+$/i.test((error as { code: string }).code)
  ) {
    return (error as { code: string }).code;
  }
  return 'guarded_private_cli_failed';
}

function parseFrame(raw: string): KnowledgeGuardedCliRequestFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new KnowledgeGuardedCliDescriptorError('private_request_invalid_json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new KnowledgeGuardedCliDescriptorError('private_request_shape_invalid');
  }
  const frame = parsed as Record<string, unknown>;
  if (frame.schema !== KNOWLEDGE_GUARDED_CLI_REQUEST_SCHEMA) {
    throw new KnowledgeGuardedCliDescriptorError('private_request_schema_invalid');
  }
  if (frame.action === 'write') {
    assertExactKeys(frame, [
      'schema',
      'action',
      'operation_id',
      'step_id',
      'verb',
      'target_id',
      'precondition',
      'binding',
      'manifest',
      'payload',
      'expires_at',
    ], 'private_write_request');
    return frame as unknown as KnowledgeGuardedCliWriteFrame;
  }
  if (frame.action === 'query' || frame.action === 'readback') {
    assertExactKeys(frame, [
      'schema',
      'action',
      'operation_id',
      'step_id',
      'binding',
      'selector',
      'archive',
      'page',
      'expires_at',
    ], 'private_query_request');
    return frame as unknown as KnowledgeGuardedCliQueryFrame;
  }
  throw new KnowledgeGuardedCliDescriptorError('private_request_action_invalid');
}

function remainingLifetime(expiresAt: string): number {
  const remaining = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining < 1) {
    throw new KnowledgeGuardedCliDescriptorError('private_descriptor_expired');
  }
  return Math.min(remaining, 60 * 60 * 1000);
}

async function executeFrame(
  frame: KnowledgeGuardedCliRequestFrame,
  env: NodeJS.ProcessEnv,
  transport: KnowledgeGuardedCliTransport,
): Promise<KnowledgeGuardedCliPrivateResult> {
  const writer = createKnowledgeGuardedWriter({ binding: frame.binding, env });
  let proof: KnowledgePrivateResultProof;
  if (frame.action === 'write') {
    const descriptor = createKnowledgePrivateInputDescriptor({
      operation_id: frame.operation_id,
      step_id: frame.step_id,
      verb: frame.verb,
      target_id: frame.target_id,
      precondition: frame.precondition,
      binding: frame.binding,
      ...(frame.manifest ? { manifest: frame.manifest } : {}),
      payload: frame.payload,
      expires_in_ms: remainingLifetime(frame.expires_at),
    });
    proof = inspectKnowledgePrivateResult(await writer.executePrivate(descriptor));
    const readback = inspectKnowledgePrivateResult(await writer.readbackPrivate(frame.target_id));
    if (canonicalKnowledgeGuardedJson(proof.items) !== canonicalKnowledgeGuardedJson(readback.items)) {
      throw new KnowledgeGuardedCliDescriptorError('private_write_exact_readback_mismatch');
    }
  } else {
    const descriptor = createKnowledgePrivateQueryDescriptor({
      operation_id: frame.operation_id,
      step_id: frame.step_id,
      binding: frame.binding,
      selector: frame.selector,
      archive: frame.archive,
      limit: frame.page.limit,
      offset: frame.page.offset,
      expires_in_ms: remainingLifetime(frame.expires_at),
    });
    if (frame.action === 'readback') {
      if (
        frame.selector.kind !== 'current_version'
        || frame.page.limit !== 1
        || frame.page.offset !== 0
      ) {
        throw new KnowledgeGuardedCliDescriptorError('private_readback_descriptor_invalid');
      }
      proof = inspectKnowledgePrivateResult(
        await writer.readbackPrivate(frame.selector.item_id),
      );
    } else {
      proof = inspectKnowledgePrivateResult(await writer.query(descriptor));
    }
  }
  const requestDigest = knowledgeGuardedDigest(frame);
  return Object.freeze({
    schema: KNOWLEDGE_GUARDED_CLI_RESULT_SCHEMA,
    ok: true,
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    action: frame.action,
    transport,
    request_digest: requestDigest,
    result_digest: knowledgeGuardedDigest(proof),
    proof,
  });
}

export async function runKnowledgeGuardedCliDescriptorWorker(
  requestFd: number,
  resultFd: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Omit<KnowledgeGuardedCliPrivateResult, 'proof'>> {
  privateFd(requestFd, 'request_fd');
  privateFd(resultFd, 'result_fd');
  if (requestFd === resultFd) {
    throw new KnowledgeGuardedCliDescriptorError('private_fds_must_be_distinct');
  }
  try {
    const result = await executeFrame(parseFrame(readBoundedPrivateFd(requestFd)), env, 'anonymous_fd');
    writeBoundedPrivateFd(resultFd, result);
    const { proof: _proof, ...safe } = result;
    return safe;
  } catch (error) {
    const failure: KnowledgeGuardedCliPrivateFailure = {
      schema: KNOWLEDGE_GUARDED_CLI_RESULT_SCHEMA,
      ok: false,
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      transport: 'anonymous_fd',
      code: safeCode(error),
    };
    try {
      writeBoundedPrivateFd(resultFd, failure);
    } catch {
      // The public error remains metadata-only even if the private result pipe
      // is unavailable.
    }
    throw new KnowledgeGuardedCliDescriptorError(failure.code);
  }
}

function readBoundedPrivateIpcMessage(): Promise<string> {
  if (typeof process.send !== 'function' || !process.connected) {
    throw new KnowledgeGuardedCliDescriptorError('guarded_descriptor_private_ipc_required');
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      process.off('message', onMessage);
      process.off('disconnect', onDisconnect);
    };
    const onMessage = (message: unknown) => {
      cleanup();
      if (typeof message !== 'string') {
        reject(new KnowledgeGuardedCliDescriptorError('private_request_schema_invalid'));
        return;
      }
      if (Buffer.byteLength(message, 'utf8') > PRIVATE_FD_MAX_BYTES) {
        reject(new KnowledgeGuardedCliDescriptorError('private_request_byte_cap_exceeded'));
        return;
      }
      resolve(message);
    };
    const onDisconnect = () => {
      cleanup();
      reject(new KnowledgeGuardedCliDescriptorError('guarded_descriptor_private_ipc_disconnected'));
    };
    process.once('message', onMessage);
    process.once('disconnect', onDisconnect);
  });
}

function writeBoundedPrivateIpcMessage(value: unknown): Promise<void> {
  if (typeof process.send !== 'function' || !process.connected) {
    throw new KnowledgeGuardedCliDescriptorError('guarded_descriptor_private_ipc_required');
  }
  const encoded = canonicalKnowledgeGuardedJson(value);
  if (Buffer.byteLength(encoded, 'utf8') > PRIVATE_FD_MAX_BYTES) {
    throw new KnowledgeGuardedCliDescriptorError('private_result_byte_cap_exceeded');
  }
  return new Promise((resolve, reject) => {
    process.send!(encoded, (error) => {
      if (error) {
        reject(new KnowledgeGuardedCliDescriptorError('private_result_write_failed'));
        return;
      }
      resolve();
    });
  });
}

export async function runKnowledgeGuardedCliIpcWorker(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Omit<KnowledgeGuardedCliPrivateResult, 'proof'>> {
  if (typeof process.send !== 'function' || !process.connected) {
    throw new KnowledgeGuardedCliDescriptorError('guarded_descriptor_private_ipc_required');
  }
  try {
    const result = await executeFrame(
      parseFrame(await readBoundedPrivateIpcMessage()),
      env,
      'process_ipc',
    );
    await writeBoundedPrivateIpcMessage(result);
    const { proof: _proof, ...safe } = result;
    return safe;
  } catch (error) {
    const failure: KnowledgeGuardedCliPrivateFailure = {
      schema: KNOWLEDGE_GUARDED_CLI_RESULT_SCHEMA,
      ok: false,
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      transport: 'process_ipc',
      code: safeCode(error),
    };
    try {
      await writeBoundedPrivateIpcMessage(failure);
    } catch {
      // The public error remains metadata-only even if the private IPC channel
      // has already closed.
    }
    throw new KnowledgeGuardedCliDescriptorError(failure.code);
  } finally {
    if (process.connected && typeof process.disconnect === 'function') {
      process.disconnect();
    }
  }
}

function writeFrame(descriptor: KnowledgePrivateInputDescriptor): KnowledgeGuardedCliWriteFrame {
  return {
    schema: KNOWLEDGE_GUARDED_CLI_REQUEST_SCHEMA,
    action: 'write',
    operation_id: descriptor.operation_id,
    step_id: descriptor.step_id,
    verb: descriptor.verb,
    target_id: descriptor.target_id,
    precondition: descriptor.precondition,
    binding: descriptor.binding,
    manifest: descriptor.manifest,
    payload: materializeKnowledgePrivateInput(descriptor),
    expires_at: descriptor.expires_at,
  };
}

function queryFrame(
  descriptor: KnowledgePrivateQueryDescriptor,
  action: 'query' | 'readback',
): KnowledgeGuardedCliQueryFrame {
  return {
    schema: KNOWLEDGE_GUARDED_CLI_REQUEST_SCHEMA,
    action,
    operation_id: descriptor.operation_id,
    step_id: descriptor.step_id,
    binding: descriptor.binding,
    selector: materializeKnowledgePrivateQuery(descriptor),
    archive: descriptor.archive,
    page: descriptor.page,
    expires_at: descriptor.expires_at,
  };
}

function collectBounded(stream: Readable, maxBytes = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (chunk: Buffer | string) => {
      const encoded = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += encoded.byteLength;
      if (total > maxBytes) {
        stream.destroy();
        reject(new KnowledgeGuardedCliDescriptorError('guarded_cli_public_output_cap_exceeded'));
        return;
      }
      chunks.push(encoded);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks, total).toString('utf8')));
    stream.on('error', () => reject(new KnowledgeGuardedCliDescriptorError('guarded_cli_stream_failed')));
  });
}

function collectPrivateIpc(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off('message', onMessage);
      child.off('disconnect', onDisconnect);
    };
    const onMessage = (message: unknown) => {
      cleanup();
      if (typeof message !== 'string') {
        reject(new KnowledgeGuardedCliDescriptorError('guarded_cli_private_result_invalid'));
        return;
      }
      if (Buffer.byteLength(message, 'utf8') > PRIVATE_FD_MAX_BYTES) {
        reject(new KnowledgeGuardedCliDescriptorError('guarded_cli_private_result_cap_exceeded'));
        return;
      }
      resolve(message);
    };
    const onDisconnect = () => {
      cleanup();
      reject(new KnowledgeGuardedCliDescriptorError('guarded_cli_private_ipc_disconnected'));
    };
    child.once('message', onMessage);
    child.once('disconnect', onDisconnect);
  });
}

function sendPrivateIpc(child: ChildProcess, value: string, didTimeout: () => boolean): Promise<void> {
  if (typeof child.send !== 'function' || !child.connected) {
    return Promise.reject(new KnowledgeGuardedCliDescriptorError('guarded_cli_private_ipc_unavailable'));
  }
  if (Buffer.byteLength(value, 'utf8') > PRIVATE_FD_MAX_BYTES) {
    return Promise.reject(new KnowledgeGuardedCliDescriptorError('private_request_byte_cap_exceeded'));
  }
  return new Promise((resolve, reject) => {
    child.send!(value, (error) => {
      if (error && !didTimeout()) {
        reject(new KnowledgeGuardedCliDescriptorError('guarded_cli_private_request_failed'));
        return;
      }
      resolve();
    });
  });
}

function parseWorkerResult(raw: string): KnowledgeGuardedCliWorkerResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new KnowledgeGuardedCliDescriptorError('guarded_cli_private_result_invalid');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new KnowledgeGuardedCliDescriptorError('guarded_cli_private_result_invalid');
  }
  return parsed as KnowledgeGuardedCliWorkerResult;
}

async function executeDescriptorFrame(
  frame: KnowledgeGuardedCliRequestFrame,
  options: KnowledgeGuardedCliDescriptorOptions,
): Promise<KnowledgeGuardedCliPrivateResult> {
  const entrypoint = fileURLToPath(new URL('../bin/knowledge.js', import.meta.url));
  const runtime = typeof Bun !== 'undefined' ? process.execPath : 'bun';
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 65_000, 1), 300_000);
  const child = spawn(runtime, [
    entrypoint,
    'guarded',
    'execute-descriptor',
    '--ipc',
    '--json',
  ], {
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
  });
  const stdout = collectBounded(child.stdout!);
  const resultText = collectPrivateIpc(child);
  let timeoutExpired = false;
  const requestFinished = sendPrivateIpc(
    child,
    canonicalKnowledgeGuardedJson(frame),
    () => timeoutExpired,
  );
  const exited = new Promise<number>((resolve, reject) => {
    child.once('error', () => reject(
      new KnowledgeGuardedCliDescriptorError('guarded_cli_spawn_failed'),
    ));
    child.once('close', (code) => resolve(code ?? 1));
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timeoutExpired = true;
      child.kill('SIGKILL');
      child.stdout?.destroy();
      reject(new KnowledgeGuardedCliDescriptorError('guarded_cli_timeout'));
    }, timeoutMs);
  });
  let completed: [number, void, string, string];
  try {
    completed = await Promise.race([
      Promise.all([exited, requestFinished, stdout, resultText]),
      timedOut,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  const [exitCode, _requestComplete, publicOut, privateOut] = completed;
  const result = parseWorkerResult(privateOut);
  if (
    exitCode !== 0
    || result.schema !== KNOWLEDGE_GUARDED_CLI_RESULT_SCHEMA
    || result.ok !== true
    || result.transport !== 'process_ipc'
  ) {
    const code = result && result.ok === false ? result.code : 'guarded_cli_worker_failed';
    throw new KnowledgeGuardedCliDescriptorError(code);
  }
  let publicAck: Record<string, unknown>;
  try {
    const parsed = JSON.parse(publicOut) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    publicAck = parsed as Record<string, unknown>;
  } catch {
    throw new KnowledgeGuardedCliDescriptorError('guarded_cli_public_ack_invalid');
  }
  assertExactKeys(publicAck, [
    'ok',
    'schema',
    'contract',
    'action',
    'transport',
    'request_digest',
    'result_digest',
  ], 'guarded_cli_public_ack');
  if (
    publicAck.ok !== true
    || publicAck.schema !== result.schema
    || publicAck.contract !== result.contract
    || publicAck.action !== result.action
    || publicAck.transport !== result.transport
    || publicAck.request_digest !== result.request_digest
    || publicAck.result_digest !== result.result_digest
    || result.request_digest !== knowledgeGuardedDigest(frame)
    || result.result_digest !== knowledgeGuardedDigest(result.proof)
  ) {
    throw new KnowledgeGuardedCliDescriptorError('guarded_cli_boundary_verification_failed');
  }
  return result;
}

export function executeKnowledgeGuardedCliWrite(
  descriptor: KnowledgePrivateInputDescriptor,
  options: KnowledgeGuardedCliDescriptorOptions = {},
): Promise<KnowledgeGuardedCliPrivateResult> {
  return executeDescriptorFrame(writeFrame(descriptor), options);
}

export function executeKnowledgeGuardedCliQuery(
  descriptor: KnowledgePrivateQueryDescriptor,
  options: KnowledgeGuardedCliDescriptorOptions = {},
): Promise<KnowledgeGuardedCliPrivateResult> {
  return executeDescriptorFrame(queryFrame(descriptor, 'query'), options);
}

export function executeKnowledgeGuardedCliReadback(
  descriptor: KnowledgePrivateQueryDescriptor,
  options: KnowledgeGuardedCliDescriptorOptions = {},
): Promise<KnowledgeGuardedCliPrivateResult> {
  return executeDescriptorFrame(queryFrame(descriptor, 'readback'), options);
}
