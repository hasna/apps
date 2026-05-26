import type { LinearClient } from './client';
import type {
  LinearComment,
  CreateCommentInput,
  UpdateCommentInput,
  CommentsResponse,
  CommentResponse,
  CreateCommentResponse,
  UpdateCommentResponse,
} from '../types';

const COMMENT_FRAGMENT = `
  fragment CommentFragment on Comment {
    id
    body
    createdAt
    updatedAt
    editedAt
    url
    user {
      id
      name
      displayName
      email
    }
    issue {
      id
      identifier
      title
    }
    parent {
      id
    }
    children {
      nodes {
        id
        body
        createdAt
        user {
          id
          name
          displayName
        }
      }
    }
  }
`;

export class CommentsApi {
  constructor(private readonly client: LinearClient) {}

  /**
   * List comments for an issue
   */
  async listForIssue(
    issueId: string,
    options: { first?: number; after?: string } = {}
  ): Promise<LinearComment[]> {
    const { first = 50, after } = options;
    const data = await this.client.query<CommentsResponse>(`
      query IssueComments($issueId: String!, $first: Int, $after: String) {
        issue(id: $issueId) {
          comments(first: $first, after: $after) {
            nodes {
              ...CommentFragment
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
      ${COMMENT_FRAGMENT}
    `, { issueId, first, after });

    return data.issue?.comments?.nodes ?? [];
  }

  /**
   * Get a single comment by ID
   */
  async get(id: string): Promise<LinearComment> {
    const data = await this.client.query<CommentResponse>(`
      query GetComment($id: String!) {
        comment(id: $id) {
          ...CommentFragment
        }
      }
      ${COMMENT_FRAGMENT}
    `, { id });

    return data.comment;
  }

  /**
   * Create a comment on an issue
   */
  async create(input: CreateCommentInput): Promise<LinearComment> {
    const data = await this.client.mutate<CreateCommentResponse>(`
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment {
            ...CommentFragment
          }
        }
      }
      ${COMMENT_FRAGMENT}
    `, { input });

    return data.commentCreate.comment;
  }

  /**
   * Update a comment
   */
  async update(id: string, input: UpdateCommentInput): Promise<LinearComment> {
    const data = await this.client.mutate<UpdateCommentResponse>(`
      mutation UpdateComment($id: String!, $input: CommentUpdateInput!) {
        commentUpdate(id: $id, input: $input) {
          success
          comment {
            ...CommentFragment
          }
        }
      }
      ${COMMENT_FRAGMENT}
    `, { id, input });

    return data.commentUpdate.comment;
  }

  /**
   * Delete a comment
   */
  async delete(id: string): Promise<boolean> {
    const data = await this.client.mutate<{ commentDelete: { success: boolean } }>(`
      mutation DeleteComment($id: String!) {
        commentDelete(id: $id) {
          success
        }
      }
    `, { id });

    return data.commentDelete.success;
  }
}
