import type { ContactsDatabase } from "../db/database.js";
import { getDatabase } from "../db/database.js";

export type UpcomingItemType = 'follow_up' | 'birthday' | 'task_deadline' | 'application_followup' | 'vendor_followup';

export interface UpcomingItem {
  date: string;
  type: UpcomingItemType;
  contact_id?: string;
  contact_name?: string;
  company_id?: string;
  company_name?: string;
  title: string;
  urgency: 'overdue' | 'today' | 'soon' | 'upcoming';
}

export function getUpcomingItems(days = 7, db?: ContactsDatabase): UpcomingItem[] {
  const _db = db || getDatabase();
  const items: UpcomingItem[] = [];
  const now = new Date();
  const future = new Date(now.getTime() + days * 86400000);
  const todayStr = now.toISOString().slice(0, 10);
  const futureStr = future.toISOString().slice(0, 10);

  // Contacts with follow_up_at in range
  const followUps = _db.query(`SELECT c.id, c.display_name, c.follow_up_at FROM contacts c WHERE c.follow_up_at IS NOT NULL AND c.follow_up_at <= ? AND c.do_not_contact = 0`).all(futureStr) as { id: string; display_name: string; follow_up_at: string }[];
  for (const r of followUps) {
    items.push({ date: r.follow_up_at, type: 'follow_up', contact_id: r.id, contact_name: r.display_name, title: `Follow up with ${r.display_name}`, urgency: r.follow_up_at < todayStr ? 'overdue' : r.follow_up_at === todayStr ? 'today' : 'upcoming' });
  }

  // Contact tasks with deadline in range
  const tasks = _db.query(`SELECT ct.*, c.display_name FROM contact_tasks ct JOIN contacts c ON ct.contact_id = c.id WHERE ct.deadline IS NOT NULL AND ct.deadline <= ? AND ct.status NOT IN ('completed','cancelled')`).all(futureStr) as { id: string; contact_id: string; title: string; deadline: string; display_name: string }[];
  for (const t of tasks) {
    items.push({ date: t.deadline, type: 'task_deadline', contact_id: t.contact_id, contact_name: t.display_name, title: t.title, urgency: t.deadline < todayStr ? 'overdue' : t.deadline === todayStr ? 'today' : 'upcoming' });
  }

  // Applications follow_up_date
  const apps = _db.query(`SELECT a.*, c.display_name as contact_name FROM applications a LEFT JOIN contacts c ON a.primary_contact_id = c.id WHERE a.follow_up_date IS NOT NULL AND a.follow_up_date <= ?`).all(futureStr) as { follow_up_date: string; program_name: string; contact_name: string | null }[];
  for (const a of apps) {
    items.push({ date: a.follow_up_date, type: 'application_followup', contact_name: a.contact_name ?? undefined, title: `Follow up: ${a.program_name}`, urgency: a.follow_up_date < todayStr ? 'overdue' : a.follow_up_date === todayStr ? 'today' : 'upcoming' });
  }

  // Vendor follow-ups
  const vendorFU = _db.query(`SELECT vc.*, co.name as company_name FROM vendor_communications vc JOIN companies co ON vc.company_id = co.id WHERE vc.follow_up_date IS NOT NULL AND vc.follow_up_date <= ? AND vc.follow_up_done = 0`).all(futureStr) as { follow_up_date: string; company_id: string; company_name: string; subject: string | null; type: string }[];
  for (const v of vendorFU) {
    items.push({ date: v.follow_up_date, type: 'vendor_followup', company_id: v.company_id, company_name: v.company_name, title: `Follow up with ${v.company_name}: ${v.subject || v.type}`, urgency: v.follow_up_date < todayStr ? 'overdue' : v.follow_up_date === todayStr ? 'today' : 'upcoming' });
  }

  // Birthdays — next occurrence within range
  const contacts = _db.query(`SELECT id, display_name, birthday FROM contacts WHERE birthday IS NOT NULL AND do_not_contact = 0`).all() as { id: string; display_name: string; birthday: string }[];
  for (const c of contacts) {
    const bday = new Date(c.birthday);
    const thisYear = new Date(now.getFullYear(), bday.getMonth(), bday.getDate());
    const nextBday = thisYear >= now ? thisYear : new Date(now.getFullYear() + 1, bday.getMonth(), bday.getDate());
    const nextStr = nextBday.toISOString().slice(0, 10);
    if (nextStr <= futureStr) {
      items.push({ date: nextStr, type: 'birthday', contact_id: c.id, contact_name: c.display_name, title: `Birthday: ${c.display_name}`, urgency: nextStr === todayStr ? 'today' : 'upcoming' });
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}
