/**
 * Internal capability scope for the protected forward-only PostgreSQL
 * migration route. This module is intentionally absent from every package
 * export, and no discoverable method or token is attached to the public
 * storage instance.
 */
const authorityDepth = new WeakMap<object, number>();

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
