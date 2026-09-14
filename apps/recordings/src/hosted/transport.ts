import { appendQuery, toV1BaseUrl } from "@hasna/contracts/client";
import { MAX_AUDIO_BYTES, WAV_HEADER_BYTES, audioSHA256Parser } from "../contracts/audio-v1.js";
import { recordingIDParser, type ContractParser } from "../contracts/stream-v1.js";

export type CredentialProvider = (context: Readonly<{ apiBase: string; signal: AbortSignal }>) => string | Promise<string>;
export type SDKErrorCode = "invalid_configuration" | "invalid_input" | "credential_unavailable" | "aborted" | "timeout" |
  "network_error" | "redirect_refused" | "response_too_large" | "invalid_response" | "unauthorized" | "forbidden" |
  "not_found" | "recording_deleted" | "conflict" | "rate_limited" | "range_not_satisfiable" | "http_error";
const messages: Record<SDKErrorCode, string> = {
  invalid_configuration: "Choose a complete HTTPS v1 API base, or an explicit HTTP loopback v1 base, and valid bounds.",
  invalid_input: "The operation input does not match the hosted Recordings contract.",
  credential_unavailable: "A valid access credential is required for this hosted operation.",
  aborted: "The hosted request was cancelled.", timeout: "The hosted request exceeded its deadline.",
  network_error: "The hosted API could not be reached.", redirect_refused: "The hosted API returned a refused redirect.",
  response_too_large: "The hosted response exceeded its byte limit. Request a smaller page.",
  invalid_response: "The hosted API returned an unexpected response.", unauthorized: "Sign in again to use this hosted session.",
  forbidden: "This hosted account is not permitted to perform the operation.", not_found: "The hosted resource was not found.",
  recording_deleted: "The recording was permanently deleted.", conflict: "The operation conflicts with existing hosted state.",
  rate_limited: "The hosted usage or request limit was reached.", range_not_satisfiable: "The requested audio byte range is unsatisfiable.", http_error: "The hosted API refused the request.",
};
/** Never retains a token, request/response body, URL, native Error cause or server message. */
export class RecordingsSDKError extends Error {
  constructor(readonly code: SDKErrorCode, readonly status?: number, readonly requestId?: string) {
    super(messages[code]); this.name = "RecordingsSDKError";
  }
}
export interface ClientOptions {
  apiBase: string;
  credentialProvider?: CredentialProvider;
  /** Trusted injection for tests/custom runtimes; must honor manual redirects and AbortSignal. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Maximum streamed audio response size. Defaults to the hosted WAV contract maximum. */
  maxAudioBytes?: number;
}
export interface RequestOptions { signal?: AbortSignal }
/** Binary bodies accepted by the hosted audio endpoint. Strings and JSON are excluded. */
export type AudioBody = ArrayBuffer | ArrayBufferView | Blob | ReadableStream<Uint8Array>;
export interface HostedAudioUploadInput {
  body: AudioBody;
  byteLength: number;
  sha256: string;
  /** Uploads must carry an affirmative, per-request retention decision. */
  retainAudio: true;
}
export interface HostedAudioDownloadOptions extends RequestOptions { range?: string }
export interface HostedAudioRange { start: number; end: number; total: number }
export interface HostedAudioDownloadResponse {
  status: 200 | 206;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
  byteLength: number;
  /** SHA-256 of the complete stored WAV, including its 44-byte header. */
  sha256: string;
  range?: HostedAudioRange;
}
export type AudioUploadInput = HostedAudioUploadInput;
export type AudioDownloadOptions = HostedAudioDownloadOptions;
export type AudioDownloadResponse = HostedAudioDownloadResponse;
export type AudioRange = HostedAudioRange;

export function input<T>(schema: ContractParser<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RecordingsSDKError("invalid_input");
  return parsed.data;
}
function abortable<T>(value: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // Observe a promise whose result is discarded while cancellation wins, so
    // a rejected credential or fetch promise cannot leak its cause.
    void value.catch(() => {});
    return Promise.reject(new RecordingsSDKError("aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new RecordingsSDKError("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    value.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
export class Transport {
  readonly base: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #credential?: CredentialProvider;
  readonly #timeout: number;
  readonly #limit: number;
  readonly #audioLimit: number;
  constructor(options: ClientOptions) {
    try {
      const base = toV1BaseUrl(options.apiBase);
      const original = new URL(options.apiBase.trim()), url = new URL(base);
      if (!/\/v1\/?$/.test(original.pathname) || original.search || original.hash ||
          (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw Error();
      this.base = base;
      this.#timeout = options.timeoutMs ?? 20_000;
      this.#limit = options.maxResponseBytes ?? 4_194_304;
      this.#audioLimit = options.maxAudioBytes ?? MAX_AUDIO_BYTES;
      if (!Number.isInteger(this.#timeout) || this.#timeout < 10 || this.#timeout > 300_000 ||
          !Number.isInteger(this.#limit) || this.#limit < 1024 || this.#limit > 33_554_432 ||
          !Number.isInteger(this.#audioLimit) || this.#audioLimit < WAV_HEADER_BYTES + 2 || this.#audioLimit > MAX_AUDIO_BYTES) throw Error();
    } catch { throw new RecordingsSDKError("invalid_configuration"); }
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#credential = options.credentialProvider;
  }
  async request(method: string, path: string, authenticated: boolean, statuses: readonly number[],
                body?: unknown, options: RequestOptions = {}, query?: Record<string, string | number | undefined>): Promise<{ status: number; data?: unknown }> {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.#timeout);
    let response: Response | undefined;
    try {
      controller.signal.throwIfAborted();
      const headers = new Headers({ accept: "application/json" });
      const encoded = body === undefined ? undefined : JSON.stringify(body);
      if (encoded !== undefined) {
        if (new TextEncoder().encode(encoded).byteLength > 1_048_576) throw new RecordingsSDKError("invalid_input");
        headers.set("content-type", "application/json");
      }
      if (authenticated) {
        let token: string;
        try {
          if (!this.#credential) throw Error();
          token = await abortable(Promise.resolve(this.#credential(Object.freeze({ apiBase: this.base, signal: controller.signal }))), controller.signal);
          if (typeof token !== "string" || !/^[A-Za-z0-9._~+\/-]{1,16000}={0,2}$/.test(token)) throw Error();
        } catch { throw new RecordingsSDKError("credential_unavailable"); }
        controller.signal.throwIfAborted();
        headers.set("authorization", "Bearer " + token);
      }
      const url = this.base + appendQuery(path, query);
      response = await abortable(this.#fetch(url, { method, headers, body: encoded, redirect: "manual", credentials: "omit", cache: "no-store", signal: controller.signal }), controller.signal);
      assertNoRedirect(response, url);
      if (!statuses.includes(response.status)) throw statusError(response);
      if (response.status === 204) return { status: 204 };
      const data = await readJSON(response, controller.signal, this.#limit);
      return { status: response.status, data };
    } catch (error) {
      if (controller.signal.aborted) throw new RecordingsSDKError(timedOut ? "timeout" : "aborted");
      if (error instanceof RecordingsSDKError) throw error;
      throw new RecordingsSDKError("network_error");
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort);
      void response?.body?.cancel().catch(() => {});
    }
  }

  /**
   * Send one raw WAV upload. The body is never JSON encoded or buffered by the
   * transport; the caller declares the exact size and digest in the request.
   */
  async requestAudioUpload(path: string, upload: HostedAudioUploadInput, options: RequestOptions = {}): Promise<{ status: 200; data?: unknown }> {
    validateAudioUpload(upload);
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.#timeout);
    let response: Response | undefined;
    try {
      controller.signal.throwIfAborted();
      const token = await this.#getCredential(controller);
      controller.signal.throwIfAborted();
      const headers = new Headers({
        accept: "application/json",
        "content-type": "audio/wav",
        "content-length": String(upload.byteLength),
        "x-audio-sha256": upload.sha256,
        "x-audio-retention-consent": "true",
        authorization: "Bearer " + token,
      });
      const url = this.base + path;
      response = await abortable(this.#fetch(url, {
        method: "PUT", headers, body: upload.body as BodyInit, redirect: "manual",
        credentials: "omit", cache: "no-store", signal: controller.signal,
      }), controller.signal);
      assertNoRedirect(response, url);
      if (response.status !== 200) throw statusError(response);
      const data = await readJSON(response, controller.signal, this.#limit);
      return { status: 200, data };
    } catch (error) {
      if (controller.signal.aborted) throw new RecordingsSDKError(timedOut ? "timeout" : "aborted");
      if (error instanceof RecordingsSDKError) throw error;
      throw new RecordingsSDKError("network_error");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      void response?.body?.cancel().catch(() => {});
      if (!response) cancelAudioBody(upload.body);
    }
  }

  /**
   * Return a bounded raw response stream. The deadline remains active until
   * that stream is consumed or cancelled, so a caller cannot leave a hosted
   * response holding a request open forever.
   */
  async requestAudioDownload(path: string, options: HostedAudioDownloadOptions = {}): Promise<HostedAudioDownloadResponse> {
    validateAudioRange(options.range);
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.#timeout);
    let response: Response | undefined;
    let handedOff = false;
    try {
      controller.signal.throwIfAborted();
      const token = await this.#getCredential(controller);
      controller.signal.throwIfAborted();
      const headers = new Headers({ accept: "audio/wav", authorization: "Bearer " + token });
      if (options.range !== undefined) headers.set("range", options.range);
      const url = this.base + path;
      response = await abortable(this.#fetch(url, {
        method: "GET", headers, redirect: "manual", credentials: "omit",
        cache: "no-store", signal: controller.signal,
      }), controller.signal);
      assertNoRedirect(response, url);
      if (response.status !== 200 && response.status !== 206) throw statusError(response);
      const contentType = response.headers.get("content-type")?.trim() ?? "";
      if (!/^audio\/wav$/i.test(contentType)) throw new RecordingsSDKError("invalid_response");
      const sha256 = audioSHA256Parser.safeParse(response.headers.get("x-audio-sha256")).success
        ? response.headers.get("x-audio-sha256")! : undefined;
      if (!sha256) throw new RecordingsSDKError("invalid_response");
      if (response.headers.get("accept-ranges")?.trim().toLowerCase() !== "bytes") throw new RecordingsSDKError("invalid_response");
      const declared = response.headers.get("content-length");
      if (declared === null || !/^\d+$/.test(declared)) throw new RecordingsSDKError("invalid_response");
      const byteLength = Number(declared);
      if (!Number.isSafeInteger(byteLength) || byteLength > this.#audioLimit || byteLength > MAX_AUDIO_BYTES) {
        throw new RecordingsSDKError("response_too_large");
      }
      if (response.status === 200 && byteLength < WAV_HEADER_BYTES + 2) {
        throw new RecordingsSDKError("invalid_response");
      }
      let range: HostedAudioRange | undefined;
      const contentRange = response.headers.get("content-range");
      if (response.status === 206) {
        range = parseContentRange(contentRange);
        if (range.end - range.start + 1 !== byteLength) throw new RecordingsSDKError("invalid_response");
      } else if (contentRange !== null) {
        throw new RecordingsSDKError("invalid_response");
      }
      const rawBody = response.body;
      if (!rawBody) throw new RecordingsSDKError("invalid_response");
      const reader = rawBody.getReader();
      let seen = 0;
      const limit = this.#audioLimit;
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const body = new ReadableStream<Uint8Array>({
        async pull(streamController) {
          try {
            const next = await abortable(reader.read(), controller.signal);
            if (next.done) {
              if (seen !== byteLength) throw new RecordingsSDKError("invalid_response");
              cleanup();
              streamController.close();
              return;
            }
            seen += next.value.byteLength;
            if (seen > limit) throw new RecordingsSDKError("response_too_large");
            if (seen > byteLength) throw new RecordingsSDKError("invalid_response");
            streamController.enqueue(next.value);
          } catch (error) {
            await reader.cancel().catch(() => {});
            cleanup();
            if (controller.signal.aborted) streamController.error(new RecordingsSDKError(timedOut ? "timeout" : "aborted"));
            else if (error instanceof RecordingsSDKError) streamController.error(error);
            else streamController.error(new RecordingsSDKError("network_error"));
          }
        },
        async cancel(reason) {
          cleanup();
          await reader.cancel(reason).catch(() => {});
        },
      });
      handedOff = true;
      return { status: response.status as 200 | 206, headers: new Headers(response.headers), body, byteLength, sha256, range, };
    } catch (error) {
      if (controller.signal.aborted) throw new RecordingsSDKError(timedOut ? "timeout" : "aborted");
      if (error instanceof RecordingsSDKError) throw error;
      throw new RecordingsSDKError("network_error");
    } finally {
      if (!handedOff) {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        void response?.body?.cancel().catch(() => {});
      }
    }
  }

  async #getCredential(controller: AbortController): Promise<string> {
    try {
      if (!this.#credential) throw Error();
      const token = await abortable(Promise.resolve(this.#credential(Object.freeze({
        apiBase: this.base, signal: controller.signal,
      })),), controller.signal);
      if (typeof token !== "string" || !/^[A-Za-z0-9._~+\/-]{1,16000}={0,2}$/.test(token)) throw Error();
      return token;
    } catch {
      throw new RecordingsSDKError("credential_unavailable");
    }
  }
}
function cancelAudioBody(body: AudioBody): void {
  if (body instanceof ReadableStream) void body.cancel().catch(() => {});
}
function validateAudioUpload(upload: HostedAudioUploadInput): void {
  if (!upload || upload.retainAudio !== true || !Number.isSafeInteger(upload.byteLength) ||
      upload.byteLength < WAV_HEADER_BYTES + 2 || upload.byteLength > MAX_AUDIO_BYTES ||
      (upload.byteLength - WAV_HEADER_BYTES) % 2 !== 0 || !audioSHA256Parser.safeParse(upload.sha256).success ||
      !isAudioBody(upload.body)) throw new RecordingsSDKError("invalid_input");
}
function isAudioBody(value: unknown): value is AudioBody {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value) ||
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    (typeof ReadableStream !== "undefined" && value instanceof ReadableStream);
}
function validateAudioRange(value: string | undefined): void {
  if (value === undefined) return;
  if (value.length > 100) throw new RecordingsSDKError("invalid_input");
  const explicit = value.match(/^bytes=(\d+)-(\d*)$/);
  const suffix = value.match(/^bytes=-(\d+)$/);
  if (!explicit && !suffix) throw new RecordingsSDKError("invalid_input");
  if (suffix) {
    const amount = Number(suffix[1]);
    if (!Number.isSafeInteger(amount) || amount < 1) throw new RecordingsSDKError("invalid_input");
    return;
  }
  const start = Number(explicit![1]);
  const end = explicit![2] === "" ? undefined : Number(explicit![2]);
  if (!Number.isSafeInteger(start) || (end !== undefined && (!Number.isSafeInteger(end) || end < start))) {
    throw new RecordingsSDKError("invalid_input");
  }
}
function parseContentRange(value: string | null): HostedAudioRange {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!match) throw new RecordingsSDKError("invalid_response");
  const start = Number(match[1]), end = Number(match[2]), total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start > end || end >= total ||
      total < WAV_HEADER_BYTES + 2 || (total - WAV_HEADER_BYTES) % 2 !== 0 ||
      total > MAX_AUDIO_BYTES) throw new RecordingsSDKError("invalid_response");
  return { start, end, total };
}
function assertNoRedirect(response: Response, url: string): void {
  if ((response.status >= 300 && response.status < 400) || response.redirected || response.url && response.url !== url) {
    throw new RecordingsSDKError("redirect_refused");
  }
}
function statusError(response: Response): RecordingsSDKError {
  const codes: Record<number, SDKErrorCode> = {
    401: "unauthorized", 403: "forbidden", 404: "not_found", 410: "recording_deleted",
    409: "conflict", 416: "range_not_satisfiable", 429: "rate_limited",
  };
  const requestID = response.headers.get("x-request-id");
  return new RecordingsSDKError(codes[response.status] ?? "http_error", response.status,
    recordingIDParser.safeParse(requestID).success ? requestID! : undefined);
}
async function readJSON(response: Response, signal: AbortSignal, limit: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(response.headers.get("content-type") ?? "")) {
    throw new RecordingsSDKError("invalid_response");
  }
  const encoding = response.headers.get("content-encoding");
  const declared = !encoding || encoding === "identity" ? response.headers.get("content-length") : null;
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new RecordingsSDKError("response_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new RecordingsSDKError("invalid_response");
  let bytes = new Uint8Array(Math.min(16_384, limit)), length = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      if (value.byteLength > limit - length) throw new RecordingsSDKError("response_too_large");
      const required = length + value.byteLength;
      if (required > bytes.byteLength) {
        const grown = new Uint8Array(Math.min(limit, Math.max(required, bytes.byteLength * 2)));
        grown.set(bytes.subarray(0, length)); bytes = grown;
      }
      bytes.set(value, length); length = required;
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (declared !== null && Number(declared) !== length) throw new RecordingsSDKError("invalid_response");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))) as unknown; }
  catch { throw new RecordingsSDKError("invalid_response"); }
}

export function output<T>(schema: ContractParser<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new RecordingsSDKError("invalid_response");
  return parsed.data;
}
