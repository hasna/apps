import type { ContactsDatabase } from "../db/database.js";
import { getDatabase } from "../db/database.js";

export interface NetworkStats {
  total_contacts: number;
  total_companies: number;
  owned_entities: number;
  total_tags: number;
  total_groups: number;
  total_deals: number;
  total_events: number;
  cold_30d: number;
  cold_60d: number;
  cold_never: number;
  contacts_with_email: number;
  contacts_with_phone: number;
  contacts_no_company: number;
  overdue_tasks: number;
  pending_applications: number;
  missing_invoices: number;
  upcoming_7d: number;
  notes_count: number;
  active_deals_value: number;
}

export function getNetworkStats(db?: ContactsDatabase): NetworkStats {
  const _db = db || getDatabase();
  const q = (sql: string) => (_db.query(sql).get() as { c: number });
  const today = new Date().toISOString().slice(0, 10);
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const d60 = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  return {
    total_contacts: q(`SELECT COUNT(*) c FROM contacts WHERE archived=0`).c,
    total_companies: q(`SELECT COUNT(*) c FROM companies WHERE archived=0`).c,
    owned_entities: q(`SELECT COUNT(*) c FROM companies WHERE is_owned_entity=1`).c,
    total_tags: q(`SELECT COUNT(*) c FROM tags`).c,
    total_groups: q(`SELECT COUNT(*) c FROM groups`).c,
    total_deals: q(`SELECT COUNT(*) c FROM deals WHERE stage NOT IN ('won','lost','cancelled')`).c,
    total_events: q(`SELECT COUNT(*) c FROM events`).c,
    cold_30d: q(`SELECT COUNT(*) c FROM contacts WHERE archived=0 AND do_not_contact=0 AND (last_contacted_at IS NULL OR last_contacted_at < '${d30}')`).c,
    cold_60d: q(`SELECT COUNT(*) c FROM contacts WHERE archived=0 AND do_not_contact=0 AND (last_contacted_at IS NULL OR last_contacted_at < '${d60}')`).c,
    cold_never: q(`SELECT COUNT(*) c FROM contacts WHERE archived=0 AND do_not_contact=0 AND last_contacted_at IS NULL`).c,
    contacts_with_email: q(`SELECT COUNT(DISTINCT contact_id) c FROM emails WHERE contact_id IS NOT NULL`).c,
    contacts_with_phone: q(`SELECT COUNT(DISTINCT contact_id) c FROM phones WHERE contact_id IS NOT NULL`).c,
    contacts_no_company: q(`SELECT COUNT(*) c FROM contacts WHERE archived=0 AND company_id IS NULL`).c,
    overdue_tasks: q(`SELECT COUNT(*) c FROM contact_tasks WHERE deadline < '${today}' AND status NOT IN ('completed','cancelled')`).c,
    pending_applications: q(`SELECT COUNT(*) c FROM applications WHERE status IN ('submitted','pending','follow_up_needed')`).c,
    missing_invoices: q(`SELECT COUNT(*) c FROM vendor_communications WHERE type='invoice_request' AND status IN ('awaiting_response','no_response')`).c,
    upcoming_7d: q(`SELECT COUNT(*) c FROM contacts WHERE follow_up_at BETWEEN '${today}' AND date('${today}','+7 days')`).c,
    notes_count: q(`SELECT COUNT(*) c FROM contact_notes`).c,
    active_deals_value: q(`SELECT COALESCE(SUM(value_usd),0) c FROM deals WHERE stage NOT IN ('won','lost','cancelled') AND currency='USD'`).c,
  };
}
