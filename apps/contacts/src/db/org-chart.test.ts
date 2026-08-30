import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase, getDatabase } from "./database.js";
import {
  addOrgChartEdge,
  listOrgChart,
  setDealContactRole,
  getDealTeam,
  getCoverageGaps,
} from "./org-chart.js";
import { createContact } from "./contacts.js";
import { createCompany } from "./companies.js";
import { createDeal } from "./deals.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("addOrgChartEdge", () => {
  it("creates an org chart edge", () => {
    const company = createCompany({ name: "OrgCo" });
    const manager = createContact({ display_name: "Manager", company_id: company.id });
    const report = createContact({ display_name: "Report", company_id: company.id });
    const edge = addOrgChartEdge(company.id, manager.id, report.id, "manages");
    expect(edge.id).toBeTruthy();
    expect(edge.company_id).toBe(company.id);
    expect(edge.contact_a_id).toBe(manager.id);
    expect(edge.contact_b_id).toBe(report.id);
    expect(edge.edge_type).toBe("manages");
    expect(edge.created_at).toBeTruthy();
  });

  it("creates edges of different types", () => {
    const company = createCompany({ name: "TypeCo" });
    const a = createContact({ display_name: "A", company_id: company.id });
    const b = createContact({ display_name: "B", company_id: company.id });
    const e1 = addOrgChartEdge(company.id, a.id, b.id, "reports_to");
    const e2 = addOrgChartEdge(company.id, a.id, b.id, "collaborates_with");
    expect(e1.edge_type).toBe("reports_to");
    expect(e2.edge_type).toBe("collaborates_with");
  });

  it("sets inferred flag", () => {
    const company = createCompany({ name: "InferCo" });
    const a = createContact({ display_name: "A", company_id: company.id });
    const b = createContact({ display_name: "B", company_id: company.id });
    const edge = addOrgChartEdge(company.id, a.id, b.id, "peer", true);
    expect(edge.inferred).toBeTruthy();
  });

  it("defaults inferred to false", () => {
    const company = createCompany({ name: "DefCo" });
    const a = createContact({ display_name: "A", company_id: company.id });
    const b = createContact({ display_name: "B", company_id: company.id });
    const edge = addOrgChartEdge(company.id, a.id, b.id, "manages");
    // SQLite stores as 0, check falsy
    expect(!!edge.inferred).toBe(false);
  });

  it("ignores duplicate edge with same company/contacts/type (INSERT OR IGNORE)", () => {
    const company = createCompany({ name: "DupCo" });
    const a = createContact({ display_name: "A", company_id: company.id });
    const b = createContact({ display_name: "B", company_id: company.id });
    const e1 = addOrgChartEdge(company.id, a.id, b.id, "manages");
    const e2 = addOrgChartEdge(company.id, a.id, b.id, "manages");
    // Should return the same edge (the original one due to UNIQUE constraint)
    expect(e1.id).toBe(e2.id);
  });
});

describe("listOrgChart", () => {
  it("lists org chart edges with contact names", () => {
    const company = createCompany({ name: "ListCo" });
    const a = createContact({ display_name: "Alice", company_id: company.id });
    const b = createContact({ display_name: "Bob", company_id: company.id });
    addOrgChartEdge(company.id, a.id, b.id, "manages");
    const chart = listOrgChart(company.id);
    expect(chart).toHaveLength(1);
    expect(chart[0]!.contact_a_name).toBe("Alice");
    expect(chart[0]!.contact_b_name).toBe("Bob");
    expect(chart[0]!.edge_type).toBe("manages");
  });

  it("returns empty array for company with no edges", () => {
    const company = createCompany({ name: "EmptyCo" });
    const chart = listOrgChart(company.id);
    expect(chart).toEqual([]);
  });

  it("returns multiple edges", () => {
    const company = createCompany({ name: "MultiCo" });
    const a = createContact({ display_name: "A", company_id: company.id });
    const b = createContact({ display_name: "B", company_id: company.id });
    const c = createContact({ display_name: "C", company_id: company.id });
    addOrgChartEdge(company.id, a.id, b.id, "manages");
    addOrgChartEdge(company.id, a.id, c.id, "manages");
    addOrgChartEdge(company.id, b.id, c.id, "peer");
    const chart = listOrgChart(company.id);
    expect(chart).toHaveLength(3);
  });
});

describe("setDealContactRole", () => {
  it("sets a deal contact role", () => {
    const company = createCompany({ name: "DealCo" });
    const contact = createContact({ display_name: "Buyer", company_id: company.id });
    const deal = createDeal({ title: "Big Deal", company_id: company.id, contact_id: contact.id });
    const role = setDealContactRole(deal.id, contact.id, "economic_buyer");
    expect(role.id).toBeTruthy();
    expect(role.deal_id).toBe(deal.id);
    expect(role.contact_id).toBe(contact.id);
    expect(role.account_role).toBe("economic_buyer");
    expect(role.created_at).toBeTruthy();
  });

  it("replaces role for same deal+contact (INSERT OR REPLACE)", () => {
    const company = createCompany({ name: "ReplaceCo" });
    const contact = createContact({ display_name: "Eval", company_id: company.id });
    const deal = createDeal({ title: "Deal2", company_id: company.id });
    setDealContactRole(deal.id, contact.id, "champion");
    const updated = setDealContactRole(deal.id, contact.id, "blocker");
    expect(updated.account_role).toBe("blocker");
  });

  it("supports all account role types", () => {
    const company = createCompany({ name: "RoleCo" });
    const deal = createDeal({ title: "Roles", company_id: company.id });
    const roles: Array<"economic_buyer" | "technical_evaluator" | "champion" | "blocker" | "influencer" | "user" | "sponsor" | "other"> =
      ["economic_buyer", "technical_evaluator", "champion", "blocker", "influencer", "user", "sponsor", "other"];
    for (const role of roles) {
      const contact = createContact({ display_name: `Role-${role}` });
      const result = setDealContactRole(deal.id, contact.id, role);
      expect(result.account_role).toBe(role);
    }
  });
});

describe("getDealTeam", () => {
  it("returns deal team with contact details", () => {
    const company = createCompany({ name: "TeamCo" });
    const c1 = createContact({ display_name: "Alice", job_title: "CEO", company_id: company.id });
    const c2 = createContact({ display_name: "Bob", job_title: "CTO", company_id: company.id });
    const deal = createDeal({ title: "TeamDeal", company_id: company.id });
    setDealContactRole(deal.id, c1.id, "economic_buyer");
    setDealContactRole(deal.id, c2.id, "technical_evaluator");
    const team = getDealTeam(deal.id);
    expect(team).toHaveLength(2);
    const names = team.map(t => t.display_name).sort();
    expect(names).toEqual(["Alice", "Bob"]);
    const alice = team.find(t => t.display_name === "Alice");
    expect(alice!.job_title).toBe("CEO");
    expect(alice!.account_role).toBe("economic_buyer");
  });

  it("returns empty array for deal with no roles", () => {
    const deal = createDeal({ title: "EmptyDeal" });
    const team = getDealTeam(deal.id);
    expect(team).toEqual([]);
  });
});

describe("getCoverageGaps", () => {
  it("reports gaps when company has no org chart or deal roles", () => {
    const company = createCompany({ name: "GapCo" });
    createContact({ display_name: "Solo", company_id: company.id });
    const gaps = getCoverageGaps(company.id);
    expect(gaps.total_contacts).toBe(1);
    expect(gaps.has_manager).toBe(false);
    expect(gaps.has_technical).toBe(false);
    expect(gaps.has_economic_buyer).toBe(false);
    expect(gaps.suggestion).toContain("Missing");
    expect(gaps.suggestion).toContain("org chart relationships");
    expect(gaps.suggestion).toContain("economic buyer");
    expect(gaps.suggestion).toContain("technical evaluator");
  });

  it("reports good coverage when all roles present", () => {
    const company = createCompany({ name: "FullCo" });
    const mgr = createContact({ display_name: "Manager", company_id: company.id });
    const dev = createContact({ display_name: "Dev", company_id: company.id });
    const buyer = createContact({ display_name: "Buyer", company_id: company.id });
    // Add manager edge
    addOrgChartEdge(company.id, mgr.id, dev.id, "manages");
    // Add deal roles
    const deal = createDeal({ title: "Coverage", company_id: company.id });
    setDealContactRole(deal.id, buyer.id, "economic_buyer");
    setDealContactRole(deal.id, dev.id, "technical_evaluator");
    const gaps = getCoverageGaps(company.id);
    expect(gaps.has_manager).toBe(true);
    expect(gaps.has_economic_buyer).toBe(true);
    expect(gaps.has_technical).toBe(true);
    expect(gaps.suggestion).toBe("Good coverage");
  });

  it("returns zero contacts for empty company", () => {
    const company = createCompany({ name: "ZeroCo" });
    const gaps = getCoverageGaps(company.id);
    expect(gaps.total_contacts).toBe(0);
  });

  it("does not count archived contacts", () => {
    const company = createCompany({ name: "ArchCo" });
    const c = createContact({ display_name: "Gone", company_id: company.id });
    const db = getDatabase();
    db.query(`UPDATE contacts SET archived = 1 WHERE id = ?`).run(c.id);
    const gaps = getCoverageGaps(company.id);
    expect(gaps.total_contacts).toBe(0);
  });
});
