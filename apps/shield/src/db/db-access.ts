import * as database from "./database.js";

/** Wrap, never re-export: bun 1.3.14 mock.module on a re-exporting module also replaces the re-exported module's bindings. */
export function getDb() { return database.getDb(); }
export function getTestDb() { return database.getTestDb(); }
export function closeDb() { database.closeDb(); }
export function onDbInit(cb: (db: ReturnType<typeof database.getDb>) => void) { database.onDbInit(cb); }
