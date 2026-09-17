/** Safe, actionable search refusals shared by terminal and MCP clients. */
export interface SearchAdmissionFailure {
  status: 429 | 504;
  code: "search_busy" | "search_timeout";
  retry_after: 5;
  retryable: true;
}

export class SearchAdmissionError extends Error {
  constructor(readonly failure: SearchAdmissionFailure) {
    super(`Message search failed (HTTP ${failure.status}; code=${failure.code}; retry_after=5). Retry after 5 seconds.`);
    this.name = "SearchAdmissionError";
  }
}

/** The body has already passed the exact route response contract. */
export function searchAdmissionError(status: number, body: unknown): SearchAdmissionError | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as Record<string, unknown>).code;
  if ((status === 429 && code === "search_busy") || (status === 504 && code === "search_timeout")) {
    return new SearchAdmissionError({ status, code, retry_after: 5, retryable: true });
  }
  return null;
}

/** MCP errors reach the contract wrapper as text; accept only our exact envelope. */
export function searchAdmissionFailure(error: unknown): SearchAdmissionFailure | null {
  if (error instanceof SearchAdmissionError) return error.failure;
  const message = (error instanceof Error ? error.message : String(error)).replace(/^Error: /, "");
  const match = /^Message search failed \(HTTP (429|504); code=(search_busy|search_timeout); retry_after=5\). Retry after 5 seconds\.$/.exec(message);
  return match ? searchAdmissionError(Number(match[1]), { code: match[2] })?.failure ?? null : null;
}
