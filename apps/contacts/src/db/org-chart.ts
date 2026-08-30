import type { ContactsDatabase } from "./database.js";
import { getDatabase, uuid, now } from "./database.js";

export type OrgEdgeType = "reports_to" | "manages" | "collaborates_with" | "peer";
export type AccountRole =
  | "economic_buyer"
  | "technical_evaluator"
  | "champion"
  | "blocker"
  | "influencer"
  | "user"
  | "sponsor"
  | "other";

export interface OrgChartEdge {
  id: string;
  company_id: string;
  contact_a_id: string;
  contact_b_id: string;
  edge_type: OrgEdgeType;
  inferred: boolean;
  created_at: string;
}

export interface DealContactRole {
  id: string;
  deal_id: string;
  contact_id: string;
  account_role: AccountRole;
  created_at: string;
}

export function addOrgChartEdge(
  companyId: string,
  contactAId: string,
  contactBId: string,
  edgeType: OrgEdgeType,
  inferred = false,
  db?: ContactsDatabase,
): OrgChartEdge {
  const _db = db || getDatabase();
  const id = uuid();
  _db
    .query(
      `INSERT OR IGNORE INTO org_chart_edges(id,company_id,contact_a_id,contact_b_id,edge_type,inferred,created_at) VALUES(?,?,?,?,?,?,?)`,
    )
    .run(id, companyId, contactAId, contactBId, edgeType, inferred ? 1 : 0, now());
  return _db
    .query(
      `SELECT * FROM org_chart_edges WHERE company_id=? AND contact_a_id=? AND contact_b_id=? AND edge_type=?`,
    )
    .get(companyId, contactAId, contactBId, edgeType) as OrgChartEdge;
}

export function listOrgChart(
  companyId: string,
  db?: ContactsDatabase,
): Array<OrgChartEdge & { contact_a_name: string; contact_b_name: string }> {
  const _db = db || getDatabase();
  return _db
    .query(
      `SELECT oe.*, ca.display_name as contact_a_name, cb.display_name as contact_b_name FROM org_chart_edges oe JOIN contacts ca ON oe.contact_a_id=ca.id JOIN contacts cb ON oe.contact_b_id=cb.id WHERE oe.company_id=?`,
    )
    .all(companyId) as Array<OrgChartEdge & { contact_a_name: string; contact_b_name: string }>;
}

export function setDealContactRole(
  dealId: string,
  contactId: string,
  accountRole: AccountRole,
  db?: ContactsDatabase,
): DealContactRole {
  const _db = db || getDatabase();
  const id = uuid();
  _db
    .query(
      `INSERT OR REPLACE INTO deal_contact_roles(id,deal_id,contact_id,account_role,created_at) VALUES(?,?,?,?,?)`,
    )
    .run(id, dealId, contactId, accountRole, now());
  return _db
    .query(`SELECT * FROM deal_contact_roles WHERE deal_id=? AND contact_id=?`)
    .get(dealId, contactId) as DealContactRole;
}

export function getDealTeam(
  dealId: string,
  db?: ContactsDatabase,
): Array<DealContactRole & { display_name: string; job_title?: string }> {
  const _db = db || getDatabase();
  return _db
    .query(
      `SELECT dr.*, c.display_name, c.job_title FROM deal_contact_roles dr JOIN contacts c ON dr.contact_id=c.id WHERE dr.deal_id=?`,
    )
    .all(dealId) as Array<DealContactRole & { display_name: string; job_title?: string }>;
}

export function getCoverageGaps(
  companyId: string,
  db?: ContactsDatabase,
): {
  total_contacts: number;
  has_manager: boolean;
  has_technical: boolean;
  has_economic_buyer: boolean;
  suggestion: string;
} {
  const _db = db || getDatabase();
  const total = (
    _db
      .query(`SELECT COUNT(*) c FROM contacts WHERE company_id=? AND archived=0`)
      .get(companyId) as { c: number }
  ).c;
  const hasManager =
    (
      _db
        .query(
          `SELECT COUNT(*) c FROM org_chart_edges WHERE company_id=? AND edge_type='manages'`,
        )
        .get(companyId) as { c: number }
    ).c > 0;
  const hasEco =
    (
      _db
        .query(
          `SELECT COUNT(*) c FROM deal_contact_roles dr JOIN deals d ON dr.deal_id=d.id WHERE d.company_id=? AND dr.account_role='economic_buyer'`,
        )
        .get(companyId) as { c: number }
    ).c > 0;
  const hasTech =
    (
      _db
        .query(
          `SELECT COUNT(*) c FROM deal_contact_roles dr JOIN deals d ON dr.deal_id=d.id WHERE d.company_id=? AND dr.account_role='technical_evaluator'`,
        )
        .get(companyId) as { c: number }
    ).c > 0;
  const missing = [
    !hasManager && "org chart relationships",
    !hasEco && "economic buyer",
    !hasTech && "technical evaluator",
  ].filter(Boolean);
  return {
    total_contacts: total,
    has_manager: hasManager,
    has_technical: hasTech,
    has_economic_buyer: hasEco,
    suggestion: missing.length ? `Missing: ${missing.join(", ")}` : "Good coverage",
  };
}
