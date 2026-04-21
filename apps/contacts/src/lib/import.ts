/**
 * Import contacts from CSV, vCard (.vcf), or JSON formats.
 * Returns an array of CreateContactInput objects (matching src/types/index.ts).
 */

import type {
  CreateContactInput,
  CreateEmailInput,
  CreatePhoneInput,
  CreateAddressInput,
  CreateSocialProfileInput,
  EmailType,
  PhoneType,
  AddressType,
  SocialPlatform,
} from "../types/index.js";

export type { CreateContactInput };

// ---------- CSV Import ----------

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]!);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = values[idx]?.trim() ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function csvRowToContact(row: Record<string, string>): CreateContactInput | null {
  const firstName = row["First Name"] ?? row["first_name"] ?? row["Given Name"] ?? "";
  const lastName = row["Last Name"] ?? row["last_name"] ?? row["Family Name"] ?? "";
  const displayName =
    row["Name"] ?? row["display_name"] ?? row["Full Name"] ??
    [firstName, lastName].filter(Boolean).join(" ") ?? "";

  if (!displayName && !firstName && !lastName) return null;

  const contact: CreateContactInput = {
    display_name: displayName || [firstName, lastName].filter(Boolean).join(" ") || "Unnamed",
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    job_title: row["Job Title"] ?? row["job_title"] ?? row["Title"] ?? undefined,
    notes: row["Notes"] ?? row["notes"] ?? undefined,
    birthday: row["Birthday"] ?? row["birthday"] ?? undefined,
    source: "import",
  };

  // Collect emails
  const emails: CreateEmailInput[] = [];
  for (let i = 1; i <= 5; i++) {
    const val =
      row[`Email ${i} - Value`] ??
      row[`Email Address ${i}`] ??
      (i === 1 ? row["Email"] ?? row["email"] ?? row["Email Address"] : undefined);
    const rawType =
      row[`Email ${i} - Type`] ??
      (i === 1 ? "work" : "other");
    if (val) {
      const type: EmailType =
        rawType?.toLowerCase() === "personal" ? "personal" :
        rawType?.toLowerCase() === "other" ? "other" : "work";
      emails.push({ address: val, type, is_primary: i === 1 });
    }
  }
  if (emails.length) contact.emails = emails;

  // Collect phones
  const phones: CreatePhoneInput[] = [];
  for (let i = 1; i <= 5; i++) {
    const val =
      row[`Phone ${i} - Value`] ??
      row[`Phone ${i}`] ??
      (i === 1 ? row["Phone"] ?? row["phone"] ?? row["Mobile"] : undefined);
    const rawType =
      row[`Phone ${i} - Type`] ??
      (i === 1 ? "mobile" : "other");
    if (val) {
      const type: PhoneType =
        rawType?.toLowerCase().includes("mobile") || rawType?.toLowerCase().includes("cell") ? "mobile" :
        rawType?.toLowerCase().includes("work") ? "work" :
        rawType?.toLowerCase().includes("home") ? "home" :
        rawType?.toLowerCase().includes("fax") ? "fax" : "other";
      phones.push({ number: val, type, is_primary: i === 1 });
    }
  }
  if (phones.length) contact.phones = phones;

  return contact;
}

export function importFromCsv(data: string): CreateContactInput[] {
  const rows = parseCsv(data);
  return rows.map(csvRowToContact).filter(Boolean) as CreateContactInput[];
}

// ---------- vCard Import ----------

function parseVcf(data: string): CreateContactInput[] {
  const contacts: CreateContactInput[] = [];
  const blocks = data.split(/BEGIN:VCARD/i).filter((b) => b.trim());

  for (const block of blocks) {
    try {
      const contact = parseVcfBlock("BEGIN:VCARD\n" + block);
      if (contact) contacts.push(contact);
    } catch {
      // Skip malformed vCards
    }
  }

  return contacts;
}

function parseVcfBlock(block: string): CreateContactInput | null {
  // Unfold lines (RFC 2425: CRLF + whitespace)
  const unfolded = block.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/).filter((l) => l.trim());

  const contact: CreateContactInput = { source: "import" };
  const emails: CreateEmailInput[] = [];
  const phones: CreatePhoneInput[] = [];
  const addresses: CreateAddressInput[] = [];
  const socials: CreateSocialProfileInput[] = [];

  for (const line of lines) {
    if (/^BEGIN:VCARD$/i.test(line) || /^END:VCARD$/i.test(line) || /^VERSION:/i.test(line)) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const propPart = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1).trim();
    const semicolonIdx = propPart.indexOf(";");
    const propName = (semicolonIdx === -1 ? propPart : propPart.slice(0, semicolonIdx)).toUpperCase();
    const params = semicolonIdx !== -1 ? propPart.slice(semicolonIdx + 1) : "";

    switch (propName) {
      case "FN":
        contact.display_name = decodeVcfValue(value);
        break;
      case "N": {
        const parts = value.split(";");
        contact.last_name = decodeVcfValue(parts[0] ?? "") || undefined;
        contact.first_name = decodeVcfValue(parts[1] ?? "") || undefined;
        break;
      }
      case "NICKNAME":
        contact.nickname = decodeVcfValue(value) || undefined;
        break;
      case "TITLE":
        contact.job_title = decodeVcfValue(value) || undefined;
        break;
      case "NOTE":
        contact.notes = decodeVcfValue(value) || undefined;
        break;
      case "BDAY":
        contact.birthday = value.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
        break;
      case "EMAIL": {
        const typeMatch = params.match(/TYPE=([^;]+)/i);
        const rawLabel = typeMatch ? typeMatch[1]!.toLowerCase() : "work";
        const type: EmailType = rawLabel.includes("personal") ? "personal" : rawLabel.includes("other") ? "other" : "work";
        const isPrimary = params.includes("PREF") || emails.length === 0;
        emails.push({ address: decodeVcfValue(value), type, is_primary: isPrimary });
        break;
      }
      case "TEL": {
        const typeMatch = params.match(/TYPE=([^;]+)/i);
        const rawLabel = typeMatch ? typeMatch[1]!.toLowerCase() : "mobile";
        const type: PhoneType =
          rawLabel.includes("cell") || rawLabel.includes("mobile") ? "mobile" :
          rawLabel.includes("work") ? "work" :
          rawLabel.includes("home") ? "home" :
          rawLabel.includes("fax") ? "fax" : "other";
        const isPrimary = params.includes("PREF") || phones.length === 0;
        phones.push({ number: decodeVcfValue(value), type, is_primary: isPrimary });
        break;
      }
      case "ADR": {
        // ADR:;;street;city;state;postal;country
        const parts = value.split(";");
        const typeMatch = params.match(/TYPE=([^;]+)/i);
        const rawLabel = typeMatch ? typeMatch[1]!.toLowerCase().split(",")[0]! : "physical";
        const type: AddressType =
          rawLabel.includes("home") || rawLabel.includes("physical") ? "physical" :
          rawLabel.includes("mail") ? "mailing" :
          rawLabel.includes("bill") ? "billing" : "other";
        addresses.push({
          type,
          street: decodeVcfValue(parts[2] ?? "") || undefined,
          city: decodeVcfValue(parts[3] ?? "") || undefined,
          state: decodeVcfValue(parts[4] ?? "") || undefined,
          zip: decodeVcfValue(parts[5] ?? "") || undefined,
          country: decodeVcfValue(parts[6] ?? "") || undefined,
          is_primary: addresses.length === 0,
        });
        break;
      }
      case "URL": {
        const url = decodeVcfValue(value);
        const platform = detectPlatform(url);
        socials.push({ platform, url, handle: url });
        break;
      }
      case "X-SOCIALPROFILE": {
        const typeMatch = params.match(/TYPE=([^;]+)/i);
        const platform = normalizePlatform(typeMatch?.[1] ?? "other");
        socials.push({ platform, handle: decodeVcfValue(value), url: value });
        break;
      }
    }
  }

  if (!contact.display_name) {
    if (contact.first_name || contact.last_name) {
      contact.display_name = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
    } else {
      return null;
    }
  }

  if (emails.length) contact.emails = emails;
  if (phones.length) contact.phones = phones;
  if (addresses.length) contact.addresses = addresses;
  if (socials.length) contact.social_profiles = socials;

  return contact;
}

function decodeVcfValue(val: string): string {
  // Process \\\\ FIRST so escaped backslashes don't get consumed by later replacements
  return val
    .replace(/\\\\/g, "\x00")
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\x00/g, "\\");
}

function detectPlatform(url: string): SocialPlatform {
  const lower = url.toLowerCase();
  if (lower.includes("twitter.com") || lower.includes("x.com")) return "twitter";
  if (lower.includes("linkedin.com")) return "linkedin";
  if (lower.includes("github.com")) return "github";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("facebook.com")) return "facebook";
  if (lower.includes("youtube.com")) return "youtube";
  if (lower.includes("telegram")) return "telegram";
  if (lower.includes("discord")) return "discord";
  if (lower.includes("tiktok")) return "tiktok";
  if (lower.includes("bluesky") || lower.includes("bsky")) return "bluesky";
  return "other";
}

function normalizePlatform(raw: string): SocialPlatform {
  const lower = raw.toLowerCase();
  const platforms: SocialPlatform[] = [
    "twitter", "linkedin", "github", "instagram", "telegram", "discord",
    "youtube", "tiktok", "bluesky", "facebook", "whatsapp", "snapchat", "reddit",
  ];
  for (const p of platforms) {
    if (lower.includes(p)) return p;
  }
  return "other";
}

// ---------- JSON Import ----------

function importFromJson(data: string): CreateContactInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error("Invalid JSON");
  }

  if (!Array.isArray(parsed)) {
    if (typeof parsed === "object" && parsed !== null) {
      parsed = [parsed];
    } else {
      throw new Error("JSON must be an array of contacts");
    }
  }

  return (parsed as Record<string, unknown>[]).map((obj) => {
    const displayName =
      (obj.display_name as string | undefined) ??
      (obj.name as string | undefined) ??
      [(obj.first_name as string | undefined) ?? "", (obj.last_name as string | undefined) ?? ""]
        .filter(Boolean)
        .join(" ") ??
      "Unnamed";

    return {
      ...obj,
      display_name: displayName,
      source: "import",
    } as CreateContactInput;
  });
}

// ---------- LinkedIn CSV Import ----------

function parseLinkedInCsvLine(line: string): string[] {
  // Reuse parseCsvLine for consistency
  return parseCsvLine(line);
}

export function parseLinkedIn(csv: string): CreateContactInput[] {
  const lines = csv.split('\n').filter(l => l.trim());
  if (!lines.length) return [];

  const headers = parseLinkedInCsvLine(lines[0]!).map(h => h.replace(/"/g, '').trim());

  const firstNameIdx = headers.findIndex(h => h === 'First Name');
  const lastNameIdx = headers.findIndex(h => h === 'Last Name');
  const emailIdx = headers.findIndex(h => h === 'Email Address');
  const companyIdx = headers.findIndex(h => h === 'Company');
  const positionIdx = headers.findIndex(h => h === 'Position');
  const urlIdx = headers.findIndex(h => h === 'URL');
  const connectedIdx = headers.findIndex(h => h === 'Connected On');

  const results: CreateContactInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLinkedInCsvLine(lines[i]!);
    const firstName = firstNameIdx >= 0 ? (cols[firstNameIdx] ?? '').trim() : '';
    const lastName = lastNameIdx >= 0 ? (cols[lastNameIdx] ?? '').trim() : '';
    if (!firstName && !lastName) continue;

    const contact: CreateContactInput = {
      first_name: firstName,
      last_name: lastName,
      display_name: `${firstName} ${lastName}`.trim(),
      source: 'import',
    };

    if (emailIdx >= 0 && cols[emailIdx]?.trim()) {
      contact.emails = [{ address: cols[emailIdx]!.trim(), type: 'work', is_primary: true }];
    }
    if (positionIdx >= 0 && cols[positionIdx]?.trim()) {
      contact.job_title = cols[positionIdx]!.trim();
    }
    if (urlIdx >= 0 && cols[urlIdx]?.trim()) {
      contact.social_profiles = [{ platform: 'linkedin', url: cols[urlIdx]!.trim(), is_primary: true }];
    }
    if (companyIdx >= 0 && cols[companyIdx]?.trim()) {
      // Store company name in notes — cannot resolve to company_id without lookup
      const connectedNote = connectedIdx >= 0 && cols[connectedIdx]?.trim()
        ? ` Connected on LinkedIn: ${cols[connectedIdx]!.trim()}`
        : '';
      contact.notes = `Company: ${cols[companyIdx]!.trim()}${connectedNote}`;
    } else if (connectedIdx >= 0 && cols[connectedIdx]?.trim()) {
      contact.notes = `Connected on LinkedIn: ${cols[connectedIdx]!.trim()}`;
    }

    results.push(contact);
  }
  return results;
}

// ---------- Public API ----------

function isLinkedInFormat(data: string): boolean {
  const firstLine = data.split('\n')[0] ?? '';
  const lower = firstLine.toLowerCase();
  return lower.includes('first name') && lower.includes('url') && lower.includes('connected on');
}

export async function importContacts(
  format: "json" | "csv" | "vcf",
  data: string
): Promise<CreateContactInput[]> {
  switch (format) {
    case "csv":
      // Auto-detect LinkedIn CSV format
      if (isLinkedInFormat(data)) return parseLinkedIn(data);
      return importFromCsv(data);
    case "vcf":
      return parseVcf(data);
    case "json":
      return importFromJson(data);
    default:
      throw new Error(`Unsupported import format: ${format}`);
  }
}
