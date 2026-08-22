import { type Migration } from "../generated/storage-kit/migrations.js";
/**
 * Ordered migrations for the machines cloud database.
 *
 * IMPORTANT: once a migration has been applied, its SQL is frozen — the ledger
 * rejects any checksum change. Add new migrations rather than editing applied
 * ones.
 */
export declare const MACHINES_MIGRATIONS: readonly Migration[];
