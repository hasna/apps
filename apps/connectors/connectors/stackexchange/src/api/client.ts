import type {
  Answer,
  ApiErrorBody,
  PageOptions,
  Question,
  SearchOptions,
  StackExchangeConfig,
  Tag,
  User,
  Wrapper,
} from '../types';
import { StackExchangeApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.stackexchange.com/2.3';
const DEFAULT_SITE = 'stackoverflow';

/**
 * Thin, dependency-free client over the public Stack Exchange API v2.3.
 *
 * Read endpoints work without authentication; supplying an application `key`
 * simply raises the daily request quota. The API always wraps results in a
 * common envelope ({ items, has_more, quota_remaining, ... }) and reports
 * errors with an { error_id, error_name, error_message } body.
 */
export class StackExchangeClient {
  private readonly baseUrl: string;
  private readonly site: string;
  private readonly key?: string;
  private readonly accessToken?: string;

  constructor(config: StackExchangeConfig = {}) {
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.site = config.site || DEFAULT_SITE;
    this.key = config.key;
    this.accessToken = config.accessToken;
  }

  /** Build a fully-qualified request URL with shared params applied. */
  private buildUrl(path: string, params: Record<string, string | number | boolean | undefined>, site?: string): string {
    const search = new URLSearchParams();
    // `filter=withbody` includes the rendered question/answer body by default;
    // callers can override via params.
    search.set('site', site || params.site as string || this.site);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '' || k === 'site') continue;
      search.set(k, String(v));
    }
    if (this.key) search.set('key', this.key);
    if (this.accessToken) search.set('access_token', this.accessToken);
    return `${this.baseUrl}/${path.replace(/^\//, '')}?${search.toString()}`;
  }

  /** Perform a GET request and unwrap the standard Stack Exchange envelope. */
  private async request<T>(path: string, params: Record<string, string | number | boolean | undefined>, site?: string): Promise<Wrapper<T>> {
    const url = this.buildUrl(path, params, site);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new StackExchangeApiError(`Stack Exchange API returned a non-JSON response (HTTP ${response.status})`, response.status);
    }

    if (!response.ok) {
      const err = body as Partial<ApiErrorBody>;
      throw new StackExchangeApiError(
        err.error_message || `Stack Exchange API error: ${response.statusText}`,
        response.status,
        err.error_id,
        err.error_name,
      );
    }

    const wrapper = body as Wrapper<T> & Partial<ApiErrorBody>;
    if (wrapper.error_id) {
      throw new StackExchangeApiError(wrapper.error_message || 'Stack Exchange API error', response.status, wrapper.error_id, wrapper.error_name);
    }
    return wrapper;
  }

  private pageParams(opts: PageOptions = {}): Record<string, string | number | boolean | undefined> {
    return {
      page: opts.page,
      pagesize: opts.pageSize,
      order: opts.order,
      sort: opts.sort,
    };
  }

  /** List questions on a site (newest/activity/votes/hot, etc.). */
  async listQuestions(opts: PageOptions = {}): Promise<Wrapper<Question>> {
    return this.request<Question>('questions', {
      ...this.pageParams(opts),
      sort: opts.sort || 'activity',
      order: opts.order || 'desc',
      filter: 'withbody',
    }, opts.site);
  }

  /** Fetch one or more questions by id. */
  async getQuestions(ids: Array<number | string>, opts: PageOptions = {}): Promise<Wrapper<Question>> {
    const idList = ids.map((id) => encodeURIComponent(String(id))).join(';');
    return this.request<Question>(`questions/${idList}`, {
      ...this.pageParams(opts),
      filter: 'withbody',
    }, opts.site);
  }

  /** Full-text question search via /search/advanced. */
  async searchQuestions(opts: SearchOptions = {}): Promise<Wrapper<Question>> {
    return this.request<Question>('search/advanced', {
      ...this.pageParams(opts),
      q: opts.query,
      title: opts.inTitle,
      tagged: opts.tagged && opts.tagged.length ? opts.tagged.join(';') : undefined,
      accepted: opts.accepted,
      answers: opts.noAnswers ? 0 : undefined,
      sort: opts.sort || 'relevance',
      order: opts.order || 'desc',
      filter: 'withbody',
    }, opts.site);
  }

  /** List answers on a site. */
  async listAnswers(opts: PageOptions = {}): Promise<Wrapper<Answer>> {
    return this.request<Answer>('answers', {
      ...this.pageParams(opts),
      sort: opts.sort || 'activity',
      order: opts.order || 'desc',
      filter: 'withbody',
    }, opts.site);
  }

  /** List answers for a given question id. */
  async getQuestionAnswers(questionId: number | string, opts: PageOptions = {}): Promise<Wrapper<Answer>> {
    return this.request<Answer>(`questions/${encodeURIComponent(String(questionId))}/answers`, {
      ...this.pageParams(opts),
      sort: opts.sort || 'votes',
      order: opts.order || 'desc',
      filter: 'withbody',
    }, opts.site);
  }

  /** List users on a site (optionally filtered by inname). */
  async listUsers(opts: PageOptions & { inName?: string } = {}): Promise<Wrapper<User>> {
    return this.request<User>('users', {
      ...this.pageParams(opts),
      inname: opts.inName,
      sort: opts.sort || 'reputation',
      order: opts.order || 'desc',
    }, opts.site);
  }

  /** Fetch one or more users by id. */
  async getUsers(ids: Array<number | string>, opts: PageOptions = {}): Promise<Wrapper<User>> {
    const idList = ids.map((id) => encodeURIComponent(String(id))).join(';');
    return this.request<User>(`users/${idList}`, this.pageParams(opts), opts.site);
  }

  /** List tags on a site. */
  async listTags(opts: PageOptions & { inName?: string } = {}): Promise<Wrapper<Tag>> {
    return this.request<Tag>('tags', {
      ...this.pageParams(opts),
      inname: opts.inName,
      sort: opts.sort || 'popular',
      order: opts.order || 'desc',
    }, opts.site);
  }
}
