import type { TensorBoardClient } from './client';
import type { ScalarTag, ScalarPoint } from '../types';

/**
 * List scalar tags across runs. TensorBoard historically returns either an object
 * of `{ displayName, description }` per tag or a bare list of tag names, so both
 * shapes are normalized here. Pass `run` to restrict the result to a single run.
 */
export async function listScalarTags(client: TensorBoardClient, run?: string): Promise<ScalarTag[]> {
  const raw = await client.scalarTags();
  const tags: ScalarTag[] = [];

  for (const [runName, tagMap] of Object.entries(raw ?? {})) {
    if (run && runName !== run) continue;

    if (Array.isArray(tagMap)) {
      for (const tag of tagMap) {
        tags.push({ run: runName, tag });
      }
      continue;
    }

    for (const [tag, meta] of Object.entries(tagMap ?? {})) {
      tags.push({
        run: runName,
        tag,
        displayName: meta?.displayName,
        description: meta?.description,
      });
    }
  }

  return tags;
}

/** Fetch a scalar time series for a run/tag pair, normalized to typed points. */
export async function getScalars(client: TensorBoardClient, run: string, tag: string): Promise<ScalarPoint[]> {
  const raw = await client.scalars(run, tag);
  return raw.map(([wallTime, step, value]) => ({ wallTime, step, value }));
}
