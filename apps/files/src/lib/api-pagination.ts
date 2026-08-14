/**
 * Largest file-list page supported by the `/v1/files` HTTP contract.
 *
 * Callers may request a larger logical result set; the API client walks it in
 * pages no larger than this value so the server can keep its per-request bound.
 */
export const FILES_API_MAX_PAGE_SIZE = 500;
