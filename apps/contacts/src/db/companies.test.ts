import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import { createCompany, getCompany, updateCompany, deleteCompany, listCompanies } from "./companies.js";
import { CompanyNotFoundError } from "../types/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-co-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("createCompany", () => {
  it("creates a company with a name", () => {
    const co = createCompany({ name: "Acme Corp" });
    expect(co.name).toBe("Acme Corp");
    expect(co.id).toBeTruthy();
    expect(co.emails).toEqual([]);
    expect(co.employee_count).toBe(0);
  });

  it("creates a company with full details", () => {
    const co = createCompany({
      name: "TechCo",
      domain: "techco.com",
      industry: "Technology",
      size: "50-100",
      founded_year: 2010,
      description: "A tech company",
      notes: "Interesting company",
    });
    expect(co.domain).toBe("techco.com");
    expect(co.industry).toBe("Technology");
    expect(co.size).toBe("50-100");
    expect(co.founded_year).toBe(2010);
    expect(co.description).toBe("A tech company");
  });

  it("creates a company with emails", () => {
    const co = createCompany({
      name: "ContactCo",
      emails: [{ address: "info@contactco.com", type: "work" }],
    });
    expect(co.emails).toHaveLength(1);
    expect(co.emails[0]!.address).toBe("info@contactco.com");
  });
});

describe("getCompany", () => {
  it("retrieves by id", () => {
    const co = createCompany({ name: "GetMe Inc" });
    const fetched = getCompany(co.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("GetMe Inc");
  });

  it("throws CompanyNotFoundError for missing id", () => {
    expect(() => getCompany("nonexistent-id")).toThrow(CompanyNotFoundError);
  });
});

describe("updateCompany", () => {
  it("updates company name", () => {
    const co = createCompany({ name: "Old Name" });
    const updated = updateCompany(co.id, { name: "New Name" });
    expect(updated.name).toBe("New Name");
  });

  it("updates domain and industry", () => {
    const co = createCompany({ name: "XYZ Ltd" });
    const updated = updateCompany(co.id, { domain: "xyz.com", industry: "Finance" });
    expect(updated.domain).toBe("xyz.com");
    expect(updated.industry).toBe("Finance");
  });

  it("throws CompanyNotFoundError for missing id", () => {
    expect(() => updateCompany("nonexistent", { name: "X" })).toThrow(CompanyNotFoundError);
  });
});

describe("deleteCompany", () => {
  it("deletes a company", () => {
    const co = createCompany({ name: "Delete Me" });
    deleteCompany(co.id);
    expect(() => getCompany(co.id)).toThrow(CompanyNotFoundError);
  });

  it("throws CompanyNotFoundError for missing id", () => {
    expect(() => deleteCompany("nonexistent")).toThrow(CompanyNotFoundError);
  });
});

describe("listCompanies", () => {
  it("returns empty list when no companies", () => {
    const result = listCompanies();
    expect(result.companies).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("returns all companies with counts", () => {
    createCompany({ name: "Alpha Inc" });
    createCompany({ name: "Beta LLC" });
    const result = listCompanies();
    expect(result.total).toBe(2);
    expect(result.companies).toHaveLength(2);
  });

  it("filters by industry", () => {
    createCompany({ name: "Tech A", industry: "Technology" });
    createCompany({ name: "Finance B", industry: "Finance" });
    const result = listCompanies({ industry: "Technology" });
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0]!.name).toBe("Tech A");
  });

  it("respects limit and offset", () => {
    createCompany({ name: "C1" });
    createCompany({ name: "C2" });
    createCompany({ name: "C3" });
    const page1 = listCompanies({ limit: 2, offset: 0 });
    expect(page1.companies).toHaveLength(2);
    expect(page1.total).toBe(3);
  });
});
