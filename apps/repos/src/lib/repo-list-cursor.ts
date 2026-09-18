export const REPO_LIST_CURSOR_PREFIX = "repos-list-v1:";

export interface RepoListCursor {
  after_id: number;
  snapshot_max_id: number;
  total: number;
  org?: string;
  query?: string;
}

export function encodeRepoListCursor(cursor: RepoListCursor): string {
  return `${REPO_LIST_CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

export function decodeRepoListCursor(raw: string, filters: { org?: string; query?: string }): RepoListCursor {
  if (!raw.startsWith(REPO_LIST_CURSOR_PREFIX)) throw new Error("Invalid --cursor: expected a repos-list-v1 cursor");
  let cursor: RepoListCursor;
  try { cursor = JSON.parse(Buffer.from(raw.slice(REPO_LIST_CURSOR_PREFIX.length), "base64url").toString("utf8")); }
  catch { throw new Error("Invalid --cursor: expected a repos-list-v1 cursor"); }
  if (!Number.isInteger(cursor.after_id) || cursor.after_id < 0 || !Number.isInteger(cursor.snapshot_max_id) || cursor.snapshot_max_id < 0 || !Number.isInteger(cursor.total) || cursor.total < 0) {
    throw new Error("Invalid --cursor: malformed repository snapshot");
  }
  if ((cursor.org ?? undefined) !== (filters.org ?? undefined) || (cursor.query ?? undefined) !== (filters.query ?? undefined)) {
    throw new Error("Repository cursor filter mismatch");
  }
  return cursor;
}
