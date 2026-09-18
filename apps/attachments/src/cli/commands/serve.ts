import { Command } from "commander";

export function registerServe(program: Command): void {
  program.command("serve")
    .description("Use attachments-serve for the PostgreSQL-backed service")
    .action(() => { throw new Error("The local SQLite server is retired. Run attachments-serve with a server-side PostgreSQL DSN and signing key."); });
}
