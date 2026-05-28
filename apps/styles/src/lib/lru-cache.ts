export class LruCache<K, V> {
  private readonly max: number;
  private readonly map: Map<K, V>;

  constructor(max: number) {
    this.max = max;
    this.map = new Map();
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key)!;
    // Move to end (most-recently-used)
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key: K, val: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) {
      // Evict LRU (first entry)
      this.map.delete(this.map.keys().next().value as K);
    }
    this.map.set(key, val);
  }
}
