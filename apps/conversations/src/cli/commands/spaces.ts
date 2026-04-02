import type { Command } from "commander";
import chalk from "chalk";
import { sendMessage, readMessages } from "../../lib/messages.js";
import { createSpace, updateSpace, archiveSpace, unarchiveSpace, listSpaces, getSpace, joinSpace, leaveSpace, getSpaceMembers } from "../../lib/spaces.js";
import { closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { renderContent } from "../../lib/terminal-markdown.js";

export function registerSpaceCommands(program: Command): void {
  const space = program
    .command("space")
    .description("Manage spaces");

  space
    .command("create")
    .description("Create a new space")
    .argument("<name>", "Space name")
    .option("--description <text>", "Space description")
    .option("--parent <name>", "Parent space name (for nesting)")
    .option("--project <id>", "Project ID to associate with")
    .option("--from <agent>", "Creator agent ID")
    .option("-j, --json", "Output as JSON")
    .action((name, opts) => {
      const agent = resolveIdentity(opts.from).trim();
      const spaceName = typeof name === "string" ? name.trim() : "";
      if (!agent) {
        console.error(chalk.red("Creator identity is required."));
        process.exit(1);
      }
      if (!spaceName) {
        console.error(chalk.red("Space name cannot be empty."));
        process.exit(1);
      }
      try {
        const description = typeof opts.description === "string" && opts.description.trim()
          ? opts.description.trim()
          : undefined;
        const sp = createSpace(spaceName, agent, {
          description,
          parent_id: opts.parent,
          project_id: opts.project,
        });
        if (opts.json) {
          console.log(JSON.stringify(sp, null, 2));
        } else {
          console.log(chalk.green(`Space #${sp.name} created`) + (sp.description ? chalk.dim(` — ${sp.description}`) : ""));
        }
      } catch (e: any) {
        if (e.message?.includes("UNIQUE constraint")) {
          console.error(chalk.red(`Space #${spaceName} already exists.`));
          process.exit(1);
        }
        console.error(chalk.red(e.message));
        process.exit(1);
      }
      closeDb();
    });

  space
    .command("list")
    .description("List all spaces")
    .option("--project <id>", "Filter by project ID")
    .option("--parent <name>", "Filter by parent space name")
    .option("--top-level", "Show only top-level spaces")
    .option("--archived", "Include archived spaces")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      const listOpts: { project_id?: string; parent_id?: string | null; include_archived?: boolean } = {};
      if (opts.project) listOpts.project_id = opts.project;
      if (opts.topLevel) {
        listOpts.parent_id = null;
      } else if (opts.parent) {
        listOpts.parent_id = opts.parent;
      }
      if (opts.archived) listOpts.include_archived = true;

      const spaces = listSpaces(listOpts);

      if (opts.json) {
        console.log(JSON.stringify(spaces, null, 2));
      } else {
        if (spaces.length === 0) {
          console.log(chalk.dim("No spaces found."));
        } else {
          for (const sp of spaces) {
            const desc = sp.description ? chalk.dim(` — ${sp.description}`) : "";
            const parent = sp.parent_id ? chalk.dim(` (child of ${sp.parent_id})`) : "";
            const archived = sp.archived_at ? chalk.yellow(" [archived]") : "";
            console.log(`${chalk.magenta(`#${sp.name}`)}${desc}${parent}${archived}  ${sp.member_count} members, ${sp.message_count} messages`);
          }
        }
      }
      closeDb();
    });

  space
    .command("update")
    .description("Update a space")
    .argument("<name>", "Space name")
    .option("--description <text>", "New description")
    .option("--parent <name>", "New parent space name")
    .option("--project <id>", "New project ID")
    .option("-j, --json", "Output as JSON")
    .action((name, opts) => {
      const spaceName = typeof name === "string" ? name.trim() : "";
      if (!spaceName) {
        console.error(chalk.red("Space name cannot be empty."));
        process.exit(1);
      }

      const updates: { description?: string; parent_id?: string | null; project_id?: string | null } = {};
      if (opts.description !== undefined) updates.description = opts.description;
      if (opts.parent !== undefined) updates.parent_id = opts.parent || null;
      if (opts.project !== undefined) updates.project_id = opts.project || null;

      try {
        const sp = updateSpace(spaceName, updates);
        if (opts.json) {
          console.log(JSON.stringify(sp, null, 2));
        } else {
          console.log(chalk.green(`Space #${sp.name} updated.`));
        }
      } catch (e: any) {
        console.error(chalk.red(e.message));
        process.exit(1);
      }
      closeDb();
    });

  space
    .command("archive")
    .description("Archive a space")
    .argument("<name>", "Space name")
    .option("-j, --json", "Output as JSON")
    .action((name, opts) => {
      const spaceName = typeof name === "string" ? name.trim() : "";
      if (!spaceName) {
        console.error(chalk.red("Space name cannot be empty."));
        process.exit(1);
      }

      try {
        const sp = archiveSpace(spaceName);
        if (opts.json) {
          console.log(JSON.stringify(sp, null, 2));
        } else {
          console.log(chalk.green(`Space #${sp.name} archived.`));
        }
      } catch (e: any) {
        console.error(chalk.red(e.message));
        process.exit(1);
      }
      closeDb();
    });

  space
    .command("unarchive")
    .description("Unarchive a space")
    .argument("<name>", "Space name")
    .option("-j, --json", "Output as JSON")
    .action((name, opts) => {
      const spaceName = typeof name === "string" ? name.trim() : "";
      if (!spaceName) {
        console.error(chalk.red("Space name cannot be empty."));
        process.exit(1);
      }

      try {
        const sp = unarchiveSpace(spaceName);
        if (opts.json) {
          console.log(JSON.stringify(sp, null, 2));
        } else {
          console.log(chalk.green(`Space #${sp.name} unarchived.`));
        }
      } catch (e: any) {
        console.error(chalk.red(e.message));
        process.exit(1);
      }
      closeDb();
    });

  space
    .command("send")
    .description("Send a message to a space")
    .argument("<space>", "Space name")
    .argument("<message>", "Message content")
    .option("--from <agent>", "Sender agent ID")
    .option("--priority <level>", "Priority: low, normal, high, urgent", "normal")
    .option("-j, --json", "Output as JSON")
    .action((spaceName, message, opts) => {
      const from = resolveIdentity(opts.from).trim();
      const spaceArg = typeof spaceName === "string" ? spaceName.trim() : "";
      const content = typeof message === "string" ? message : "";

      if (!from) {
        console.error(chalk.red("Sender identity is required."));
        process.exit(1);
      }
      if (!spaceArg) {
        console.error(chalk.red("Space name cannot be empty."));
        process.exit(1);
      }
      if (!content.trim()) {
        console.error(chalk.red("Message content cannot be empty."));
        process.exit(1);
      }

      const sp = getSpace(spaceArg);
      if (!sp) {
        console.error(chalk.red(`Space #${spaceArg} not found.`));
        process.exit(1);
      }

      const msg = sendMessage({
        from,
        to: spaceArg,
        content,
        space: spaceArg,
        session_id: `space:${spaceArg}`,
        priority: opts.priority,
      });

      if (opts.json) {
        console.log(JSON.stringify(msg, null, 2));
      } else {
        console.log(chalk.green(`Message sent to #${spaceArg}`) + chalk.dim(` (id: ${msg.id})`));
      }
      closeDb();
    });

  space
    .command("read")
    .description("Read messages from a space")
    .argument("<space>", "Space name")
    .option("--since <timestamp>", "Messages after this ISO timestamp")
    .option("--limit <n>", "Max messages to return", parseInt)
    .option("-j, --json", "Output as JSON")
    .action((spaceName, opts) => {
      const spaceArg = typeof spaceName === "string" ? spaceName.trim() : "";
      if (!spaceArg) {
        console.error(chalk.red("Space name cannot be empty."));
        process.exit(1);
      }
      const messages = readMessages({
        space: spaceArg,
        since: opts.since,
        limit: opts.limit,
      });

      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else {
        if (messages.length === 0) {
          console.log(chalk.dim(`No messages in #${spaceArg}.`));
        } else {
          for (const msg of messages) {
            const time = chalk.dim(msg.created_at.slice(11, 19));
            const from = chalk.cyan(msg.from_agent);
            const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
            console.log(`${time} ${from} → ${chalk.magenta(`#${spaceArg}`)}${priority}`);
            const rendered = renderContent(msg.content);
            const indented = rendered.split("\n").map((l: string) => "  " + l).join("\n");
            console.log(indented);
          }
        }
      }
      closeDb();
    });

  space
    .command("join")
    .description("Join a space")
    .argument("<space>", "Space name")
    .option("--from <agent>", "Agent ID")
    .option("-j, --json", "Output as JSON")
    .action((spaceName, opts) => {
      const agent = resolveIdentity(opts.from).trim();
      const spaceArg = typeof spaceName === "string" ? spaceName.trim() : "";

      if (!agent) {
        console.error(chalk.red("Agent identity is required."));
        process.exit(1);
      }
      if (!spaceArg) {
        console.error(chalk.red("Space name cannot be empty."));
        process.exit(1);
      }

      const ok = joinSpace(spaceArg, agent);

      if (!ok) {
        console.error(chalk.red(`Space #${spaceArg} not found.`));
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify({ space: spaceArg, agent, joined: true }));
      } else {
        console.log(chalk.green(`${agent} joined #${spaceArg}`));
      }
      closeDb();
    });

  space
    .command("leave")
    .description("Leave a space")
    .argument("<space>", "Space name")
    .option("--from <agent>", "Agent ID")
    .option("-j, --json", "Output as JSON")
    .action((spaceName, opts) => {
      const agent = resolveIdentity(opts.from).trim();
      const spaceArg = typeof spaceName === "string" ? spaceName.trim() : "";

      if (!agent) {
        console.error(chalk.red("Agent identity is required."));
        process.exit(1);
      }
      if (!spaceArg) {
        console.error(chalk.red("Space name cannot be empty."));
        process.exit(1);
      }

      const ok = leaveSpace(spaceArg, agent);

      if (opts.json) {
        console.log(JSON.stringify({ space: spaceArg, agent, left: ok }));
      } else {
        if (ok) {
          console.log(chalk.green(`${agent} left #${spaceArg}`));
        } else {
          console.log(chalk.dim(`${agent} was not a member of #${spaceArg}`));
        }
      }
      closeDb();
    });

  space
    .command("members")
    .description("List space members")
    .argument("<space>", "Space name")
    .option("-j, --json", "Output as JSON")
    .action((spaceName, opts) => {
      const spaceArg = typeof spaceName === "string" ? spaceName.trim() : "";
      if (!spaceArg) {
        console.error(chalk.red("Space name cannot be empty."));
        process.exit(1);
      }
      const members = getSpaceMembers(spaceArg);

      if (opts.json) {
        console.log(JSON.stringify(members, null, 2));
      } else {
        if (members.length === 0) {
          console.log(chalk.dim(`No members in #${spaceArg}.`));
        } else {
          console.log(chalk.magenta(`#${spaceArg}`) + chalk.dim(` — ${members.length} member(s)`));
          for (const m of members) {
            console.log(`  ${chalk.cyan(m.agent)} ${chalk.dim(`joined ${m.joined_at.slice(0, 10)}`)}`);
          }
        }
      }
      closeDb();
    });
}
