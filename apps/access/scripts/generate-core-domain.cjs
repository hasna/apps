// Transitional extraction: preserve the legacy MCP/storage implementation while
// moving the unchanged core domain rules onto an asynchronous PostgreSQL seam.
// Prints an apply_patch payload; does not mutate files or application state.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resources = ['identities', 'credentials', 'scopes', 'elevations', 'reviews', 'access-requests', 'revocations', 'tokens', 'registry'];
const texts = Object.fromEntries(resources.map(name => [name, fs.readFileSync(path.join(root, 'src/services', name + '.ts'), 'utf8')]));
texts.audit = fs.readFileSync(path.join(root, 'src/db/audit.ts'), 'utf8');
const files = Object.fromEntries(Object.entries(texts).map(([name, text]) => [name, ts.createSourceFile(name + '.ts', text, ts.ScriptTarget.Latest, true)]));
const asyncNames = new Set(['appendAuditEvent', 'listAuditEvents', 'verifyAuditChain', 'runOperation', 'handler']);
const nameOf = call => ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : '';
const isDb = call => ['get', 'all', 'run'].includes(nameOf(call)) && call.expression.getText().includes('.query(');
function calls(node, output = []) {
  ts.forEachChild(node, child => {
    if (ts.isFunctionLike(child)) return;
    if (ts.isCallExpression(child)) output.push(child);
    calls(child, output);
  });
  return output;
}
let changed;
do {
  changed = false;
  for (const source of Object.values(files)) for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.body || !statement.name) continue;
    if (!asyncNames.has(statement.name.text) && calls(statement.body).some(c => isDb(c) || asyncNames.has(nameOf(c)))) {
      asyncNames.add(statement.name.text); changed = true;
    }
  }
} while (changed);
const output = {};
for (const [name, source] of Object.entries(files)) {
  const text = texts[name];
  const edits = [];
  function visit(node) {
    if (ts.isFunctionLike(node) && node.body) {
      const own = calls(node.body);
      if (ts.isCallExpression(node.body)) own.push(node.body);
      const needed = (ts.isFunctionDeclaration(node) && asyncNames.has(node.name?.text)) || own.some(c => isDb(c) || asyncNames.has(nameOf(c)));
      if (needed) {
        if (ts.isFunctionDeclaration(node)) edits.push([text.indexOf('function', node.getStart()), text.indexOf('function', node.getStart()), 'async ']);
        else if (ts.isArrowFunction(node)) edits.push([node.getStart(), node.getStart(), 'async ']);
        if (node.type) edits.push([node.type.getStart(), node.type.end, `Promise<${node.type.getText()}>`]);
        for (const call of own) if (isDb(call) || asyncNames.has(nameOf(call))) {
          edits.push([call.getStart(), call.getStart(), '(await '], [call.end, call.end, ')']);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  let result = text;
  for (const [start, end, replacement] of edits.sort((a,b) => b[0]-a[0] || b[1]-a[1])) result = result.slice(0,start)+replacement+result.slice(end);
  result = result.replaceAll('"../db/database.js"', '"../core-store.js"').replaceAll('"../db/audit.js"', '"./audit.js"').replaceAll('"../db/crud.js"', '"../../db/crud.js"').replaceAll('"../types/index.js"', '"../../types/index.js"').replaceAll('"../config.js"', '"../../config.js"');
  for (const pure of ['authorization', 'authorization-scopes', 'authorization-constants', 'secret-boundary']) result = result.replaceAll(`"./${pure}.js"`, `"../../services/${pure}.js"`);
  result = result.replaceAll('"../providers/', '"../../providers/');
  if (name === 'audit') {
    result = result.replace('import type { Database } from "bun:sqlite";', 'import type { CoreDatabase as Database } from "../core-store.js";').replace('"./schema.js"', '"../../db/schema.js"');
    result = result.replace('SELECT last_insert_rowid() AS id', "SELECT currval(pg_get_serial_sequence('audit_log', 'id'))::integer AS id");
  }
  if (name === 'tokens') {
    result = result.replace('resolveStorageMode, type StorageMode', 'type StorageMode');
    result = result.replace('options.mode ?? resolveStorageMode()', 'options.mode ?? "cloud"');
  }
  output[`src/server/core-domain/${name}.ts`] = '// PostgreSQL core extraction; legacy services remain only for unresolved compatibility surfaces.\n' + result;
}
console.log(JSON.stringify(output));
