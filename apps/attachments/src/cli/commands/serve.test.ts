import { test, expect } from "bun:test";
import { Command } from "commander";
import { registerServe } from "./serve";
test("legacy SQLite serve is rejected with PostgreSQL service guidance", async () => {
 const program = new Command(); registerServe(program);
 await expect(program.parseAsync(["node", "test", "serve"])).rejects.toThrow("attachments-serve");
});
test("local bind overrides cannot resurrect the retired server", async () => {
 const program = new Command().exitOverride(); registerServe(program);
 await expect(program.parseAsync(["node", "test", "serve", "--port", "9000"])).rejects.toThrow();
});
