import chalk from "chalk";
import type { ContactWithDetails } from "../types/index.js";

interface TableRow {
  [key: string]: string | undefined;
}

export function renderTable(headers: string[], rows: TableRow[]): void {
  const colWidths: number[] = headers.map((h) => h.length);

  for (const row of rows) {
    headers.forEach((h, i) => {
      const val = String(row[h] ?? "");
      if (val.length > (colWidths[i] ?? 0)) colWidths[i] = val.length;
    });
  }

  const cappedWidths = colWidths.map((w) => Math.min(w, 40));

  const topBorder = "┌" + cappedWidths.map((w) => "─".repeat(w + 2)).join("┬") + "┐";
  const midBorder = "┼" + cappedWidths.map((w) => "─".repeat(w + 2)).join("┼") + "┼";
  const bottomBorder = "└" + cappedWidths.map((w) => "─".repeat(w + 2)).join("┴") + "┘";

  console.log(chalk.gray(topBorder));
  console.log(
    "│" + headers.map((h, i) => " " + chalk.bold.cyan(h.padEnd(cappedWidths[i] ?? 0)) + " │").join("")
  );
  console.log(chalk.gray(midBorder));

  for (const row of rows) {
    console.log(
      "│" +
        headers
          .map((h, i) => {
            let val = String(row[h] ?? "");
            const width = cappedWidths[i] ?? 0;
            if (val.length > width) val = val.slice(0, width - 1) + "…";
            return " " + val.padEnd(width) + " │";
          })
          .join("")
    );
  }

  console.log(chalk.gray(bottomBorder));
}

export function formatContact(c: ContactWithDetails): void {
  console.log("\n" + chalk.bold.blue("━━━ Contact: ") + chalk.bold(c.display_name) + chalk.bold.blue(" ━━━"));
  console.log();

  const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
  if (name) console.log(chalk.gray("  Name:     ") + name);
  if (c.nickname) console.log(chalk.gray("  Nickname: ") + c.nickname);
  if (c.job_title) console.log(chalk.gray("  Title:    ") + c.job_title);
  if (c.company) console.log(chalk.gray("  Company:  ") + chalk.cyan(c.company.name));
  if (c.birthday) console.log(chalk.gray("  Birthday: ") + c.birthday);

  if (c.emails?.length) {
    console.log();
    console.log(chalk.yellow("  Emails:"));
    for (const e of c.emails) {
      const star = e.is_primary ? chalk.green(" ★") : "";
      console.log(`    ${chalk.gray(e.type.padEnd(10))} ${e.address}${star}`);
    }
  }

  if (c.phones?.length) {
    console.log();
    console.log(chalk.yellow("  Phones:"));
    for (const p of c.phones) {
      const star = p.is_primary ? chalk.green(" ★") : "";
      console.log(`    ${chalk.gray(p.type.padEnd(10))} ${p.number}${star}`);
    }
  }

  if (c.addresses?.length) {
    console.log();
    console.log(chalk.yellow("  Addresses:"));
    for (const a of c.addresses) {
      const parts = [a.street, a.city, a.state, a.country].filter(Boolean);
      console.log(`    ${chalk.gray(a.type.padEnd(10))} ${parts.join(", ")}`);
    }
  }

  if (c.social_profiles?.length) {
    console.log();
    console.log(chalk.yellow("  Social:"));
    for (const s of c.social_profiles) {
      console.log(`    ${chalk.gray(s.platform.padEnd(12))} ${s.handle ?? s.url ?? ""}`);
    }
  }

  if (c.tags?.length) {
    console.log();
    console.log(chalk.yellow("  Tags:     ") + c.tags.map((t) => chalk.magenta(`#${t.name}`)).join("  "));
  }

  if (c.notes) {
    console.log();
    console.log(chalk.yellow("  Notes:"));
    for (const line of c.notes.split("\n")) {
      console.log("    " + chalk.gray(line));
    }
  }

  console.log();
  console.log(chalk.gray(`  ID: ${c.id}  •  Created: ${c.created_at.slice(0, 10)}`));
  console.log();
}

export async function promptUser(question: string): Promise<string> {
  process.stdout.write(chalk.cyan("? ") + question + " ");
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", (data: Buffer) => {
      process.stdin.pause();
      resolve(data.toString().trim());
    });
  });
}

export async function confirmUser(question: string): Promise<boolean> {
  const answer = await promptUser(question + " [y/N]");
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}
