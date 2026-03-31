import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import { setHealthData, getHealthData, deleteHealthData } from "./health.js";
import { createContact } from "./contacts.js";
import { initVault, lockVault } from "../lib/vault.js";

let tmpDir: string;
let contactId: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  process.env["HOME"] = tmpDir;
  resetDatabase();
  initVault("test-passphrase");
  const c = createContact({ display_name: "Health User" });
  contactId = c.id;
});

afterEach(() => {
  lockVault();
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("setHealthData", () => {
  it("creates health data with all fields", () => {
    const h = setHealthData(contactId, {
      blood_type: "O+",
      allergies: ["peanuts", "shellfish"],
      medical_conditions: ["asthma"],
      medications: ["albuterol"],
      emergency_contacts: [{ name: "Jane", phone: "+1555000", relationship: "spouse" }],
      health_insurance_provider: "BlueCross",
      health_insurance_id: "BC-12345",
      primary_physician: "Dr. Smith",
      primary_physician_phone: "+1555999",
      organ_donor: true,
      notes: "No known drug allergies beyond listed",
    });
    expect(h.id).toBeTruthy();
    expect(h.contact_id).toBe(contactId);
    expect(h.blood_type).toBe("O+");
    expect(h.allergies).toEqual(["peanuts", "shellfish"]);
    expect(h.medical_conditions).toEqual(["asthma"]);
    expect(h.medications).toEqual(["albuterol"]);
    expect(h.emergency_contacts).toEqual([{ name: "Jane", phone: "+1555000", relationship: "spouse" }]);
    expect(h.health_insurance_provider).toBe("BlueCross");
    expect(h.health_insurance_id).toBe("BC-12345");
    expect(h.primary_physician).toBe("Dr. Smith");
    expect(h.primary_physician_phone).toBe("+1555999");
    expect(h.organ_donor).toBe(true);
    expect(h.notes).toBe("No known drug allergies beyond listed");
    expect(h.created_at).toBeTruthy();
    expect(h.updated_at).toBeTruthy();
  });

  it("creates health data with minimal fields", () => {
    const h = setHealthData(contactId, { blood_type: "A-" });
    expect(h.blood_type).toBe("A-");
    expect(h.allergies).toEqual([]);
    expect(h.medications).toEqual([]);
    expect(h.organ_donor).toBe(false);
    expect(h.notes).toBeNull();
  });

  it("updates existing health data", () => {
    setHealthData(contactId, { blood_type: "O+" });
    const updated = setHealthData(contactId, {
      blood_type: "O-",
      allergies: ["latex"],
    });
    expect(updated.blood_type).toBe("O-");
    expect(updated.allergies).toEqual(["latex"]);
  });

  it("updates only specified fields on existing record", () => {
    setHealthData(contactId, {
      blood_type: "AB+",
      primary_physician: "Dr. Old",
    });
    const updated = setHealthData(contactId, {
      primary_physician: "Dr. New",
    });
    expect(updated.blood_type).toBe("AB+");
    expect(updated.primary_physician).toBe("Dr. New");
  });

  it("handles empty update gracefully", () => {
    setHealthData(contactId, { blood_type: "B+" });
    const h = setHealthData(contactId, {});
    expect(h.blood_type).toBe("B+");
  });

  it("sets organ_donor to false when not specified on insert", () => {
    const h = setHealthData(contactId, {});
    expect(h.organ_donor).toBe(false);
  });

  it("toggles organ_donor from false to true", () => {
    setHealthData(contactId, {});
    const h = setHealthData(contactId, { organ_donor: true });
    expect(h.organ_donor).toBe(true);
  });
});

describe("getHealthData", () => {
  it("returns health data for a contact", () => {
    setHealthData(contactId, { blood_type: "O+" });
    const h = getHealthData(contactId);
    expect(h).not.toBeNull();
    expect(h!.blood_type).toBe("O+");
  });

  it("returns null for contact with no health data", () => {
    const h = getHealthData(contactId);
    expect(h).toBeNull();
  });

  it("correctly parses JSON arrays", () => {
    setHealthData(contactId, {
      allergies: ["dust", "mold"],
      medications: ["aspirin"],
      emergency_contacts: [
        { name: "A", phone: "1", relationship: "parent" },
        { name: "B", phone: "2", relationship: "sibling" },
      ],
    });
    const h = getHealthData(contactId)!;
    expect(h.allergies).toHaveLength(2);
    expect(h.medications).toHaveLength(1);
    expect(h.emergency_contacts).toHaveLength(2);
  });
});

describe("deleteHealthData", () => {
  it("deletes health data for a contact", () => {
    setHealthData(contactId, { blood_type: "AB-" });
    deleteHealthData(contactId);
    const h = getHealthData(contactId);
    expect(h).toBeNull();
  });

  it("does not throw when no health data exists", () => {
    expect(() => deleteHealthData(contactId)).not.toThrow();
  });
});
