import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { knowledgeOpenApi } from '../src/serve.ts';

interface OpenApiOperation {
  description?: string;
  security?: unknown[];
  responses?: Record<string, { $ref?: string }>;
  [key: string]: unknown;
}

const DATA_OPERATIONS = [
  ['/v1/notes', 'get'],
  ['/v1/notes', 'post'],
  ['/v1/notes/{id}', 'get'],
  ['/v1/notes/{id}', 'patch'],
  ['/v1/notes/{id}', 'delete'],
  ['/v1/registry', 'get'],
] as const;

describe('Stage-A OpenAPI and generated client contract', () => {
  test('every data operation documents typed pre-auth 403 and 503 containment', () => {
    const document = knowledgeOpenApi('9.9.9') as {
      components: {
        schemas: Record<string, { properties?: Record<string, unknown> }>;
        responses: Record<string, unknown>;
      };
      paths: Record<string, Record<string, OpenApiOperation>>;
    };

    expect(document.components.schemas.KnowledgeContainmentResponse).toBeDefined();
    expect(document.components.responses).toHaveProperty('KnowledgeProjectForbidden');
    expect(document.components.responses).toHaveProperty('KnowledgeUnavailable');

    for (const [path, method] of DATA_OPERATIONS) {
      const operation = document.paths[path]?.[method];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation.security).toEqual([]);
      expect(operation.description).toContain('before authentication');
      expect(operation['x-knowledge-stage-a-containment']).toBe('pre-auth');
      expect(operation['x-knowledge-operation-enabled']).toBe(false);
      expect(operation.deprecated).toBe(true);
      expect(operation.responses?.['403']).toEqual({
        $ref: '#/components/responses/KnowledgeProjectForbidden',
      });
      expect(operation.responses?.['503']).toEqual({
        $ref: '#/components/responses/KnowledgeUnavailable',
      });
      expect(Object.keys(operation.responses ?? {}).some((status) => status.startsWith('2'))).toBe(false);
    }
    expect(document.components.schemas.Note).toMatchObject({
      type: 'object',
      required: ['id', 'title', 'content', 'tags', 'archived', 'created_at', 'updated_at'],
      properties: {
        id: { type: 'string' },
        short_id: { type: 'string', nullable: true },
        title: { type: 'string' },
        content: { type: 'string' },
        url: { type: 'string', nullable: true },
        tags: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object', additionalProperties: true },
        archived: { type: 'boolean' },
        created_at: { type: 'string' },
        updated_at: { type: 'string' },
      },
    });
    expect(document.components.schemas.NoteInput).toMatchObject({
      type: 'object',
      required: ['title'],
      properties: { title: { type: 'string' }, metadata: { type: 'object', additionalProperties: true } },
    });
    expect(document.components.schemas.NotePatch).toMatchObject({
      type: 'object',
      properties: { archived: { type: 'boolean' }, metadata: { type: 'object', additionalProperties: true } },
    });
    expect(document.components.schemas.NoteList).toMatchObject({
      type: 'object',
      required: ['items', 'total'],
      properties: {
        items: { type: 'array', items: { $ref: '#/components/schemas/Note' } },
        total: { type: 'integer' },
      },
    });
  });

  test('generated client exports the typed containment body on ApiError', () => {
    const generated = readFileSync(
      join(import.meta.dir, '..', 'src', 'generated', 'knowledge-api-client.ts'),
      'utf8',
    );
    expect(generated).toContain('export interface Note {');
    expect(generated).toContain('export class ApiError extends Error');
    expect(generated).toContain('readonly body: unknown');
    expect(generated).not.toContain('globalThis.fetch');
    expect(generated).not.toContain('this.fetchImpl =');
  });
});
