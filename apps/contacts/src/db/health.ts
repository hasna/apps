import { getDatabase, uuid, now } from "./database.js";
import { requireVault } from "../lib/vault.js";
import type { Database } from "bun:sqlite";

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

export interface ContactHealth {
  id: string;
  contact_id: string;
  blood_type: string | null;
  allergies: string[];
  medical_conditions: string[];
  medications: string[];
  emergency_contacts: EmergencyContact[];
  health_insurance_provider: string | null;
  health_insurance_id: string | null;
  primary_physician: string | null;
  primary_physician_phone: string | null;
  organ_donor: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SetHealthInput {
  blood_type?: string;
  allergies?: string[];
  medical_conditions?: string[];
  medications?: string[];
  emergency_contacts?: EmergencyContact[];
  health_insurance_provider?: string;
  health_insurance_id?: string;
  primary_physician?: string;
  primary_physician_phone?: string;
  organ_donor?: boolean;
  notes?: string;
}

export function setHealthData(contactId: string, input: SetHealthInput, db?: Database): ContactHealth {
  requireVault();
  const _db = db || getDatabase();
  const existing = _db.query(`SELECT id FROM contact_health WHERE contact_id = ?`).get(contactId) as { id: string } | null;

  if (existing) {
    // Update
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (input.blood_type !== undefined) { sets.push("blood_type = ?"); params.push(input.blood_type); }
    if (input.allergies !== undefined) { sets.push("allergies = ?"); params.push(JSON.stringify(input.allergies)); }
    if (input.medical_conditions !== undefined) { sets.push("medical_conditions = ?"); params.push(JSON.stringify(input.medical_conditions)); }
    if (input.medications !== undefined) { sets.push("medications = ?"); params.push(JSON.stringify(input.medications)); }
    if (input.emergency_contacts !== undefined) { sets.push("emergency_contacts = ?"); params.push(JSON.stringify(input.emergency_contacts)); }
    if (input.health_insurance_provider !== undefined) { sets.push("health_insurance_provider = ?"); params.push(input.health_insurance_provider); }
    if (input.health_insurance_id !== undefined) { sets.push("health_insurance_id = ?"); params.push(input.health_insurance_id); }
    if (input.primary_physician !== undefined) { sets.push("primary_physician = ?"); params.push(input.primary_physician); }
    if (input.primary_physician_phone !== undefined) { sets.push("primary_physician_phone = ?"); params.push(input.primary_physician_phone); }
    if (input.organ_donor !== undefined) { sets.push("organ_donor = ?"); params.push(input.organ_donor ? 1 : 0); }
    if (input.notes !== undefined) { sets.push("notes = ?"); params.push(input.notes); }
    if (sets.length) {
      sets.push("updated_at = ?"); params.push(now());
      params.push(contactId);
      _db.query(`UPDATE contact_health SET ${sets.join(", ")} WHERE contact_id = ?`).run(...params);
    }
  } else {
    // Insert
    const id = uuid();
    _db.query(`INSERT INTO contact_health (id, contact_id, blood_type, allergies, medical_conditions, medications, emergency_contacts, health_insurance_provider, health_insurance_id, primary_physician, primary_physician_phone, organ_donor, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, contactId, input.blood_type ?? null, JSON.stringify(input.allergies || []), JSON.stringify(input.medical_conditions || []), JSON.stringify(input.medications || []), JSON.stringify(input.emergency_contacts || []), input.health_insurance_provider ?? null, input.health_insurance_id ?? null, input.primary_physician ?? null, input.primary_physician_phone ?? null, input.organ_donor ? 1 : 0, input.notes ?? null, now(), now());
  }
  return getHealthData(contactId, _db)!;
}

export function getHealthData(contactId: string, db?: Database): ContactHealth | null {
  requireVault();
  const _db = db || getDatabase();
  const row = _db.query(`SELECT * FROM contact_health WHERE contact_id = ?`).get(contactId) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    id: row.id as string, contact_id: row.contact_id as string,
    blood_type: row.blood_type as string | null, allergies: JSON.parse((row.allergies as string) || "[]"),
    medical_conditions: JSON.parse((row.medical_conditions as string) || "[]"),
    medications: JSON.parse((row.medications as string) || "[]"),
    emergency_contacts: JSON.parse((row.emergency_contacts as string) || "[]"),
    health_insurance_provider: row.health_insurance_provider as string | null,
    health_insurance_id: row.health_insurance_id as string | null,
    primary_physician: row.primary_physician as string | null,
    primary_physician_phone: row.primary_physician_phone as string | null,
    organ_donor: !!(row.organ_donor),
    notes: row.notes as string | null,
    created_at: row.created_at as string, updated_at: row.updated_at as string,
  };
}

export function deleteHealthData(contactId: string, db?: Database): void {
  const _db = db || getDatabase();
  _db.query(`DELETE FROM contact_health WHERE contact_id = ?`).run(contactId);
}
