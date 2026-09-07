import type { RemoteCustomerRole } from "./remote-profile.js";

export type RemoteWorkspaceMember = {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: RemoteCustomerRole;
  /** Exact server timestamp, including microseconds; never rounded to Date. */
  createdAt: string;
};
export type RemoteWorkspaceMembersPage = {
  organizationId: string;
  members: RemoteWorkspaceMember[];
  nextCursor: string | null;
};
export type RemoteWorkspaceMembersOptions = { limit?: number; cursor?: string };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const cursor = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

/** Pagination is transport input, not a workspace or authority selector. */
export function workspaceMembersQuery(options: RemoteWorkspaceMembersOptions = {}): string {
  if (!record(options) || Object.keys(options).some(key => key !== "limit" && key !== "cursor")
    || (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100))
    || (options.cursor !== undefined && !cursor(options.cursor))) throw new Error("Use a roster limit from 1 to 100 and an unchanged continuation cursor.");
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  return query.size ? `?${query}` : "";
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 23) === value.slice(0, 23);
}

/** Project the documented roster only; auth metadata and other fields stay out. */
export function parseWorkspaceMembersPage(value: unknown): RemoteWorkspaceMembersPage {
  const fail = (): never => { throw new Error("The server returned an invalid workspace roster."); };
  if (!record(value) || !uuid(value.organizationId) || !Array.isArray(value.members) || value.members.length > 100
    || !(value.nextCursor === null || cursor(value.nextCursor))
    || (!value.members.length && value.nextCursor !== null)) return fail();
  const members = value.members.map((row: unknown): RemoteWorkspaceMember => {
    if (!record(row) || !uuid(row.membershipId) || !uuid(row.userId) || typeof row.email !== "string" || !row.email
      || !(row.displayName === null || typeof row.displayName === "string") || typeof row.role !== "string"
      || !["owner", "admin", "member", "viewer"].includes(row.role) || !timestamp(row.createdAt)) return fail();
    return { membershipId: row.membershipId, userId: row.userId, email: row.email, displayName: row.displayName,
      role: row.role as RemoteCustomerRole, createdAt: row.createdAt };
  });
  if (new Set(members.map(row => row.membershipId)).size !== members.length) return fail();
  return { organizationId: value.organizationId, members, nextCursor: value.nextCursor };
}
