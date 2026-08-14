/**
 * Fixture process: holds a SQLite write lock so another process can be observed
 * contending for it.
 *
 * Must be a SEPARATE process. SQLite locks are held per connection, and the point
 * is to reproduce the ordinary situation the pragma-order bug appeared in — one
 * process opening the database while another already has it open.
 *
 * Usage: bun run src/test/sqlite-lock-holder.ts <db-path> <hold-ms>
 *
 * Prints exactly one `HOLDING journal_mode=<mode>` line once the lock is taken,
 * which is the caller's signal that contention is now guaranteed, then releases
 * after <hold-ms> and prints `RELEASED`.
 */
import { Database } from "bun:sqlite";

const path = process.argv[2];
const holdMs = Number(process.argv[3] ?? 3000);

if (!path) {
  console.error("usage: sqlite-lock-holder.ts <db-path> <hold-ms>");
  process.exit(2);
}

const db = new Database(path);

// This holder must never wait on anyone else — it is the one doing the blocking.
db.run("PRAGMA busy_timeout = 0");

// Establish DELETE journal mode explicitly. This is load-bearing: the bug under
// test is in the delete -> WAL transition, because switching journal_mode takes a
// lock. On a database that is already WAL, the pragma order is a no-op.
db.run("PRAGMA journal_mode = delete");
db.run("CREATE TABLE IF NOT EXISTS lock_holder_marker(x)");

db.run("BEGIN EXCLUSIVE");
db.run("INSERT INTO lock_holder_marker VALUES (1)");

const mode = (db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode;
console.log(`HOLDING journal_mode=${mode}`);

await new Promise((resolve) => setTimeout(resolve, holdMs));

db.run("COMMIT");
console.log("RELEASED");
