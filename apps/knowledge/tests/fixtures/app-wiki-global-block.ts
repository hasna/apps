import { createAppWikiScope } from '../../src/index.ts';

let initBlocked = false;
let addBlocked = false;
try {
  const wiki = createAppWikiScope({
    scope: 'global',
    cwd: process.cwd(),
    env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'local' },
  } as never);
  try {
    await wiki.init();
  } catch (error) {
    initBlocked = /Global (?:app-)?wiki (?:writes|access) require/.test(String(error));
  }
  try {
    await wiki.notes.add({
      title: 'Blocked Global Wiki',
      content: 'This write must require explicit global permission.',
    });
  } catch (error) {
    addBlocked = /Global (?:app-)?wiki (?:writes|access) require/.test(String(error));
  }
} catch (error) {
  const blocked = /Global (?:app-)?wiki (?:writes|access) require/.test(String(error));
  initBlocked = blocked;
  addBlocked = blocked;
}

process.stdout.write(JSON.stringify({ initBlocked, addBlocked }));
