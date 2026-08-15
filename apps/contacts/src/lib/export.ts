/**
 * Export contacts to CSV, vCard (.vcf), or JSON formats.
 * Accepts ContactWithDetails from src/types/index.ts.
 */

import type { ContactWithDetails } from "../types/index.js";

export type ExportContact = ContactWithDetails;

// ---------- JSON Export ----------

function toJson(contacts: ExportContact[]): string {
  return JSON.stringify(contacts, null, 2);
}

// ---------- CSV Export ----------

function escapeCsvField(val: string | number | null | undefined): string {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(contacts: ExportContact[]): string {
  const headers = [
    "First Name",
    "Last Name",
    "Name",
    "Nickname",
    "Job Title",
    "Company",
    "Email 1 - Value",
    "Email 1 - Type",
    "Email 2 - Value",
    "Email 2 - Type",
    "Phone 1 - Value",
    "Phone 1 - Type",
    "Phone 2 - Value",
    "Phone 2 - Type",
    "Address 1 - Street",
    "Address 1 - City",
    "Address 1 - State",
    "Address 1 - Postal Code",
    "Address 1 - Country",
    "Address 1 - Type",
    "Birthday",
    "Notes",
    "Tags",
  ];

  const rows = [headers.map(escapeCsvField).join(",")];

  for (const c of contacts) {
    const emails = c.emails ?? [];
    const phones = c.phones ?? [];
    const addrs = c.addresses ?? [];
    const tags = (c.tags ?? []).map((t) => t.name).join(";");

    const row = [
      c.first_name,
      c.last_name,
      c.display_name,
      c.nickname,
      c.job_title,
      c.company?.name,
      emails[0]?.address,
      emails[0]?.type,
      emails[1]?.address,
      emails[1]?.type,
      phones[0]?.number,
      phones[0]?.type,
      phones[1]?.number,
      phones[1]?.type,
      addrs[0]?.street,
      addrs[0]?.city,
      addrs[0]?.state,
      addrs[0]?.zip,
      addrs[0]?.country,
      addrs[0]?.type,
      c.birthday,
      c.notes,
      tags,
    ];

    rows.push(row.map(escapeCsvField).join(","));
  }

  return rows.join("\n");
}

// ---------- vCard Export ----------

function escapeVcfValue(val: string | null | undefined): string {
  if (!val) return "";
  return val
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n");
}

function foldVcfLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) {
    parts.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join("\r\n");
}

function toVcf(contacts: ExportContact[]): string {
  const cards: string[] = [];

  for (const c of contacts) {
    const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

    lines.push(`FN:${escapeVcfValue(c.display_name)}`);
    lines.push(`N:${escapeVcfValue(c.last_name)};${escapeVcfValue(c.first_name)};;;`);

    if (c.nickname) lines.push(`NICKNAME:${escapeVcfValue(c.nickname)}`);
    if (c.job_title) lines.push(`TITLE:${escapeVcfValue(c.job_title)}`);
    if (c.company?.name) lines.push(`ORG:${escapeVcfValue(c.company.name)}`);
    if (c.birthday) lines.push(`BDAY:${c.birthday.replace(/-/g, "")}`);

    for (let i = 0; i < (c.emails ?? []).length; i++) {
      const e = c.emails[i]!;
      const pref = (i === 0 || e.is_primary) ? ";PREF" : "";
      lines.push(`EMAIL;TYPE=${e.type.toUpperCase()}${pref}:${escapeVcfValue(e.address)}`);
    }

    for (let i = 0; i < (c.phones ?? []).length; i++) {
      const p = c.phones[i]!;
      const pref = (i === 0 || p.is_primary) ? ";PREF" : "";
      const vcfType = p.type === "mobile" ? "CELL" : p.type.toUpperCase();
      lines.push(`TEL;TYPE=${vcfType}${pref}:${escapeVcfValue(p.number)}`);
    }

    for (let i = 0; i < (c.addresses ?? []).length; i++) {
      const a = c.addresses[i]!;
      const pref = (i === 0 || a.is_primary) ? ";PREF" : "";
      lines.push(
        `ADR;TYPE=${a.type.toUpperCase()}${pref}:;;${escapeVcfValue(a.street)};${escapeVcfValue(a.city)};${escapeVcfValue(a.state)};${escapeVcfValue(a.zip)};${escapeVcfValue(a.country)}`
      );
    }

    for (const sp of c.social_profiles ?? []) {
      if (sp.url) lines.push(`URL;TYPE=${sp.platform.toUpperCase()}:${escapeVcfValue(sp.url)}`);
      if (sp.handle) lines.push(`X-SOCIALPROFILE;TYPE=${sp.platform.toLowerCase()}:${escapeVcfValue(sp.handle)}`);
    }

    if (c.notes) lines.push(`NOTE:${escapeVcfValue(c.notes)}`);

    if (c.tags && c.tags.length > 0) {
      lines.push(`CATEGORIES:${c.tags.map((t) => escapeVcfValue(t.name)).join(",")}`);
    }

    lines.push(`UID:${c.id}`);
    lines.push("END:VCARD");

    cards.push(lines.map(foldVcfLine).join("\r\n"));
  }

  return cards.join("\r\n");
}

// ---------- Public API ----------

export async function exportContacts(
  format: "json" | "csv" | "vcf",
  contacts: ExportContact[]
): Promise<string> {
  switch (format) {
    case "json":
      return toJson(contacts);
    case "csv":
      return toCsv(contacts);
    case "vcf":
      return toVcf(contacts);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}
