import { appendQuery, toV1BaseUrl } from "@hasna/contracts/client";
import { recordingIDParser, type ContractParser } from "../contracts/stream-v1.js";

export type CredentialProvider = (context: Readonly<{ apiBase: string; signal: AbortSignal }>) => string | Promise<string>;
export type SDKErrorCode = "invalid_configuration" | "invalid_input" | "credential_unavailable" | "aborted" | "timeout" |
  "network_error" | "redirect_refused" | "response_too_large" | "invalid_response" | "unauthorized" | "forbidden" |
  "not_found" | "recording_deleted" | "conflict" | "rate_limited" | "http_error";
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
  rate_limited: "The hosted usage or request limit was reached.", http_error: "The hosted API refused the request.",
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
}
export interface RequestOptions { signal?: AbortSignal }
export function input<T>(schema: ContractParser<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RecordingsSDKError("invalid_input");
  return parsed.data;
}
function abortable<T>(value: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The caller may abort synchronously while producing a rejected credential/fetch promise.
    // Observe that promise even though its result is discarded, so its cause cannot leak.
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
  constructor(options: ClientOptions) {
    try {
      const base = toV1BaseUrl(options.apiBase);
      const original = new URL(options.apiBase.trim()), url = new URL(base);
      if (!/\/v1\/?$/.test(original.pathname) || original.search || original.hash ||
          (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw Error();
      this.base = base;
      this.#timeout = options.timeoutMs ?? 20_000;
      this.#limit = options.maxResponseBytes ?? 4_194_304;
      if (!Number.isInteger(this.#timeout) || this.#timeout < 10 || this.#timeout > 300_000 ||
          !Number.isInteger(this.#limit) || this.#limit < 1024 || this.#limit > 33_554_432) throw Error();
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
      if (response.status >= 300 && response.status < 400 || response.redirected || response.url && response.url !== url) throw new RecordingsSDKError("redirect_refused");
      if (!statuses.includes(response.status)) {
        const codes: Record<number, SDKErrorCode> = { 401: "unauthorized", 403: "forbidden", 404: "not_found", 410: "recording_deleted", 409: "conflict", 429: "rate_limited" };
        const requestID = response.headers.get("x-request-id");
        throw new RecordingsSDKError(codes[response.status] ?? "http_error", response.status,
          recordingIDParser.safeParse(requestID).success ? requestID! : undefined);
      }
      if (response.status === 204) return { status: 204 };
      if (!/^application\/json(?:\s*;.*)?$/i.test(response.headers.get("content-type") ?? "")) throw new RecordingsSDKError("invalid_response");
      // Fetch may decode compressed bytes while retaining the wire Content-Length.
      const encoding = response.headers.get("content-encoding");
      const declared = !encoding || encoding === "identity" ? response.headers.get("content-length") : null;
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > this.#limit)) throw new RecordingsSDKError("response_too_large");
      const reader = response.body?.getReader();
      if (!reader) throw new RecordingsSDKError("invalid_response");
      let bytes = new Uint8Array(Math.min(16_384, this.#limit)), length = 0;
      try {
        while (true) {
          const { done, value } = await abortable(reader.read(), controller.signal);
          if (done) break;
          if (value.byteLength > this.#limit - length) throw new RecordingsSDKError("response_too_large");
          const required = length + value.byteLength;
          if (required > bytes.byteLength) {
            const grown = new Uint8Array(Math.min(this.#limit, Math.max(required, bytes.byteLength * 2)));
            grown.set(bytes.subarray(0, length)); bytes = grown;
          }
          bytes.set(value, length); length = required;
        }
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (declared !== null && Number(declared) !== length) throw new RecordingsSDKError("invalid_response");
      try { return { status: response.status, data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))) as unknown }; }
      catch { throw new RecordingsSDKError("invalid_response"); }
    } catch (error) {
      if (controller.signal.aborted) throw new RecordingsSDKError(timedOut ? "timeout" : "aborted");
      if (error instanceof RecordingsSDKError) throw error;
      throw new RecordingsSDKError("network_error");
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort);
      void response?.body?.cancel().catch(() => {});
    }
  }
}
export function output<T>(schema: ContractParser<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new RecordingsSDKError("invalid_response");
  return parsed.data;
}
