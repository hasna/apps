import type { ConnectorClient } from './client';
import type { Activity, AddCommentParams, Comment, ListActivitiesParams, WorkableListResponse } from '../types';

export class CommentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(candidateId: string): Promise<WorkableListResponse<Comment>> {
    return this.client.get<WorkableListResponse<Comment>>(
      `/candidates/${encodeURIComponent(candidateId)}/comments`,
    );
  }

  async add(params: AddCommentParams): Promise<Comment> {
    return this.client.post<Comment>(
      `/candidates/${encodeURIComponent(params.candidateId)}/comments`,
      {
        comment: {
          body: params.body,
          member_id: params.memberId,
        },
      },
    );
  }

  async listActivities(params: ListActivitiesParams): Promise<WorkableListResponse<Activity>> {
    return this.client.get<WorkableListResponse<Activity>>(
      `/candidates/${encodeURIComponent(params.candidateId)}/activities`,
      {
        limit: params.limit,
        since_id: params.sinceId,
      },
    );
  }
}
