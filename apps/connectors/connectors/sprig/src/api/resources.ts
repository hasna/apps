import type {
  AcceptedResponse,
  ListResponsesParams,
  ListSurveysParams,
  ListThemesParams,
  PaginatedResponse,
  PurgeVisitorsRequest,
  PurgeVisitorsResponse,
  Survey,
  SurveyResponse,
  Theme,
  UpsertUserRequest,
  UserV2,
} from '../types';
import { SprigClient } from './client';

export class UsersApi {
  constructor(private readonly client: SprigClient) {}

  get(userId: string): Promise<UserV2> {
    return this.client.get<UserV2>(`/v2/users/${encodeURIComponent(userId)}`, undefined, 'api-key');
  }

  upsert(request: UpsertUserRequest): Promise<AcceptedResponse> {
    return this.client.post<AcceptedResponse>(
      '/v2/users',
      request as unknown as Record<string, unknown>,
      undefined,
      'api-key',
      [202],
    );
  }
}

export class PurgeApi {
  constructor(private readonly client: SprigClient) {}

  visitors(request: PurgeVisitorsRequest): Promise<PurgeVisitorsResponse> {
    return this.client.post<PurgeVisitorsResponse>(
      '/v2/purge/visitors',
      request as unknown as Record<string, unknown>,
      undefined,
      'bearer',
    );
  }
}

export class SurveysApi {
  constructor(private readonly client: SprigClient) {}

  list(params: ListSurveysParams = {}): Promise<PaginatedResponse<Survey>> {
    const query = this.buildSurveyParams(params);
    return this.client.get<PaginatedResponse<Survey>>('/v1/surveys', query, 'bearer');
  }

  private buildSurveyParams(params: ListSurveysParams): Record<string, string | number | boolean | string[] | undefined> {
    const query: Record<string, string | number | boolean | string[] | undefined> = {
      start: params.start,
      end: params.end,
      cursor: params.cursor,
      limit: params.limit,
    };

    if (params.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status];
      query.status = statuses;
    }

    return query;
  }
}

export class ResponsesApi {
  constructor(private readonly client: SprigClient) {}

  list(params: ListResponsesParams = {}): Promise<PaginatedResponse<SurveyResponse>> {
    return this.client.get<PaginatedResponse<SurveyResponse>>(
      '/v1/responses',
      {
        start: params.start,
        end: params.end,
        cursor: params.cursor,
        limit: params.limit,
        sid: params.sid,
        with_snapshots: params.with_snapshots,
        with_urls: params.with_urls,
        with_meta: params.with_meta,
        with_custom_metadata: params.with_custom_metadata,
        with_deleted_responses: params.with_deleted_responses,
      },
      'bearer',
    );
  }
}

export class ThemesApi {
  constructor(private readonly client: SprigClient) {}

  list(params: ListThemesParams = {}): Promise<PaginatedResponse<Theme>> {
    return this.client.get<PaginatedResponse<Theme>>(
      '/v1/themes',
      {
        start: params.start,
        end: params.end,
        cursor: params.cursor,
        limit: params.limit,
        sid: params.sid,
      },
      'bearer',
    );
  }
}
