import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { MAX_AUDIO_BYTES, WAV_HEADER_BYTES } from "../contracts/audio-v1.js";
import { RecordingsSDKError, type HostedAudioDownloadResponse, type HostedAudioUploadInput } from "./transport.js";

const FILE_CHUNK_BYTES = 1_048_576;

export interface HostedAudioFileReceipt {
  path: string;
  byteLength: number;
  sha256: string;
  status: 200;
}
/** Resolve one untrusted MCP basename under the startup-configured real directory. */
export function audioFileInDirectory(directory: string, file: string): string {
  try {
    const root = lstatSync(directory);
    if (!root.isDirectory() || root.isSymbolicLink() || !file || file !== basename(file) ||
        file === "." || file === ".." || file.includes("/") || file.includes("\\") || file.includes("\0")) throw Error();
    return join(directory, file);
  } catch {
    throw new RecordingsSDKError("invalid_input");
  }
}
/** Open and validate one stable regular-file descriptor before handing it to fetch. */
export async function prepareAudioUpload(path: string, signal?: AbortSignal): Promise<HostedAudioUploadInput> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    checkAbort(signal);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || !Number.isSafeInteger(stat.size)) throw new RecordingsSDKError("invalid_input");
    const byteLength = stat.size;
    if (byteLength < WAV_HEADER_BYTES + 2 || byteLength > MAX_AUDIO_BYTES || (byteLength - WAV_HEADER_BYTES) % 2 !== 0) {
      throw new RecordingsSDKError("invalid_input");
    }
    const hash = createHash("sha256");
    const header = new Uint8Array(WAV_HEADER_BYTES);
    let headerLength = 0, readLength = 0;
    while (readLength < byteLength) {
      checkAbort(signal);
      const chunk = new Uint8Array(Math.min(FILE_CHUNK_BYTES, byteLength - readLength));
      const result = await handle.read(chunk, 0, chunk.byteLength, readLength);
      if (result.bytesRead <= 0) throw new RecordingsSDKError("invalid_input");
      const value = chunk.subarray(0, result.bytesRead);
      readLength += value.byteLength; hash.update(value);
      if (headerLength < WAV_HEADER_BYTES) {
        const copyLength = Math.min(WAV_HEADER_BYTES - headerLength, value.byteLength);
        header.set(value.subarray(0, copyLength), headerLength); headerLength += copyLength;
      }
    }
    const endStat = await handle.stat();
    if (readLength !== byteLength || endStat.size !== byteLength || headerLength !== WAV_HEADER_BYTES || !validWav(header, byteLength)) {
      throw new RecordingsSDKError("invalid_input");
    }
    const body = audioFileStream(handle, byteLength, signal);
    handle = undefined;
    return { body, byteLength, sha256: hash.digest("hex"), retainAudio: true };
  } catch (error) {
    if (error instanceof RecordingsSDKError) throw error;
    if (signal?.aborted) throw new RecordingsSDKError("aborted");
    throw new RecordingsSDKError("invalid_input");
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

export async function assertAudioDestination(path: string): Promise<void> {
  await destinationAbsent(path);
  await destinationParent(path);
}

export async function writeAudioDownload(
  path: string,
  response: HostedAudioDownloadResponse,
  signal?: AbortSignal,
): Promise<HostedAudioFileReceipt> {
  if (response.status !== 200 || response.range) throw new RecordingsSDKError("invalid_input");
  await assertAudioDestination(path);
  const parent = dirname(path);
  const temp = join(parent, "." + basename(path) + ".part-" + randomUUID());
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temp, "wx", 0o600);
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let length = 0;
    try {
      while (true) {
        checkAbort(signal);
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > response.byteLength || length > MAX_AUDIO_BYTES) throw new RecordingsSDKError("invalid_response");
        hash.update(next.value);
        let offset = 0;
        while (offset < next.value.byteLength) {
          const result = await handle.write(next.value, offset, next.value.byteLength - offset);
          if (result.bytesWritten <= 0) throw new RecordingsSDKError("invalid_input");
          offset += result.bytesWritten;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const digest = hash.digest("hex");
    if (length !== response.byteLength || digest !== response.sha256) throw new RecordingsSDKError("invalid_response");
    checkAbort(signal);
    await handle.sync();
    checkAbort(signal);
    await handle.close();
    handle = undefined;
    checkAbort(signal);
    // A hard-link publication fails if another process created the destination
    // after the initial absent check, so it cannot overwrite an existing file.
    await link(temp, path);
    await unlink(temp);
    return { path, byteLength: length, sha256: digest, status: 200 };
  } catch (error) {
    if (error instanceof RecordingsSDKError) throw error;
    if (signal?.aborted) throw new RecordingsSDKError("aborted");
    throw new RecordingsSDKError("invalid_input");
  } finally {
    if (handle) await handle.close().catch(() => {});
    // Retry cleanup after every outcome, including a failed unlink after link.
    await unlink(temp).catch(() => {});
  }
}

async function destinationAbsent(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isFile() || stat.isDirectory() || stat.isSymbolicLink()) throw Error();
    throw Error();
  } catch (error) {
    if (error instanceof RecordingsSDKError) throw error;
    // ENOENT is the only acceptable result. Every other filesystem result
    // remains a fixed SDK error without disclosing the path or OS details.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new RecordingsSDKError("invalid_input");
  }
}
async function destinationParent(path: string): Promise<void> {
  try {
    const stat = await lstat(dirname(path));
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error();
  } catch {
    throw new RecordingsSDKError("invalid_input");
  }
}
function audioFileStream(handle: Awaited<ReturnType<typeof open>>, byteLength: number, signal?: AbortSignal): ReadableStream<Uint8Array> {
  let offset = 0, closed = false;
  let closePromise: Promise<void> | undefined;
  const close = async () => {
    if (closePromise) return closePromise;
    closed = true; closePromise = handle.close().catch(() => {}); return closePromise;
  };
  const onAbort = () => { void close(); };
  signal?.addEventListener("abort", onAbort, { once: true });
  const cleanup = () => signal?.removeEventListener("abort", onAbort);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) { controller.close(); return; }
      try {
        checkAbort(signal);
        if (offset === byteLength) { cleanup(); await close(); controller.close(); return; }
        const chunk = new Uint8Array(Math.min(FILE_CHUNK_BYTES, byteLength - offset));
        const result = await handle.read(chunk, 0, chunk.byteLength, offset);
        if (result.bytesRead <= 0) throw new RecordingsSDKError("invalid_input");
        offset += result.bytesRead; controller.enqueue(chunk.subarray(0, result.bytesRead));
        if (offset === byteLength) { cleanup(); await close(); controller.close(); }
      } catch (error) {
        cleanup(); await close();
        controller.error(error instanceof RecordingsSDKError ? error : new RecordingsSDKError("invalid_input"));
      }
    },
    async cancel() { cleanup(); await close(); },
  });
}
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RecordingsSDKError("aborted");
}
function validWav(header: Uint8Array, total: number): boolean {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const text = (start: number, length: number) => new TextDecoder().decode(header.subarray(start, start + length));
  return text(0, 4) === "RIFF" && view.getUint32(4, true) === total - 8 &&
    text(8, 4) === "WAVE" && text(12, 4) === "fmt " && view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === 24_000 && view.getUint32(28, true) === 48_000 &&
    view.getUint16(32, true) === 2 && view.getUint16(34, true) === 16 &&
    text(36, 4) === "data" && view.getUint32(40, true) === total - WAV_HEADER_BYTES;
}
