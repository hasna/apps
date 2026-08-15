import { Database } from "bun:sqlite";
import { indexRoot } from "../indexer.js";

const [dbPath, rootId] = process.argv.slice(2);
if (!dbPath || !rootId) {
  throw new Error("usage: crash-after-indexing-status <db-path> <root-id>");
}

const db = new Database(dbPath);
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

const crashAfterStatusWrite = new Proxy(db, {
  get(target, property) {
    if (property === "prepare") {
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.includes("UPDATE index_roots SET status = 'indexing'")) return statement;

        return new Proxy(statement, {
          get(statementTarget, statementProperty) {
            if (statementProperty === "run") {
              return (...bindings: unknown[]) => {
                const result = Reflect.apply(statementTarget.run, statementTarget, bindings);
                process.kill(process.pid, "SIGKILL");
                return result;
              };
            }

            const value = Reflect.get(statementTarget, statementProperty, statementTarget);
            return typeof value === "function" ? value.bind(statementTarget) : value;
          },
        });
      };
    }

    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as Database;

indexRoot(rootId, {}, crashAfterStatusWrite);
