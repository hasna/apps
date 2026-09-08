import type { RegistryStorage } from "./shared";

/** Transactional storage fake: serializes transactions and rolls back failed writes. */
export class MemoryStorage implements RegistryStorage {
  private rows = new Map<string, unknown>();
  private pending = Promise.resolve();
  async get<T>(key: string): Promise<T | undefined> { return structuredClone(this.rows.get(key)) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.rows.set(key, structuredClone(value)); }
  async list<T>({ prefix }: { prefix: string }): Promise<Map<string, T>> {
    return new Map([...this.rows].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value) as T]));
  }
  async transaction<T>(callback: (storage: RegistryStorage) => Promise<T>): Promise<T> {
    const previous = this.pending;
    let unlock!: () => void;
    this.pending = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    const snapshot = structuredClone(this.rows);
    try { return await callback(this); }
    catch (error) { this.rows = snapshot; throw error; }
    finally { unlock(); }
  }
}
