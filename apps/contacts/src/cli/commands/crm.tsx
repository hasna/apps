import type { Command } from "commander";
import chalk from "chalk";
import { getStore } from "../../store/index.js";
import type {
  CompanyRelationshipType,
  ContactTask,
  ApplicationType,
  ApplicationStatus,
} from "../../types/index.js";
import { renderTable, promptUser as prompt } from "../utils.js";

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}

export function registerCrmCommands(program: Command): void {

// ─── contacts completion ──────────────────────────────────────────────────────

program
  .command("completion <shell>")
  .description("Generate shell completion script (bash, zsh, fish)")
  .action((shell: string) => {
    const commands = [
      "add", "list", "show", "edit", "delete", "search", "recent", "dupe",
      "log", "open", "import", "export", "companies", "tags", "groups",
      "mcp", "connection", "legacy", "completion",
    ];
    if (shell === "zsh") {
      console.log(`#compdef contacts\n_contacts() {\n  local commands=(${commands.map(c => `'${c}'`).join(" ")})\n  _describe 'command' commands\n}\n_contacts "$@"`);
    } else if (shell === "bash") {
      console.log(`_contacts_completion() {\n  local cur=\${COMP_WORDS[COMP_CWORD]}\n  COMPREPLY=($(compgen -W "${commands.join(" ")}" -- "$cur"))\n}\ncomplete -F _contacts_completion contacts`);
    } else if (shell === "fish") {
      for (const c of commands) {
        console.log(`complete -c contacts -f -a ${c}`);
      }
    } else {
      console.error(chalk.red("Supported shells: bash, zsh, fish"));
    }
  });

// ─── contacts entities ────────────────────────────────────────────────────────

const entities = program.command('entities').description('Manage your owned legal entities');

entities
  .command('list')
  .description('List all owned legal entities')
  .action(async () => {
    const store = getStore();
    const result = await store.listCompanies({ limit: 200 });
    const owned = (result.companies as Array<{ is_owned_entity: boolean; name: string; entity_type?: string | null; industry?: string | null; description?: string | null }>).filter((c) => c.is_owned_entity);
    if (!owned.length) {
      console.log(chalk.yellow('No owned entities found. Add one with: contacts companies add'));
      return;
    }
    console.log();
    renderTable(
      ['Name', 'Type', 'Industry', 'Description'],
      owned.map((e) => ({
        Name: e.name,
        Type: e.entity_type || 'operating',
        Industry: e.industry || '',
        Description: e.description || '',
      }))
    );
    console.log(chalk.gray(`\n${owned.length} owned entity/entities\n`));
  });

entities
  .command('show <id>')
  .description('Show entity with full team')
  .action(async (id: string) => {
    const store = getStore();
    const company = await store.getCompany(id) as { id: string; name: string; industry?: string | null; description?: string | null } | null;
    if (!company) {
      console.error(chalk.red(`\nEntity not found: ${id}\n`));
      process.exit(1);
    }
    console.log('\n' + chalk.bold.blue('━━━ Entity: ') + chalk.bold(company.name) + chalk.bold.blue(' ━━━'));
    console.log();
    if (company.industry) console.log(chalk.gray('  Industry:    ') + company.industry);
    if (company.description) console.log(chalk.gray('  Description: ') + company.description);
    console.log(chalk.gray(`  ID: ${company.id}`));
    console.log();

    const team = await store.listCompanyRelationships({ company_id: id }) as Array<{ contact_id: string; relationship_type: string; is_primary: boolean; status: string }>;
    if (team.length === 0) {
      console.log(chalk.gray('  No team members assigned.\n'));
      return;
    }
    console.log(chalk.yellow(`  Team (${team.length}):\n`));
    const rows = [];
    for (const r of team) {
      let name = r.contact_id;
      try {
        const c = await store.getContact(r.contact_id);
        if (c) name = c.display_name;
      } catch { /* contact not found */ }
      rows.push({
        Contact: name,
        Role: r.relationship_type,
        Primary: r.is_primary ? 'yes' : '',
        Status: r.status,
      });
    }
    renderTable(['Contact', 'Role', 'Primary', 'Status'], rows);
    console.log();
  });

entities
  .command('add-contact <entity-id> <contact-id>')
  .description('Link a contact to an entity with a role')
  .option('--role <role>', 'Role (tax_preparer|bank_manager|attorney|registered_agent|accountant|payroll_provider|insurance_broker|advisor|other)', 'other')
  .option('--primary', 'Mark as primary contact for this role')
  .action(async (entityId: string, contactId: string, opts: { role?: string; primary?: boolean }) => {
    const store = getStore();
    const contact = await store.getContact(contactId);
    if (!contact) {
      console.error(chalk.red(`\nContact not found: ${contactId}\n`));
      process.exit(1);
    }
    const company = await store.getCompany(entityId) as { name: string } | null;
    if (!company) {
      console.error(chalk.red(`\nEntity not found: ${entityId}\n`));
      process.exit(1);
    }
    const rel = await store.createCompanyRelationship({
      contact_id: contactId,
      company_id: entityId,
      relationship_type: (opts.role || 'other') as CompanyRelationshipType,
      is_primary: opts.primary || false,
    }) as { relationship_type: string };
    console.log(chalk.green(`\n✓ Linked ${contact.display_name} to ${company.name} as ${rel.relationship_type}\n`));
  });

entities
  .command('team <id>')
  .description('Show full team matrix for an entity')
  .action(async (id: string) => {
    const store = getStore();
    const company = await store.getCompany(id) as { name: string } | null;
    if (!company) {
      console.error(chalk.red(`\nEntity not found: ${id}\n`));
      process.exit(1);
    }
    const team = await store.listCompanyRelationships({ company_id: id }) as Array<{ contact_id: string; relationship_type: string; is_primary: boolean; status: string }>;
    if (team.length === 0) {
      console.log(chalk.yellow(`\nNo team members for ${company.name}.\n`));
      return;
    }
    console.log('\n' + chalk.bold(`Team: ${company.name}`) + '\n');
    const rows = [];
    for (const r of team) {
      let name = r.contact_id;
      try {
        const c = await store.getContact(r.contact_id);
        if (c) name = c.display_name;
      } catch { /* not found */ }
      rows.push({
        Contact: name,
        Role: r.relationship_type,
        Primary: r.is_primary ? 'yes' : '',
        Status: r.status,
      });
    }
    renderTable(['Contact', 'Role', 'Primary', 'Status'], rows);
    console.log();
  });

// ─── contacts workload ────────────────────────────────────────────────────────

program
  .command('workload <id>')
  .description('Show workload summary for a contact')
  .action(async (id: string) => {
    const store = getStore();
    const contact = await store.getContact(id);
    if (!contact) {
      console.error(chalk.red(`\nContact not found: ${id}\n`));
      process.exit(1);
    }
    const companyRels = await store.listCompanyRelationships({ contact_id: id }) as Array<{ relationship_type: string; notes?: string | null }>;
    const overdue = (await store.listOverdueTasks() as Array<{ contact_id: string }>).filter((t) => t.contact_id === id);
    const orgMemberships = await store.listOrgMembersForContact(id);

    console.log(chalk.bold(`\n${contact.display_name}`));
    if (contact.job_title) console.log(chalk.gray(`  ${contact.job_title}`));
    console.log();

    if (companyRels.length) {
      console.log(chalk.cyan(`  Manages/linked to ${companyRels.length} company relationship(s):`));
      for (const r of companyRels.slice(0, 5)) {
        console.log(chalk.gray(`    • ${r.relationship_type}${r.notes ? ` — ${r.notes}` : ''}`));
      }
    }

    if (orgMemberships.length) {
      console.log(chalk.cyan(`  Org memberships: ${orgMemberships.length}`));
    }

    if (overdue.length) {
      console.log(chalk.red(`  ⚠ Overdue tasks: ${overdue.length}`));
    } else {
      console.log(chalk.green('  No overdue tasks'));
    }

    if (contact.last_contacted_at) {
      const days = Math.floor((Date.now() - new Date(contact.last_contacted_at).getTime()) / 86400000);
      const color = days > 30 ? chalk.red : days > 14 ? chalk.yellow : chalk.green;
      console.log(color(`  Last contact: ${days} day(s) ago`));
    } else {
      console.log(chalk.gray('  Never contacted'));
    }
    console.log();
  });

// ─── contacts vendor ──────────────────────────────────────────────────────────

const vendor = program.command('vendor').description('Track vendor communications and invoices');

vendor
  .command('log <company-id>')
  .description('Log a vendor communication')
  .option('--type <type>', 'Type: email|invoice_request|invoice_received|call|payment|dispute|other', 'email')
  .option('--subject <subject>', 'Subject')
  .option('--body <body>', 'Body/notes')
  .option('--amount <n>', 'Invoice amount')
  .option('--currency <c>', 'Currency', 'USD')
  .option('--ref <ref>', 'Invoice reference')
  .option('--follow-up <date>', 'Follow-up date (YYYY-MM-DD)')
  .option('--status <status>', 'Status: sent|awaiting_response|responded|no_response|resolved', 'sent')
  .option('--contact <id>', 'Contact ID (optional)')
  .option('--direction <dir>', 'Direction: inbound|outbound', 'outbound')
  .action(async (companyId: string, opts: {
    type?: string;
    subject?: string;
    body?: string;
    amount?: string;
    currency?: string;
    ref?: string;
    followUp?: string;
    status?: string;
    contact?: string;
    direction?: string;
  }) => {
    const store = getStore();
    const company = await store.getCompany(companyId) as { name: string } | null;
    if (!company) {
      console.error(chalk.red(`\nCompany not found: ${companyId}\n`));
      process.exit(1);
    }
    const comm = await store.logVendorCommunication({
      company_id: companyId,
      contact_id: opts.contact,
      comm_date: new Date().toISOString().slice(0, 10),
      type: (opts.type || 'email') as never,
      direction: (opts.direction || 'outbound') as never,
      subject: opts.subject,
      body: opts.body,
      status: (opts.status || 'sent') as never,
      invoice_amount: opts.amount ? parseFloat(opts.amount) : undefined,
      invoice_currency: opts.currency,
      invoice_ref: opts.ref,
      follow_up_date: opts.followUp,
    }) as { type: string; id: string };
    console.log(chalk.green(`\n✓ Logged ${comm.type} communication with ${company.name} (${comm.id})\n`));
  });

vendor
  .command('missing-invoices')
  .description('Show all invoice requests with no response')
  .action(async () => {
    const store = getStore();
    const missing = await store.listMissingInvoices() as Array<{ company_id: string; comm_date: string; subject?: string | null; status: string }>;
    if (!missing.length) {
      console.log(chalk.green('\nNo missing invoices.\n'));
      return;
    }
    console.log(chalk.yellow(`\n${missing.length} missing invoice(s):\n`));
    renderTable(
      ['Company', 'Date', 'Subject', 'Status'],
      missing.map((m) => ({
        Company: m.company_id,
        Date: m.comm_date,
        Subject: m.subject || '',
        Status: m.status,
      }))
    );
    console.log();
  });

vendor
  .command('pending-followups')
  .description('Show vendor follow-ups due today or overdue')
  .action(async () => {
    const store = getStore();
    const pending = await store.listPendingFollowUps() as Array<{ company_id: string; type: string; follow_up_date?: string | null; subject?: string | null }>;
    if (!pending.length) {
      console.log(chalk.green('\nNo pending follow-ups.\n'));
      return;
    }
    console.log(chalk.yellow(`\n${pending.length} pending follow-up(s):\n`));
    renderTable(
      ['Company', 'Type', 'Follow-up', 'Subject'],
      pending.map((p) => ({
        Company: p.company_id,
        Type: p.type,
        'Follow-up': p.follow_up_date || '',
        Subject: p.subject || '',
      }))
    );
    console.log();
  });

vendor
  .command('history <company-id>')
  .description('Show vendor communication history for a company')
  .action(async (id: string) => {
    const store = getStore();
    const company = await store.getCompany(id) as { name: string } | null;
    if (!company) {
      console.error(chalk.red(`\nCompany not found: ${id}\n`));
      process.exit(1);
    }
    const comms = await store.listVendorCommunications(id, {}) as Array<{ comm_date: string; type: string; direction: string; subject?: string | null; status: string }>;
    if (!comms.length) {
      console.log(chalk.gray(`\nNo communications logged for ${company.name}.\n`));
      return;
    }
    console.log(chalk.bold(`\nCommunications: ${company.name} (${comms.length})\n`));
    renderTable(
      ['Date', 'Type', 'Direction', 'Subject', 'Status'],
      comms.map((c) => ({
        Date: c.comm_date,
        Type: c.type,
        Direction: c.direction,
        Subject: c.subject || '',
        Status: c.status,
      }))
    );
    console.log();
  });

// ─── contacts task ────────────────────────────────────────────────────────────

const taskCmd = program.command('task').description('Contact-assigned tasks with escalation');

taskCmd
  .command('create')
  .description('Create a contact task')
  .option('--contact <id>', 'Contact ID (required)')
  .option('--title <title>', 'Task title (required)')
  .option('--deadline <date>', 'Deadline (YYYY-MM-DD)')
  .option('--priority <p>', 'Priority: low|medium|high|critical', 'medium')
  .option('--entity <id>', 'Entity/company this task is for')
  .option('--escalate <rule>', 'Escalation rule: contactId:afterDays (repeatable)', collect, [] as string[])
  .action(async (opts: {
    contact?: string;
    title?: string;
    deadline?: string;
    priority?: string;
    entity?: string;
    escalate: string[];
  }) => {
    const store = getStore();
    let contactId = opts.contact;
    let title = opts.title;
    if (!contactId) {
      contactId = await prompt('Contact ID (required):');
      if (!contactId) { console.error(chalk.red('Contact ID is required.')); process.exit(1); }
    }
    if (!title) {
      title = await prompt('Task title (required):');
      if (!title) { console.error(chalk.red('Task title is required.')); process.exit(1); }
    }
    const escalationRules = opts.escalate.map((rule: string) => {
      const [contactIdPart, daysPart] = rule.split(':');
      return {
        escalate_to_contact_id: contactIdPart || '',
        after_days: parseInt(daysPart || '7', 10),
        method: 'email' as const,
      };
    });
    const contact = await store.getContact(contactId);
    if (!contact) { console.error(chalk.red(`\nContact not found: ${contactId}\n`)); process.exit(1); }
    const task = await store.createContactTask({
      title,
      contact_id: contactId,
      deadline: opts.deadline,
      priority: (opts.priority || 'medium') as ContactTask['priority'],
      entity_id: opts.entity,
      escalation_rules: escalationRules.length ? escalationRules : undefined,
    }) as { title: string; id: string };
    console.log(chalk.green(`\n✓ Task created for ${contact.display_name}: ${task.title} (${task.id})\n`));
  });

taskCmd
  .command('list [contact-id]')
  .description('List contact tasks')
  .option('--overdue', 'Show only overdue tasks')
  .option('--status <s>', 'Filter by status')
  .action(async (contactId: string | undefined, opts: { overdue?: boolean; status?: string }) => {
    const store = getStore();
    let tasks: Array<{ title: string; contact_id: string; priority: string; status: string; deadline?: string | null }>;
    if (opts.overdue) {
      tasks = await store.listOverdueTasks() as typeof tasks;
      if (contactId) tasks = tasks.filter((t) => t.contact_id === contactId);
    } else {
      tasks = await store.listContactTasks({
        contact_id: contactId,
        status: opts.status as ContactTask['status'],
      }) as typeof tasks;
    }
    if (!tasks.length) {
      console.log(chalk.gray('\nNo tasks found.\n'));
      return;
    }
    console.log();
    const rows = [];
    for (const t of tasks) {
      let contactName = t.contact_id;
      try { const c = await store.getContact(t.contact_id); if (c) contactName = c.display_name; } catch { /* not found */ }
      rows.push({
        Title: t.title,
        Contact: contactName,
        Priority: t.priority,
        Status: t.status,
        Deadline: t.deadline ? t.deadline.slice(0, 10) : '',
      });
    }
    renderTable(['Title', 'Contact', 'Priority', 'Status', 'Deadline'], rows);
    console.log(chalk.gray(`\n${tasks.length} task(s)\n`));
  });

taskCmd
  .command('done <id>')
  .description('Mark a contact task as completed')
  .action(async (id: string) => {
    const store = getStore();
    const updated = await store.updateContactTask(id, { status: 'completed' }) as { title: string };
    console.log(chalk.green(`\n✓ Task completed: ${updated.title}\n`));
  });

// ─── contacts applications ────────────────────────────────────────────────────

const appsCmd = program.command('applications').description('Track grant/credit/program applications');

appsCmd
  .command('list')
  .description('List applications')
  .option('--status <s>', 'Filter by status')
  .option('--type <t>', 'Filter by type')
  .action(async (opts: { status?: string; type?: string }) => {
    const store = getStore();
    const apps = await store.listApplications({
      status: opts.status as ApplicationStatus | undefined,
      type: opts.type as ApplicationType | undefined,
    }) as Array<{ program_name: string; type: string; status: string; value_usd?: number | null; follow_up_date?: string | null }>;
    if (!apps.length) {
      console.log(chalk.gray('\nNo applications found.\n'));
      return;
    }
    console.log();
    renderTable(
      ['Program', 'Type', 'Status', 'Value', 'Follow-up'],
      apps.map((a) => ({
        Program: a.program_name,
        Type: a.type,
        Status: a.status,
        Value: a.value_usd ? `$${a.value_usd.toLocaleString()}` : '',
        'Follow-up': a.follow_up_date ? a.follow_up_date.slice(0, 10) : '',
      }))
    );
    console.log(chalk.gray(`\n${apps.length} application(s)\n`));
  });

appsCmd
  .command('add')
  .description('Add a new application')
  .option('--name <name>', 'Program name (required)')
  .option('--type <type>', 'Type: ai_credits|grant|startup_program|other', 'other')
  .option('--value <usd>', 'Value in USD')
  .option('--status <status>', 'Status: draft|submitted|pending|approved|rejected|follow_up_needed|expired|cancelled', 'draft')
  .option('--follow-up <date>', 'Follow-up date (YYYY-MM-DD)')
  .option('--provider <id>', 'Provider company ID')
  .option('--contact <id>', 'Primary contact ID')
  .option('--method <method>', 'Application method: email|form|typeform|hubspot|manual|browser|feathery|other')
  .option('--url <url>', 'Form URL')
  .action(async (opts: {
    name?: string;
    type?: string;
    value?: string;
    status?: string;
    followUp?: string;
    provider?: string;
    contact?: string;
    method?: string;
    url?: string;
  }) => {
    const store = getStore();
    let name = opts.name;
    if (!name) {
      name = await prompt('Program name (required):');
      if (!name) { console.error(chalk.red('Program name is required.')); process.exit(1); }
    }
    const app = await store.createApplication({
      program_name: name,
      type: (opts.type || 'other') as ApplicationType,
      value_usd: opts.value ? parseFloat(opts.value) : undefined,
      status: (opts.status || 'draft') as ApplicationStatus,
      follow_up_date: opts.followUp,
      provider_company_id: opts.provider,
      primary_contact_id: opts.contact,
      method: opts.method as "email" | "form" | "typeform" | "hubspot" | "manual" | "browser" | "feathery" | "other" | undefined,
      form_url: opts.url,
    }) as { program_name: string; id: string };
    console.log(chalk.green(`\n✓ Application created: ${app.program_name} (${app.id})\n`));
  });

appsCmd
  .command('followup')
  .description('Show applications with follow-up due')
  .action(async () => {
    const store = getStore();
    const apps = await store.listFollowUpDueApplications() as Array<{ program_name: string; type: string; status: string; follow_up_date?: string | null }>;
    if (!apps.length) {
      console.log(chalk.green('\nNo follow-ups due.\n'));
      return;
    }
    console.log(chalk.yellow(`\n${apps.length} application(s) need follow-up:\n`));
    renderTable(
      ['Program', 'Type', 'Status', 'Follow-up'],
      apps.map((a) => ({
        Program: a.program_name,
        Type: a.type,
        Status: a.status,
        'Follow-up': a.follow_up_date ? a.follow_up_date.slice(0, 10) : '',
      }))
    );
    console.log();
  });

// ─── contacts seed ────────────────────────────────────────────────────────────

program
  .command('seed')
  .description('Seed demo contacts, companies, and relationships')
  .option('--demo', 'Seed demo data (professional services example)')
  .option('--clear', 'Clear existing demo data first')
  .action(async (opts: { demo?: boolean; clear?: boolean }) => {
    const store = getStore();

    if (opts.clear) {
      // Delete only the known demo records (matched by the exact names/emails
      // this command seeds) so real data is never touched. Deleting a company
      // or contact cascades its relationships.
      const demoCompanyNames = [
        'KPMG Romania', 'Escalon Services', 'Revision Legal PLLC', 'RAW Financial',
        'Silicon Valley Bank', 'Hasna, Inc.', 'Beep Media International LLC', 'Hasna Global SRL',
      ];
      const demoContactEmails = [
        'alinaturlea@kpmg.com', 'lsipos@kpmg.com', 'elizabeth.robles@escalon.services',
        'drew@revisionlegal.com', 'DYang@svb.com',
      ];
      let removedCompanies = 0;
      let removedContacts = 0;
      const { companies } = await store.listCompanies({ limit: 500 }) as { companies: Array<{ id: string; name: string }> };
      for (const c of companies) {
        if (demoCompanyNames.includes(c.name)) {
          await store.deleteCompany(c.id);
          removedCompanies++;
        }
      }
      for (const email of demoContactEmails) {
        const contact = await store.getContactByEmail(email) as { id: string } | null;
        if (contact) {
          await store.deleteContact(contact.id);
          removedContacts++;
        }
      }
      console.log(chalk.green(`✓ Cleared demo data: ${removedCompanies} companies, ${removedContacts} contacts`));
      if (!opts.demo) return;
    }

    if (!opts.demo) {
      console.log('Use --demo flag to seed demo data (add --clear to remove previously seeded demo data)');
      return;
    }
    console.log(chalk.cyan('Seeding demo contacts...'));

    type Co = { id: string; name: string };
    // Create vendor companies
    const kpmg = await store.createCompany({ name: 'KPMG Romania', industry: 'Accounting', description: 'Romanian accounting, tax, and payroll firm' }) as Co;
    const escalon = await store.createCompany({ name: 'Escalon Services', industry: 'Tax & Finance', description: 'US tax preparation for multi-entity businesses', domain: 'escalon.services' }) as Co;
    const revisionLegal = await store.createCompany({ name: 'Revision Legal PLLC', industry: 'Legal', description: 'Trademark and IP law firm', domain: 'revisionlegal.com' }) as Co;
    await store.createCompany({ name: 'RAW Financial', industry: 'Tax & Finance', description: 'US tax preparation for dissolution entities' });
    const svb = await store.createCompany({ name: 'Silicon Valley Bank', industry: 'Banking', domain: 'svb.com' }) as Co;

    // Create owned entities
    const hasnaInc = await store.createCompany({ name: 'Hasna, Inc.', is_owned_entity: true, entity_type: 'operating', industry: 'AI/Software', description: 'Primary US operating entity (C-Corp, Delaware)' }) as Co;
    const beepMedia = await store.createCompany({ name: 'Beep Media International LLC', is_owned_entity: true, entity_type: 'operating', industry: 'Media/Technology' }) as Co;
    await store.createCompany({ name: 'Hasna Global SRL', is_owned_entity: true, entity_type: 'operating', industry: 'AI/Software', description: 'Romanian operating entity' });

    // Create contacts
    const alina = await store.createContact({ display_name: 'Alina Turlea', first_name: 'Alina', last_name: 'Turlea', job_title: 'Tax Consultant', emails: [{ address: 'alinaturlea@kpmg.com', type: 'work', is_primary: true }], source: 'manual' });
    const lucia = await store.createContact({ display_name: 'Lucia Grecu', first_name: 'Lucia', last_name: 'Grecu', job_title: 'Compliance & Billing', emails: [{ address: 'lsipos@kpmg.com', type: 'work', is_primary: true }], source: 'manual' });
    const elizabeth = await store.createContact({ display_name: 'Elizabeth Robles', first_name: 'Elizabeth', last_name: 'Robles', job_title: 'Tax Manager', emails: [{ address: 'elizabeth.robles@escalon.services', type: 'work', is_primary: true }], source: 'manual' });
    const drew = await store.createContact({ display_name: 'Andrew Jurgensen', first_name: 'Andrew', last_name: 'Jurgensen', job_title: 'Partner', emails: [{ address: 'drew@revisionlegal.com', type: 'work', is_primary: true }], source: 'manual' });
    const donna = await store.createContact({ display_name: 'Donna Yang', first_name: 'Donna', last_name: 'Yang', job_title: 'Relationship Manager', emails: [{ address: 'DYang@svb.com', type: 'work', is_primary: true }], source: 'manual' });

    // Link contacts to companies
    await store.createCompanyRelationship({ contact_id: alina.id, company_id: kpmg.id, relationship_type: 'vendor', is_primary: true });
    await store.createCompanyRelationship({ contact_id: lucia.id, company_id: kpmg.id, relationship_type: 'vendor' });
    await store.createCompanyRelationship({ contact_id: elizabeth.id, company_id: escalon.id, relationship_type: 'vendor', is_primary: true });
    await store.createCompanyRelationship({ contact_id: drew.id, company_id: revisionLegal.id, relationship_type: 'vendor', is_primary: true });
    await store.createCompanyRelationship({ contact_id: donna.id, company_id: svb.id, relationship_type: 'vendor', is_primary: true });

    // Link contacts to owned entities
    await store.createCompanyRelationship({ contact_id: alina.id, company_id: hasnaInc.id, relationship_type: 'vendor', is_primary: true });
    await store.createCompanyRelationship({ contact_id: alina.id, company_id: beepMedia.id, relationship_type: 'vendor', is_primary: true });

    // Use the contacts (avoid unused variable warnings)
    void [lucia, elizabeth, drew, donna];

    console.log(chalk.green(`✓ Seeded: 5 companies, 3 owned entities, 5 key contacts`));
    console.log(chalk.gray('  Try: contacts entities list'));
    console.log(chalk.gray('  Try: contacts workload ' + alina.id));
  });

// ─── contacts brief ───────────────────────────────────────────────────────────

program
  .command('brief <id>')
  .description('Generate pre-meeting briefing for a contact')
  .action(async (id: string) => {
    const brief = await getStore().generateBrief(id);
    console.log(brief);
  });

// ─── contacts cold ────────────────────────────────────────────────────────────

program
  .command('cold')
  .description("Show contacts you haven't reached out to recently")
  .option('-d, --days <n>', 'Days threshold', '30')
  .option('-j, --json', 'Output JSON')
  .action(async (opts: { days: string; json?: boolean }) => {
    const contacts = await getStore().listColdContacts(parseInt(opts.days, 10)) as Array<{ display_name: string; company?: { name: string } | null; last_contacted_at?: string | null; days_cold?: number | null }>;
    if (opts.json) {
      console.log(JSON.stringify({ contacts, total: contacts.length, threshold_days: parseInt(opts.days, 10) }, null, 2));
      return;
    }
    if (!contacts.length) {
      console.log(chalk.green('\nNo cold contacts!\n'));
      return;
    }
    console.log();
    const rows = contacts.map((c) => {
      const daysCold = c.days_cold ?? null;
      const lastContact = c.last_contacted_at ? c.last_contacted_at.slice(0, 10) : 'never';
      const dayStr = daysCold === null ? chalk.red('never') : daysCold > 60 ? chalk.red(String(daysCold) + 'd') : chalk.yellow(String(daysCold) + 'd');
      return {
        Name: c.display_name,
        Company: c.company?.name ?? '',
        'Last Contact': lastContact,
        'Days Cold': dayStr,
      };
    });
    renderTable(['Name', 'Company', 'Last Contact', 'Days Cold'], rows);
    console.log(chalk.gray(`\n${contacts.length} cold contact(s) (${opts.days}+ days)\n`));
  });

// ─── contacts upcoming ────────────────────────────────────────────────────────

program
  .command('upcoming')
  .option('-d, --days <n>', 'Days ahead to show', '7')
  .option('-j, --json', 'Output JSON')
  .description('Show upcoming follow-ups, birthdays, and deadlines')
  .action(async (opts: { days: string; json?: boolean }) => {
    const items = await getStore().getUpcomingItems(parseInt(opts.days, 10)) as Array<{ type?: string; urgency?: string; date?: string; title?: string }>;
    if (opts.json) {
      console.log(JSON.stringify({ items, total: items.length, window_days: parseInt(opts.days, 10) }, null, 2));
      return;
    }
    if (!items.length) {
      console.log(chalk.green('\nNothing upcoming!\n'));
      return;
    }
    console.log();
    const iconMap: Record<string, string> = {
      follow_up: '📅',
      birthday: '🎂',
      task_deadline: '⚠️',
      application_followup: '📋',
      vendor_followup: '💼',
    };
    for (const item of items) {
      const icon = iconMap[item.type as string] ?? '•';
      const urgencyColor = item.urgency === 'overdue' ? chalk.red : item.urgency === 'today' ? chalk.yellow : chalk.white;
      console.log(`  ${icon}  ${urgencyColor(item.date?.slice(0, 10) ?? '')}  ${chalk.bold(item.title ?? '')}  ${chalk.gray(item.type ?? '')}`);
    }
    console.log(chalk.gray(`\n${items.length} upcoming item(s) in next ${opts.days} days\n`));
  });

// ─── contacts stats ───────────────────────────────────────────────────────────

program
  .command('stats')
  .description('Network health dashboard')
  .option('-j, --json', 'Output JSON')
  .action(async (opts: { json?: boolean }) => {
    const store = getStore();
    // Some aggregate routes are not exposed by /v1 yet. Degrade to the real
    // remote basic counts rather than reading local data.
    let s: Awaited<ReturnType<typeof store.getNetworkStats>>;
    try {
      s = await store.getNetworkStats();
    } catch (err) {
      if (!(err instanceof Error && err.name === 'ApiUnavailableError')) throw err;
      const basic = await store.stats();
      if (opts.json) {
        console.log(JSON.stringify({ total_contacts: basic.contacts, total_companies: basic.companies, total_tags: basic.tags, total_groups: basic.groups, extended_metrics: 'unavailable_via_v1' }, null, 2));
        return;
      }
      console.log(chalk.bold.blue('\n━━━ Network Health Dashboard ━━━\n'));
      console.log(chalk.bold('  Network Size:'));
      console.log(`    ${chalk.cyan(String(basic.contacts))} contacts   ${chalk.cyan(String(basic.companies))} companies   ${chalk.cyan(String(basic.tags))} tags   ${chalk.cyan(String(basic.groups))} groups`);
      console.log(chalk.gray('\n  (Cold/tasks/deals/pipeline metrics are not exposed by the current /v1 API.)\n'));
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(s, null, 2));
      return;
    }
    console.log(chalk.bold.blue('\n━━━ Network Health Dashboard ━━━\n'));

    console.log(chalk.bold('  Network Size:'));
    console.log(`    ${chalk.cyan(String(s.total_contacts))} contacts   ${chalk.cyan(String(s.total_companies))} companies   ${chalk.cyan(String(s.total_tags))} tags   ${chalk.cyan(String(s.total_groups))} groups`);

    console.log(chalk.bold('\n  Cold Contacts:'));
    const c30 = s.cold_30d;
    const c60 = s.cold_60d;
    const cnever = s.cold_never;
    console.log(`    ${c30 > 5 ? chalk.red(String(c30)) : c30 > 0 ? chalk.yellow(String(c30)) : chalk.green(String(c30))} not contacted in 30d`);
    console.log(`    ${c60 > 5 ? chalk.red(String(c60)) : c60 > 0 ? chalk.yellow(String(c60)) : chalk.green(String(c60))} not contacted in 60d`);
    console.log(`    ${cnever > 5 ? chalk.red(String(cnever)) : cnever > 0 ? chalk.yellow(String(cnever)) : chalk.green(String(cnever))} never contacted`);

    console.log(chalk.bold('\n  Action Required:'));
    console.log(`    ${s.overdue_tasks > 0 ? chalk.red(String(s.overdue_tasks)) : chalk.green('0')} overdue tasks`);
    console.log(`    ${s.pending_applications > 0 ? chalk.yellow(String(s.pending_applications)) : chalk.green('0')} pending applications`);
    console.log(`    ${s.missing_invoices > 0 ? chalk.yellow(String(s.missing_invoices)) : chalk.green('0')} missing invoices`);
    console.log(`    ${s.upcoming_7d > 0 ? chalk.yellow(String(s.upcoming_7d)) : chalk.green('0')} upcoming in 7d`);

    console.log(chalk.bold('\n  Deal Pipeline:'));
    console.log(`    ${chalk.cyan('$' + s.active_deals_value.toLocaleString())} active pipeline   ${chalk.cyan(String(s.total_deals))} active deal(s)`);
    console.log();
  });

// ─── contacts audit ───────────────────────────────────────────────────────────

program
  .command('audit')
  .description('Score contacts for data completeness')
  .option('-l, --limit <n>', 'Number to show', '20')
  .action(async (opts: { limit: string }) => {
    const results = (await getStore().listContactAudit()).slice(0, parseInt(opts.limit, 10));
    if (!results.length) {
      console.log(chalk.gray('\nNo contacts found.\n'));
      return;
    }
    console.log();
    for (const r of results) {
      const score = (r as { score: number }).score;
      const name = (r as { display_name: string }).display_name;
      const missing = (r as { missing_fields?: string[] }).missing_fields ?? [];
      const filled = Math.round(score / 10);
      const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(10 - filled));
      const scoreColor = score < 40 ? chalk.red : score < 70 ? chalk.yellow : chalk.green;
      console.log(`  ${bar} ${scoreColor(String(score).padStart(3) + '%')}  ${chalk.bold(name)}  ${chalk.gray(missing.join(', '))}`);
    }
    console.log(chalk.gray(`\n${results.length} contact(s) shown (sorted by completeness ascending)\n`));
  });

// ─── contacts deals ───────────────────────────────────────────────────────────

const dealsCmd = program.command('deals').description('Manage deals and opportunities');

dealsCmd
  .command('list')
  .description('List deals')
  .option('--stage <s>', 'Filter by stage')
  .action(async (opts: { stage?: string }) => {
    const store = getStore();
    const deals = await store.listDeals({ stage: opts.stage as import('../../types/index.js').DealStage | undefined }) as Array<{ title: string; stage: string; value_usd?: number | null; close_date?: string | null; contact_id?: string | null }>;
    if (!deals.length) {
      console.log(chalk.gray('\nNo deals found.\n'));
      return;
    }
    console.log();
    renderTable(
      ['Title', 'Stage', 'Value', 'Close Date', 'Contact'],
      deals.map(d => ({
        Title: d.title,
        Stage: d.stage,
        Value: d.value_usd ? '$' + d.value_usd.toLocaleString() : '',
        'Close Date': d.close_date ? d.close_date.slice(0, 10) : '',
        Contact: d.contact_id ?? '',
      }))
    );
    console.log(chalk.gray(`\n${deals.length} deal(s)\n`));
  });

dealsCmd
  .command('add')
  .description('Add a new deal')
  .option('--title <title>', 'Deal title (required)')
  .option('--stage <stage>', 'Stage: lead|qualified|proposal|negotiation|won|lost|cancelled', 'lead')
  .option('--value <usd>', 'Value in USD')
  .option('--contact <id>', 'Contact ID')
  .option('--company <id>', 'Company ID')
  .option('--close-date <date>', 'Expected close date (YYYY-MM-DD)')
  .option('--notes <text>', 'Notes')
  .action(async (opts: { title?: string; stage?: string; value?: string; contact?: string; company?: string; closeDate?: string; notes?: string }) => {
    const store = getStore();
    let title = opts.title;
    if (!title) {
      title = await prompt('Deal title (required):');
      if (!title) { console.error(chalk.red('Title is required.')); process.exit(1); }
    }
    const validStages = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'cancelled'];
    if (opts.stage && !validStages.includes(opts.stage)) {
      console.error(chalk.red(`Invalid stage '${opts.stage}'. Valid stages: ${validStages.join(', ')}`));
      process.exit(1);
    }
    const deal = await store.createDeal({
      title,
      stage: opts.stage as import('../../types/index.js').DealStage | undefined,
      value_usd: opts.value ? parseFloat(opts.value) : undefined,
      contact_id: opts.contact,
      company_id: opts.company,
      close_date: opts.closeDate,
      notes: opts.notes,
    }) as { title: string; id: string };
    console.log(chalk.green(`\n✓ Deal created: ${deal.title} (${deal.id})\n`));
  });

dealsCmd
  .command('show <id>')
  .description('Show deal details')
  .action(async (id: string) => {
    const deal = await getStore().getDeal(id) as Record<string, unknown> | null;
    if (!deal) { console.error(chalk.red(`\nDeal not found: ${id}\n`)); process.exit(1); }
    console.log();
    for (const [k, v] of Object.entries(deal)) {
      if (v !== null && v !== undefined) console.log(`  ${chalk.gray(k.padEnd(15))} ${v}`);
    }
    console.log();
  });

dealsCmd
  .command('won <id>')
  .description('Mark a deal as won')
  .action(async (id: string) => {
    const deal = await getStore().updateDeal(id, { stage: 'won' }) as { title: string } | null;
    console.log(chalk.green(`\n✓ Deal won: ${deal?.title ?? id}\n`));
  });

dealsCmd
  .command('lost <id>')
  .description('Mark a deal as lost')
  .action(async (id: string) => {
    const deal = await getStore().updateDeal(id, { stage: 'lost' }) as { title: string } | null;
    console.log(chalk.yellow(`\nDeal lost: ${deal?.title ?? id}\n`));
  });

// ─── contacts events ──────────────────────────────────────────────────────────

const eventsCmd = program.command('events').description('Log meetings and interactions');

eventsCmd
  .command('log')
  .description('Log an event/meeting')
  .option('--title <title>', 'Event title (required)')
  .option('--type <type>', 'Type: meeting|call|email|lunch|conference|demo|other', 'meeting')
  .option('--date <date>', 'Date (YYYY-MM-DD, default today)')
  .option('--contact <id>', 'Contact ID (can repeat)', collect, [] as string[])
  .option('--duration <min>', 'Duration in minutes')
  .option('--notes <text>', 'Notes')
  .option('--outcome <text>', 'Outcome')
  .action(async (opts: { title?: string; type?: string; date?: string; contact: string[]; duration?: string; notes?: string; outcome?: string }) => {
    const store = getStore();
    let title = opts.title;
    if (!title) {
      title = await prompt('Event title (required):');
      if (!title) { console.error(chalk.red('Title is required.')); process.exit(1); }
    }
    const eventDate = opts.date ?? new Date().toISOString().slice(0, 10);
    const event = await store.logEvent({
      title,
      type: opts.type as import('../../types/index.js').EventType | undefined,
      event_date: eventDate,
      duration_min: opts.duration ? parseInt(opts.duration, 10) : undefined,
      contact_ids: opts.contact.length ? opts.contact : undefined,
      notes: opts.notes,
      outcome: opts.outcome,
    }) as { title: string };
    console.log(chalk.green(`\n✓ Event logged: ${event.title} on ${eventDate}\n`));
  });

eventsCmd
  .command('list [contact-id]')
  .description('List events, optionally for a specific contact')
  .action(async (contactId: string | undefined) => {
    const events = await getStore().listEvents({ contact_id: contactId }) as Array<{ title: string; type: string; event_date: string; duration_min?: number | null; notes?: string | null }>;
    if (!events.length) {
      console.log(chalk.gray('\nNo events found.\n'));
      return;
    }
    console.log();
    renderTable(
      ['Title', 'Type', 'Date', 'Duration'],
      events.map(e => ({
        Title: e.title,
        Type: e.type,
        Date: e.event_date.slice(0, 10),
        Duration: e.duration_min ? `${e.duration_min}m` : '',
      }))
    );
    console.log(chalk.gray(`\n${events.length} event(s)\n`));
  });

// ─── contacts timeline ────────────────────────────────────────────────────────

program
  .command('timeline <id>')
  .description('Full chronological activity history for a contact')
  .option('--limit <n>', 'Items to show', '20')
  .action(async (id: string, opts: { limit: string }) => {
    const store = getStore();
    const items = await store.getContactTimeline(id, parseInt(opts.limit, 10));
    if (!items.length) {
      console.log(chalk.gray('\nNo timeline items found.\n'));
      return;
    }
    const contact = await store.getContact(id);
    console.log(chalk.bold(`\nTimeline: ${contact?.display_name ?? id}\n`));
    const iconMap: Record<string, string> = {
      note: '📝',
      event: '📅',
      task: '✅',
      vendor_comm: '📧',
      interaction: '💬',
      deal: '💰',
    };
    for (const item of items) {
      const icon = iconMap[item.type] ?? '•';
      console.log(`  ${icon}  ${chalk.gray(item.date?.slice(0, 10) ?? '')}  ${chalk.bold(item.title)}  ${chalk.gray(item.body ? item.body.slice(0, 60) : '')}`);
    }
    console.log();
  });

// ─── contacts enrich ──────────────────────────────────────────────────────────

program
  .command('enrich <id>')
  .description('Auto-fill missing contact data via web search (requires EXA_API_KEY)')
  .action(async (id: string) => {
    const contact = await getStore().getContact(id);
    if (!contact) { console.error(chalk.red(`\nContact not found: ${id}\n`)); process.exit(1); }
    const exaKey = process.env['EXA_API_KEY'];
    if (!exaKey) {
      console.error(chalk.red('\nSet EXA_API_KEY environment variable to use enrichment.\n'));
      process.exit(1);
    }
    console.log(chalk.blue(`\nSearching for: ${contact.display_name}...\n`));
    const primaryEmail = contact.emails?.[0]?.address ?? '';
    const query = `${contact.display_name} ${primaryEmail} site:linkedin.com OR site:twitter.com OR site:github.com`;
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': exaKey, 'content-type': 'application/json' },
      body: JSON.stringify({ query, num_results: 5 }),
    });
    const data = await res.json() as { results?: Array<{ url?: string; title?: string }> };
    const results = data.results ?? [];
    if (!results.length) {
      console.log(chalk.gray('No results found.\n'));
      return;
    }
    const socialProfiles = contact.social_profiles;
    const suggestions: Array<{ field: string; value: string }> = [];
    for (const r of results) {
      if (r.url?.includes('linkedin.com') && !socialProfiles?.find(s => s.platform === 'linkedin')) suggestions.push({ field: 'linkedin', value: r.url! });
      if (r.url?.includes('twitter.com') && !socialProfiles?.find(s => s.platform === 'twitter')) suggestions.push({ field: 'twitter', value: r.url! });
      if (r.url?.includes('github.com') && !socialProfiles?.find(s => s.platform === 'github')) suggestions.push({ field: 'github', value: r.url! });
    }
    if (!suggestions.length) {
      console.log(chalk.green('No new data found to enrich.\n'));
      return;
    }
    console.log(chalk.yellow('Suggestions (review before applying):\n'));
    for (const s of suggestions) {
      console.log(`  ${chalk.cyan(s.field.padEnd(10))} ${s.value}`);
    }
    console.log(chalk.gray('\nUse `contacts edit <id>` to apply these manually.\n'));
  });

} // end registerCrmCommands
