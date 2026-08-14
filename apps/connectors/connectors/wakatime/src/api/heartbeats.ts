import type { WakatimeClient } from './client';
import type {
  CreateHeartbeatOptions,
  DeleteHeartbeatsOptions,
  HeartbeatsListOptions,
} from '../types';

export class HeartbeatsApi {
  constructor(private readonly client: WakatimeClient) {}

  async list(options: HeartbeatsListOptions): Promise<unknown> {
    return this.client.get(`${this.client.userPath(options.user)}/heartbeats`, {
      date: options.date,
      timezone: options.timezone,
    });
  }

  async create(options: CreateHeartbeatOptions): Promise<unknown> {
    const body: Record<string, unknown> = {
      entity: options.entity,
      type: options.type,
      time: options.time,
    };
    if (options.project) body.project = options.project;
    if (options.language) body.language = options.language;
    if (options.isWrite !== undefined) body.is_write = options.isWrite;
    if (options.lines !== undefined) body.lines = options.lines;

    return this.client.post(`${this.client.userPath(options.user)}/heartbeats`, body);
  }

  async deleteBulk(options: DeleteHeartbeatsOptions): Promise<unknown> {
    await this.client.delete(`${this.client.userPath(options.user)}/heartbeats.bulk`, {
      ids: options.ids,
    });
    return { success: true, deleted: options.ids.length };
  }
}
