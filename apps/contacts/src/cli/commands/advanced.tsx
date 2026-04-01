import type { Command } from "commander";
import chalk from "chalk";
import {
  getContact,
  updateContact,
  listContacts,
  searchContacts,
} from "../../db/contacts.js";
import {
  getCompany,
} from "../../db/companies.js";
import { getDatabase } from "../../db/database.js";
import { renderTable, promptUser as prompt } from "../utils.js";

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}

export function registerAdvancedCommands(program: Command): void {

// ─── contacts remind ──────────────────────────────────────────────────────────

program
  .command('remind <id>')
  .option('--in <duration>', 'Duration (e.g. 7d, 2w, 1m)')
  .option('--on <date>', 'Specific date YYYY-MM-DD')
  .option('--note <text>', 'Reminder note')
  .description('Schedule a follow-up reminder')
  .action(async (id: string, opts: { in?: string; on?: string; note?: string }) => {
    let date: string;
    if (opts.on) {
      date = opts.on;
    } else if (opts.in) {
      const raw = opts.in;
      const n = parseInt(raw, 10);
      const unit = raw.slice(-1);
      const ms = unit === 'w' ? n * 7 * 86400000 : unit === 'm' ? n * 30 * 86400000 : n * 86400000;
      date = new Date(Date.now() + ms).toISOString().slice(0, 10);
    } else {
      console.error(chalk.red('Provide --in (e.g. 7d) or --on (YYYY-MM-DD)'));
      process.exit(1);
    }
    const db = getDatabase();
    updateContact(id, { follow_up_at: date });
    if (opts.note) {
      const { addNote } = await import('../../db/notes.js');
      addNote(id, `Reminder (${date}): ${opts.note}`, undefined, db);
    }
    const contact = getContact(id);
    console.log(chalk.green(`\n✓ Reminder set for ${contact.display_name} on ${date}\n`));
  });

// ─── contacts tag bulk ────────────────────────────────────────────────────────

const tagsCmd = program.commands.find(c => c.name() === 'tags');
if (tagsCmd) {
  const bulkTag = tagsCmd.command('bulk').description('Bulk tag operations');

  bulkTag
    .command('add <tag>')
    .description('Apply a tag to multiple contacts')
    .option('--query <q>', 'Apply to all contacts matching search query')
    .option('--all', 'Apply to all contacts')
    .option('--contact-ids <ids>', 'Comma-separated contact IDs')
    .action(async (tag: string, opts: { query?: string; all?: boolean; contactIds?: string }) => {
      const { addTagToContact: addTag } = await import('../../db/tags.js');
      const { getTagByName: getTagByNameFn } = await import('../../db/tags.js');
      const db = getDatabase();
      const tagRecord = getTagByNameFn(tag, db);
      if (!tagRecord) { console.error(chalk.red(`Tag not found: ${tag}`)); process.exit(1); }
      let contactIds: string[] = [];
      if (opts.contactIds) contactIds = opts.contactIds.split(',').map(s => s.trim());
      if (opts.query) {
        const found = searchContacts(opts.query);
        contactIds = [...contactIds, ...found.map((c: { id: string }) => c.id)];
      }
      if (opts.all) {
        const all = listContacts({ limit: 10000 });
        contactIds = [...contactIds, ...all.contacts.map((c: { id: string }) => c.id)];
      }
      contactIds = [...new Set(contactIds)];
      let count = 0;
      for (const cid of contactIds) {
        try { addTag(cid, tagRecord.id); count++; } catch { /* skip */ }
      }
      console.log(chalk.green(`\n✓ Tagged ${count} contact(s) with #${tagRecord.name}\n`));
    });

  bulkTag
    .command('remove <tag>')
    .description('Remove a tag from matching contacts')
    .option('--query <q>', 'Remove from all contacts matching search query')
    .option('--contact-ids <ids>', 'Comma-separated contact IDs')
    .action(async (tag: string, opts: { query?: string; contactIds?: string }) => {
      const { removeTagFromContact: removeTag } = await import('../../db/tags.js');
      const { getTagByName: getTagByNameFn } = await import('../../db/tags.js');
      const db = getDatabase();
      const tagRecord = getTagByNameFn(tag, db);
      if (!tagRecord) { console.error(chalk.red(`Tag not found: ${tag}`)); process.exit(1); }
      let contactIds: string[] = [];
      if (opts.contactIds) contactIds = opts.contactIds.split(',').map(s => s.trim());
      if (opts.query) {
        const found = searchContacts(opts.query);
        contactIds = [...contactIds, ...found.map((c: { id: string }) => c.id)];
      }
      contactIds = [...new Set(contactIds)];
      let count = 0;
      for (const cid of contactIds) {
        try { removeTag(cid, tagRecord.id); count++; } catch { /* skip */ }
      }
      console.log(chalk.green(`\n✓ Removed #${tagRecord.name} from ${count} contact(s)\n`));
    });
}

// ─── contacts dnc ─────────────────────────────────────────────────────────────

program
  .command('dnc <id>')
  .description('Mark contact as do-not-contact')
  .option('--remove', 'Remove DNC flag')
  .option('--reason <text>', 'Reason for DNC')
  .action(async (id: string, opts: { remove?: boolean; reason?: string }) => {
    const contact = getContact(id);
    const db = getDatabase();
    updateContact(id, { do_not_contact: !opts.remove });
    if (opts.reason && !opts.remove) {
      const { addNote } = await import('../../db/notes.js');
      addNote(id, `DNC: ${opts.reason}`, undefined, db);
    }
    if (opts.remove) {
      console.log(chalk.green(`\n✓ DNC flag removed for ${contact.display_name}\n`));
    } else {
      console.log(chalk.yellow(`\n⚠ ${contact.display_name} marked as do-not-contact\n`));
    }
  });

// ─── contacts history ─────────────────────────────────────────────────────────

program
  .command('history <id>')
  .description('Show field change timeline for a contact')
  .option('--field <name>', 'Filter to a specific field')
  .action(async (id: string, opts: { field?: string }) => {
    const { getFieldHistory } = await import('../../db/field-history.js');
    const db = getDatabase();
    const history = getFieldHistory(id, opts.field, db);
    if (!history.length) {
      console.log(chalk.gray('\nNo field history found.\n'));
      return;
    }
    const contact = getContact(id);
    console.log(chalk.bold(`\nField History: ${contact.display_name}\n`));
    renderTable(
      ['Field', 'Old Value', 'New Value', 'When', 'Source'],
      history.map((h: { field_name: string; old_value?: string | null; new_value?: string | null; valid_from: string; source?: string | null }) => ({
        Field: h.field_name,
        'Old Value': h.old_value ?? '',
        'New Value': h.new_value ?? '',
        When: h.valid_from.slice(0, 16),
        Source: h.source ?? '',
      }))
    );
    console.log();
  });

// ─── contacts learnings ───────────────────────────────────────────────────────

program
  .command('learnings [id]')
  .description('Show or search learnings for a contact')
  .option('--search <query>', 'Cross-contact search across all learnings')
  .option('--type <type>', 'Filter by type: preference|fact|inference|warning|signal')
  .option('--min-importance <n>', 'Minimum importance (1-10)')
  .action(async (id: string | undefined, opts: { search?: string; type?: string; minImportance?: string }) => {
    const { getLearnings, searchLearnings } = await import('../../db/learnings.js');
    const db = getDatabase();
    if (opts.search) {
      const results = searchLearnings(opts.search, { type: opts.type, contact_id: id }, db);
      if (!results.length) {
        console.log(chalk.gray(`\nNo learnings found for: "${opts.search}"\n`));
        return;
      }
      console.log(chalk.bold(`\nLearnings matching "${opts.search}":\n`));
      renderTable(
        ['Contact', 'Type', 'Confidence', 'Content'],
        results.map((r: { contact_id: string; type: string; confidence: number; content: string }) => {
          let name = r.contact_id;
          try { name = getContact(r.contact_id).display_name; } catch { /* not found */ }
          return { Contact: name, Type: r.type, Confidence: String(r.confidence) + '%', Content: r.content };
        })
      );
      console.log(chalk.gray(`\n${results.length} learning(s)\n`));
      return;
    }
    if (!id) {
      console.error(chalk.red('Provide a contact ID or use --search <query>'));
      process.exit(1);
    }
    const learnings = getLearnings(id, {
      type: opts.type,
      min_importance: opts.minImportance ? parseInt(opts.minImportance, 10) : undefined,
    }, db);
    const contact = getContact(id);
    if (!learnings.length) {
      console.log(chalk.gray(`\nNo learnings for ${contact.display_name}.\n`));
      return;
    }
    console.log(chalk.bold(`\nLearnings: ${contact.display_name} (${learnings.length})\n`));
    for (const l of learnings) {
      const conf = l.confidence >= 80 ? chalk.green : l.confidence >= 50 ? chalk.yellow : chalk.red;
      console.log(`  ${conf(String(l.confidence).padStart(3) + '%')}  ${chalk.cyan(l.type.padEnd(12))}  ${l.content}`);
    }
    console.log();
  });

// ─── contacts graph ───────────────────────────────────────────────────────────

program
  .command('graph <id>')
  .description('Show relationship network and strength score for a contact')
  .action(async (id: string) => {
    const { computeRelationshipStrength } = await import('../../db/graph.js');
    const { listRelationships } = await import('../../db/relationships.js');
    const db = getDatabase();
    const contact = getContact(id);
    const strength = computeRelationshipStrength(id, db);
    const rels = listRelationships({ contact_id: id });
    console.log(chalk.bold(`\nNetwork: ${contact.display_name}`));
    const strengthColor = strength >= 70 ? chalk.green : strength >= 40 ? chalk.yellow : chalk.red;
    console.log(`  Relationship Strength: ${strengthColor(String(strength) + '/100')}\n`);
    if (!rels.length) {
      console.log(chalk.gray('  No relationships mapped.\n'));
      return;
    }
    for (const r of rels) {
      const otherId = (r as { contact_a_id: string; contact_b_id: string }).contact_a_id === id
        ? (r as { contact_b_id: string }).contact_b_id
        : (r as { contact_a_id: string }).contact_a_id;
      let otherName = otherId;
      try { otherName = getContact(otherId).display_name; } catch { /* not found */ }
      console.log(`  ${chalk.cyan((r as { relationship_type: string }).relationship_type.padEnd(14))} ${otherName}`);
    }
    console.log();
  });

// ─── contacts cooling ─────────────────────────────────────────────────────────

program
  .command('cooling')
  .description('Show warming, cooling, and ghost contacts')
  .action(async () => {
    const { detectCoolingRelationships } = await import('../../db/graph.js');
    const { getGhostContacts, getWarmingContacts } = await import('../../db/signals.js');
    const db = getDatabase();
    const cooling = detectCoolingRelationships(db);
    const ghosts = getGhostContacts(db);
    const warming = getWarmingContacts(db);
    if (warming.length) {
      console.log(chalk.bold.green(`\nWarming (${warming.length}):`));
      for (const c of warming.slice(0, 10)) {
        console.log(`  ${chalk.green('↑')} ${c.display_name}  ${chalk.gray(c.days_since_contact !== null ? c.days_since_contact + 'd ago' : 'never')}`);
      }
    }
    if (cooling.length) {
      console.log(chalk.bold.yellow(`\nCooling (${cooling.length}):`));
      for (const c of cooling.slice(0, 10)) {
        console.log(`  ${chalk.yellow('↓')} ${c.display_name}  ${chalk.gray(String(c.days_since) + 'd ago')}`);
      }
    }
    if (ghosts.length) {
      console.log(chalk.bold.red(`\nGhost (${ghosts.length}):`));
      for (const c of ghosts.slice(0, 10)) {
        console.log(`  ${chalk.red('☠')} ${c.display_name}  ${chalk.gray(c.days_since_contact !== null ? c.days_since_contact + 'd ago' : 'never contacted')}`);
      }
    }
    if (!warming.length && !cooling.length && !ghosts.length) {
      console.log(chalk.green('\nAll relationships look healthy!\n'));
    }
    console.log();
  });

// ─── contacts resolve ─────────────────────────────────────────────────────────

program
  .command('resolve')
  .description('Resolve contact identity before creating (check for existing contact)')
  .option('--email <email>', 'Email to search')
  .option('--name <name>', 'Name to search')
  .option('--linkedin <url>', 'LinkedIn URL to search')
  .action(async (opts: { email?: string; name?: string; linkedin?: string }) => {
    const { resolveByPartial } = await import('../../db/identity.js');
    const db = getDatabase();
    const matches = resolveByPartial({ email: opts.email, name: opts.name, linkedin_url: opts.linkedin }, db);
    if (!matches.length) {
      console.log(chalk.gray('\nNo matches found — safe to create.\n'));
      return;
    }
    console.log(chalk.bold(`\nPotential matches (${matches.length}):\n`));
    renderTable(
      ['Name', 'Job Title', 'Confidence', 'Match Reasons'],
      matches.map((m: { contact: { display_name: string; job_title?: string }; confidence_score: number; match_reasons: string[] }) => ({
        Name: m.contact.display_name,
        'Job Title': m.contact.job_title ?? '',
        Confidence: String(m.confidence_score) + '%',
        'Match Reasons': m.match_reasons.join('; '),
      }))
    );
    console.log();
  });

// ─── contacts search --semantic ───────────────────────────────────────────────

program
  .command('search-semantic <query>')
  .description('Semantic capability search using TF-IDF embeddings (run "contacts embed --all" first)')
  .option('--limit <n>', 'Max results', '10')
  .action(async (query: string, opts: { limit: string }) => {
    const { semanticSearch } = await import('../../lib/embeddings.js');
    const db = getDatabase();
    const results = semanticSearch(query, parseInt(opts.limit, 10), db);
    if (!results.length) {
      console.log(chalk.gray(`\nNo semantic matches for "${query}". Try running: contacts embed --all\n`));
      return;
    }
    console.log(chalk.bold(`\nSemantic search: "${query}"\n`));
    renderTable(
      ['Name', 'Score', 'Company', 'Title'],
      results.map((r: { contact_id: string; score: number }) => {
        let name = r.contact_id;
        let company = '';
        let title = '';
        try {
          const c = getContact(r.contact_id);
          name = c.display_name;
          company = (c.company as { name: string } | undefined)?.name ?? '';
          title = c.job_title ?? '';
        } catch { /* not found */ }
        return { Name: name, Score: (r.score * 100).toFixed(1) + '%', Company: company, Title: title };
      })
    );
    console.log();
  });

// ─── contacts signals ─────────────────────────────────────────────────────────

program
  .command('signals <id>')
  .description('Show relationship health signals for a contact')
  .action(async (id: string) => {
    const { getRelationshipSignals } = await import('../../db/signals.js');
    const db = getDatabase();
    const contact = getContact(id);
    const signals = getRelationshipSignals(id, db);
    console.log(chalk.bold(`\nSignals: ${contact.display_name}\n`));
    for (const s of signals) {
      const color = s.signal_type === 'warming' ? chalk.green : s.signal_type === 'ghost' ? chalk.red : s.signal_type === 'cooling' ? chalk.yellow : chalk.cyan;
      const icon = s.signal_type === 'warming' ? '↑' : s.signal_type === 'ghost' ? '☠' : s.signal_type === 'cooling' ? '↓' : '✓';
      console.log(`  ${color(icon + ' ' + s.signal_type.toUpperCase())}  ${chalk.gray(s.reason)}`);
      if (s.days_since_contact !== null) {
        console.log(`    Last contact: ${s.days_since_contact} days ago`);
      }
    }
    console.log();
  });

// ─── contacts stale ───────────────────────────────────────────────────────────

program
  .command('stale')
  .description('List contacts with low data completeness scores')
  .option('--threshold <n>', 'Score threshold 0-100 (default 40)', '40')
  .action(async (opts: { threshold: string }) => {
    const { getStaleContacts } = await import('../../db/freshness.js');
    const db = getDatabase();
    const threshold = parseInt(opts.threshold, 10);
    const contacts = getStaleContacts(threshold, db);
    if (!contacts.length) {
      console.log(chalk.green(`\nNo contacts below ${threshold}% completeness!\n`));
      return;
    }
    console.log(chalk.bold(`\nStale contacts (below ${threshold}% completeness):\n`));
    renderTable(
      ['Name', 'Score'],
      contacts.map((c: { contact_id: string; display_name: string; score: number }) => ({
        Name: c.display_name,
        Score: String(c.score) + '%',
      }))
    );
    console.log(chalk.gray(`\n${contacts.length} contact(s) need enrichment\n`));
  });

// ─── contacts freshness ───────────────────────────────────────────────────────

program
  .command('freshness <id>')
  .description('Show per-field confidence and freshness breakdown for a contact')
  .action(async (id: string) => {
    const { getFreshnessScore } = await import('../../db/freshness.js');
    const db = getDatabase();
    const contact = getContact(id);
    const score = getFreshnessScore(id, db);
    console.log(chalk.bold(`\nFreshness: ${contact.display_name}`));
    const scoreColor = score.overall_score >= 70 ? chalk.green : score.overall_score >= 40 ? chalk.yellow : chalk.red;
    console.log(`  Overall: ${scoreColor(String(score.overall_score) + '/100')}\n`);
    renderTable(
      ['Field', 'Value', 'Confidence', 'Last Verified', 'Days Old'],
      score.fields.map((f: { field_name: string; value: string | null; confidence: string; last_verified_at: string | null; days_old: number | null }) => ({
        Field: f.field_name,
        Value: f.value ? f.value.slice(0, 20) : chalk.gray('(missing)'),
        Confidence: f.confidence,
        'Last Verified': f.last_verified_at ? f.last_verified_at.slice(0, 10) : '',
        'Days Old': f.days_old !== null ? String(f.days_old) + 'd' : '',
      }))
    );
    console.log();
  });

// ─── contacts embed ───────────────────────────────────────────────────────────

program
  .command('embed')
  .description('Build semantic embeddings for contacts')
  .option('--all', 'Embed all contacts in the database')
  .option('--contact <id>', 'Embed a single contact')
  .action(async (opts: { all?: boolean; contact?: string }) => {
    const { embedAllContacts, embedContact } = await import('../../lib/embeddings.js');
    const db = getDatabase();
    if (opts.all) {
      console.log(chalk.blue('\nBuilding embeddings for all contacts...\n'));
      const count = await embedAllContacts(db);
      console.log(chalk.green(`✓ Embedded ${count} contact(s)\n`));
    } else if (opts.contact) {
      await embedContact(opts.contact, db);
      const contact = getContact(opts.contact);
      console.log(chalk.green(`✓ Embedded: ${contact.display_name}\n`));
    } else {
      console.error(chalk.red('Use --all or --contact <id>'));
      process.exit(1);
    }
  });

// ─── contacts capture-meeting ─────────────────────────────────────────────────

program
  .command('capture-meeting')
  .description('Ingest meeting participants as contacts and log the event')
  .option('--title <title>', 'Meeting title (required)')
  .option('--date <date>', 'Meeting date (YYYY-MM-DD, default today)')
  .option('--attendee <name:email>', 'Attendee (format: Name:email@example.com), repeatable', collect, [] as string[])
  .option('--context <text>', 'Meeting context or agenda')
  .action(async (opts: { title?: string; date?: string; attendee: string[]; context?: string }) => {
    const { ingestMeetingParticipants } = await import('../../lib/meeting-capture.js');
    const db = getDatabase();
    let title = opts.title;
    if (!title) {
      title = await prompt('Meeting title (required):');
      if (!title) { console.error(chalk.red('Title is required.')); process.exit(1); }
    }
    const eventDate = opts.date ?? new Date().toISOString().slice(0, 10);
    const attendees = opts.attendee.map((a: string) => {
      const colonIdx = a.lastIndexOf(':');
      if (colonIdx > 0) {
        return { name: a.slice(0, colonIdx), email: a.slice(colonIdx + 1) };
      }
      return { name: a, email: a };
    });
    if (!attendees.length) {
      console.log(chalk.yellow('\nNo attendees provided. Use --attendee "Name:email@example.com"\n'));
      return;
    }
    const result = await ingestMeetingParticipants({ title, event_date: eventDate, attendees, context: opts.context }, db);
    console.log(chalk.green(`\n✓ Meeting captured: ${title}`));
    console.log(`  ${chalk.cyan(String(result.created))} contacts created`);
    console.log(`  ${chalk.cyan(String(result.updated))} contacts found (existing)\n`);
  });

// ─── contacts org ─────────────────────────────────────────────────────────────

const orgCmd = program.command('org').description('Org chart and deal team management');

orgCmd
  .command('chart <company-id>')
  .description('Show ASCII org chart for a company')
  .action(async (companyId: string) => {
    const { listOrgChart } = await import('../../db/org-chart.js');
    const db = getDatabase();
    const company = getCompany(companyId);
    if (!company) {
      console.error(chalk.red(`\nCompany not found: ${companyId}\n`));
      process.exit(1);
    }
    const edges = listOrgChart(companyId, db);
    console.log(chalk.bold(`\nOrg Chart: ${company.name}\n`));
    if (!edges.length) {
      console.log(chalk.gray('  No org chart edges defined. Use: contacts org add-edge\n'));
      return;
    }
    for (const e of edges) {
      const arrow = e.edge_type === 'manages' ? '→' : e.edge_type === 'reports_to' ? '←' : '↔';
      console.log(`  ${chalk.cyan(e.contact_a_name)}  ${chalk.gray(arrow + ' ' + e.edge_type + ' →')}  ${chalk.cyan(e.contact_b_name)}`);
    }
    console.log();
  });

orgCmd
  .command('add-edge <company-id> <contact-a> <contact-b>')
  .description('Add an org chart edge between two contacts at a company')
  .option('--type <type>', 'Edge type: reports_to|manages|peer|collaborates_with', 'reports_to')
  .action(async (companyId: string, contactAId: string, contactBId: string, opts: { type?: string }) => {
    const { addOrgChartEdge } = await import('../../db/org-chart.js');
    const db = getDatabase();
    const contactA = getContact(contactAId);
    const contactB = getContact(contactBId);
    addOrgChartEdge(companyId, contactAId, contactBId, (opts.type || 'reports_to') as import('../../db/org-chart.js').OrgEdgeType, false, db);
    console.log(chalk.green(`\n✓ ${contactA.display_name} ${opts.type || 'reports_to'} ${contactB.display_name}\n`));
  });

// ─── contacts deals team ──────────────────────────────────────────────────────

const dealsTeamCmd = program.command('deals-team').description('Deal team and buying committee management');

dealsTeamCmd
  .command('show <deal-id>')
  .description('Show buying committee for a deal')
  .action(async (dealId: string) => {
    const { getDealTeam } = await import('../../db/org-chart.js');
    const db = getDatabase();
    const team = getDealTeam(dealId, db);
    console.log(chalk.bold(`\nDeal Team: ${dealId}\n`));
    if (!team.length) {
      console.log(chalk.gray('  No contacts assigned to this deal team.\n'));
      return;
    }
    renderTable(
      ['Contact', 'Role', 'Title'],
      team.map((m: { display_name: string; account_role: string; job_title?: string }) => ({
        Contact: m.display_name,
        Role: m.account_role,
        Title: m.job_title ?? '',
      }))
    );
    console.log();
  });

dealsTeamCmd
  .command('assign <deal-id> <contact-id>')
  .description('Assign a contact a role in a deal (buying committee)')
  .option('--role <role>', 'Role: economic_buyer|technical_evaluator|champion|blocker|influencer|user|sponsor|other', 'other')
  .action(async (dealId: string, contactId: string, opts: { role?: string }) => {
    const { setDealContactRole } = await import('../../db/org-chart.js');
    const db = getDatabase();
    const contact = getContact(contactId);
    setDealContactRole(dealId, contactId, (opts.role || 'other') as import('../../db/org-chart.js').AccountRole, db);
    console.log(chalk.green(`\n✓ ${contact.display_name} assigned as ${opts.role || 'other'} in deal ${dealId}\n`));
  });

// ─── Image / Photo management ────────────────────────────────────────────────

const photoCmd = program.command('photo').description('Manage contact profile photos');

photoCmd
  .command('set <contact-id> <image-path>')
  .description('Set a contact\'s profile photo from a local file')
  .action((contactId: string, imagePath: string) => {
    const { saveImage } = require('../../lib/images.js') as typeof import('../../lib/images.js');
    try {
      const contact = getContact(contactId);
      const filename = saveImage(contactId, imagePath);
      updateContact(contactId, { avatar_url: `~/.hasna/contacts/images/${filename}` });
      console.log(chalk.green(`Photo set for ${contact.display_name}: ~/.hasna/contacts/images/${filename}`));
    } catch (e) {
      console.error(chalk.red(e instanceof Error ? e.message : String(e)));
    }
  });

photoCmd
  .command('show <contact-id>')
  .description('Show the path to a contact\'s profile photo')
  .action((contactId: string) => {
    const { getImagePath } = require('../../lib/images.js') as typeof import('../../lib/images.js');
    const contact = getContact(contactId);
    const path = getImagePath(contactId);
    if (path) {
      console.log(`${chalk.bold(contact.display_name)}: ${chalk.cyan(path)}`);
    } else {
      console.log(chalk.yellow(`No photo set for ${contact.display_name}`));
    }
  });

photoCmd
  .command('remove <contact-id>')
  .description('Remove a contact\'s profile photo')
  .action((contactId: string) => {
    const { deleteImage } = require('../../lib/images.js') as typeof import('../../lib/images.js');
    const contact = getContact(contactId);
    const deleted = deleteImage(contactId);
    if (deleted) {
      updateContact(contactId, { avatar_url: null });
      console.log(chalk.green(`Photo removed for ${contact.display_name}`));
    } else {
      console.log(chalk.yellow(`No photo found for ${contact.display_name}`));
    }
  });

photoCmd
  .command('list')
  .description('List all stored photos')
  .action(() => {
    const { listImages } = require('../../lib/images.js') as typeof import('../../lib/images.js');
    const images = listImages();
    if (!images.length) { console.log(chalk.yellow('No photos stored')); return; }
    for (const img of images) {
      try {
        const contact = getContact(img.entity_id);
        console.log(`${chalk.bold(contact.display_name)}: ${chalk.cyan(img.path)}`);
      } catch {
        console.log(`${chalk.gray(img.entity_id)}: ${chalk.cyan(img.path)}`);
      }
    }
  });

const logoCmd = program.command('logo').description('Manage company logos');

logoCmd
  .command('set <company-id> <image-path>')
  .description('Set a company\'s logo from a local file')
  .action((companyId: string, imagePath: string) => {
    const { saveImage } = require('../../lib/images.js') as typeof import('../../lib/images.js');
    try {
      const company = getCompany(companyId);
      if (!company) { console.error(chalk.red('Company not found')); return; }
      const filename = saveImage(companyId, imagePath);
      const { updateCompany } = require('../../db/companies.js');
      updateCompany(companyId, { logo_url: `~/.hasna/contacts/images/${filename}` });
      console.log(chalk.green(`Logo set for ${company.name}: ~/.hasna/contacts/images/${filename}`));
    } catch (e) {
      console.error(chalk.red(e instanceof Error ? e.message : String(e)));
    }
  });

logoCmd
  .command('show <company-id>')
  .description('Show the path to a company\'s logo')
  .action((companyId: string) => {
    const { getImagePath } = require('../../lib/images.js') as typeof import('../../lib/images.js');
    const company = getCompany(companyId);
    if (!company) { console.error(chalk.red('Company not found')); return; }
    const path = getImagePath(companyId);
    if (path) {
      console.log(`${chalk.bold(company.name)}: ${chalk.cyan(path)}`);
    } else {
      console.log(chalk.yellow(`No logo set for ${company.name}`));
    }
  });

logoCmd
  .command('remove <company-id>')
  .description('Remove a company\'s logo')
  .action((companyId: string) => {
    const { deleteImage } = require('../../lib/images.js') as typeof import('../../lib/images.js');
    const { updateCompany } = require('../../db/companies.js') as typeof import('../../db/companies.js');
    const company = getCompany(companyId);
    if (!company) { console.error(chalk.red('Company not found')); return; }
    const deleted = deleteImage(companyId);
    if (deleted) updateCompany(companyId, { logo_url: null });
    console.log(deleted ? chalk.green(`Logo removed for ${company.name}`) : chalk.yellow(`No logo set for ${company.name}`));
  });

// ─── contacts set-sensitivity ─────────────────────────────────────────────────

program
  .command('set-sensitivity <id> <level>')
  .description('Set contact sensitivity level (normal, confidential, restricted)')
  .action((id: string, level: string) => {
    if (!['normal', 'confidential', 'restricted'].includes(level)) {
      console.error(chalk.red(`\nInvalid sensitivity level: ${level}. Use: normal, confidential, restricted\n`));
      process.exit(1);
    }
    const contact = getContact(id);
    updateContact(id, { sensitivity: level as 'normal' | 'confidential' | 'restricted' });
    console.log(chalk.green(`\nSensitivity set to ${level} for ${contact.display_name}\n`));
  });

// ─── contacts vault ──────────────────────────────────────────────────────────

const vaultCmd = program.command('vault').description('Manage the encrypted document vault');

function promptPassphrase(promptText: string): Promise<string> {
  const { createInterface } = require("readline");
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(promptText);
    rl.question("", (answer: string) => { rl.close(); resolve(answer); });
  });
}

vaultCmd
  .command('init')
  .description('Initialize the encrypted vault')
  .option('--passphrase <pass>', 'Passphrase (non-interactive)')
  .action(async (opts: { passphrase?: string }) => {
    const { initVault, isVaultInitialized } = await import('../../lib/vault.js');
    if (isVaultInitialized()) {
      console.log(chalk.yellow('\nVault already initialized. Use "contacts vault unlock" to access it.\n'));
      return;
    }
    let passphrase: string;
    if (opts.passphrase) {
      passphrase = opts.passphrase;
    } else {
      passphrase = await promptPassphrase('Enter vault passphrase: ');
      if (!passphrase) { console.error(chalk.red('Passphrase is required.')); process.exit(1); }
      const confirmPass = await promptPassphrase('Confirm passphrase: ');
      if (passphrase !== confirmPass) { console.error(chalk.red('Passphrases do not match.')); process.exit(1); }
    }
    initVault(passphrase);
    console.log(chalk.green('\nVault initialized and unlocked.\n'));
  });

vaultCmd
  .command('unlock')
  .description('Unlock the vault')
  .option('--passphrase <pass>', 'Passphrase (non-interactive)')
  .action(async (opts: { passphrase?: string }) => {
    const { unlockVault } = await import('../../lib/vault.js');
    const passphrase = opts.passphrase || await promptPassphrase('Enter vault passphrase: ');
    const ok = unlockVault(passphrase);
    if (!ok) {
      console.error(chalk.red('\nInvalid passphrase.\n'));
      process.exit(1);
    }
    console.log(chalk.green('\nVault unlocked.\n'));
  });

vaultCmd
  .command('lock')
  .description('Lock the vault')
  .action(async () => {
    const { lockVault } = await import('../../lib/vault.js');
    lockVault();
    console.log(chalk.green('\nVault locked.\n'));
  });

vaultCmd
  .command('status')
  .description('Show vault status')
  .action(async () => {
    const { isVaultInitialized, isVaultUnlocked } = await import('../../lib/vault.js');
    const initialized = isVaultInitialized();
    const unlocked = isVaultUnlocked();
    console.log(chalk.bold.blue('\nVault Status:'));
    console.log(`  Initialized: ${initialized ? chalk.green('yes') : chalk.red('no')}`);
    console.log(`  Unlocked:    ${unlocked ? chalk.green('yes') : chalk.red('no')}`);
    if (initialized) {
      const db = getDatabase();
      try {
        const docCount = (db.query("SELECT COUNT(*) as n FROM contact_documents").get() as { n: number }).n;
        console.log(`  Documents:   ${chalk.cyan(String(docCount))}`);
      } catch { /* table may not exist yet */ }
    }
    console.log();
  });

// ─── contacts docs ───────────────────────────────────────────────────────────

function handleVaultError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('Vault is locked') || msg.includes('not initialized')) {
    console.error(chalk.red(`\nVault is locked. Run: contacts vault unlock --passphrase <pass>\n`));
    process.exit(1);
  }
  throw err;
}

const docsCmd = program.command('docs').description('Manage encrypted contact documents');

docsCmd
  .command('add <contact-id>')
  .description('Add an encrypted document')
  .option('--type <type>', 'Document type (passport, national_id, tax_id, ssn, drivers_license, bank_account, visa, insurance, contract, certificate, medical_record, prescription, allergy_list, vaccination, blood_type, health_insurance, medical_condition, emergency_contact_medical, other)', 'other')
  .option('--label <label>', 'Document label')
  .option('--value <value>', 'Document value (required)')
  .option('--file <path>', 'File to encrypt and attach')
  .option('--expires <date>', 'Expiry date (YYYY-MM-DD)')
  .action(async (contactId: string, opts: { type?: string; label?: string; value?: string; file?: string; expires?: string }) => {
    const { addDocument } = await import('../../db/documents.js');
    if (!opts.value) { console.error(chalk.red('--value is required')); process.exit(1); }
    let doc;
    try {
      doc = addDocument({
        contact_id: contactId,
        doc_type: (opts.type || 'other') as import('../../db/documents.js').DocumentType,
        label: opts.label,
        value: opts.value,
        file_path: opts.file,
        expires_at: opts.expires,
      });
    } catch (err) { handleVaultError(err); }
    console.log(chalk.green(`\nDocument added: ${doc!.doc_type} (${doc!.id})\n`));
  });

docsCmd
  .command('list <contact-id>')
  .description('List documents for a contact (metadata only)')
  .action(async (contactId: string) => {
    const { listDocuments } = await import('../../db/documents.js');
    const docs = listDocuments(contactId);
    if (!docs.length) {
      console.log(chalk.gray('\nNo documents found.\n'));
      return;
    }
    console.log();
    renderTable(
      ['Type', 'Label', 'Has File', 'Expires', 'Created'],
      docs.map(d => ({
        Type: d.doc_type,
        Label: d.label || '',
        'Has File': d.has_file ? 'yes' : 'no',
        Expires: d.expires_at ? d.expires_at.slice(0, 10) : '',
        Created: d.created_at.slice(0, 10),
      }))
    );
    console.log(chalk.gray(`\n${docs.length} document(s)\n`));
  });

docsCmd
  .command('show <doc-id>')
  .description('Show a document with decrypted value (vault must be unlocked)')
  .action(async (docId: string) => {
    const { getDocument } = await import('../../db/documents.js');
    const doc = getDocument(docId);
    console.log(chalk.bold.blue(`\nDocument: ${doc.doc_type}`));
    if (doc.label) console.log(chalk.gray('  Label:   ') + doc.label);
    console.log(chalk.gray('  Value:   ') + doc.value);
    console.log(chalk.gray('  Has File:') + (doc.has_file ? ' yes' : ' no'));
    if (doc.expires_at) console.log(chalk.gray('  Expires: ') + doc.expires_at.slice(0, 10));
    console.log(chalk.gray(`  ID: ${doc.id}\n`));
  });

docsCmd
  .command('remove <doc-id>')
  .description('Delete a document')
  .action(async (docId: string) => {
    const { deleteDocument } = await import('../../db/documents.js');
    deleteDocument(docId);
    console.log(chalk.green(`\nDocument deleted: ${docId}\n`));
  });

docsCmd
  .command('scan <image-path>')
  .description('Scan a document image using AI vision')
  .option('--contact <id>', 'Contact ID to associate with')
  .option('--type <type>', 'Document type hint')
  .action(async (imagePath: string, opts: { contact?: string; type?: string }) => {
    const { scanDocument } = await import('../../lib/document-scanner.js');
    console.log(chalk.blue('\nScanning document...\n'));
    const result = await scanDocument(imagePath, opts.type);
    console.log(chalk.bold(`  Type: ${result.document_type}  Confidence: ${(result.confidence * 100).toFixed(0)}%\n`));
    console.log(chalk.yellow('  Extracted fields:'));
    for (const [k, v] of Object.entries(result.fields)) {
      console.log(`    ${chalk.gray(k.padEnd(20))} ${v}`);
    }
    console.log();
  });

docsCmd
  .command('types')
  .description('List all valid document types')
  .action(async () => {
    const { DOCUMENT_TYPES } = await import('../../db/documents.js');
    console.log(chalk.bold.blue('\nDocument Types:\n'));
    for (const t of DOCUMENT_TYPES) {
      console.log(`  ${chalk.cyan(t)}`);
    }
    console.log();
  });

// ─── contacts health ─────────────────────────────────────────────────────────

const healthCmd = program.command('health').description('Manage contact health data (vault required)');

healthCmd
  .command('show <id>')
  .description('Show health data for a contact')
  .action(async (id: string) => {
    const { getHealthData } = await import('../../db/health.js');
    const contact = getContact(id);
    let health;
    try {
      health = getHealthData(id);
    } catch (err) { handleVaultError(err); }
    if (!health) {
      console.log(chalk.gray(`\nNo health data for ${contact.display_name}.\n`));
      return;
    }
    console.log(chalk.bold.blue(`\nHealth: ${contact.display_name}\n`));
    if (health.blood_type) console.log(chalk.gray('  Blood Type:      ') + health.blood_type);
    if (health.allergies.length) console.log(chalk.gray('  Allergies:       ') + health.allergies.join(', '));
    if (health.medical_conditions.length) console.log(chalk.gray('  Conditions:      ') + health.medical_conditions.join(', '));
    if (health.medications.length) console.log(chalk.gray('  Medications:     ') + health.medications.join(', '));
    if (health.emergency_contacts.length) {
      console.log(chalk.yellow('\n  Emergency Contacts:'));
      for (const ec of health.emergency_contacts) {
        console.log(`    ${chalk.bold(ec.name)}  ${ec.phone}  ${chalk.gray(ec.relationship)}`);
      }
    }
    if (health.health_insurance_provider) console.log(chalk.gray('\n  Insurance:       ') + `${health.health_insurance_provider} (${health.health_insurance_id || 'no ID'})`);
    if (health.primary_physician) console.log(chalk.gray('  Physician:       ') + `${health.primary_physician} ${health.primary_physician_phone || ''}`);
    console.log(chalk.gray('  Organ Donor:     ') + (health.organ_donor ? 'yes' : 'no'));
    if (health.notes) console.log(chalk.gray('  Notes:           ') + health.notes);
    console.log();
  });

healthCmd
  .command('set <id>')
  .description('Set health data for a contact')
  .option('--blood-type <type>', 'Blood type (e.g. A+, O-)')
  .option('--allergies <list>', 'Comma-separated allergies')
  .option('--conditions <list>', 'Comma-separated medical conditions')
  .option('--medications <list>', 'Comma-separated medications')
  .option('--insurance-provider <name>', 'Health insurance provider')
  .option('--insurance-id <id>', 'Health insurance ID')
  .option('--physician <name>', 'Primary physician')
  .option('--physician-phone <phone>', 'Physician phone')
  .option('--organ-donor', 'Mark as organ donor')
  .option('--notes <text>', 'Health notes')
  .action(async (id: string, opts: {
    bloodType?: string; allergies?: string; conditions?: string; medications?: string;
    insuranceProvider?: string; insuranceId?: string; physician?: string; physicianPhone?: string;
    organDonor?: boolean; notes?: string;
  }) => {
    const { setHealthData } = await import('../../db/health.js');
    const contact = getContact(id);
    const input: Record<string, unknown> = {};
    if (opts.bloodType) input.blood_type = opts.bloodType;
    if (opts.allergies) input.allergies = opts.allergies.split(',').map(s => s.trim());
    if (opts.conditions) input.medical_conditions = opts.conditions.split(',').map(s => s.trim());
    if (opts.medications) input.medications = opts.medications.split(',').map(s => s.trim());
    if (opts.insuranceProvider) input.health_insurance_provider = opts.insuranceProvider;
    if (opts.insuranceId) input.health_insurance_id = opts.insuranceId;
    if (opts.physician) input.primary_physician = opts.physician;
    if (opts.physicianPhone) input.primary_physician_phone = opts.physicianPhone;
    if (opts.organDonor !== undefined) input.organ_donor = opts.organDonor;
    if (opts.notes) input.notes = opts.notes;
    try {
      setHealthData(id, input as import('../../db/health.js').SetHealthInput);
    } catch (err) { handleVaultError(err); }
    console.log(chalk.green(`\nHealth data updated for ${contact.display_name}\n`));
  });

healthCmd
  .command('clear <id>')
  .description('Delete all health data for a contact')
  .action(async (id: string) => {
    const { deleteHealthData } = await import('../../db/health.js');
    const contact = getContact(id);
    try {
      deleteHealthData(id);
    } catch (err) { handleVaultError(err); }
    console.log(chalk.green(`\nHealth data cleared for ${contact.display_name}\n`));
  });

} // end registerAdvancedCommands
