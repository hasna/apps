import { createHash } from "node:crypto";
import type { ContactsDatabase } from "./database.js";
import { getDatabase, now } from "./database.js";
import type {
  ContactProjectMembershipListResult,
  ContactProjectMembershipMutationDirection,
  ContactProjectMembershipMutationInput,
  ContactProjectMembershipMutationResult,
  ContactProjectMembershipSnapshot,
} from "../types/project-memberships.js";
import { ContactProjectMembershipConflictError } from "../types/project-memberships.js";

interface MembershipStateRow {
  contact_id: string;
  project_id: string;
  linked: number;
  revision: number;
}

interface ReceiptRow {
  direction: ContactProjectMembershipMutationDirection;
  contact_id: string;
  project_id: string;
  operation_id: string;
  step_id: string;
  expected_version: string;
  before_json: string;
  after_json: string;
  receipt_id: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function membershipVersion(
  contactId: string,
  projectId: string,
  linked: boolean,
  revision: number,
): string {
  return `cpmv_${digest(JSON.stringify([contactId, projectId, linked, revision])).slice(0, 32)}`;
}

function receiptId(input: ContactProjectMembershipMutationInput): string {
  return `cpmr_${digest(JSON.stringify([
    input.operation_id,
    input.step_id,
    input.contact_id,
    input.project_id,
  ])).slice(0, 32)}`;
}

function stateRow(
  contactId: string,
  projectId: string,
  db: ContactsDatabase,
): MembershipStateRow {
  const persisted = db.query(
    `SELECT contact_id, project_id, linked, revision
     FROM contact_project_membership_states
     WHERE contact_id = ? AND project_id = ?`,
  ).get(contactId, projectId) as MembershipStateRow | null;
  if (persisted) return persisted;
  const linked = Boolean(db.query(
    `SELECT 1 AS present FROM contact_projects WHERE contact_id = ? AND project_id = ?`,
  ).get(contactId, projectId));
  return { contact_id: contactId, project_id: projectId, linked: linked ? 1 : 0, revision: 0 };
}

function snapshot(row: MembershipStateRow): ContactProjectMembershipSnapshot {
  const linked = Boolean(row.linked);
  return {
    contact_id: row.contact_id,
    project_id: row.project_id,
    linked,
    version: membershipVersion(row.contact_id, row.project_id, linked, row.revision),
  };
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function normalizeInput(input: ContactProjectMembershipMutationInput): ContactProjectMembershipMutationInput {
  return {
    contact_id: required(input.contact_id, "contact_id"),
    project_id: required(input.project_id, "project_id"),
    operation_id: required(input.operation_id, "operation_id"),
    step_id: required(input.step_id, "step_id"),
    expected_version: required(input.expected_version, "expected_version"),
  };
}

function parseSnapshot(value: string): ContactProjectMembershipSnapshot {
  return JSON.parse(value) as ContactProjectMembershipSnapshot;
}

function replay(
  row: ReceiptRow,
  direction: ContactProjectMembershipMutationDirection,
  input: ContactProjectMembershipMutationInput,
): ContactProjectMembershipMutationResult {
  if (
    row.direction !== direction
    || row.contact_id !== input.contact_id
    || row.project_id !== input.project_id
    || row.expected_version !== input.expected_version
  ) {
    throw new ContactProjectMembershipConflictError(
      `operation_id/step_id already accepted for a different contact-project membership mutation`,
    );
  }
  return {
    outcome: "duplicate_of_accepted",
    operation_id: row.operation_id,
    step_id: row.step_id,
    before: parseSnapshot(row.before_json),
    after: parseSnapshot(row.after_json),
    receipt_id: row.receipt_id,
  };
}

function transitionWithoutReceipt(
  contactId: string,
  projectId: string,
  linked: boolean,
  db: ContactsDatabase,
): boolean {
  const beforeRow = stateRow(contactId, projectId, db);
  const changed = Boolean(beforeRow.linked) !== linked;
  const afterRow: MembershipStateRow = {
    ...beforeRow,
    linked: linked ? 1 : 0,
    revision: changed ? beforeRow.revision + 1 : beforeRow.revision,
  };
  const changedAt = now();
  db.run(
    `INSERT INTO contact_project_membership_states
       (contact_id, project_id, linked, revision, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(contact_id, project_id) DO UPDATE SET
       linked = excluded.linked,
       revision = excluded.revision,
       updated_at = excluded.updated_at`,
    [contactId, projectId, afterRow.linked, afterRow.revision, changedAt],
  );
  if (linked) {
    db.run(
      `INSERT OR IGNORE INTO contact_projects (contact_id, project_id) VALUES (?, ?)`,
      [contactId, projectId],
    );
  } else {
    db.run(
      `DELETE FROM contact_projects WHERE contact_id = ? AND project_id = ?`,
      [contactId, projectId],
    );
  }
  return changed;
}

export function setContactProjectMembershipWithoutReceipt(
  contactId: string,
  projectId: string,
  linked: boolean,
  db: ContactsDatabase = getDatabase(),
): boolean {
  const normalizedContactId = required(contactId, "contact_id");
  const normalizedProjectId = required(projectId, "project_id");
  return db.transaction(() =>
    transitionWithoutReceipt(normalizedContactId, normalizedProjectId, linked, db));
}

export function replaceContactProjectMembershipsWithoutReceipts(
  contactId: string,
  projectIds: string[],
  db: ContactsDatabase = getDatabase(),
): string[] {
  const normalizedContactId = required(contactId, "contact_id");
  const normalizedProjectIds = [...new Set(projectIds.map((projectId) => required(projectId, "project_id")))];
  return db.transaction(() => {
    const currentRows = db.query(
      `SELECT project_id FROM contact_projects WHERE contact_id = ?`,
    ).all(normalizedContactId) as Array<{ project_id: string }>;
    const desired = new Set(normalizedProjectIds);
    const population = new Set([...currentRows.map((row) => row.project_id), ...normalizedProjectIds]);
    for (const projectId of population) {
      transitionWithoutReceipt(normalizedContactId, projectId, desired.has(projectId), db);
    }
    return normalizedProjectIds;
  });
}

export function readContactProjectMembership(
  contactId: string,
  projectId: string,
  db: ContactsDatabase = getDatabase(),
): ContactProjectMembershipSnapshot {
  return snapshot(stateRow(required(contactId, "contact_id"), required(projectId, "project_id"), db));
}

export function listContactProjectMemberships(
  projectId: string,
  maxItems: number,
  db: ContactsDatabase = getDatabase(),
): ContactProjectMembershipListResult {
  const normalizedProjectId = required(projectId, "project_id");
  if (!Number.isInteger(maxItems) || maxItems < 1) throw new Error("max_items must be a positive integer");
  const rows = db.query(
    `SELECT cp.contact_id, cp.project_id,
            COALESCE(state.linked, 1) AS linked,
            COALESCE(state.revision, 0) AS revision
     FROM contact_projects cp
     LEFT JOIN contact_project_membership_states state
       ON state.contact_id = cp.contact_id AND state.project_id = cp.project_id
     WHERE cp.project_id = ?
     ORDER BY cp.contact_id ASC
     LIMIT ?`,
  ).all(normalizedProjectId, maxItems + 1) as MembershipStateRow[];
  if (rows.length > maxItems) {
    throw new Error(`contact project membership collection exceeds max_items=${maxItems}`);
  }
  const contactIds = rows.map((row) => row.contact_id);
  return {
    project_id: normalizedProjectId,
    contact_ids: contactIds,
    complete: true,
    membership_revision: `cpml_${digest(JSON.stringify(rows.map((row) => snapshot(row)))).slice(0, 32)}`,
  };
}

export function mutateContactProjectMembership(
  direction: ContactProjectMembershipMutationDirection,
  rawInput: ContactProjectMembershipMutationInput,
  db: ContactsDatabase = getDatabase(),
): ContactProjectMembershipMutationResult {
  const input = normalizeInput(rawInput);
  return db.transaction(() => {
    const existingReceipt = db.query(
      `SELECT direction, contact_id, project_id, operation_id, step_id, expected_version,
              before_json, after_json, receipt_id
       FROM contact_project_membership_receipts
       WHERE operation_id = ? AND step_id = ?`,
    ).get(input.operation_id, input.step_id) as ReceiptRow | null;
    if (existingReceipt) return replay(existingReceipt, direction, input);

    const contact = db.query(`SELECT id FROM contacts WHERE id = ?`).get(input.contact_id);
    if (!contact) throw new Error(`contact not found: ${input.contact_id}`);

    const beforeRow = stateRow(input.contact_id, input.project_id, db);
    const before = snapshot(beforeRow);
    if (before.version !== input.expected_version) {
      throw new ContactProjectMembershipConflictError(
        `contact project membership expected_version conflict: expected ${input.expected_version}, current ${before.version}`,
      );
    }

    const desiredLinked = direction === "attach";
    const changed = before.linked !== desiredLinked;
    const afterRow: MembershipStateRow = {
      ...beforeRow,
      linked: desiredLinked ? 1 : 0,
      revision: changed ? beforeRow.revision + 1 : beforeRow.revision,
    };
    const changedAt = now();
    db.run(
      `INSERT INTO contact_project_membership_states
        (contact_id, project_id, linked, revision, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(contact_id, project_id) DO UPDATE SET
         linked = excluded.linked,
         revision = excluded.revision,
         updated_at = excluded.updated_at`,
      [input.contact_id, input.project_id, afterRow.linked, afterRow.revision, changedAt],
    );
    if (desiredLinked) {
      db.run(
        `INSERT OR IGNORE INTO contact_projects (contact_id, project_id) VALUES (?, ?)`,
        [input.contact_id, input.project_id],
      );
    } else {
      db.run(
        `DELETE FROM contact_projects WHERE contact_id = ? AND project_id = ?`,
        [input.contact_id, input.project_id],
      );
    }

    const after = snapshot(afterRow);
    const id = receiptId(input);
    db.run(
      `INSERT INTO contact_project_membership_receipts (
         receipt_id, direction, contact_id, project_id, operation_id, step_id,
         expected_version, before_json, after_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        direction,
        input.contact_id,
        input.project_id,
        input.operation_id,
        input.step_id,
        input.expected_version,
        JSON.stringify(before),
        JSON.stringify(after),
        changedAt,
      ],
    );
    return {
      outcome: changed ? "accepted" : "duplicate_of_accepted",
      operation_id: input.operation_id,
      step_id: input.step_id,
      before,
      after,
      receipt_id: id,
    };
  });
}
