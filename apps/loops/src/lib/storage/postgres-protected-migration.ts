import type { StorageMigration } from "./contract.js";
import { POSTGRES_STORAGE_MIGRATIONS } from "./postgres-schema.js";

/**
 * Internal capability scope for the protected forward-only PostgreSQL
 * migration route. This module is intentionally absent from every package
 * export, and no discoverable method or token is attached to the public
 * storage instance.
 */
const authorityDepth = new WeakMap<object, number>();

const protectedMigrationSignatures = Object.freeze(
  POSTGRES_STORAGE_MIGRATIONS
    .filter((migration) => migration.rollingDeploy?.kind === "canonical_identity_aliases")
    .map((migration) => Object.freeze({
      id: migration.id,
      checksum: migration.checksum,
    })),
);

export function isProtectedPostgresMigration(
  migration: Pick<StorageMigration, "id" | "checksum">,
): boolean {
  return protectedMigrationSignatures.some(
    (signature) =>
      signature.id === migration.id
      && signature.checksum === migration.checksum,
  );
}

export async function withProtectedPostgresMigrationAuthority<T>(
  storage: object,
  operation: () => Promise<T>,
): Promise<T> {
  authorityDepth.set(storage, (authorityDepth.get(storage) ?? 0) + 1);
  try {
    return await operation();
  } finally {
    const remaining = (authorityDepth.get(storage) ?? 1) - 1;
    if (remaining === 0) authorityDepth.delete(storage);
    else authorityDepth.set(storage, remaining);
  }
}

export function hasProtectedPostgresMigrationAuthority(storage: object): boolean {
  return (authorityDepth.get(storage) ?? 0) > 0;
}
