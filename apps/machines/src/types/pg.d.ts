// Minimal ambient declaration for the `pg` package.
// `pg` ships no bundled types and we deliberately avoid adding @types/pg
// (extra dependency); the package is used dynamically via the storage layer
// and bundled with `--external pg`, so a permissive shim is sufficient to keep
// `tsc` declaration emission green.
declare module "pg" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Pool = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type PoolClient = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type PoolConfig = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type QueryResult = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type QueryResultRow = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pg: any;
  export default pg;
}
