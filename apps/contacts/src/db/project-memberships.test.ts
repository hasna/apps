import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createContact,
  linkContactToProject,
  setContactProjects,
  unlinkContactFromProject,
} from "./contacts.js";
import { getDatabase, resetDatabase } from "./database.js";
import {
  listContactProjectMemberships,
  mutateContactProjectMembership,
  readContactProjectMembership,
} from "./project-memberships.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "contacts-project-membership-"));
  process.env["CONTACTS_DB_PATH"] = join(root, "contacts.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  delete process.env["CONTACTS_DB_PATH"];
  rmSync(root, { recursive: true, force: true });
});

describe("guarded contact-project membership mutations", () => {
  test("uses CAS, stable receipts, snapshots, compensation, and revision-bound retries", () => {
    const db = getDatabase();
    const contact = createContact({ display_name: "Bianca Sipos" }, db);
    const projectId = "wks_eHb1kcLUzgQVJQt6L0CCB";

    const initial = readContactProjectMembership(contact.id, projectId, db);
    expect(initial).toMatchObject({
      contact_id: contact.id,
      project_id: projectId,
      linked: false,
    });

    const attached = mutateContactProjectMembership("attach", {
      contact_id: contact.id,
      project_id: projectId,
      operation_id: "attach-bianca",
      step_id: "contacts-membership:forward:v1",
      expected_version: initial.version,
    }, db);
    expect(attached.outcome).toBe("accepted");
    expect(attached.before).toEqual(initial);
    expect(attached.after.linked).toBe(true);
    expect(attached.after.version).not.toBe(initial.version);

    const replay = mutateContactProjectMembership("attach", {
      contact_id: contact.id,
      project_id: projectId,
      operation_id: "attach-bianca",
      step_id: "contacts-membership:forward:v1",
      expected_version: initial.version,
    }, db);
    expect(replay).toEqual({ ...attached, outcome: "duplicate_of_accepted" });

    expect(() => mutateContactProjectMembership("detach", {
      contact_id: contact.id,
      project_id: projectId,
      operation_id: "stale-detach",
      step_id: "contacts-membership:forward:stale",
      expected_version: initial.version,
    }, db)).toThrow("expected_version conflict");

    const compensated = mutateContactProjectMembership("detach", {
      contact_id: contact.id,
      project_id: projectId,
      operation_id: "attach-bianca",
      step_id: "contacts-membership:compensate:v2",
      expected_version: attached.after.version,
    }, db);
    expect(compensated.after.linked).toBe(false);

    const retried = mutateContactProjectMembership("attach", {
      contact_id: contact.id,
      project_id: projectId,
      operation_id: "attach-bianca",
      step_id: "contacts-membership:forward:v3",
      expected_version: compensated.after.version,
    }, db);
    expect(retried.outcome).toBe("accepted");
    expect(retried.after.linked).toBe(true);

    const listed = listContactProjectMemberships(projectId, 1000, db);
    expect(listed).toMatchObject({
      project_id: projectId,
      contact_ids: [contact.id],
      complete: true,
    });
    expect(listed.membership_revision).toBeTruthy();
  });

  test("keeps legacy project-link mutations synchronized with membership versions", () => {
    const db = getDatabase();
    const contact = createContact({ display_name: "Bianca Sipos" }, db);
    const firstProjectId = "wks_eHb1kcLUzgQVJQt6L0CCB";
    const secondProjectId = "wks_contactslegacy0001";

    const initial = readContactProjectMembership(contact.id, firstProjectId, db);
    linkContactToProject(contact.id, firstProjectId, db);
    const linked = readContactProjectMembership(contact.id, firstProjectId, db);
    expect(linked.linked).toBe(true);
    expect(linked.version).not.toBe(initial.version);

    unlinkContactFromProject(contact.id, firstProjectId, db);
    const unlinked = readContactProjectMembership(contact.id, firstProjectId, db);
    expect(unlinked.linked).toBe(false);
    expect(unlinked.version).not.toBe(linked.version);

    setContactProjects(contact.id, [firstProjectId, secondProjectId], db);
    expect(readContactProjectMembership(contact.id, firstProjectId, db).linked).toBe(true);
    expect(readContactProjectMembership(contact.id, secondProjectId, db).linked).toBe(true);

    setContactProjects(contact.id, [secondProjectId], db);
    expect(readContactProjectMembership(contact.id, firstProjectId, db).linked).toBe(false);
    expect(readContactProjectMembership(contact.id, secondProjectId, db).linked).toBe(true);
  });

  test("keeps retained authority state synchronized across legacy rollback attach and detach writes", () => {
    const db = getDatabase();
    const contact = createContact({ display_name: "Bianca Sipos" }, db);
    const projectId = "wks_eHb1kcLUzgQVJQt6L0CCB";
    const initial = readContactProjectMembership(contact.id, projectId, db);

    const attached = mutateContactProjectMembership("attach", {
      contact_id: contact.id,
      project_id: projectId,
      operation_id: "rollback-sync-candidate-attach",
      step_id: "contacts-membership:forward:v1",
      expected_version: initial.version,
    }, db);
    const afterCandidateAttach = db.query(
      `SELECT linked, revision
       FROM contact_project_membership_states
       WHERE contact_id = ? AND project_id = ?`,
    ).get(contact.id, projectId) as { linked: number; revision: number };
    expect(afterCandidateAttach).toEqual({ linked: 1, revision: 1 });
    expect(attached.after.version).toBe(readContactProjectMembership(contact.id, projectId, db).version);

    // Simulate a rolled-back 0.6.34 binary, which only knows contact_projects.
    db.run(
      `DELETE FROM contact_projects WHERE contact_id = ? AND project_id = ?`,
      [contact.id, projectId],
    );
    const afterLegacyDetach = readContactProjectMembership(contact.id, projectId, db);
    const detachedState = db.query(
      `SELECT linked, revision
       FROM contact_project_membership_states
       WHERE contact_id = ? AND project_id = ?`,
    ).get(contact.id, projectId) as { linked: number; revision: number };
    expect(afterLegacyDetach.linked).toBe(false);
    expect(afterLegacyDetach.version).not.toBe(attached.after.version);
    expect(detachedState).toEqual({ linked: 0, revision: 2 });

    db.run(
      `INSERT INTO contact_projects (contact_id, project_id) VALUES (?, ?)`,
      [contact.id, projectId],
    );
    const afterLegacyAttach = readContactProjectMembership(contact.id, projectId, db);
    const reattachedState = db.query(
      `SELECT linked, revision
       FROM contact_project_membership_states
       WHERE contact_id = ? AND project_id = ?`,
    ).get(contact.id, projectId) as { linked: number; revision: number };
    expect(afterLegacyAttach.linked).toBe(true);
    expect(afterLegacyAttach.version).not.toBe(afterLegacyDetach.version);
    expect(reattachedState).toEqual({ linked: 1, revision: 3 });

    const receipt = db.query(
      `SELECT after_json
       FROM contact_project_membership_receipts
       WHERE operation_id = ? AND step_id = ?`,
    ).get("rollback-sync-candidate-attach", "contacts-membership:forward:v1") as { after_json: string };
    expect(JSON.parse(receipt.after_json)).toEqual(attached.after);

    db.run(`DELETE FROM contacts WHERE id = ?`, [contact.id]);
    expect(db.query(
      `SELECT 1 AS present
       FROM contact_project_membership_states
       WHERE contact_id = ?`,
    ).get(contact.id)).toBeNull();
  });
});
