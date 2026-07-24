import type { StitchClient } from './client';
import type {
  StitchDestination,
  CreateDestinationRequest,
  UpdateDestinationRequest,
} from '../types';

/**
 * Stitch Destinations API.
 * @see https://www.stitchdata.com/docs/developers/stitch-connect/api#destinations
 */
export class DestinationsApi {
  constructor(private readonly client: StitchClient) {}

  /** List all destinations for the account. */
  list(): Promise<StitchDestination[]> {
    return this.client.get<StitchDestination[]>('/v4/destinations');
  }

  /** Create a new destination. */
  create(data: CreateDestinationRequest): Promise<StitchDestination> {
    return this.client.post<StitchDestination>('/v4/destinations', data);
  }

  /** Update an existing destination. */
  update(destinationId: number, data: UpdateDestinationRequest): Promise<StitchDestination> {
    return this.client.put<StitchDestination>(`/v4/destinations/${destinationId}`, data);
  }

  /** Delete a destination. */
  delete(destinationId: number): Promise<Record<string, unknown>> {
    return this.client.delete<Record<string, unknown>>(`/v4/destinations/${destinationId}`);
  }
}
