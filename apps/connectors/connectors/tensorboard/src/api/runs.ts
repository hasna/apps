import type { TensorBoardClient } from './client';
import type { RunInfo } from '../types';

/** List all runs known to the TensorBoard server, sorted by name. */
export async function listRuns(client: TensorBoardClient): Promise<RunInfo[]> {
  const runs = await client.listRuns();
  return runs
    .map((name) => ({ name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
