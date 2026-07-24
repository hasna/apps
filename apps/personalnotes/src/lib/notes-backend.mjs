// Notes backend facade — the seam that lets the CLI and MCP surfaces talk to the
// HTTP API instead of the local filesystem.
//
// It exports the SAME function names/signatures as tools/notes-lib.mjs for the subset
// of storage operations the client surfaces use, so those surfaces swap their import
// source and nothing else. In local mode (default) every call delegates straight to the
// in-process domain layer — behaviour is byte-for-byte identical. When a server is
// configured (HASNA_NOTES_API_URL, i.e. self_hosted/cloud) the same calls route over
// HTTP through the generated SDK. Clients never hold a database DSN.

import * as local from '../../tools/notes-lib.mjs';
import { resolveMode } from './mode.mjs';
import { PersonalNotesClient, ApiError } from '../sdk/index.ts';

function cleanQuery(opts = {}) {
  const out = {};
  for (const key of [
    'limit',
    'offset',
    'label',
    'machine',
    'status',
    'includeTrash',
    'includeArchived',
    'query',
  ]) {
    const value = opts[key];
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

function httpBackend(apiUrl, apiKey) {
  const client = new PersonalNotesClient({ baseUrl: apiUrl, apiKey: apiKey || undefined });
  return {
    listNotes: (opts = {}) => client.listNotes(cleanQuery(opts)),
    getNote: async (id) => {
      try {
        return await client.getNote(id);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    saveNote: (note) => client.saveNote(note),
    deleteNote: async (id) => {
      await client.deleteNote(id);
    },
    archiveNote: (id) => client.archiveNote(id),
    trashNote: (id, opts = {}) =>
      client.trashNote(id, opts?.retentionDays != null ? { retentionDays: opts.retentionDays } : undefined),
    restoreNote: (id) => client.restoreNote(id),
    purgeExpiredTrash: () => client.purgeExpiredTrash(),
    loadNotes: () => client.loadNotes(),
    loadLabelList: () => client.loadLabelList(),
    saveLabelList: (labels) => client.saveLabelList({ labels }),
    renameLabel: async (from, to) => {
      await client.renameLabel({ from, to });
    },
    deleteLabelEverywhere: async (name) => {
      await client.deleteLabel(name);
    },
    assignLabel: (id, label) => client.assignLabel(id, { label }),
    unassignLabel: (id, label) => client.unassignLabel(id, label),
    loadSettings: () => client.loadSettings(),
    saveSettings: (settings) => client.saveSettings(settings),
  };
}

// The local backend forwards every argument (including the optional trailing `root`)
// so drop-in behaviour is preserved exactly.
const localBackend = {
  listNotes: (...args) => local.listNotes(...args),
  getNote: (...args) => local.getNote(...args),
  saveNote: (...args) => local.saveNote(...args),
  deleteNote: (...args) => local.deleteNote(...args),
  archiveNote: (...args) => local.archiveNote(...args),
  trashNote: (...args) => local.trashNote(...args),
  restoreNote: (...args) => local.restoreNote(...args),
  purgeExpiredTrash: (...args) => local.purgeExpiredTrash(...args),
  loadNotes: (...args) => local.loadNotes(...args),
  loadLabelList: (...args) => local.loadLabelList(...args),
  saveLabelList: (...args) => local.saveLabelList(...args),
  renameLabel: (...args) => local.renameLabel(...args),
  deleteLabelEverywhere: (...args) => local.deleteLabelEverywhere(...args),
  assignLabel: (...args) => local.assignLabel(...args),
  unassignLabel: (...args) => local.unassignLabel(...args),
  loadSettings: (...args) => local.loadSettings(...args),
  saveSettings: (...args) => local.saveSettings(...args),
};

/**
 * Resolve the active backend from the environment (or an explicit override for tests).
 * @param {NodeJS.ProcessEnv} [source]
 */
export function createNotesBackend(source = process.env) {
  const { mode, apiUrl, apiKey } = resolveMode(source);
  if (mode !== 'local' && apiUrl) return httpBackend(apiUrl, apiKey);
  return localBackend;
}

// Module-level singleton so surfaces can `import { listNotes } from notes-backend`.
const backend = createNotesBackend();

export const listNotes = (...a) => backend.listNotes(...a);
export const getNote = (...a) => backend.getNote(...a);
export const saveNote = (...a) => backend.saveNote(...a);
export const deleteNote = (...a) => backend.deleteNote(...a);
export const archiveNote = (...a) => backend.archiveNote(...a);
export const trashNote = (...a) => backend.trashNote(...a);
export const restoreNote = (...a) => backend.restoreNote(...a);
export const purgeExpiredTrash = (...a) => backend.purgeExpiredTrash(...a);
export const loadNotes = (...a) => backend.loadNotes(...a);
export const loadLabelList = (...a) => backend.loadLabelList(...a);
export const saveLabelList = (...a) => backend.saveLabelList(...a);
export const renameLabel = (...a) => backend.renameLabel(...a);
export const deleteLabelEverywhere = (...a) => backend.deleteLabelEverywhere(...a);
export const assignLabel = (...a) => backend.assignLabel(...a);
export const unassignLabel = (...a) => backend.unassignLabel(...a);
export const loadSettings = (...a) => backend.loadSettings(...a);
export const saveSettings = (...a) => backend.saveSettings(...a);
