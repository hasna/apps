// OpenAPI 3.1 document for the Personal Notes HTTP API (the PRIMARY surface).
//
// This document is the single source of truth for the /v1 control plane. The
// generated SDK (src/sdk/index.ts) is produced from it via scripts/generate-sdk.mjs,
// and the server router (src/server/router.mjs) implements exactly these operations.
// Keeping all three in lockstep is enforced by test/surfaces-sdk-sync.test.mjs.

const noteSchema = {
  type: 'object',
  description: 'A single note. Markdown on disk is the contract; unknown/legacy keys are tolerated.',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    body: { type: 'string' },
    labels: { type: 'array', items: { type: 'string' } },
    status: { type: 'string' },
    folder: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: true,
};

const noteListSchema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { $ref: '#/components/schemas/Note' } },
    limit: { type: 'number' },
    offset: { type: 'number' },
    total: { type: 'number' },
    hasMore: { type: 'boolean' },
    nextOffset: { type: 'number' },
  },
  required: ['items'],
  additionalProperties: true,
};

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' }, message: { type: 'string' } },
  required: ['error'],
  additionalProperties: true,
};

const okResponse = (ref) => ({
  '200': {
    description: 'OK',
    content: { 'application/json': { schema: ref } },
  },
});

/** Build the OpenAPI document. Version flows in from package.json at serve time. */
export function buildOpenApiDocument({ version = '0.0.0' } = {}) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'PersonalNotes',
      version,
      description:
        'Personal Notes OSS core — the primary HTTP surface. Notes CRUD, lifecycle, labels and settings over a versioned /v1 control plane.',
    },
    paths: {
      '/v1/notes': {
        get: {
          operationId: 'listNotes',
          summary: 'List notes with pagination and filters.',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'number' } },
            { name: 'offset', in: 'query', schema: { type: 'number' } },
            { name: 'label', in: 'query', schema: { type: 'string' } },
            { name: 'machine', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'includeTrash', in: 'query', schema: { type: 'boolean' } },
            { name: 'includeArchived', in: 'query', schema: { type: 'boolean' } },
            { name: 'query', in: 'query', schema: { type: 'string' } },
          ],
          responses: okResponse({ $ref: '#/components/schemas/NoteList' }),
        },
        post: {
          operationId: 'saveNote',
          summary: 'Create or update (upsert) a note.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Note' } } },
          },
          responses: okResponse({ $ref: '#/components/schemas/Note' }),
        },
      },
      '/v1/notes/all': {
        get: {
          operationId: 'loadNotes',
          summary: 'Load every note (unpaged).',
          responses: okResponse({ type: 'array', items: { $ref: '#/components/schemas/Note' } }),
        },
      },
      '/v1/notes/{id}': {
        get: {
          operationId: 'getNote',
          summary: 'Read one note by id.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: okResponse({ $ref: '#/components/schemas/Note' }),
        },
        delete: {
          operationId: 'deleteNote',
          summary: 'Permanently delete a note.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: okResponse({ $ref: '#/components/schemas/Ok' }),
        },
      },
      '/v1/notes/{id}/archive': {
        post: {
          operationId: 'archiveNote',
          summary: 'Archive a note.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: okResponse({ $ref: '#/components/schemas/Note' }),
        },
      },
      '/v1/notes/{id}/trash': {
        post: {
          operationId: 'trashNote',
          summary: 'Move a note to Trash.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { retentionDays: { type: 'number' } },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: okResponse({ $ref: '#/components/schemas/Note' }),
        },
      },
      '/v1/notes/{id}/restore': {
        post: {
          operationId: 'restoreNote',
          summary: 'Restore a note from Trash/Archive.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: okResponse({ $ref: '#/components/schemas/Note' }),
        },
      },
      '/v1/trash/purge': {
        post: {
          operationId: 'purgeExpiredTrash',
          summary: 'Purge expired Trash notes.',
          responses: okResponse({ $ref: '#/components/schemas/PurgeResult' }),
        },
      },
      '/v1/labels': {
        get: {
          operationId: 'loadLabelList',
          summary: 'List persisted labels.',
          responses: okResponse({ type: 'array', items: { type: 'string' } }),
        },
        put: {
          operationId: 'saveLabelList',
          summary: 'Replace the persisted label list.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { labels: { type: 'array', items: { type: 'string' } } },
                  required: ['labels'],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: okResponse({ type: 'array', items: { type: 'string' } }),
        },
      },
      '/v1/labels/rename': {
        post: {
          operationId: 'renameLabel',
          summary: 'Rename a label everywhere it appears.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { from: { type: 'string' }, to: { type: 'string' } },
                  required: ['from', 'to'],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: okResponse({ $ref: '#/components/schemas/Ok' }),
        },
      },
      '/v1/labels/{name}': {
        delete: {
          operationId: 'deleteLabel',
          summary: 'Delete a label everywhere it appears.',
          parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
          responses: okResponse({ $ref: '#/components/schemas/Ok' }),
        },
      },
      '/v1/notes/{id}/labels': {
        post: {
          operationId: 'assignLabel',
          summary: 'Assign a label to a note.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { label: { type: 'string' } },
                  required: ['label'],
                  additionalProperties: false,
                },
              },
            },
          },
          responses: okResponse({ $ref: '#/components/schemas/Note' }),
        },
      },
      '/v1/notes/{id}/labels/{label}': {
        delete: {
          operationId: 'unassignLabel',
          summary: 'Remove a label from a note.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'label', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: okResponse({ $ref: '#/components/schemas/Note' }),
        },
      },
      '/v1/settings': {
        get: {
          operationId: 'loadSettings',
          summary: 'Read persisted settings.',
          responses: okResponse({ $ref: '#/components/schemas/Settings' }),
        },
        put: {
          operationId: 'saveSettings',
          summary: 'Replace persisted settings.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Settings' } } },
          },
          responses: okResponse({ $ref: '#/components/schemas/Settings' }),
        },
      },
    },
    components: {
      schemas: {
        Note: noteSchema,
        NoteList: noteListSchema,
        Settings: {
          type: 'object',
          properties: { trashRetentionDays: { type: 'number' } },
          additionalProperties: true,
        },
        PurgeResult: {
          type: 'object',
          properties: {
            purged: { type: 'array', items: { type: 'string' } },
            count: { type: 'number' },
          },
          required: ['purged', 'count'],
          additionalProperties: true,
        },
        Ok: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: true,
        },
        Error: errorSchema,
      },
    },
  };
}

export default buildOpenApiDocument;
